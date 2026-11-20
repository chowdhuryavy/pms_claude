const test = require('node:test');
const assert = require('node:assert/strict');
const { createEnv } = require('./helpers/gas-env');

const env = createEnv();
const g = env.ctx;

test('Money parses decimal strings to integer minor units without float error', () => {
  assert.equal(g.Money.parse('12'), 1200);
  assert.equal(g.Money.parse('12.5'), 1250);
  assert.equal(g.Money.parse('0.07'), 7);
  assert.equal(g.Money.parse('-0.07'), -7);
  // 0.1 + 0.2 is the classic float failure. Minor units avoid it.
  assert.equal(g.Money.parse('0.10') + g.Money.parse('0.20'), 30);
});

test('Money rejects malformed amounts', () => {
  assert.throws(() => g.Money.parse('1,000'), { code: 'VALIDATION' });
  assert.throws(() => g.Money.parse('1.234'), { code: 'VALIDATION' });
  assert.throws(() => g.Money.parse('abc'), { code: 'VALIDATION' });
});

test('Money formats with thousands separators and sign', () => {
  assert.equal(g.Money.format(123456), '1,234.56');
  assert.equal(g.Money.format(-5), '-0.05');
  assert.equal(g.Money.format(0), '0.00');
});

test('Money.roundDiv rounds half away from zero', () => {
  assert.equal(g.Money.roundDiv(5, 10), 1);
  assert.equal(g.Money.roundDiv(-5, 10), -1);
  assert.equal(g.Money.roundDiv(14, 10), 1);
  assert.equal(g.Money.roundDiv(15, 10), 2);
});

test('Dates counts nights and adds days across month boundaries', () => {
  assert.equal(g.Dates.nights('2026-11-20', '2026-11-23'), 3);
  assert.equal(g.Dates.addDays('2026-02-28', 1), '2026-03-01');
  assert.equal(g.Dates.addDays('2028-02-28', 1), '2028-02-29');
});

test('Dates.overlaps treats checkout day as free for the next arrival', () => {
  assert.equal(g.Dates.overlaps('2026-11-20', '2026-11-22', '2026-11-22', '2026-11-24'), false);
  assert.equal(g.Dates.overlaps('2026-11-20', '2026-11-22', '2026-11-21', '2026-11-23'), true);
});

test('Dates rejects impossible calendar dates', () => {
  assert.equal(g.Dates.isIsoDate('2026-02-30'), false);
  assert.equal(g.Dates.isIsoDate('2026-13-01'), false);
  assert.equal(g.Dates.isIsoDate('2026-11-20'), true);
});

test('Validate.integer and oneOf enforce bounds and allowed values', () => {
  assert.equal(g.Validate.integer('3', 'n', 1, 5), 3);
  assert.throws(() => g.Validate.integer('9', 'n', 1, 5), { code: 'VALIDATION' });
  assert.throws(() => g.Validate.integer('2.5', 'n', 1, 5), { code: 'VALIDATION' });
  assert.throws(() => g.Validate.oneOf('NOPE', 'status', ['ACTIVE']), { code: 'VALIDATION' });
});

test('Password hash is salted and verifies only the right password', () => {
  const h1 = g.Hash.passwordHash('Correct-Horse-1', 'salt-a');
  const h2 = g.Hash.passwordHash('Correct-Horse-1', 'salt-b');
  assert.notEqual(h1, h2);
  assert.equal(h1, g.Hash.passwordHash('Correct-Horse-1', 'salt-a'));
});

test('Password policy requires length, a letter and a digit', () => {
  assert.throws(() => g.Admin.assertPasswordPolicy('short1'), { code: 'VALIDATION' });
  assert.throws(() => g.Admin.assertPasswordPolicy('allletterspassword'), { code: 'VALIDATION' });
  assert.equal(g.Admin.assertPasswordPolicy('Correct-Horse-1'), 'Correct-Horse-1');
});
