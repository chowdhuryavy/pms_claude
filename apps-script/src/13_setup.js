/**
 * One-time setup, run from the Apps Script editor by the project owner.
 * None of these functions are reachable through doPost.
 *
 *   1. Setup.initialize()                   creates the five spreadsheets and their sheets
 *   2. Setup.createFirstAdmin(user, pwd, name)  creates the System Administrator (once)
 */

var Setup = (function () {

  function initialize() {
    var props = PropertiesService.getScriptProperties();
    Object.keys(DOMAIN_PROP).forEach(function (domain) {
      var key = DOMAIN_PROP[domain];
      var id = props.getProperty(key);
      var ss = id ? SpreadsheetApp.openById(id) : SpreadsheetApp.create('PMS ' + domain);
      if (!id) props.setProperty(key, ss.getId());

      Object.keys(SCHEMA).filter(function (name) { return SCHEMA[name].domain === domain; }).forEach(function (name) {
        var headers = SCHEMA[name].headers;
        var sheet = ss.getSheetByName(name) || ss.insertSheet(name);
        if (sheet.getLastRow() === 0) {
          sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
          sheet.setFrozenRows(1);
        } else {
          var actual = sheet.getRange(1, 1, 1, headers.length).getValues()[0];
          headers.forEach(function (h, i) {
            if (actual[i] !== h) {
              throw new Error('Sheet ' + name + ' column ' + (i + 1) + ' is "' + actual[i] + '", expected "' + h + '"');
            }
          });
        }
      });

      var blank = ss.getSheetByName('Sheet1');
      if (blank && blank.getLastRow() === 0 && ss.getSheets().length > 1) ss.deleteSheet(blank);
    });
    Logger.log('Initialized. Spreadsheet IDs are stored in Script Properties.');
  }

  /** Editor entry point. Connects to the real spreadsheets, then bootstraps. */
  function createFirstAdmin(username, password, displayName) {
    Store.setBackend(SheetsBackend);
    Store.beginRequest();
    return bootstrapAdmin(username, password, displayName);
  }

  /** Backend-neutral bootstrap. Refuses if any user already exists. */
  function bootstrapAdmin(username, password, displayName) {
    if (Store.list('Users', function () { return true; }).length) {
      throw new Error('Users already exist. First admin can only be created once.');
    }
    var pwd = Admin.assertPasswordPolicy(password);
    var role = Store.insert('Roles', {
      org_id: '*', name: 'System Administrator', is_system: 'true', approval_limit_minor: 0
    }, 'SETUP');
    Object.keys(FUNCTIONS).forEach(function (fn) {
      Store.insert('Permissions', { role_id: role.role_id, function_id: fn, levels: 'Full Access' }, 'SETUP');
    });
    var salt = Hash.newSalt();
    var user = Store.insert('Users', {
      org_id: '*',
      username: Validate.text(username, 'username', 80).toLowerCase(),
      display_name: Validate.text(displayName, 'display_name', 120),
      password_hash: Hash.passwordHash(pwd, salt),
      salt: salt,
      status: 'ACTIVE',
      role_ids: role.role_id,
      property_ids: '',
      failed_logins: 0,
      locked_until: ''
    }, 'SETUP');
    Logger.log('System Administrator created: ' + user.username);
    return { user_id: user.user_id, username: user.username, role_id: role.role_id };
  }

  /** Default codes so a new property can take a booking at once. Edit them per property. */
  function seedDefaultCodes(propertyId, userId) {
    var txn = [
      ['ROOM', 'CHARGE', 'Room revenue'],
      ['VAT', 'CHARGE', 'Value added tax on room revenue'],
      ['BREAKFAST', 'CHARGE', 'Breakfast'],
      ['MINIBAR', 'CHARGE', 'Minibar'],
      ['CASH', 'PAYMENT', 'Cash payment'],
      ['CARD', 'PAYMENT', 'Card payment'],
      ['ADJ', 'ADJUSTMENT', 'Manual adjustment'],
      ['REBATE', 'REBATE', 'Guest rebate'],
      ['TRANSFER', 'TRANSFER', 'Folio transfer (system)']
    ];
    txn.forEach(function (t) {
      Store.insert('Config_Items', {
        property_id: propertyId, config_type: 'TRANSACTION_CODE', code: t[0],
        description: t[2], data_json: JSON.stringify({ kind: t[1] }), active: 'true'
      }, userId);
    });
    Store.insert('Config_Items', {
      property_id: propertyId, config_type: 'TAX_RULE', code: 'VAT',
      description: 'Placeholder rate. Set the rate required in your jurisdiction.',
      data_json: JSON.stringify({ rate_bps: 1000, applies_to: 'ROOM' }), active: 'true'
    }, userId);
    [['BAR', 'Best available rate'], ['CORP', 'Corporate rate']].forEach(function (r) {
      Store.insert('Config_Items', {
        property_id: propertyId, config_type: 'RATE_CODE', code: r[0],
        description: r[1], data_json: '{}', active: 'true'
      }, userId);
    });
    [['DIRECT', 'Direct booking'], ['OTA', 'Online travel agency'], ['CORP', 'Corporate'], ['GROUP', 'Group']]
      .forEach(function (m) {
        Store.insert('Config_Items', {
          property_id: propertyId, config_type: 'MARKET_CODE', code: m[0],
          description: m[1], data_json: '{}', active: 'true'
        }, userId);
      });
    [['WEB', 'Website'], ['PHONE', 'Phone'], ['WALKIN', 'Walk-in']].forEach(function (s) {
      Store.insert('Config_Items', {
        property_id: propertyId, config_type: 'SOURCE_CODE', code: s[0],
        description: s[1], data_json: '{}', active: 'true'
      }, userId);
    });
  }

  return {
    initialize: initialize, createFirstAdmin: createFirstAdmin, bootstrapAdmin: bootstrapAdmin,
    seedDefaultCodes: seedDefaultCodes
  };
})();

/*
 * Editor entry points. Apps Script's Run menu can only call top-level functions.
 *
 * First-time order:
 *   1. Run setupInitialize once. Authorize when prompted.
 *   2. Project Settings > Script Properties: add
 *        PMS_BOOTSTRAP_USER      = the System Administrator username
 *        PMS_BOOTSTRAP_PASSWORD  = a 12+ character password with a letter and a digit
 *   3. Run setupFirstAdmin once. It deletes PMS_BOOTSTRAP_PASSWORD when it finishes.
 */
function setupInitialize() {
  Setup.initialize();
}

function setupFirstAdmin() {
  var props = PropertiesService.getScriptProperties();
  var user = props.getProperty('PMS_BOOTSTRAP_USER');
  var pass = props.getProperty('PMS_BOOTSTRAP_PASSWORD');
  if (!user || !pass) throw new Error('Set PMS_BOOTSTRAP_USER and PMS_BOOTSTRAP_PASSWORD in Script Properties first.');
  Setup.createFirstAdmin(user, pass, 'System Administrator');
  props.deleteProperty('PMS_BOOTSTRAP_PASSWORD');
}
