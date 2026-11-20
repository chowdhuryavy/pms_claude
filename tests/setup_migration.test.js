const test = require('node:test');
const assert = require('node:assert/strict');
const { createEnv } = require('./helpers/gas-env');

/** A sheet stub with the three calls the migration uses. Columns are 1-based in the API. */
function fakeSheet(headers) {
  const sheet = {
    cols: headers.slice(),
    getLastColumn() { return sheet.cols.length; },
    getRange(row, col, numRows, numCols) {
      return {
        getValues: () => [sheet.cols.slice(col - 1, col - 1 + numCols).concat(
          Array(Math.max(0, col - 1 + numCols - sheet.cols.length)).fill(''))],
        setValue: (v) => { sheet.cols[col - 1] = v; }
      };
    },
    insertColumnBefore(col) { sheet.cols.splice(col - 1, 0, ''); }
  };
  return sheet;
}

test('a sheet missing a column gets it at the schema position and keeps its data', () => {
  const env = createEnv();
  const expected = env.ctx.SCHEMA.Users.headers;
  // The older Users sheet: identical to the schema, but without the email column.
  const old = expected.filter((h) => h !== 'email');
  const sheet = fakeSheet(old);
  env.ctx.Setup.migrateHeaders(sheet, 'Users', expected);
  assert.deepEqual(sheet.cols.slice(0, expected.length), expected);
});

test('a sheet with a column out of order is refused and nothing is moved', () => {
  const env = createEnv();
  const expected = env.ctx.SCHEMA.Users.headers;
  const swapped = expected.slice();
  [swapped[2], swapped[3]] = [swapped[3], swapped[2]];
  const sheet = fakeSheet(swapped);
  assert.throws(() => env.ctx.Setup.migrateHeaders(sheet, 'Users', expected), /Move that column by hand/);
  assert.deepEqual(sheet.cols, swapped, 'the sheet is unchanged');
});

test('several missing columns are all added in one run', () => {
  const env = createEnv();
  const expected = env.ctx.SCHEMA.Users.headers;
  const old = expected.filter((h) => h !== 'email' && h !== 'must_change_password' && h !== 'password_changed_at');
  const sheet = fakeSheet(old);
  env.ctx.Setup.migrateHeaders(sheet, 'Users', expected);
  assert.deepEqual(sheet.cols.slice(0, expected.length), expected);
});
