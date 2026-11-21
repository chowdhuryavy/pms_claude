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
  '10_frontoffice.js', '11_night_audit.js', '12_reports.js', '13_setup.js', '14_api.js',
  '15_mail.js', '16_account.js', '17_vault.js', '18_approvals.js', '19_engineering.js', '20_housekeeping.js',
  'Updater.js'
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
  // Every message the app tries to send. Tests read temporary passwords from here.
  const outbox = [];
  const mail = { resendStatus: 200, relayStatus: 200 };
  const sandbox = {
    UrlFetchApp: {
      fetch(url, opts) {
        const web = sandbox.__web;
        if (url.startsWith('https://api.github.com/') || url.startsWith('https://raw.githubusercontent.com/') ||
            url.startsWith('https://script.googleapis.com/')) {
          return web.handle(url, opts);
        }
        const body = JSON.parse(opts.payload);
        if (url.endsWith('/api/send-smtp')) {
          if (opts.headers['X-Relay-Secret'] !== mail.relaySecret) return { getResponseCode: () => 401 };
          const status = mail.relayStatus;
          if (status === 200) {
            outbox.push({ provider: 'SMTP', url, relaySecret: opts.headers['X-Relay-Secret'], smtp: body.smtp,
              to: body.to, from: body.from, subject: body.subject, html: body.html, text: body.text });
          }
          return { getResponseCode: () => status };
        }
        outbox.push({ provider: 'RESEND', url, auth: opts.headers.Authorization, to: body.to[0],
          from: body.from, subject: body.subject, html: body.html, text: body.text });
        return { getResponseCode: () => mail.resendStatus, getContentText: () => '' };
      }
    },
    console: { log() {}, error() {}, warn() {} },
    Logger: { log() {} },
    Utilities: {
      getUuid: () => crypto.randomUUID(),
      DigestAlgorithm: { SHA_256: 'SHA_256' },
      Charset: { UTF_8: 'UTF_8' },
      computeDigest: (alg, text) => signedBytes(crypto.createHash('sha256').update(String(text), 'utf8').digest()),
      computeHmacSha256Signature: (value, key) =>
        signedBytes(crypto.createHmac('sha256', String(key)).update(String(value), 'utf8').digest()),
      newBlob: (data) => {
        const bytes = typeof data === 'string' ? Buffer.from(data, 'utf8') : Buffer.from(data.map((b) => b & 0xff));
        return { getBytes: () => signedBytes(bytes), getDataAsString: () => bytes.toString('utf8') };
      },
      base64Encode: (bytes) => Buffer.from(bytes.map((b) => b & 0xff)).toString('base64'),
      base64Decode: (text) => signedBytes(Buffer.from(String(text), 'base64'))
    },
    PropertiesService: {
      getScriptProperties: () => ({
        getProperty: (k) => (k in props ? props[k] : null),
        setProperty: (k, v) => { props[k] = v; },
        deleteProperty: (k) => { delete props[k]; }
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
    ScriptApp: {
      getScriptId: () => 'SCRIPT_TEST_ID',
      getOAuthToken: () => 'test-oauth-token',
      newTrigger(handler) {
        const b = {
          timeBased() { return b; },
          everyMinutes(n) { b.minutes = n; return b; },
          create() { web.triggers.push({ handler, minutes: b.minutes }); return { getHandlerFunction: () => handler }; }
        };
        return b;
      },
      getProjectTriggers: () => web.triggers.map((t) => ({ getHandlerFunction: () => t.handler, _t: t })),
      deleteTrigger(trigger) { web.triggers = web.triggers.filter((t) => t !== trigger._t); }
    },
    ContentService: {
      MimeType: { JSON: 'application/json' },
      createTextOutput(text) {
        const out = { content: text, getContent: () => text, setMimeType() { return out; } };
        return out;
      }
    },
    SpreadsheetApp: {}
  };
  vm.createContext(sandbox);
  for (const f of FILES) {
    vm.runInContext(fs.readFileSync(path.join(SRC, f), 'utf8'), sandbox, { filename: f });
  }
  const backend = memoryBackend();
  sandbox.Store.setBackend(backend);
  mail.relaySecret = 'relay-secret-for-tests-0123456789';
  // Fake GitHub repo and Apps Script project, used by the updater tests.
  const web = {
    repo: { sha: 'a'.repeat(40), files: {} },
    project: { content: null, versions: 0, deployments: [] },
    failMove: false,
    triggers: [],
    reply(status, text) { return { getResponseCode: () => status, getContentText: () => text }; },
    handle(url, opts) {
      if (url.startsWith('https://api.github.com/repos/') && url.includes('/commits/')) {
        return web.reply(200, JSON.stringify({ sha: web.repo.sha }));
      }
      if (url.includes('/git/trees/')) {
        const tree = Object.keys(web.repo.files).map((path) => ({ path, type: 'blob', sha: path }));
        return web.reply(200, JSON.stringify({ tree }));
      }
      if (url.startsWith('https://raw.githubusercontent.com/')) {
        const path = url.split('/' + web.repo.sha + '/')[1];
        return web.repo.files[path] !== undefined ? web.reply(200, web.repo.files[path]) : web.reply(404, '');
      }
      if (url.startsWith('https://script.googleapis.com/')) {
        const path = url.split('/projects/SCRIPT_TEST_ID')[1];
        if (opts.method === 'put' && path === '/content') {
          web.project.content = JSON.parse(opts.payload).files;
          return web.reply(200, '{}');
        }
        if (opts.method === 'post' && path === '/versions') {
          web.project.versions++;
          return web.reply(200, JSON.stringify({ versionNumber: web.project.versions }));
        }
        if (opts.method === 'get' && path.startsWith('/deployments')) {
          return web.reply(200, JSON.stringify({ deployments: web.project.deployments }));
        }
        if (opts.method === 'put' && path.startsWith('/deployments/')) {
          if (web.failMove) return web.reply(500, 'move failed');
          const id = path.split('/deployments/')[1];
          const dep = web.project.deployments.find((d) => d.deploymentId === id);
          dep.deploymentConfig.versionNumber = JSON.parse(opts.payload).deploymentConfig.versionNumber;
          return web.reply(200, '{}');
        }
      }
      return web.reply(404, 'unknown fake route ' + url);
    }
  };
  sandbox.__web = web;
  return { ctx: sandbox, backend, props, cache, outbox, mail, web };
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
  const org = env.call('admin.orgs.create', { name: 'Test Hotels', license_start: '2026-01-01', license_end: '2099-12-31' });
  env.orgId = org.org_id;
  // Resend is configured by default, so user creation and resets send mail in tests.
  env.call('admin.email.save', {
    from_name: 'Hotel PMS', from_email: 'no-reply@example.com', app_url: 'https://pms.example.com',
    resend_active: true, resend_api_key: 're_test_key_0123456789abcdef', smtp_active: false
  });
  // The most recent temporary password sent to an address. Returns null if none.
  env.tempPassword = (username) => {
    const msgs = env.outbox.filter((m) => m.to === username + '@example.com');
    const last = msgs[msgs.length - 1];
    const match = last && last.text.match(/Temporary password: (\S+)/);
    return match ? match[1] : null;
  };
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
