const test = require('node:test');
const assert = require('node:assert/strict');
const { bootstrap, makeProperty } = require('./helpers/gas-env');

function world() {
  const env = bootstrap();
  const prop = makeProperty(env);
  const role = env.call('admin.roles.create', { name: 'Front Desk' });
  return { env, pid: prop.property_id, roleId: role.role_id };
}

/** A user who can manage users (no email access) to test the permission boundary. */
function userAdmin(env, pid) {
  const role = env.call('admin.roles.create', { name: 'User Admin' });
  env.call('admin.permissions.set', { role_id: role.role_id, function_id: 'ADMIN.USER', levels: ['View', 'Create', 'Edit'] });
  env.call('admin.users.create', { username: 'uadmin', display_name: 'User Admin', email: 'uadmin@example.com',
    role_ids: [role.role_id], property_ids: [pid] });
  const temp = env.tempPassword('uadmin');
  const token = env.ctx.Api.dispatch({ action: 'auth.login', payload: { username: 'uadmin', password: temp } }).token;
  env.call('auth.change_password', { current_password: temp, new_password: 'Uadmin-Pass-1' }, token);
  return env.ctx.Api.dispatch({ action: 'auth.login', payload: { username: 'uadmin', password: 'Uadmin-Pass-1' } }).token;
}

test('new user gets a random temporary password by email through Resend, never returned', () => {
  const { env, pid, roleId } = world();
  const res = env.call('admin.users.create', { username: 'ann', display_name: 'Ann', email: 'ann@example.com',
    role_ids: [roleId], property_ids: [pid] });
  assert.equal(res.email_sent, true);
  assert.equal(res.provider, 'RESEND');
  assert.equal(Object.keys(res).includes('temp_password'), false);
  const msg = env.outbox[env.outbox.length - 1];
  assert.equal(msg.url, 'https://api.resend.com/emails');
  assert.equal(msg.auth, 'Bearer re_test_key_0123456789abcdef');
  assert.equal(msg.to, 'ann@example.com');
  assert.match(msg.subject, /account is ready/);
  assert.match(msg.from, /Hotel PMS <no-reply@example.com>/);
  assert.ok(env.tempPassword('ann'));
  // The password is not stored in plain text anywhere in the sheets or the audit log.
  const dump = JSON.stringify(env.backend.sheets);
  assert.equal(dump.includes(env.tempPassword('ann')), false);
});

test('temporary password forces a change: other actions are refused until the password is changed', () => {
  const { env, pid, roleId } = world();
  env.call('admin.users.create', { username: 'bob', display_name: 'Bob', email: 'bob@example.com',
    role_ids: [roleId], property_ids: [pid] });
  env.call('admin.permissions.set', { role_id: roleId, function_id: 'RES.VIEW', levels: ['View'] });
  const temp = env.tempPassword('bob');
  const token = env.ctx.Api.dispatch({ action: 'auth.login', payload: { username: 'bob', password: temp } }).token;
  const me = env.call('auth.me', {}, token);
  assert.equal(me.user.must_change_password, true);
  assert.throws(() => env.call('res.list', { property_id: pid }, token),
    { code: 'PASSWORD_CHANGE_REQUIRED' });
  assert.throws(() => env.call('auth.change_password', { current_password: 'nope-nope-1', new_password: 'Bob-Pass-1234' }, token),
    { code: 'WRONG_PASSWORD' });
  assert.throws(() => env.call('auth.change_password', { current_password: temp, new_password: temp }, token),
    { code: 'VALIDATION' });
  assert.throws(() => env.call('auth.change_password', { current_password: temp, new_password: 'short1' }, token),
    { code: 'VALIDATION' });
  env.call('auth.change_password', { current_password: temp, new_password: 'Bob-Pass-1234' }, token);
  assert.equal(env.call('auth.me', {}, token).user.must_change_password, false);
  env.call('res.list', { property_id: pid }, token); // allowed now
});

test('changing the password revokes other sessions but keeps the current one', () => {
  const { env, pid, roleId } = world();
  env.call('admin.users.create', { username: 'cy', display_name: 'Cy', email: 'cy@example.com',
    role_ids: [roleId], property_ids: [pid] });
  const temp = env.tempPassword('cy');
  const first = env.ctx.Api.dispatch({ action: 'auth.login', payload: { username: 'cy', password: temp } }).token;
  const second = env.ctx.Api.dispatch({ action: 'auth.login', payload: { username: 'cy', password: temp } }).token;
  env.call('auth.change_password', { current_password: temp, new_password: 'Cy-Pass-12345' }, first);
  assert.throws(() => env.call('auth.me', {}, second), { code: 'UNAUTHENTICATED' });
  assert.equal(env.call('auth.me', {}, first).user.username, 'cy');
});

test('admin reset emails a new temporary password and signs the user out everywhere', () => {
  const { env, pid, roleId } = world();
  const created = env.call('admin.users.create', { username: 'dee', display_name: 'Dee', email: 'dee@example.com',
    role_ids: [roleId], property_ids: [pid] });
  const oldTemp = env.tempPassword('dee');
  const token = env.ctx.Api.dispatch({ action: 'auth.login', payload: { username: 'dee', password: oldTemp } }).token;
  env.call('auth.change_password', { current_password: oldTemp, new_password: 'Dee-Pass-12345' }, token);
  const freshToken = env.ctx.Api.dispatch({ action: 'auth.login', payload: { username: 'dee', password: 'Dee-Pass-12345' } }).token;

  const reset = env.call('admin.users.reset_password', { user_id: created.user_id });
  assert.equal(reset.email_sent, true);
  assert.throws(() => env.call('auth.me', {}, freshToken), { code: 'UNAUTHENTICATED' });
  const newTemp = env.tempPassword('dee');
  assert.notEqual(newTemp, oldTemp);
  assert.match(env.outbox[env.outbox.length - 1].subject, /was reset/);
  assert.throws(() => env.ctx.Api.dispatch({ action: 'auth.login', payload: { username: 'dee', password: 'Dee-Pass-12345' } }),
    { code: 'AUTH_FAILED' });
});

test('when no provider works, creation still succeeds and reports why the email was not sent', () => {
  const { env, pid, roleId } = world();
  env.call('admin.email.clear_key', {});
  env.call('admin.email.save', { provider: 'RESEND', is_active: false, from_name: 'Hotel PMS',
    from_email: 'no-reply@example.com' });
  const res = env.call('admin.users.create', { username: 'eve', display_name: 'Eve', email: 'eve@example.com',
    role_ids: [roleId], property_ids: [pid] });
  assert.equal(res.email_sent, false);
  assert.match(res.reason, /Resend is not configured|No email provider/);
  assert.equal(env.outbox.filter((m) => m.to === 'eve@example.com').length, 0);
});

test('active Google provider is used first, and Resend is the fallback when it fails', () => {
  const { env, pid, roleId } = world();
  env.call('admin.email.save', { provider: 'GOOGLE', is_active: true, from_name: 'Hotel PMS',
    from_email: 'no-reply@example.com' });
  env.call('admin.users.create', { username: 'fay', display_name: 'Fay', email: 'fay@example.com',
    role_ids: [roleId], property_ids: [pid] });
  assert.equal(env.outbox[env.outbox.length - 1].provider, 'GOOGLE');

  env.mail.googleFails = true;
  const res = env.call('admin.users.create', { username: 'gus', display_name: 'Gus', email: 'gus@example.com',
    role_ids: [roleId], property_ids: [pid] });
  assert.equal(res.provider, 'RESEND');
  assert.equal(env.outbox[env.outbox.length - 1].provider, 'RESEND');
});

test('email settings never return the API key, only a hint', () => {
  const { env } = world();
  const s = env.call('admin.email.get', {});
  assert.equal(s.resend_configured, true);
  assert.equal(s.resend_key_hint, 're_••••cdef');
  assert.equal(JSON.stringify(s).includes('0123456789abcdef'), false);
  assert.equal(JSON.stringify(env.backend.sheets).includes('0123456789abcdef'), false);
});

test('only System Administrators can change email settings; others get NOT_FOUND', () => {
  const { env, pid } = world();
  const token = userAdmin(env, pid);
  assert.throws(() => env.call('admin.email.get', {}, token), { code: 'NOT_FOUND' });
  assert.throws(() => env.call('admin.email.save', { provider: 'RESEND', is_active: false, from_name: 'X',
    from_email: 'x@example.com' }, token), { code: 'NOT_FOUND' });
});

test('a user without email cannot be created, and an active Resend setting needs a key', () => {
  const { env, pid, roleId } = world();
  assert.throws(() => env.call('admin.users.create', { username: 'hal', display_name: 'Hal',
    role_ids: [roleId], property_ids: [pid] }), { code: 'VALIDATION' });
  env.call('admin.email.clear_key', {});
  assert.throws(() => env.call('admin.email.save', { provider: 'RESEND', is_active: true, from_name: 'X',
    from_email: 'x@example.com' }), { code: 'VALIDATION' });
});

test('display names are escaped in the email body', () => {
  const { env, pid, roleId } = world();
  env.call('admin.users.create', { username: 'ivy', display_name: '<img src=x onerror=alert(1)>', email: 'ivy@example.com',
    role_ids: [roleId], property_ids: [pid] });
  const html = env.outbox[env.outbox.length - 1].html;
  assert.equal(html.includes('<img src=x'), false);
  assert.match(html, /&lt;img src=x/);
});

test('test email reports success through the configured provider', () => {
  const { env } = world();
  const res = env.call('admin.email.test', { to: 'ops@example.com' });
  assert.equal(res.sent, true);
  assert.equal(env.outbox[env.outbox.length - 1].subject, 'Test email from Hotel PMS');
});
