/**
 * API router. Every request is a POST with a JSON body:
 *   { "action": "res.create", "token": "...", "payload": {...}, "idempotency_key": "..." }
 *
 * Responses are always HTTP 200 with a JSON envelope:
 *   { "ok": true,  "data": ... }
 *   { "ok": false, "error": { "code": "...", "message": "..." } }
 * (Apps Script cannot return other status codes from a web app.)
 *
 * Checks for every call, in order:
 *   1. Route exists.
 *   2. Session is valid (except login).
 *   3. Route-level function grant (Hidden returns NOT_FOUND, missing level FORBIDDEN).
 *   4. Service-level checks: property scope, property active, feature flag, business rules.
 * Write calls run under a script lock. Repeated idempotency_key values return the first result.
 */

var PASSWORD_CHANGE_ALLOWED = ['auth.me', 'auth.logout', 'auth.change_password'];

var Api = (function () {

  function route(fn, level, write, handler, opts) {
    var r = { fn: fn, level: level, write: !!write, h: handler, auth: true };
    if (opts) Object.keys(opts).forEach(function (k) { r[k] = opts[k]; });
    return r;
  }

  var ROUTES = {
    'auth.login': route(null, null, true, function (ctx, p) {
      return Auth.login(p.username, p.password);
    }, { auth: false }),
    'auth.logout': route(null, null, false, function (ctx, p, req) {
      Auth.logout(req.token);
      return { signed_out: true };
    }),
    'auth.me': route(null, null, false, function (ctx) { return me(ctx); }),
    'auth.change_password': route(null, null, true, function (ctx, p) { return Account.changePassword(ctx, p); }),

    'admin.orgs.list': route('ADMIN.ORG', 'View', false, function (c) { return Admin.orgsList(c); }),
    'admin.orgs.create': route('ADMIN.ORG', 'Create', true, function (c, p) { return Admin.orgsCreate(c, p); }),
    'admin.properties.list': route('ADMIN.PROPERTY', 'View', false, function (c) { return Admin.propertiesList(c); }),
    'admin.properties.create': route('ADMIN.PROPERTY', 'Create', true, function (c, p) { return Admin.propertiesCreate(c, p); }),
    'admin.properties.update': route('ADMIN.PROPERTY', 'Edit', true, function (c, p) { return Admin.propertiesUpdate(c, p); }),
    'admin.properties.status': route('ADMIN.PROPERTY', 'Edit', true, function (c, p) { return Admin.propertiesSetStatus(c, p); }),
    'admin.users.list': route('ADMIN.USER', 'View', false, function (c, p) { return Admin.usersList(c, p); }),
    'admin.users.create': route('ADMIN.USER', 'Create', true, function (c, p) { return Admin.usersCreate(c, p); }),
    'admin.users.status': route('ADMIN.USER', 'Edit', true, function (c, p) { return Admin.usersSetStatus(c, p); }),
    'admin.users.reset_password': route('ADMIN.USER', 'Edit', true, function (c, p) { return Account.resetByAdmin(c, p); }),
    'admin.email.get': route('ADMIN.EMAIL', 'View', false, function (c) { return Mail.getSettings(c); }),
    'admin.email.save': route('ADMIN.EMAIL', 'Edit', true, function (c, p) { return Mail.saveSettings(c, p); }),
    'admin.email.clear_secret': route('ADMIN.EMAIL', 'Edit', true, function (c, p) { return Mail.clearSecret(c, p); }),
    'admin.email.test': route('ADMIN.EMAIL', 'Execute', true, function (c, p) { return Mail.test(c, p); }),
    'admin.roles.list': route('ADMIN.ROLE', 'View', false, function (c) { return Admin.rolesList(c); }),
    'admin.roles.create': route('ADMIN.ROLE', 'Create', true, function (c, p) { return Admin.rolesCreate(c, p); }),
    'admin.roles.approval_limit': route('ADMIN.ROLE', 'Edit', true, function (c, p) { return Admin.rolesSetApprovalLimit(c, p); }),
    'admin.permissions.catalog': route('ADMIN.PERM', 'View', false, function (c) { return Admin.permissionsCatalog(c); }),
    'admin.permissions.role': route('ADMIN.PERM', 'View', false, function (c, p) { return Admin.permissionsForRole(c, p); }),
    'admin.permissions.set': route('ADMIN.PERM', 'Edit', true, function (c, p) { return Admin.permissionsSet(c, p); }),
    'admin.flags.list': route('ADMIN.FLAG', 'View', false, function (c, p) { return Admin.flagsList(c, p); }),
    'admin.flags.set': route('ADMIN.FLAG', 'Edit', true, function (c, p) { return Admin.flagsSet(c, p); }),
    'admin.audit.list': route('ADMIN.AUDIT', 'View', false, function (c, p) { return Admin.auditList(c, p); }),

    'config.room_types.list': route(null, null, false, function (c, p) { return ConfigSvc.roomTypesList(c, p); }),
    'config.room_types.create': route(null, null, true, function (c, p) { return ConfigSvc.roomTypesCreate(c, p); }),
    'config.room_types.update': route(null, null, true, function (c, p) { return ConfigSvc.roomTypesUpdate(c, p); }),
    'config.rooms.list': route(null, null, false, function (c, p) { return ConfigSvc.roomsList(c, p); }),
    'config.rooms.create': route(null, null, true, function (c, p) { return ConfigSvc.roomsCreate(c, p); }),
    'config.rooms.update': route(null, null, true, function (c, p) { return ConfigSvc.roomsUpdate(c, p); }),
    'config.items.list': route(null, null, false, function (c, p) { return ConfigSvc.configList(c, p); }),
    'config.items.create': route(null, null, true, function (c, p) { return ConfigSvc.configCreate(c, p); }),
    'config.items.update': route(null, null, true, function (c, p) { return ConfigSvc.configUpdate(c, p); }),

    'res.availability': route(null, null, false, function (c, p) { return Reservations.availability(c, p); }),
    'res.create': route(null, null, true, function (c, p) { return Reservations.create(c, p); }),
    'res.get': route(null, null, false, function (c, p) { return Reservations.get(c, p); }),
    'res.list': route(null, null, false, function (c, p) { return Reservations.list(c, p); }),
    'res.modify': route(null, null, true, function (c, p) { return Reservations.modify(c, p); }),
    'res.cancel': route(null, null, true, function (c, p) { return Reservations.cancel(c, p); }),
    'res.no_show': route(null, null, true, function (c, p) { return Reservations.noShow(c, p); }),
    'res.guests.search': route(null, null, false, function (c, p) { return Reservations.guestsSearch(c, p); }),

    'fo.rack': route(null, null, false, function (c, p) { return FrontOffice.rack(c, p); }),
    'fo.arrivals': route(null, null, false, function (c, p) { return FrontOffice.arrivals(c, p); }),
    'fo.departures': route(null, null, false, function (c, p) { return FrontOffice.departures(c, p); }),
    'fo.checkin': route(null, null, true, function (c, p) { return FrontOffice.checkIn(c, p); }),
    'fo.checkout': route(null, null, true, function (c, p) { return FrontOffice.checkOut(c, p); }),
    'fo.room_status': route(null, null, true, function (c, p) { return FrontOffice.setRoomStatus(c, p); }),

    'cash.folio': route(null, null, false, function (c, p) { return Cashier.folio(c, p); }),
    'cash.post': route(null, null, true, function (c, p) { return Cashier.post(c, p); }),
    'cash.transfer': route(null, null, true, function (c, p) { return Cashier.transfer(c, p); }),
    'cash.reverse': route(null, null, true, function (c, p) { return Cashier.reverse(c, p); }),

    'audit.status': route(null, null, false, function (c, p) { return NightAudit.status(c, p); }),
    'audit.run': route(null, null, true, function (c, p) { return NightAudit.run(c, p); }),

    'rpt.occupancy': route(null, null, false, function (c, p) { return Reports.occupancyRange(c, p); }),
    'rpt.flash': route(null, null, false, function (c, p) { return Reports.flash(c, p); }),
    'rpt.daily_revenue': route(null, null, false, function (c, p) { return Reports.dailyRevenue(c, p); }),
    'rpt.daily_revenue_csv': route(null, null, false, function (c, p) { return Reports.dailyRevenueCsv(c, p); }),
    'rpt.guest_ledger': route(null, null, false, function (c, p) { return Reports.guestLedger(c, p); })
  };

  /** Route-level function IDs are checked here. Service-level checks run inside each handler. */

  function me(ctx) {
    var grants = {};
    Object.keys(ctx.grants).forEach(function (fn) {
      var levels = Perm.levelsOf(ctx.grants, fn);
      if (levels.length) grants[fn] = levels;
    });
    var visible = Store.list('Properties', function (p) {
      return Perm.isSystemUser(ctx.user) || Auth.splitList(ctx.user.property_ids).indexOf(p.property_id) !== -1;
    });
    var modules = {};
    visible.forEach(function (p) {
      modules[p.property_id] = Store.list('Feature_Flags', function (f) {
        return f.property_id === p.property_id && String(f.enabled) === 'true';
      }).map(function (f) { return f.module_key; });
    });
    return {
      user: Auth.publicUser(ctx.user),
      is_system_admin: Perm.isSystemUser(ctx.user),
      grants: grants,
      properties: Store.publicRows(visible).map(function (p) {
        return { property_id: p.property_id, code: p.code, name: p.name, status: p.status,
          business_date: p.business_date, currency: p.currency, modules: modules[p.property_id] || [] };
      })
    };
  }

  function withLock(fn) {
    var lock = LockService.getScriptLock();
    if (!lock.tryLock(CFG.LOCK_WAIT_MS)) {
      throw new PmsError('BUSY', 'The system is busy. Please try again.', 503);
    }
    try {
      return fn();
    } finally {
      lock.releaseLock();
    }
  }

  function idempotent(userId, action, key, fn) {
    if (!key) return fn();
    var cache = CacheService.getScriptCache();
    var cacheKey = 'idem:' + Hash.sha256Hex(userId + '|' + action + '|' + key);
    var hit = cache.get(cacheKey);
    if (hit) return JSON.parse(hit);
    var result = fn();
    cache.put(cacheKey, JSON.stringify(result), CFG.IDEMPOTENCY_TTL_SECONDS);
    return result;
  }

  /** Fixed-window rate limit per key. Approximate under heavy parallel use. */
  function rateLimit(key) {
    var cache = CacheService.getScriptCache();
    var cacheKey = 'rl:' + Hash.sha256Hex(key) + ':' + Math.floor(Date.now() / 60000);
    var count = Number(cache.get(cacheKey) || 0) + 1;
    cache.put(cacheKey, String(count), 70);
    if (count > CFG.RATE_LIMIT_PER_MINUTE) {
      throw new PmsError('RATE_LIMITED', 'Too many requests. Wait a minute and try again.', 429);
    }
  }

  /** Core dispatch. Pure apart from the services it calls, so tests can drive it directly. */
  function dispatch(req) {
    var action = String(req.action || '');
    var r = ROUTES[action];
    if (!r) throw new PmsError('NOT_FOUND', 'Unknown action', 404);
    var payload = req.payload && typeof req.payload === 'object' ? req.payload : {};

    Store.beginRequest();
    var ctx = null;
    if (r.auth) {
      var session = Auth.resolve(req.token);
      ctx = { user: session.user, session: session.session, grants: Perm.grantsFor(session.user) };
      rateLimit('user:' + session.user.user_id);
      // A user with a temporary password can only look at themselves or change the password.
      if (String(session.user.must_change_password) === 'true' && PASSWORD_CHANGE_ALLOWED.indexOf(action) === -1) {
        throw new PmsError('PASSWORD_CHANGE_REQUIRED', 'Change your temporary password before continuing', 403);
      }
      if (r.fn) Perm.authorize(ctx, r.fn, r.level);
    } else {
      rateLimit('login:' + String(payload.username || '').toLowerCase());
    }

    if (!r.write) return r.h(ctx, payload, req);

    return withLock(function () {
      Store.beginRequest();
      if (ctx && r.fn) Perm.authorize(ctx, r.fn, r.level);
      var userKey = ctx ? ctx.user.user_id : String(payload.username || '').toLowerCase();
      return idempotent(userKey, action, req.idempotency_key, function () {
        return r.h(ctx, payload, req);
      });
    });
  }

  /** Converts any thrown value into the error envelope. Internal details never reach the client. */
  function errorEnvelope(err) {
    if (err && err.name === 'PmsError') {
      return { ok: false, error: { code: err.code, message: err.message } };
    }
    console.error('Unhandled: ' + (err && err.stack ? err.stack : err));
    return { ok: false, error: { code: 'INTERNAL', message: 'Unexpected error. The incident was logged.' } };
  }

  function handle(bodyText) {
    try {
      var req = JSON.parse(bodyText || '{}');
      return { ok: true, data: dispatch(req) };
    } catch (err) {
      return errorEnvelope(err);
    }
  }

  return { dispatch: dispatch, handle: handle, ROUTES: ROUTES, errorEnvelope: errorEnvelope, me: me };
})();

/** Apps Script entry point for POST. Store backend is set here so every call uses Sheets. */
function doPost(e) {
  Store.setBackend(SheetsBackend);
  var body = e && e.postData ? e.postData.contents : '';
  var out = Api.handle(body);
  return ContentService.createTextOutput(JSON.stringify(out)).setMimeType(ContentService.MimeType.JSON);
}

/** GET returns a health marker only. No data is exposed. */
function doGet() {
  return ContentService.createTextOutput(JSON.stringify({ ok: true, service: 'pms-api' }))
    .setMimeType(ContentService.MimeType.JSON);
}
