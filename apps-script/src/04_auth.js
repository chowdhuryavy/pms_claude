/**
 * Authentication (username, password, opaque session token) and authorization
 * (role grants, property scope, feature flags). Every API call passes through
 * Perm.authorize on the server. The frontend never decides access.
 */

var Hash = (function () {
  function toHex(bytes) {
    var out = '';
    for (var i = 0; i < bytes.length; i++) {
      out += ((bytes[i] & 0xff) + 0x100).toString(16).slice(1);
    }
    return out;
  }

  function sha256Hex(text) {
    return toHex(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, text, Utilities.Charset.UTF_8));
  }

  /** Iterated salted SHA-256. Apps Script has no bcrypt, so cost comes from rounds. */
  function passwordHash(password, salt) {
    var h = salt + ':' + password;
    for (var i = 0; i < CFG.PASSWORD_ROUNDS; i++) {
      h = sha256Hex(h + ':' + salt);
    }
    return h;
  }

  function newSalt() {
    return Ids.newId('SALT').toLowerCase();
  }

  return { sha256Hex: sha256Hex, passwordHash: passwordHash, newSalt: newSalt };
})();

var Auth = (function () {
  function newToken() {
    return Utilities.getUuid() + Utilities.getUuid().replace(/-/g, '');
  }

  function minutesFromNow(minutes) {
    return new Date(Date.now() + minutes * 60000).toISOString();
  }

  function hoursFromNow(hours) {
    return new Date(Date.now() + hours * 3600000).toISOString();
  }

  function publicUser(user) {
    return {
      user_id: user.user_id,
      org_id: user.org_id,
      username: user.username,
      display_name: user.display_name,
      status: user.status,
      role_ids: splitList(user.role_ids),
      property_ids: splitList(user.property_ids)
    };
  }

  function splitList(s) {
    return String(s || '').split(',').map(function (x) { return x.trim(); }).filter(Boolean);
  }

  /** Verifies credentials. Locks the account after repeated failures. */
  function login(username, password) {
    var name = Validate.text(username, 'username', 80).toLowerCase();
    var pwd = String(password || '');
    var user = Store.list('Users', function (u) {
      return String(u.username).toLowerCase() === name;
    })[0];

    // Same generic message for unknown user, bad password and locked account.
    var invalid = new PmsError('AUTH_FAILED', 'Invalid username or password', 401);
    if (!user) {
      // Burn comparable time so timing does not reveal which usernames exist.
      Hash.passwordHash(pwd, 'dummy-salt');
      throw invalid;
    }
    if (user.locked_until && new Date(user.locked_until).getTime() > Date.now()) {
      throw new PmsError('ACCOUNT_LOCKED', 'Account is temporarily locked. Try again later.', 423);
    }
    if (user.status !== 'ACTIVE') throw invalid;

    if (Hash.passwordHash(pwd, user.salt) !== user.password_hash) {
      var failures = Number(user.failed_logins || 0) + 1;
      var patch = { failed_logins: failures };
      if (failures >= CFG.LOGIN_MAX_FAILURES) {
        patch.locked_until = minutesFromNow(CFG.LOGIN_LOCK_MINUTES);
        patch.failed_logins = 0;
      }
      Store.update('Users', user.user_id, patch, null, user.user_id);
      throw invalid;
    }

    Store.update('Users', user.user_id, { failed_logins: 0, locked_until: '' }, null, user.user_id);
    var token = newToken();
    Store.insert('Sessions', {
      token_hash: Hash.sha256Hex(token),
      user_id: user.user_id,
      created_at: Dates.now(),
      expires_at: hoursFromNow(CFG.SESSION_HOURS),
      revoked: ''
    }, user.user_id);
    return { token: token, user: publicUser(user), expires_in_hours: CFG.SESSION_HOURS };
  }

  /** Latest session row for a token hash. Sessions are append-only, so the last row wins. */
  function latestSession(hash) {
    var matches = Store.list('Sessions', function (s) { return s.token_hash === hash; });
    return matches.length ? matches[matches.length - 1] : null;
  }

  /** Resolves a bearer token to { user, session } or throws UNAUTHENTICATED. */
  function resolve(token) {
    if (!token) throw new PmsError('UNAUTHENTICATED', 'Sign in required', 401);
    var hash = Hash.sha256Hex(String(token));
    var session = latestSession(hash);
    if (!session || String(session.revoked) === 'true' || new Date(session.expires_at).getTime() <= Date.now()) {
      throw new PmsError('UNAUTHENTICATED', 'Session expired. Sign in again.', 401);
    }
    var user = Store.get('Users', session.user_id);
    if (!user || user.status !== 'ACTIVE') {
      throw new PmsError('UNAUTHENTICATED', 'Account is not active', 401);
    }
    return { user: user, session: session };
  }

  /** Revokes a session. Sessions are append-only, so revocation is a new row with the same hash. */
  function logout(token) {
    if (!token) return;
    var hash = Hash.sha256Hex(String(token));
    var session = latestSession(hash);
    if (session && String(session.revoked) !== 'true') {
      Store.insert('Sessions', {
        token_hash: hash, user_id: session.user_id, created_at: Dates.now(),
        expires_at: session.expires_at, revoked: 'true'
      }, session.user_id);
    }
  }

  return { login: login, resolve: resolve, logout: logout, publicUser: publicUser, splitList: splitList };
})();

var Perm = (function () {
  function isSystemUser(user) {
    return user.org_id === '*';
  }

  /** Union of levels granted to the user across all roles, per function ID. */
  function grantsFor(user) {
    var roleIds = Auth.splitList(user.role_ids);
    var grants = {};
    var perms = Store.list('Permissions', function (p) {
      return roleIds.indexOf(p.role_id) !== -1;
    });
    perms.forEach(function (p) {
      var levels = Auth.splitList(p.levels);
      if (!grants[p.function_id]) grants[p.function_id] = {};
      levels.forEach(function (l) { grants[p.function_id][l] = true; });
    });
    return grants;
  }

  function levelsOf(grants, fn) {
    var set = grants[fn] || {};
    var all = Object.keys(set);
    if (set['Full Access']) return LEVELS.slice();
    return all;
  }

  function hasLevel(grants, fn, required) {
    var set = grants[fn] || {};
    return !!(set['Full Access'] || set[required]);
  }

  function assertFeatureEnabled(propertyId, moduleKey) {
    if (!moduleKey) return;
    var flag = Store.list('Feature_Flags', function (f) {
      return f.property_id === propertyId && f.module_key === moduleKey;
    })[0];
    if (!flag || String(flag.enabled) !== 'true') {
      throw new PmsError('MODULE_DISABLED', moduleKey + ' is not enabled for this property', 403);
    }
  }

  function assertPropertyScope(user, propertyId) {
    if (isSystemUser(user)) return;
    if (Auth.splitList(user.property_ids).indexOf(propertyId) === -1) {
      throw new PmsError('FORBIDDEN', 'You do not have access to this property', 403);
    }
  }

  function assertPropertyActive(propertyId) {
    var property = Store.mustGet('Properties', propertyId);
    if (property.status !== 'ACTIVE') {
      throw new PmsError('PROPERTY_SUSPENDED', 'This property is suspended', 403);
    }
    return property;
  }

  /**
   * Checks one API call. Hidden (no grant at all) returns NOT_FOUND so the
   * function does not reveal itself. A grant without the required level returns FORBIDDEN.
   */
  function authorize(ctx, fnId, level, propertyId) {
    var meta = FUNCTIONS[fnId];
    if (!meta) throw new PmsError('INTERNAL', 'Unregistered function ' + fnId, 500);
    if (levelsOf(ctx.grants, fnId).length === 0) {
      throw new PmsError('NOT_FOUND', 'Not found', 404);
    }
    if (!hasLevel(ctx.grants, fnId, level)) {
      throw new PmsError('FORBIDDEN', 'Your role does not allow ' + level + ' on ' + meta.label, 403);
    }
    if (propertyId) {
      assertPropertyScope(ctx.user, propertyId);
      assertPropertyActive(propertyId);
      assertFeatureEnabled(propertyId, meta.module);
    }
    return true;
  }

  /** Highest approval limit across the user's roles (minor units). */
  function approvalLimitFor(user) {
    var roleIds = Auth.splitList(user.role_ids);
    var limit = 0;
    Store.list('Roles', function (r) { return roleIds.indexOf(r.role_id) !== -1; }).forEach(function (r) {
      var v = Number(r.approval_limit_minor || 0);
      if (v > limit) limit = v;
    });
    return limit;
  }

  return {
    grantsFor: grantsFor, levelsOf: levelsOf, hasLevel: hasLevel, authorize: authorize,
    assertPropertyScope: assertPropertyScope, assertPropertyActive: assertPropertyActive,
    assertFeatureEnabled: assertFeatureEnabled, approvalLimitFor: approvalLimitFor,
    isSystemUser: isSystemUser
  };
})();
