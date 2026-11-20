const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const RELAY = path.join(__dirname, '..', 'frontend', 'api', 'send-smtp.js');

function fakeRes() {
  const r = { statusCode: 200, body: null };
  r.status = (c) => { r.statusCode = c; return r; };
  r.json = (b) => { r.body = b; return r; };
  return r;
}

test('relay refuses requests without the shared secret', async () => {
  process.env.MAIL_RELAY_SECRET = 'relay-secret-for-tests-0123456789';
  const { default: handler } = await import(pathToFileURL(RELAY).href);
  const res = fakeRes();
  await handler({ method: 'POST', headers: {}, body: {} }, res);
  assert.equal(res.statusCode, 401);
  const wrong = fakeRes();
  await handler({ method: 'POST', headers: { 'x-relay-secret': 'nope' }, body: {} }, wrong);
  assert.equal(wrong.statusCode, 401);
});

test('relay refuses non-POST requests', async () => {
  const { default: handler } = await import(pathToFileURL(RELAY).href);
  const res = fakeRes();
  await handler({ method: 'GET', headers: {} }, res);
  assert.equal(res.statusCode, 405);
});

test('relay refuses a missing relay secret configuration', async () => {
  delete process.env.MAIL_RELAY_SECRET;
  const { default: handler } = await import(pathToFileURL(RELAY).href + '?unset');
  const res = fakeRes();
  await handler({ method: 'POST', headers: { 'x-relay-secret': 'anything' }, body: {} }, res);
  assert.equal(res.statusCode, 401);
});
