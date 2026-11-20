/**
 * Loads the real Apps Script sources into a Node vm context with stubs for the
 * Apps Script globals, and an in-memory sheet backend. The tests run the same
 * code that ships to Apps Script. Only the storage and Google services are faked.
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const crypto = require('crypto');

const SRC = path.join(__dirname, '..', '..', 'apps-script', 'src');
const FILES = [
  '00_config.js', '01_core.js', '02_store.js', '03_sheets_backend.js', '04_auth.js',
  '05_audit.js', '06_admin.js', '07_config_svc.js', '08_reservations.js', '09_cashier.js',
  '10_frontoffice.js', '11_night_audit.js', '12_reports.js', '13_setup.js', '14_api.js'
];

function signedBytes(buffer) {
  return Array.from(buffer).map((b) => (b > 127 ? b - 256 : b));
}

function memoryBackend() {
  const sheets = {};
  return {
    sheets,
    read(name, headers) {
      return (sheets[name] || []).map((r, i) => Object.assign({}, r, { _row: i + 2 }));
    },
    append(name, obj) {
      if (!sheets[name]) sheets[name] = [];
      sheets[name].push(Object.assign({}, obj));
      return sheets[name].length + 1;
    },
    write(name, row, obj) {
      sheets[name][row - 2] = Object.assign({}, obj);
    }
  };
}

function createEnv() {
  const props = {};
  const cache = new Map();
  const sandbox = {
    console: { log() {}, error() {}, warn() {} },
    Logger: { log() {} },
    Utilities: {
      getUuid: () => crypto.randomUUID(),
      DigestAlgorithm: { SHA_256: 'SHA_256' },
      Charset: { UTF_8: 'UTF_8' },
      computeDigest: (alg, text) => signedBytes(crypto.createHash('sha256').update(String(text), 'utf8').digest())
    },
    PropertiesService: {
      getScriptProperties: () => ({
        getProperty: (k) => (k in props ? props[k] : null),
        setProperty: (k, v) => { props[k] = v; }
      })
    },
    LockService: {
      getScriptLock: () => ({ tryLock: () => true, releaseLock() {} })
    },
    CacheService: {
      getScriptCache: () => ({
        get: (k) => (cache.has(k) ? cache.get(k) : null),
        put: (k, v) => { cache.set(k, v); }
      })
    },
    ContentService: {},
    SpreadsheetApp: {}
  };
  vm.createContext(sandbox);
  for (const f of FILES) {
    vm.runInContext(fs.readFileSync(path.join(SRC, f), 'utf8'), sandbox, { filename: f });
  }
  const backend = memoryBackend();
  sandbox.Store.setBackend(backend);
  return { ctx: sandbox, backend, props, cache };
}

/** Builds a small world: one org, one active property, a system admin, and a role/user helper. */
function bootstrap() {
  const env = createEnv();
  const g = env.ctx;
  const admin = g.Setup.bootstrapAdmin('sysadmin', 'Correct-Horse-1', 'System Admin');
  const login = g.Api.dispatch({ action: 'auth.login', payload: { username: 'sysadmin', password: 'Correct-Horse-1' } });
  env.adminToken = login.token;
  env.call = (action, payload, token, key) =>
    g.Api.dispatch({ action, payload: payload || {}, token: token === undefined ? env.adminToken : token, idempotency_key: key });
  const org = env.call('admin.orgs.create', { name: 'Test Hotels' });
  env.orgId = org.org_id;
  return env;
}

/** Creates a property with defaults and returns its id. */
function makeProperty(env, overrides) {
  const p = Object.assign({
    org_id: env.orgId, code: 'HQ1', name: 'Headquarters', currency: 'USD', timezone: 'UTC',
    business_date: '2026-11-20', license_rooms: 50, user_limit: 20
  }, overrides || {});
  return env.call('admin.properties.create', p);
}

/** Creates a room type and rooms, returning { typeId, roomIds }. */
function makeRooms(env, propertyId, { type = 'DBL', rate = '100.00', count = 2, max = 2 } = {}) {
  const t = env.call('config.room_types.create', {
    property_id: propertyId, code: type, description: 'Double', max_occupancy: max, base_rate: rate
  });
  const roomIds = [];
  for (let i = 1; i <= count; i++) {
    const r = env.call('config.rooms.create', {
      property_id: propertyId, room_number: String(100 + i), room_type_id: t.room_type_id, floor: '1'
    });
    roomIds.push(r.room_id);
  }
  return { typeId: t.room_type_id, roomIds };
}

module.exports = { createEnv, bootstrap, makeProperty, makeRooms, memoryBackend };
