/**
 * Property configuration: room types, rooms, and config items (rate, transaction,
 * market, source, package and payment codes, and tax rules).
 */

var ConfigSvc = (function () {

  function propertyOf(ctx, fn, level, propertyId) {
    var pid = Validate.text(propertyId, 'property_id', 60);
    Perm.authorize(ctx, fn, level, pid);
    return pid;
  }

  // ---- Room types ----------------------------------------------------------

  function roomTypesList(ctx, p) {
    var pid = propertyOf(ctx, 'CFG.ROOMTYPE', 'View', p.property_id);
    var rows = Store.list('Room_Types', function (r) { return r.property_id === pid; });
    return Paging.page(Store.publicRows(rows), p);
  }

  function roomTypesCreate(ctx, p) {
    var pid = propertyOf(ctx, 'CFG.ROOMTYPE', 'Create', p.property_id);
    var code = Validate.text(p.code, 'code', 12).toUpperCase();
    if (Store.list('Room_Types', function (r) { return r.property_id === pid && r.code === code; }).length) {
      throw new PmsError('DUPLICATE', 'Room type ' + code + ' already exists', 409);
    }
    var row = Store.insert('Room_Types', {
      property_id: pid,
      code: code,
      description: Validate.text(p.description, 'description', 120),
      max_occupancy: Validate.integer(p.max_occupancy, 'max_occupancy', 1, 20),
      base_rate_minor: Money.parse(p.base_rate, 'base_rate'),
      active: 'true'
    }, ctx.user.user_id);
    Audit.record(ctx, 'CFG.ROOMTYPE', 'CREATE', 'Room_Types', row.room_type_id, null, row, pid);
    return Store.publicRow(row);
  }

  function roomTypesUpdate(ctx, p) {
    var existing = Store.mustGet('Room_Types', p.room_type_id);
    var pid = propertyOf(ctx, 'CFG.ROOMTYPE', 'Edit', existing.property_id);
    var patch = {};
    if (p.description !== undefined) patch.description = Validate.text(p.description, 'description', 120);
    if (p.max_occupancy !== undefined) patch.max_occupancy = Validate.integer(p.max_occupancy, 'max_occupancy', 1, 20);
    if (p.base_rate !== undefined) patch.base_rate_minor = Money.parse(p.base_rate, 'base_rate');
    if (p.active !== undefined) patch.active = p.active ? 'true' : 'false';
    var result = Store.update('Room_Types', p.room_type_id, patch, p.version, ctx.user.user_id);
    Audit.record(ctx, 'CFG.ROOMTYPE', 'UPDATE', 'Room_Types', p.room_type_id, result.before, result.after, pid);
    return Store.publicRow(result.after);
  }

  // ---- Rooms ---------------------------------------------------------------

  function roomsList(ctx, p) {
    var pid = propertyOf(ctx, 'CFG.ROOM', 'View', p.property_id);
    var rows = Store.list('Rooms', function (r) { return r.property_id === pid; });
    rows.sort(function (a, b) { return a.room_number < b.room_number ? -1 : a.room_number > b.room_number ? 1 : 0; });
    return Paging.page(Store.publicRows(rows), p);
  }

  function roomsCreate(ctx, p) {
    var pid = propertyOf(ctx, 'CFG.ROOM', 'Create', p.property_id);
    var property = Store.mustGet('Properties', pid);
    var number = Validate.text(p.room_number, 'room_number', 10);
    var type = Store.mustGet('Room_Types', p.room_type_id);
    if (type.property_id !== pid) throw new PmsError('VALIDATION', 'room type belongs to another property');
    var existing = Store.list('Rooms', function (r) { return r.property_id === pid; });
    if (existing.some(function (r) { return r.room_number === number; })) {
      throw new PmsError('DUPLICATE', 'Room ' + number + ' already exists', 409);
    }
    if (existing.length >= Number(property.license_rooms)) {
      throw new PmsError('LICENSE_LIMIT', 'Room licence limit reached for ' + property.code, 409);
    }
    var row = Store.insert('Rooms', {
      property_id: pid,
      room_number: number,
      room_type_id: type.room_type_id,
      floor: Validate.text(p.floor || '0', 'floor', 10),
      status: 'ACTIVE',
      housekeeping_status: 'CLEAN'
    }, ctx.user.user_id);
    Audit.record(ctx, 'CFG.ROOM', 'CREATE', 'Rooms', row.room_id, null, row, pid);
    return Store.publicRow(row);
  }

  function roomsUpdate(ctx, p) {
    var existing = Store.mustGet('Rooms', p.room_id);
    var pid = propertyOf(ctx, 'CFG.ROOM', 'Edit', existing.property_id);
    var patch = {};
    if (p.room_type_id !== undefined) {
      var type = Store.mustGet('Room_Types', p.room_type_id);
      if (type.property_id !== pid) throw new PmsError('VALIDATION', 'room type belongs to another property');
      patch.room_type_id = type.room_type_id;
    }
    if (p.floor !== undefined) patch.floor = Validate.text(p.floor, 'floor', 10);
    if (p.status !== undefined) patch.status = Validate.oneOf(p.status, 'status', ['ACTIVE', 'OUT_OF_ORDER']);
    var result = Store.update('Rooms', p.room_id, patch, p.version, ctx.user.user_id);
    Audit.record(ctx, 'CFG.ROOM', 'UPDATE', 'Rooms', p.room_id, result.before, result.after, pid);
    return Store.publicRow(result.after);
  }

  // ---- Config items --------------------------------------------------------

  /** Checks data_json per config type before it is stored. */
  function validateConfigData(type, data) {
    if (type === 'TRANSACTION_CODE') {
      Validate.oneOf(data.kind, 'kind', Object.keys(TXN_KINDS));
    }
    if (type === 'TAX_RULE') {
      Validate.integer(data.rate_bps, 'rate_bps', 0, 10000);
    }
    return data;
  }

  function configList(ctx, p) {
    var pid = propertyOf(ctx, 'CFG.CODE', 'View', p.property_id);
    var type = p.config_type ? Validate.oneOf(p.config_type, 'config_type', CONFIG_TYPES) : null;
    var rows = Store.list('Config_Items', function (c) {
      return c.property_id === pid && (!type || c.config_type === type);
    });
    return Paging.page(Store.publicRows(rows), p);
  }

  function configCreate(ctx, p) {
    var pid = propertyOf(ctx, 'CFG.CODE', 'Create', p.property_id);
    var type = Validate.oneOf(p.config_type, 'config_type', CONFIG_TYPES);
    var code = Validate.text(p.code, 'code', 20).toUpperCase();
    if (!/^[A-Z0-9_]+$/.test(code)) throw new PmsError('VALIDATION', 'code may use A-Z, 0-9 and _');
    if (Store.list('Config_Items', function (c) {
      return c.property_id === pid && c.config_type === type && c.code === code;
    }).length) {
      throw new PmsError('DUPLICATE', code + ' already exists for ' + type, 409);
    }
    var data = validateConfigData(type, p.data || {});
    var row = Store.insert('Config_Items', {
      property_id: pid,
      config_type: type,
      code: code,
      description: Validate.text(p.description, 'description', 120),
      data_json: JSON.stringify(data),
      active: 'true'
    }, ctx.user.user_id);
    Audit.record(ctx, 'CFG.CODE', 'CREATE', 'Config_Items', row.config_id, null, row, pid);
    return Store.publicRow(row);
  }

  function configUpdate(ctx, p) {
    var existing = Store.mustGet('Config_Items', p.config_id);
    var pid = propertyOf(ctx, 'CFG.CODE', 'Edit', existing.property_id);
    var patch = {};
    if (p.description !== undefined) patch.description = Validate.text(p.description, 'description', 120);
    if (p.active !== undefined) patch.active = p.active ? 'true' : 'false';
    if (p.data !== undefined) {
      var merged = Object.assign({}, JSON.parse(existing.data_json || '{}'), p.data);
      patch.data_json = JSON.stringify(validateConfigData(existing.config_type, merged));
    }
    var result = Store.update('Config_Items', p.config_id, patch, p.version, ctx.user.user_id);
    Audit.record(ctx, 'CFG.CODE', 'UPDATE', 'Config_Items', p.config_id, result.before, result.after, pid);
    return Store.publicRow(result.after);
  }

  /** Helper for other modules: an active config item for this property, by type and code. */
  function findActiveItem(propertyId, type, code) {
    var item = Store.list('Config_Items', function (c) {
      return c.property_id === propertyId && c.config_type === type && c.code === code && String(c.active) === 'true';
    })[0];
    if (!item) throw new PmsError('CONFIG_MISSING', type + ' ' + code + ' is not configured or is inactive', 409);
    return Object.assign({}, item, { data: JSON.parse(item.data_json || '{}') });
  }

  return {
    roomTypesList: roomTypesList, roomTypesCreate: roomTypesCreate, roomTypesUpdate: roomTypesUpdate,
    roomsList: roomsList, roomsCreate: roomsCreate, roomsUpdate: roomsUpdate,
    configList: configList, configCreate: configCreate, configUpdate: configUpdate,
    findActiveItem: findActiveItem, validateConfigData: validateConfigData
  };
})();
