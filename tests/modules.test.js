const test = require('node:test');
const assert = require('node:assert/strict');
const { bootstrap, makeProperty, makeRooms } = require('./helpers/gas-env');

const DAY = '2026-11-20';

function hotel(env) {
  const prop = makeProperty(env);
  const rooms = makeRooms(env, prop.property_id);
  return { pid: prop.property_id, typeId: rooms.typeId, roomIds: rooms.roomIds };
}

function checkedIn(env, h, guest) {
  const res = env.call('res.create', {
    property_id: h.pid, room_type_id: h.typeId, arrival: DAY, departure: '2026-11-22', adults: 1,
    guest: { first_name: guest, last_name: 'Guest', email: guest.toLowerCase() + '@example.com' }
  });
  return env.call('fo.checkin', { res_id: res.res_id });
}

function login(env, username, password) {
  return env.ctx.Api.dispatch({ action: 'auth.login', payload: { username, password } }).token;
}

function makeUser(env, username, roleId, propertyIds) {
  env.call('admin.users.create', {
    username, display_name: username, email: `${username}@example.com`,
    role_ids: [roleId], property_ids: propertyIds
  });
  const temp = env.tempPassword(username);
  const token = login(env, username, temp);
  env.call('auth.change_password', { current_password: temp, new_password: 'Staff-Pass-123' }, token);
  return login(env, username, 'Staff-Pass-123');
}

function role(env, name, approvalLimit, grants) {
  const r = env.call('admin.roles.create', { name });
  if (approvalLimit !== undefined) {
    env.call('admin.roles.approval_limit', { role_id: r.role_id, approval_limit: approvalLimit, version: r.version });
  }
  Object.keys(grants).forEach((fn) => {
    env.call('admin.permissions.set', { role_id: r.role_id, function_id: fn, levels: grants[fn] });
  });
  return r;
}

function txnsWithKey(env, key) {
  return (env.backend.sheets.Transactions || []).filter((t) => t.txn_key === key);
}

// ---------------------------------------------------------------------------
// Posting approvals

test('an over-limit adjustment is queued, then posted once when a higher limit approves it', () => {
  const env = bootstrap();
  const h = hotel(env);
  const a = checkedIn(env, h, 'Alice');

  const cashierRole = role(env, 'Cashier', '50.00', {
    'CASH.POST': ['Create'], 'CASH.ADJUST': ['Create'], 'APPROVAL.QUEUE': ['View']
  });
  const managerRole = role(env, 'Manager', '500.00', { 'APPROVAL.QUEUE': ['View', 'Approve'] });
  const cashier = makeUser(env, 'cashier1', cashierRole.role_id, [h.pid]);
  const manager = makeUser(env, 'manager1', managerRole.role_id, [h.pid]);

  const queued = env.call('cash.post', {
    folio_id: a.folio_id, code: 'ADJ', amount: '100.00', request_approval: true, description: 'Goodwill'
  }, cashier);
  assert.equal(queued.status, 'PENDING_APPROVAL');
  assert.equal(queued.folio_balance, 0, 'nothing is posted while the request is pending');

  const pending = env.call('approvals.list', { property_id: h.pid, status: 'PENDING' }, manager);
  assert.equal(pending.total, 1);
  const req = pending.items[0];
  assert.equal(Number(req.amount_minor), 10000, 'an adjustment adds to the folio balance');

  const decided = env.call('approvals.approve', { approval_id: req.approval_id, version: req.version }, manager);
  assert.equal(decided.approval.status, 'APPROVED');
  assert.equal(decided.folio_balance, 10000);
  assert.equal(txnsWithKey(env, 'APPROVAL:' + req.approval_id).length, 1);

  assert.throws(() => env.call('approvals.approve', { approval_id: req.approval_id }, manager),
    { code: 'INVALID_STATE' });
  assert.equal(txnsWithKey(env, 'APPROVAL:' + req.approval_id).length, 1, 'a second approval posts nothing');
});

test('a requester cannot approve their own request', () => {
  const env = bootstrap();
  const h = hotel(env);
  const a = checkedIn(env, h, 'Bob');
  const both = role(env, 'Cashier-Approver', '50.00', {
    'CASH.POST': ['Create'], 'CASH.ADJUST': ['Create'], 'APPROVAL.QUEUE': ['View', 'Approve']
  });
  const user = makeUser(env, 'cashier2', both.role_id, [h.pid]);

  const queued = env.call('cash.post', { folio_id: a.folio_id, code: 'ADJ', amount: '90.00', request_approval: true }, user);
  const req = env.call('approvals.list', { property_id: h.pid }, user).items[0];
  assert.equal(req.approval_id, queued.approval_id);
  assert.throws(() => env.call('approvals.approve', { approval_id: req.approval_id }, user), { code: 'SELF_APPROVAL' });
});

test('an approver whose limit is below the amount cannot approve it', () => {
  const env = bootstrap();
  const h = hotel(env);
  const a = checkedIn(env, h, 'Carol');
  const small = role(env, 'Small approver', '50.00', {
    'CASH.POST': ['Create'], 'CASH.ADJUST': ['Create'], 'APPROVAL.QUEUE': ['View', 'Approve']
  });
  const big = role(env, 'Requester', '50.00', { 'CASH.POST': ['Create'], 'CASH.ADJUST': ['Create'], 'APPROVAL.QUEUE': ['View'] });
  const approverUser = makeUser(env, 'approver1', small.role_id, [h.pid]);
  const requester = makeUser(env, 'requester1', big.role_id, [h.pid]);
  env.call('cash.post', { folio_id: a.folio_id, code: 'ADJ', amount: '200.00', request_approval: true }, requester);
  const req = env.call('approvals.list', { property_id: h.pid }, approverUser).items[0];
  assert.throws(() => env.call('approvals.approve', { approval_id: req.approval_id }, approverUser),
    { code: 'APPROVAL_REQUIRED' });
});

test('a rejected request posts nothing and cannot be approved afterwards', () => {
  const env = bootstrap();
  const h = hotel(env);
  const a = checkedIn(env, h, 'Dan');
  const cashierRole = role(env, 'Cashier-R', '50.00', { 'CASH.POST': ['Create'], 'CASH.ADJUST': ['Create'] });
  const managerRole = role(env, 'Manager-R', '500.00', { 'APPROVAL.QUEUE': ['View', 'Approve'] });
  const cashier = makeUser(env, 'cashier3', cashierRole.role_id, [h.pid]);
  const manager = makeUser(env, 'manager3', managerRole.role_id, [h.pid]);

  env.call('cash.post', { folio_id: a.folio_id, code: 'ADJ', amount: '80.00', request_approval: true }, cashier);
  const req = env.call('approvals.list', { property_id: h.pid }, manager).items[0];
  const rejected = env.call('approvals.reject', { approval_id: req.approval_id, decision_note: 'Not supported' }, manager);
  assert.equal(rejected.status, 'REJECTED');
  assert.equal(rejected.decision_note, 'Not supported');
  assert.equal(txnsWithKey(env, 'APPROVAL:' + req.approval_id).length, 0);
  assert.throws(() => env.call('approvals.approve', { approval_id: req.approval_id }, manager), { code: 'INVALID_STATE' });
});

test('approvals can be listed only by users who hold the queue grant', () => {
  const env = bootstrap();
  const h = hotel(env);
  const none = role(env, 'No queue', undefined, {});
  const user = makeUser(env, 'noqueue', none.role_id, [h.pid]);
  assert.throws(() => env.call('approvals.list', { property_id: h.pid }, user), { code: 'NOT_FOUND' });
});

// ---------------------------------------------------------------------------
// Engineering

test('a maintenance request moves through its steps and needs a resolution to be done', () => {
  const env = bootstrap();
  const h = hotel(env);
  const created = env.call('eng.requests.create', {
    property_id: h.pid, room_id: h.roomIds[0], category: 'PLUMBING', priority: 'URGENT',
    description: 'Shower drain blocked'
  });
  assert.equal(created.status, 'OPEN');

  assert.throws(() => env.call('eng.requests.update', { request_id: created.request_id, status: 'DONE' }),
    { code: 'INVALID_STATE' }, 'OPEN cannot jump to DONE');

  const started = env.call('eng.requests.update', {
    request_id: created.request_id, status: 'IN_PROGRESS', assigned_to: 'Ravi', version: created.version
  });
  assert.equal(started.assigned_to, 'Ravi');

  assert.throws(() => env.call('eng.requests.update', { request_id: created.request_id, status: 'DONE' }),
    { code: 'VALIDATION' }, 'DONE needs a resolution note');

  const done = env.call('eng.requests.update', {
    request_id: created.request_id, status: 'DONE', resolution: 'Cleared the drain', version: started.version
  });
  assert.equal(done.status, 'DONE');
  assert.ok(done.completed_at);
  assert.throws(() => env.call('eng.requests.update', { request_id: created.request_id, status: 'OPEN' }),
    { code: 'INVALID_STATE' }, 'DONE is final');
});

test('a stale version is refused so two people do not overwrite each other', () => {
  const env = bootstrap();
  const h = hotel(env);
  const r = env.call('eng.requests.create', { property_id: h.pid, category: 'HVAC', description: 'Too cold' });
  env.call('eng.requests.update', { request_id: r.request_id, assigned_to: 'Mina', version: r.version });
  assert.throws(() => env.call('eng.requests.update', { request_id: r.request_id, assigned_to: 'Other', version: r.version }),
    { code: 'CONFLICT' });
});

test('maintenance requests are hidden from users without the grant and blocked when the module is off', () => {
  const env = bootstrap();
  const h = hotel(env);
  const none = role(env, 'Nothing', undefined, {});
  const user = makeUser(env, 'nomaint', none.role_id, [h.pid]);
  assert.throws(() => env.call('eng.requests.list', { property_id: h.pid }, user), { code: 'NOT_FOUND' });

  env.call('admin.flags.set', { property_id: h.pid, module_key: 'ENGINEERING', enabled: false });
  assert.throws(() => env.call('eng.requests.list', { property_id: h.pid }), { code: 'MODULE_DISABLED' });
});

// ---------------------------------------------------------------------------
// Housekeeping tasks and lost and found

test('completing a clean task marks the room clean for the front desk', () => {
  const env = bootstrap();
  const h = hotel(env);
  env.call('fo.room_status', { room_id: h.roomIds[0], housekeeping_status: 'DIRTY' });

  const task = env.call('hk.tasks.create', { property_id: h.pid, room_id: h.roomIds[0], task_type: 'CLEAN' });
  assert.equal(task.status, 'OPEN');
  const rack = () => env.call('fo.rack', { property_id: h.pid }).rooms.find((r) => r.room_id === h.roomIds[0]);
  assert.equal(rack().housekeeping_status, 'DIRTY');

  const done = env.call('hk.tasks.complete', { task_id: task.task_id, version: task.version });
  assert.equal(done.status, 'DONE');
  assert.equal(rack().housekeeping_status, 'CLEAN');
  assert.throws(() => env.call('hk.tasks.complete', { task_id: task.task_id }), { code: 'INVALID_STATE' });
});

test('a turndown task completes without changing the room status', () => {
  const env = bootstrap();
  const h = hotel(env);
  env.call('fo.room_status', { room_id: h.roomIds[1], housekeeping_status: 'DIRTY' });
  const task = env.call('hk.tasks.create', { property_id: h.pid, room_id: h.roomIds[1], task_type: 'TURNDOWN' });
  env.call('hk.tasks.complete', { task_id: task.task_id });
  const room = env.call('fo.rack', { property_id: h.pid }).rooms.find((r) => r.room_id === h.roomIds[1]);
  assert.equal(room.housekeeping_status, 'DIRTY');
});

test('completing a task also needs the front-office housekeeping grant', () => {
  const env = bootstrap();
  const h = hotel(env);
  const taskOnly = role(env, 'Task only', undefined, { 'HK.TASKS': ['View', 'Create', 'Edit'] });
  const user = makeUser(env, 'taskonly', taskOnly.role_id, [h.pid]);
  const task = env.call('hk.tasks.create', { property_id: h.pid, room_id: h.roomIds[0], task_type: 'INSPECT' });
  assert.throws(() => env.call('hk.tasks.complete', { task_id: task.task_id }, user), { code: 'NOT_FOUND' });
});

test('a lost item is claimed only with a claimant name and cannot change afterwards', () => {
  const env = bootstrap();
  const h = hotel(env);
  const item = env.call('hk.lost.create', {
    property_id: h.pid, description: 'Blue umbrella', location: 'Lobby'
  });
  assert.equal(item.status, 'HELD');
  assert.throws(() => env.call('hk.lost.update', { item_id: item.item_id, status: 'CLAIMED' }), { code: 'VALIDATION' });

  const claimed = env.call('hk.lost.update', {
    item_id: item.item_id, status: 'CLAIMED', claimed_by: 'Mr. Khan', version: item.version
  });
  assert.equal(claimed.status, 'CLAIMED');
  assert.equal(claimed.claimed_by, 'Mr. Khan');
  assert.throws(() => env.call('hk.lost.update', { item_id: item.item_id, status: 'DISPOSED' }),
    { code: 'INVALID_STATE' });
});

test('housekeeping tasks list for one business date', () => {
  const env = bootstrap();
  const h = hotel(env);
  env.call('hk.tasks.create', { property_id: h.pid, room_id: h.roomIds[0], task_type: 'CLEAN', business_date: DAY });
  env.call('hk.tasks.create', { property_id: h.pid, room_id: h.roomIds[1], task_type: 'CLEAN', business_date: '2026-11-21' });
  const list = env.call('hk.tasks.list', { property_id: h.pid, date: DAY });
  assert.equal(list.total, 1);
  assert.equal(list.items[0].room_number, '101');
});

test('organization, property and role lists return the paged shape the admin screens read', () => {
  const env = bootstrap();
  env.call('admin.orgs.create', { name: 'Second Group' });
  const orgs = env.call('admin.orgs.list', {});
  assert.ok(Array.isArray(orgs.items));
  assert.ok(orgs.items.some((o) => o.name === 'Second Group'));
  assert.equal(typeof orgs.total, 'number');
  assert.ok(Array.isArray(env.call('admin.properties.list', {}).items));
  assert.ok(Array.isArray(env.call('admin.roles.list', {}).items));
});
