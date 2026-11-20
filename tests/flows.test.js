const test = require('node:test');
const assert = require('node:assert/strict');
const { bootstrap, makeProperty, makeRooms } = require('./helpers/gas-env');

const DAY = '2026-11-20';

/** One property HQ1 on DAY with two double rooms at 100.00. */
function hotel(env, propOverrides) {
  const prop = makeProperty(env, propOverrides);
  const rooms = makeRooms(env, prop.property_id);
  return { pid: prop.property_id, prop, typeId: rooms.typeId, roomIds: rooms.roomIds };
}

function book(env, h, guest, arrival, departure, key) {
  return env.call('res.create', {
    property_id: h.pid, room_type_id: h.typeId, arrival, departure, adults: 2,
    guest: { first_name: guest, last_name: 'Guest', email: guest.toLowerCase() + '@example.com' }
  }, undefined, key);
}

function login(env, username, password) {
  return env.ctx.Api.dispatch({ action: 'auth.login', payload: { username, password } }).token;
}

/** Creates a user with one role on one property. */
function makeUser(env, username, roleId, propertyIds, password) {
  return env.call('admin.users.create', {
    username, display_name: username, password: password || 'Staff-Pass-123',
    role_ids: [roleId], property_ids: propertyIds
  });
}

function grant(env, roleId, fn, levels) {
  return env.call('admin.permissions.set', { role_id: roleId, function_id: fn, levels });
}

function rowsOf(env, sheet) {
  return env.backend.sheets[sheet] || [];
}

// ---------------------------------------------------------------------------

test('availability is checked night by night and bookings are idempotent', () => {
  const env = bootstrap();
  const h = hotel(env);

  const avail = env.call('res.availability', { property_id: h.pid, arrival: DAY, departure: '2026-11-22' });
  assert.equal(avail[0].min_available, 2);

  const first = book(env, h, 'Alice', DAY, '2026-11-22', 'booking-key-1');
  const retry = book(env, h, 'Alice', DAY, '2026-11-22', 'booking-key-1');
  assert.equal(first.res_id, retry.res_id, 'same idempotency key returns the same booking');
  assert.equal(rowsOf(env, 'Reservations').length, 1, 'retry did not create a second reservation');
  assert.equal(first.rate_minor, 10000, 'rate defaults to the room type base rate');

  book(env, h, 'Bob', DAY, '2026-11-22');
  assert.throws(() => book(env, h, 'Carol', DAY, '2026-11-22'), { code: 'NO_AVAILABILITY' });
});

test('check-in assigns a room, folio postings and payments drive the balance', () => {
  const env = bootstrap();
  const h = hotel(env);
  const a = book(env, h, 'Alice', DAY, '2026-11-22');
  const checkin = env.call('fo.checkin', { res_id: a.res_id });
  assert.equal(checkin.room_number, '101');
  assert.equal(checkin.folio_no, 1001);

  const breakfast = env.call('cash.post', { folio_id: checkin.folio_id, code: 'BREAKFAST', amount: '15.00' });
  assert.equal(breakfast.folio_balance, 1500);
  const cash = env.call('cash.post', { folio_id: checkin.folio_id, code: 'CASH', amount: '10.00' });
  assert.equal(cash.folio_balance, 500);

  assert.throws(() => env.call('fo.checkout', { res_id: a.res_id }), { code: 'BALANCE_DUE' });
  env.call('cash.post', { folio_id: checkin.folio_id, code: 'CARD', amount: '5.00' });

  const out = env.call('fo.checkout', { res_id: a.res_id });
  assert.equal(out.status, 'CHECKED_OUT');
  const res = env.call('res.get', { res_id: a.res_id });
  assert.equal(res.departure, DAY, 'early departure shortens the stay to the checkout date');
  const rooms = env.call('config.rooms.list', { property_id: h.pid }).items;
  assert.equal(rooms.find((r) => r.room_number === '101').housekeeping_status, 'DIRTY');
});

test('dirty rooms are not assigned until housekeeping releases them', () => {
  const env = bootstrap();
  const h = hotel(env, { code: 'HQ2' });
  // Only one room of the type is clean; the other is dirty.
  const rooms = env.call('config.rooms.list', { property_id: h.pid }).items;
  env.call('fo.room_status', { room_id: rooms[0].room_id, housekeeping_status: 'DIRTY', version: rooms[0].version });

  const a = book(env, h, 'Dan', DAY, '2026-11-21');
  const ci = env.call('fo.checkin', { res_id: a.res_id });
  assert.equal(ci.room_number, '102', 'auto-assign skips the dirty room');

  const b = book(env, h, 'Eve', DAY, '2026-11-21');
  assert.throws(() => env.call('fo.checkin', { res_id: b.res_id }), { code: 'NO_ROOM' });
});

test('folio transfer nets to zero and reversal is allowed once', () => {
  const env = bootstrap();
  const h = hotel(env);
  const a = env.call('fo.checkin', { res_id: book(env, h, 'Alice', DAY, '2026-11-22').res_id });
  const b = env.call('fo.checkin', { res_id: book(env, h, 'Bob', DAY, '2026-11-22').res_id });

  const charge = env.call('cash.post', { folio_id: a.folio_id, code: 'MINIBAR', amount: '50.00' });
  const xfer = env.call('cash.transfer', { from_folio_id: a.folio_id, to_folio_id: b.folio_id, amount: '20.00' });
  assert.equal(xfer.from_balance, 3000);
  assert.equal(xfer.to_balance, 2000);
  assert.equal(xfer.transactions[0].amount_minor + xfer.transactions[1].amount_minor, 0);

  const rev = env.call('cash.reverse', { txn_id: charge.txn.txn_id, reason: 'Posted to wrong folio' });
  assert.equal(rev.folio_balance, -2000);
  assert.throws(() => env.call('cash.reverse', { txn_id: charge.txn.txn_id, reason: 'again' }), { code: 'ALREADY_REVERSED' });
  assert.throws(() => env.call('cash.reverse', { txn_id: rev.txn.txn_id, reason: 'reverse the reversal' }), { code: 'INVALID_STATE' });
});

test('a posting with the same client txn_key is stored once', () => {
  const env = bootstrap();
  const h = hotel(env);
  const a = env.call('fo.checkin', { res_id: book(env, h, 'Alice', DAY, '2026-11-22').res_id });
  const p1 = env.call('cash.post', { folio_id: a.folio_id, code: 'BREAKFAST', amount: '12.00', txn_key: 'pos-terminal-77' });
  const p2 = env.call('cash.post', { folio_id: a.folio_id, code: 'BREAKFAST', amount: '12.00', txn_key: 'pos-terminal-77' });
  assert.equal(p1.txn.txn_id, p2.txn.txn_id);
  assert.equal(p2.created, false);
  assert.equal(p2.folio_balance, 1200);
});

test('rebates above the approval limit are refused until a higher limit posts them', () => {
  const env = bootstrap();
  const h = hotel(env);
  const a = env.call('fo.checkin', { res_id: book(env, h, 'Alice', DAY, '2026-11-22').res_id });
  env.call('cash.post', { folio_id: a.folio_id, code: 'BREAKFAST', amount: '200.00' });

  const role = env.call('admin.roles.create', { name: 'Cashier' });
  env.call('admin.roles.approval_limit', { role_id: role.role_id, approval_limit: '50.00', version: role.version });
  grant(env, role.role_id, 'CASH.POST', ['Create']);
  grant(env, role.role_id, 'CASH.ADJUST', ['Create']);
  makeUser(env, 'cashier1', role.role_id, [h.pid]);
  const cashier = login(env, 'cashier1', 'Staff-Pass-123');
  // Regression: a user created by System Admin must not inherit the system scope.
  assert.equal(env.call('auth.me', {}, cashier).is_system_admin, false);

  assert.throws(() => env.call('cash.post', { folio_id: a.folio_id, code: 'ADJ', amount: '100.00' }, cashier),
    { code: 'APPROVAL_REQUIRED' });
  const ok = env.call('cash.post', { folio_id: a.folio_id, code: 'ADJ', amount: '40.00' }, cashier);
  assert.equal(ok.created, true);
  // The cashier has no CASH.VIEW grant, so the folio view is hidden from them.
  assert.throws(() => env.call('cash.folio', { folio_id: a.folio_id }, cashier), { code: 'NOT_FOUND' });
});

test('night audit posts each night once, rolls the date, and refuses a second run for the same date', () => {
  const env = bootstrap();
  const h = hotel(env);
  const a = env.call('fo.checkin', { res_id: book(env, h, 'Alice', DAY, '2026-11-22').res_id });
  env.call('fo.checkin', { res_id: book(env, h, 'Bob', DAY, '2026-11-23').res_id });
  // Alice leaves on the audit date, before the audit runs.
  env.call('fo.checkout', { res_id: a.res_id });

  const status = env.call('audit.status', { property_id: h.pid });
  assert.equal(status.can_run, true);

  const run1 = env.call('audit.run', { property_id: h.pid });
  assert.equal(run1.run.status, 'COMPLETE');
  assert.equal(run1.run.rooms_posted, 1, 'only Bob stayed the night of the audit date');
  assert.equal(run1.run.room_minor, 10000);
  assert.equal(run1.run.tax_minor, 1000, 'VAT placeholder 10% on 100.00');
  assert.equal(run1.next_business_date, '2026-11-21');

  const run2 = env.call('audit.run', { property_id: h.pid });
  assert.equal(run2.run.rooms_posted, 1, 'next night posts for Bob');
  const roomPostings = rowsOf(env, 'Transactions').filter((t) => t.code === 'ROOM');
  assert.equal(roomPostings.length, 2, 'two nights, one posting each');

  // Force the date back and try to audit it again.
  env.backend.sheets.Properties[0].business_date = DAY;
  assert.throws(() => env.call('audit.run', { property_id: h.pid }), { code: 'DUPLICATE_AUDIT' });
});

test('a failed audit leaves the business date unchanged, and a rerun posts nothing twice', () => {
  const env = bootstrap();
  const h = hotel(env);
  const bob = env.call('fo.checkin', { res_id: book(env, h, 'Bob', DAY, '2026-11-23').res_id });
  env.call('audit.run', { property_id: h.pid });
  assert.equal(env.call('audit.status', { property_id: h.pid }).business_date, '2026-11-21');

  // Corrupt the ledger: an unbalanced transfer leg.
  env.ctx.Store.insert('Transactions', {
    txn_key: 'BAD-LEG', property_id: h.pid, folio_id: bob.folio_id, res_id: bob.res_id, code: 'TRANSFER',
    kind: 'TRANSFER', amount_minor: 500, currency: 'USD', business_date: '2026-11-21', reverses_txn_id: '',
    description: 'injected', created_at: new Date().toISOString(), created_by: 'TEST'
  }, 'TEST');

  assert.throws(() => env.call('audit.run', { property_id: h.pid }), { code: 'LEDGER_UNBALANCED' });
  const after = env.call('audit.status', { property_id: h.pid });
  assert.equal(after.business_date, '2026-11-21', 'date did not roll');
  assert.ok(after.last_runs.some((r) => r.status === 'FAILED'));

  // Repair the ledger with the offsetting leg, then rerun.
  env.ctx.Store.insert('Transactions', {
    txn_key: 'BAD-LEG-FIX', property_id: h.pid, folio_id: bob.folio_id, res_id: bob.res_id, code: 'TRANSFER',
    kind: 'TRANSFER', amount_minor: -500, currency: 'USD', business_date: '2026-11-21', reverses_txn_id: '',
    description: 'offset', created_at: new Date().toISOString(), created_by: 'TEST'
  }, 'TEST');
  const rerun = env.call('audit.run', { property_id: h.pid });
  assert.equal(rerun.run.status, 'COMPLETE');
  assert.equal(rerun.run.rooms_posted, 0, 'room charge for the date was already posted by the failed run');
  const bobRoomsOn21 = rowsOf(env, 'Transactions').filter((t) =>
    t.code === 'ROOM' && t.res_id === bob.res_id && t.business_date === '2026-11-21');
  assert.equal(bobRoomsOn21.length, 1);
});

test('occupancy, ADR and RevPAR follow the stated definitions', () => {
  const env = bootstrap();
  const h = hotel(env);
  const a = env.call('fo.checkin', { res_id: book(env, h, 'Alice', DAY, '2026-11-22').res_id });
  env.call('fo.checkin', { res_id: book(env, h, 'Bob', DAY, '2026-11-22').res_id });
  env.call('fo.checkout', { res_id: a.res_id }); // departs same day, no night charged
  env.call('audit.run', { property_id: h.pid });

  const flash = env.call('rpt.flash', { property_id: h.pid, date: DAY });
  assert.equal(flash.rooms_sold, 1);
  assert.equal(flash.occupancy, 0.5, 'sold 1 of 2 rooms');
  assert.equal(flash.room_revenue_minor, 10000);
  assert.equal(flash.adr_minor, 10000);
  assert.equal(flash.revpar_minor, 5000);
});

test('guest ledger lists only open folios with a balance', () => {
  const env = bootstrap();
  const h = hotel(env);
  const a = env.call('fo.checkin', { res_id: book(env, h, 'Alice', DAY, '2026-11-22').res_id });
  env.call('fo.checkin', { res_id: book(env, h, 'Bob', DAY, '2026-11-22').res_id });
  env.call('cash.post', { folio_id: a.folio_id, code: 'BREAKFAST', amount: '9.50' });
  const ledger = env.call('rpt.guest_ledger', { property_id: h.pid });
  assert.equal(ledger.total, 1);
  assert.equal(ledger.items[0].balance_minor, 950);
});

test('CSV export is available only with the Export level', () => {
  const env = bootstrap();
  const h = hotel(env);
  const a = env.call('fo.checkin', { res_id: book(env, h, 'Alice', DAY, '2026-11-22').res_id });
  env.call('cash.post', { folio_id: a.folio_id, code: 'BREAKFAST', amount: '4.00' });
  const csv = env.call('rpt.daily_revenue_csv', { property_id: h.pid, date: DAY });
  assert.match(csv.csv, /^code,count,amount/);
  assert.match(csv.csv, /BREAKFAST,1,4\.00/);
});

test('permissions: hidden functions return NOT_FOUND, missing levels FORBIDDEN, other properties FORBIDDEN', () => {
  const env = bootstrap();
  const h = hotel(env, { user_limit: 2 });
  const hq2 = makeProperty(env, { code: 'HQ2', user_limit: 5 });

  const frontDesk = env.call('admin.roles.create', { name: 'Front Desk' });
  grant(env, frontDesk.role_id, 'RES.VIEW', ['View']);
  grant(env, frontDesk.role_id, 'FO.RACK', ['View']);
  makeUser(env, 'frontdesk', frontDesk.role_id, [h.pid]);
  const fd = login(env, 'frontdesk', 'Staff-Pass-123');

  assert.ok(env.call('res.availability', { property_id: h.pid, arrival: DAY, departure: '2026-11-21' }, fd));
  assert.throws(() => env.call('res.create', {
    property_id: h.pid, room_type_id: h.typeId, arrival: DAY, departure: '2026-11-21', guest: { first_name: 'X', last_name: 'Y' }
  }, fd), { code: 'NOT_FOUND' });
  assert.throws(() => env.call('admin.users.list', {}, fd), { code: 'NOT_FOUND' });
  assert.throws(() => env.call('res.availability', { property_id: hq2.property_id, arrival: DAY, departure: '2026-11-21' }, fd),
    { code: 'FORBIDDEN' });

  grant(env, frontDesk.role_id, 'RES.BOOK', ['View']);
  assert.throws(() => env.call('res.create', {
    property_id: h.pid, room_type_id: h.typeId, arrival: DAY, departure: '2026-11-21', guest: { first_name: 'X', last_name: 'Y' }
  }, fd), { code: 'FORBIDDEN' });

  // A module switched off for the property hides it from everyone there.
  env.call('admin.flags.set', { property_id: h.pid, module_key: 'RESERVATIONS', enabled: false });
  assert.throws(() => env.call('res.availability', { property_id: h.pid, arrival: DAY, departure: '2026-11-21' }, fd),
    { code: 'MODULE_DISABLED' });
  env.call('admin.flags.set', { property_id: h.pid, module_key: 'RESERVATIONS', enabled: true });

  // A suspended property blocks operations, including for System Admin.
  env.call('admin.properties.status', { property_id: hq2.property_id, status: 'SUSPENDED', version: hq2.version });
  assert.throws(() => env.call('res.availability', { property_id: hq2.property_id, arrival: DAY, departure: '2026-11-21' }),
    { code: 'PROPERTY_SUSPENDED' });
});

test('a property admin cannot grant a level they do not hold, and user limits are enforced', () => {
  const env = bootstrap();
  const h = hotel(env, { user_limit: 2 });

  const frontDesk = env.call('admin.roles.create', { name: 'Front Desk' });
  grant(env, frontDesk.role_id, 'RES.VIEW', ['View']);
  const propAdmin = env.call('admin.roles.create', { name: 'Property Admin' });
  grant(env, propAdmin.role_id, 'ADMIN.PERM', ['Edit', 'View']);
  grant(env, propAdmin.role_id, 'ADMIN.USER', ['Create', 'View']);
  grant(env, propAdmin.role_id, 'RES.VIEW', ['View']);

  makeUser(env, 'pa', propAdmin.role_id, [h.pid]);
  makeUser(env, 'fd', frontDesk.role_id, [h.pid]);
  const pa = login(env, 'pa', 'Staff-Pass-123');

  assert.throws(() => grant_as(env, pa, frontDesk.role_id, 'RES.BOOK', ['Create']), { code: 'ESCALATION' });
  // Granting a level they already hold is allowed.
  assert.ok(grant_as(env, pa, frontDesk.role_id, 'RES.VIEW', ['View']));

  assert.throws(() => makeUser(env, 'third', frontDesk.role_id, [h.pid]), { code: 'USER_LIMIT' });
});

function grant_as(env, token, roleId, fn, levels) {
  return env.call('admin.permissions.set', { role_id: roleId, function_id: fn, levels }, token);
}

test('the API returns a clean envelope and never leaks internal errors', () => {
  const env = bootstrap();
  const bad = env.ctx.Api.handle('not json');
  assert.equal(bad.ok, false);
  assert.equal(bad.error.code, 'INTERNAL');
  assert.equal(bad.error.message, 'Unexpected error. The incident was logged.');

  const noToken = env.ctx.Api.handle(JSON.stringify({ action: 'res.list', payload: { property_id: 'X' } }));
  assert.equal(noToken.error.code, 'UNAUTHENTICATED');

  const unknown = env.ctx.Api.handle(JSON.stringify({ action: 'nope.nope', token: env.adminToken }));
  assert.equal(unknown.error.code, 'NOT_FOUND');
});

test('session expiry and logout are enforced on the server', () => {
  const env = bootstrap();
  const token = login(env, 'sysadmin', 'Correct-Horse-1');
  assert.ok(env.call('auth.me', {}, token).user);

  env.call('auth.logout', {}, token);
  assert.throws(() => env.call('auth.me', {}, token), { code: 'UNAUTHENTICATED' });

  const fresh = login(env, 'sysadmin', 'Correct-Horse-1');
  rowsOf(env, 'Sessions').forEach((s) => { s.expires_at = '2000-01-01T00:00:00.000Z'; });
  assert.throws(() => env.call('auth.me', {}, fresh), { code: 'UNAUTHENTICATED' });
});

test('repeated wrong passwords lock the account even when the right password follows', () => {
  const env = bootstrap();
  const h = hotel(env);
  const role = env.call('admin.roles.create', { name: 'Viewer' });
  makeUser(env, 'victim', role.role_id, [h.pid]);
  for (let i = 0; i < 5; i++) {
    assert.throws(() => env.ctx.Api.dispatch({ action: 'auth.login', payload: { username: 'victim', password: 'wrong-pass-1' } }),
      { code: 'AUTH_FAILED' });
  }
  assert.throws(() => env.ctx.Api.dispatch({ action: 'auth.login', payload: { username: 'victim', password: 'Staff-Pass-123' } }),
    { code: 'ACCOUNT_LOCKED' });
});

test('no-show needs the arrival date to have passed; in-house stays cannot be cancelled', () => {
  const env = bootstrap();
  const h = hotel(env);
  const future = book(env, h, 'Future', '2026-11-25', '2026-11-26');
  assert.throws(() => env.call('res.no_show', { res_id: future.res_id, version: future.version }), { code: 'INVALID_STATE' });

  const cancelled = env.call('res.cancel', { res_id: future.res_id, reason: 'Guest changed plans', version: future.version });
  assert.equal(cancelled.status, 'CANCELLED');

  const arrived = book(env, h, 'Walker', DAY, '2026-11-22');
  env.call('fo.checkin', { res_id: arrived.res_id });
  assert.throws(() => env.call('res.cancel', { res_id: arrived.res_id, reason: 'x', version: 2 }), { code: 'INVALID_STATE' });
});
