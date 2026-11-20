/**
 * System and Organization administration: organizations, properties and
 * licensing, users, roles, permission matrix, feature flags, audit viewer.
 *
 * Rules enforced here:
 * - Only System Admin (org '*') may create or suspend properties, switch
 *   feature flags, or set approval limits.
 * - No privilege escalation: a non-system user can grant a role or a level
 *   only if they hold that level themselves.
 * - Property user limits are enforced when a user is created or activated.
 */

var Admin = (function () {

  function requireSystem(ctx) {
    if (!Perm.isSystemUser(ctx.user)) {
      throw new PmsError('FORBIDDEN', 'System Administrator only', 403);
    }
  }

  function assertPasswordPolicy(password) {
    var p = String(password || '');
    if (p.length < CFG.MIN_PASSWORD_LENGTH) {
      throw new PmsError('VALIDATION', 'password must be at least ' + CFG.MIN_PASSWORD_LENGTH + ' characters');
    }
    if (!/[A-Za-z]/.test(p) || !/\d/.test(p)) {
      throw new PmsError('VALIDATION', 'password must contain a letter and a digit');
    }
    return p;
  }

  /** A caller may assign a role only if they already hold every level it grants. */
  function assertCanGrantRoles(ctx, roleIds) {
    if (Perm.isSystemUser(ctx.user)) return;
    roleIds.forEach(function (roleId) {
      Store.list('Permissions', function (p) { return p.role_id === roleId; }).forEach(function (p) {
        Auth.splitList(p.levels).forEach(function (level) {
          if (!Perm.hasLevel(ctx.grants, p.function_id, level)) {
            throw new PmsError('ESCALATION', 'You cannot grant ' + level + ' on ' + p.function_id, 403);
          }
        });
      });
    });
  }

  function visibleProperties(ctx) {
    return Store.list('Properties', function (p) {
      return Perm.isSystemUser(ctx.user) || Auth.splitList(ctx.user.property_ids).indexOf(p.property_id) !== -1;
    });
  }

  // ---- Organizations -------------------------------------------------------

  function orgsList(ctx) {
    Perm.authorize(ctx, 'ADMIN.ORG', 'View');
    return Store.publicRows(Store.list('Organizations', function () { return true; }));
  }

  function orgsCreate(ctx, p) {
    Perm.authorize(ctx, 'ADMIN.ORG', 'Create');
    requireSystem(ctx);
    var name = Validate.text(p.name, 'name', 120);
    var row = Store.insert('Organizations', { name: name, status: 'ACTIVE' }, ctx.user.user_id);
    Audit.record(ctx, 'ADMIN.ORG', 'CREATE', 'Organizations', row.org_id, null, row);
    return Store.publicRow(row);
  }

  // ---- Properties and licensing -------------------------------------------

  function propertiesList(ctx) {
    Perm.authorize(ctx, 'ADMIN.PROPERTY', 'View');
    return Store.publicRows(visibleProperties(ctx));
  }

  function propertiesCreate(ctx, p) {
    Perm.authorize(ctx, 'ADMIN.PROPERTY', 'Create');
    requireSystem(ctx);
    var orgId = Validate.text(p.org_id, 'org_id', 60);
    Store.mustGet('Organizations', orgId);
    var code = Validate.text(p.code, 'code', 12).toUpperCase();
    if (Store.list('Properties', function (x) { return x.code === code; }).length) {
      throw new PmsError('DUPLICATE', 'Property code ' + code + ' already exists', 409);
    }
    var currency = Validate.text(p.currency || CFG.CURRENCY_DEFAULT || 'USD', 'currency', 3).toUpperCase();
    var businessDate = Dates.assertIsoDate(p.business_date, 'business_date');
    var row = Store.insert('Properties', {
      org_id: orgId,
      code: code,
      name: Validate.text(p.name, 'name', 120),
      status: 'ACTIVE',
      currency: currency,
      timezone: Validate.text(p.timezone || 'UTC', 'timezone', 40),
      business_date: businessDate,
      license_rooms: Validate.integer(p.license_rooms, 'license_rooms', 1, 100000),
      user_limit: Validate.integer(p.user_limit || 10, 'user_limit', 1, 10000)
    }, ctx.user.user_id);
    // New properties start with every module on. System Admin can switch any off.
    MODULES.forEach(function (m) {
      Store.insert('Feature_Flags', { property_id: row.property_id, module_key: m, enabled: 'true' }, ctx.user.user_id);
    });
    Setup.seedDefaultCodes(row.property_id, ctx.user.user_id);
    Audit.record(ctx, 'ADMIN.PROPERTY', 'CREATE', 'Properties', row.property_id, null, row, row.property_id);
    return Store.publicRow(row);
  }

  function propertiesUpdate(ctx, p) {
    Perm.authorize(ctx, 'ADMIN.PROPERTY', 'Edit');
    requireSystem(ctx);
    var patch = {};
    if (p.name !== undefined) patch.name = Validate.text(p.name, 'name', 120);
    if (p.license_rooms !== undefined) patch.license_rooms = Validate.integer(p.license_rooms, 'license_rooms', 1, 100000);
    if (p.user_limit !== undefined) patch.user_limit = Validate.integer(p.user_limit, 'user_limit', 1, 10000);
    if (p.timezone !== undefined) patch.timezone = Validate.text(p.timezone, 'timezone', 40);
    var result = Store.update('Properties', p.property_id, patch, p.version, ctx.user.user_id);
    Audit.record(ctx, 'ADMIN.PROPERTY', 'UPDATE', 'Properties', p.property_id, result.before, result.after, p.property_id);
    return Store.publicRow(result.after);
  }

  function propertiesSetStatus(ctx, p) {
    Perm.authorize(ctx, 'ADMIN.PROPERTY', 'Edit');
    requireSystem(ctx);
    var status = Validate.oneOf(p.status, 'status', ['ACTIVE', 'SUSPENDED']);
    var result = Store.update('Properties', p.property_id, { status: status }, p.version, ctx.user.user_id);
    Audit.record(ctx, 'ADMIN.PROPERTY', 'STATUS', 'Properties', p.property_id, result.before, result.after, p.property_id);
    return Store.publicRow(result.after);
  }

  // ---- Users ---------------------------------------------------------------

  function activeUsersOnProperty(propertyId) {
    return Store.list('Users', function (u) {
      return u.status === 'ACTIVE' && Auth.splitList(u.property_ids).indexOf(propertyId) !== -1;
    }).length;
  }

  function assertUserLimit(propertyIds) {
    propertyIds.forEach(function (pid) {
      var property = Store.mustGet('Properties', pid);
      if (activeUsersOnProperty(pid) >= Number(property.user_limit)) {
        throw new PmsError('USER_LIMIT', 'User limit reached for ' + property.code, 409);
      }
    });
  }

  function usersList(ctx, p) {
    Perm.authorize(ctx, 'ADMIN.USER', 'View');
    var users = Store.list('Users', function (u) {
      if (Perm.isSystemUser(ctx.user)) return true;
      var mine = Auth.splitList(ctx.user.property_ids);
      return Auth.splitList(u.property_ids).some(function (pid) { return mine.indexOf(pid) !== -1; });
    });
    if (p && p.property_id) {
      users = users.filter(function (u) { return Auth.splitList(u.property_ids).indexOf(p.property_id) !== -1; });
    }
    return Paging.page(users.map(function (u) {
      return { user_id: u.user_id, username: u.username, display_name: u.display_name, status: u.status,
        role_ids: Auth.splitList(u.role_ids), property_ids: Auth.splitList(u.property_ids), version: u.version };
    }), p);
  }

  function usersCreate(ctx, p) {
    Perm.authorize(ctx, 'ADMIN.USER', 'Create');
    var username = Validate.text(p.username, 'username', 80).toLowerCase();
    if (!/^[a-z0-9._-]+$/.test(username)) throw new PmsError('VALIDATION', 'username may use letters, digits, . _ -');
    if (Store.list('Users', function (u) { return String(u.username).toLowerCase() === username; }).length) {
      throw new PmsError('DUPLICATE', 'Username already exists', 409);
    }
    var roleIds = Auth.splitList(p.role_ids);
    var propertyIds = Auth.splitList(p.property_ids);
    if (!roleIds.length) throw new PmsError('VALIDATION', 'at least one role is required');
    roleIds.forEach(function (r) { Store.mustGet('Roles', r); });
    propertyIds.forEach(function (pid) {
      Perm.assertPropertyScope(ctx.user, pid);
    });
    assertCanGrantRoles(ctx, roleIds);
    assertUserLimit(propertyIds);
    // A user's org comes from the property they are assigned to. The system scope '*' is
    // reserved for the System Administrator created by Setup, so it is never inherited.
    var orgId = propertyIds.length ? Store.mustGet('Properties', propertyIds[0]).org_id : ctx.user.org_id;
    if (Perm.isSystemUser(ctx.user) && p.org_id) orgId = Validate.text(p.org_id, 'org_id', 60);
    if (orgId === '*') throw new PmsError('VALIDATION', 'Users must belong to an organization');
    Store.mustGet('Organizations', orgId);
    var salt = Hash.newSalt();
    var row = Store.insert('Users', {
      org_id: orgId,
      username: username,
      display_name: Validate.text(p.display_name, 'display_name', 120),
      password_hash: Hash.passwordHash(assertPasswordPolicy(p.password), salt),
      salt: salt,
      status: 'ACTIVE',
      role_ids: roleIds.join(','),
      property_ids: propertyIds.join(','),
      failed_logins: 0,
      locked_until: ''
    }, ctx.user.user_id);
    Audit.record(ctx, 'ADMIN.USER', 'CREATE', 'Users', row.user_id, null,
      { user_id: row.user_id, username: username, role_ids: roleIds, property_ids: propertyIds });
    return { user_id: row.user_id, username: username, status: 'ACTIVE' };
  }

  function usersSetStatus(ctx, p) {
    Perm.authorize(ctx, 'ADMIN.USER', 'Edit');
    var target = Store.mustGet('Users', p.user_id);
    Auth.splitList(target.property_ids).forEach(function (pid) { Perm.assertPropertyScope(ctx.user, pid); });
    var status = Validate.oneOf(p.status, 'status', ['ACTIVE', 'DISABLED']);
    if (status === 'ACTIVE' && target.status !== 'ACTIVE') {
      assertUserLimit(Auth.splitList(target.property_ids));
    }
    var result = Store.update('Users', p.user_id, { status: status, failed_logins: 0, locked_until: '' },
      p.version, ctx.user.user_id);
    Audit.record(ctx, 'ADMIN.USER', 'STATUS', 'Users', p.user_id, { status: result.before.status },
      { status: status });
    return { user_id: p.user_id, status: status };
  }

  // ---- Roles and permission matrix ----------------------------------------

  function rolesList(ctx) {
    Perm.authorize(ctx, 'ADMIN.ROLE', 'View');
    return Store.publicRows(Store.list('Roles', function () { return true; }));
  }

  function rolesCreate(ctx, p) {
    Perm.authorize(ctx, 'ADMIN.ROLE', 'Create');
    requireSystem(ctx);
    var row = Store.insert('Roles', {
      org_id: '*',
      name: Validate.text(p.name, 'name', 80),
      is_system: 'false',
      approval_limit_minor: 0
    }, ctx.user.user_id);
    Audit.record(ctx, 'ADMIN.ROLE', 'CREATE', 'Roles', row.role_id, null, row);
    return Store.publicRow(row);
  }

  function rolesSetApprovalLimit(ctx, p) {
    Perm.authorize(ctx, 'ADMIN.ROLE', 'Edit');
    requireSystem(ctx);
    var limit = Money.parse(p.approval_limit, 'approval_limit');
    if (limit < 0) throw new PmsError('VALIDATION', 'approval_limit cannot be negative');
    var result = Store.update('Roles', p.role_id, { approval_limit_minor: limit }, p.version, ctx.user.user_id);
    Audit.record(ctx, 'ADMIN.ROLE', 'APPROVAL_LIMIT', 'Roles', p.role_id, result.before, result.after);
    return Store.publicRow(result.after);
  }

  function permissionsCatalog(ctx) {
    Perm.authorize(ctx, 'ADMIN.PERM', 'View');
    return Object.keys(FUNCTIONS).map(function (id) {
      return { function_id: id, label: FUNCTIONS[id].label, module: FUNCTIONS[id].module };
    });
  }

  function permissionsForRole(ctx, p) {
    Perm.authorize(ctx, 'ADMIN.PERM', 'View');
    var roleId = Validate.text(p.role_id, 'role_id', 60);
    Store.mustGet('Roles', roleId);
    return Store.publicRows(Store.list('Permissions', function (x) { return x.role_id === roleId; }));
  }

  /** Sets the levels a role holds on one function. Empty levels hides the function. */
  function permissionsSet(ctx, p) {
    Perm.authorize(ctx, 'ADMIN.PERM', 'Edit');
    var roleId = Validate.text(p.role_id, 'role_id', 60);
    Store.mustGet('Roles', roleId);
    if (!FUNCTIONS[p.function_id]) throw new PmsError('VALIDATION', 'Unknown function_id');
    var levels = Array.isArray(p.levels) ? p.levels : [];
    levels.forEach(function (l) { Validate.oneOf(l, 'level', LEVELS); });
    if (!Perm.isSystemUser(ctx.user)) {
      levels.forEach(function (l) {
        if (!Perm.hasLevel(ctx.grants, p.function_id, l)) {
          throw new PmsError('ESCALATION', 'You cannot grant ' + l + ' on ' + p.function_id, 403);
        }
      });
    }
    var levelText = levels.join(',');
    var existing = Store.list('Permissions', function (x) {
      return x.role_id === roleId && x.function_id === p.function_id;
    })[0];
    var result;
    if (existing) {
      result = Store.update('Permissions', existing.perm_id, { levels: levelText }, null, ctx.user.user_id);
      Audit.record(ctx, 'ADMIN.PERM', 'UPDATE', 'Permissions', existing.perm_id, result.before, result.after);
      return Store.publicRow(result.after);
    }
    var row = Store.insert('Permissions', { role_id: roleId, function_id: p.function_id, levels: levelText }, ctx.user.user_id);
    Audit.record(ctx, 'ADMIN.PERM', 'CREATE', 'Permissions', row.perm_id, null, row);
    return Store.publicRow(row);
  }

  // ---- Feature flags -------------------------------------------------------

  function flagsList(ctx, p) {
    Perm.authorize(ctx, 'ADMIN.FLAG', 'View', p.property_id);
    return Store.publicRows(Store.list('Feature_Flags', function (f) { return f.property_id === p.property_id; }));
  }

  function flagsSet(ctx, p) {
    Perm.authorize(ctx, 'ADMIN.FLAG', 'Edit');
    requireSystem(ctx);
    Store.mustGet('Properties', p.property_id);
    var module = Validate.oneOf(p.module_key, 'module_key', MODULES);
    var enabled = p.enabled === true ? 'true' : 'false';
    var flag = Store.list('Feature_Flags', function (f) {
      return f.property_id === p.property_id && f.module_key === module;
    })[0];
    var result;
    if (flag) {
      result = Store.update('Feature_Flags', flag.flag_id, { enabled: enabled }, null, ctx.user.user_id);
      Audit.record(ctx, 'ADMIN.FLAG', 'UPDATE', 'Feature_Flags', flag.flag_id, result.before, result.after, p.property_id);
      return Store.publicRow(result.after);
    }
    var row = Store.insert('Feature_Flags', { property_id: p.property_id, module_key: module, enabled: enabled }, ctx.user.user_id);
    Audit.record(ctx, 'ADMIN.FLAG', 'CREATE', 'Feature_Flags', row.flag_id, null, row, p.property_id);
    return Store.publicRow(row);
  }

  // ---- Audit viewer --------------------------------------------------------

  function auditList(ctx, p) {
    Perm.authorize(ctx, 'ADMIN.AUDIT', 'View');
    var rows = Store.list('Audit_Log', function (a) {
      if (p.property_id && a.property_id !== p.property_id) return false;
      if (p.entity && a.entity !== p.entity) return false;
      if (p.entity_id && a.entity_id !== p.entity_id) return false;
      return true;
    });
    rows.sort(function (x, y) { return x.at < y.at ? 1 : x.at > y.at ? -1 : 0; });
    return Paging.page(Store.publicRows(rows), p);
  }

  return {
    requireSystem: requireSystem,
    assertPasswordPolicy: assertPasswordPolicy,
    orgsList: orgsList, orgsCreate: orgsCreate,
    propertiesList: propertiesList, propertiesCreate: propertiesCreate,
    propertiesUpdate: propertiesUpdate, propertiesSetStatus: propertiesSetStatus,
    usersList: usersList, usersCreate: usersCreate, usersSetStatus: usersSetStatus,
    rolesList: rolesList, rolesCreate: rolesCreate, rolesSetApprovalLimit: rolesSetApprovalLimit,
    permissionsCatalog: permissionsCatalog, permissionsForRole: permissionsForRole, permissionsSet: permissionsSet,
    flagsList: flagsList, flagsSet: flagsSet, auditList: auditList
  };
})();
