/**
 * Data access over Google Sheets.
 *
 * - Each request loads a sheet at most once (request-scoped memo), so a page
 *   that needs Reservations twice reads the sheet once.
 * - Writes go through update() or insert(), which check `version` for optimistic
 *   concurrency and stamp audit columns.
 * - The backend is injectable. SheetsBackend talks to SpreadsheetApp; tests use
 *   an in-memory backend with the same contract.
 *
 * Backend contract:
 *   read(sheetName, headers)  -> Array<object> with _row (1-based sheet row)
 *   append(sheetName, obj)    -> row number written
 *   write(sheetName, row, obj)-> void
 */

var Store = (function () {
  var backend = null;
  var memo = {};

  function setBackend(b) {
    backend = b;
    memo = {};
  }

  /** Call at the start of every request so no stale rows survive between requests. */
  function beginRequest() {
    memo = {};
  }

  function schemaOf(name) {
    var s = SCHEMA[name];
    if (!s) throw new PmsError('INTERNAL', 'Unknown sheet ' + name, 500);
    return s;
  }

  function rows(name) {
    if (!backend) throw new PmsError('INTERNAL', 'Store backend not configured', 500);
    if (!memo[name]) {
      memo[name] = backend.read(name, schemaOf(name).headers);
    }
    return memo[name];
  }

  /** Returns rows matching predicate. Rows still carry _row for internal updates. */
  function list(name, predicate) {
    var out = [];
    var all = rows(name);
    for (var i = 0; i < all.length; i++) {
      if (!predicate || predicate(all[i])) out.push(all[i]);
    }
    return out;
  }

  function get(name, id) {
    var key = schemaOf(name).key;
    var all = rows(name);
    for (var i = 0; i < all.length; i++) {
      if (all[i][key] === id) return all[i];
    }
    return null;
  }

  function mustGet(name, id) {
    var row = get(name, id);
    if (!row) throw new PmsError('NOT_FOUND', name + ' ' + id + ' not found', 404);
    return row;
  }

  /** Inserts a new row. Sets key, audit columns and version=1 where the schema has them. */
  function insert(name, obj, userId) {
    var s = schemaOf(name);
    var now = Dates.now();
    var record = {};
    s.headers.forEach(function (h) { record[h] = ''; });
    Object.keys(obj).forEach(function (k) { record[k] = obj[k]; });
    if (!record[s.key]) record[s.key] = Ids.newId(s.key.split('_')[0].toUpperCase());
    if (s.headers.indexOf('created_at') !== -1) {
      record.created_at = now;
      record.created_by = userId || '';
    }
    if (s.headers.indexOf('version') !== -1) {
      record.version = 1;
      record.updated_at = now;
      record.updated_by = userId || '';
    }
    record._row = backend.append(name, record);
    rows(name).push(record);
    return record;
  }

  /**
   * Applies a patch to an existing row. expectedVersion, when given, must match
   * the stored version or the write is refused with CONFLICT.
   * Returns { before, after }.
   */
  function update(name, id, patch, expectedVersion, userId) {
    var s = schemaOf(name);
    var current = mustGet(name, id);
    if (expectedVersion !== undefined && expectedVersion !== null &&
        Number(expectedVersion) !== Number(current.version)) {
      throw new PmsError('CONFLICT', name + ' was changed by someone else. Reload and try again.', 409);
    }
    var before = copyWithoutInternal(current);
    var after = copyWithoutInternal(current);
    Object.keys(patch).forEach(function (k) {
      if (k === s.key || k === '_row') return;
      if (s.headers.indexOf(k) === -1) throw new PmsError('INTERNAL', 'Unknown column ' + name + '.' + k, 500);
      after[k] = patch[k];
    });
    if (s.headers.indexOf('version') !== -1) {
      after.version = Number(current.version) + 1;
      after.updated_at = Dates.now();
      after.updated_by = userId || '';
    }
    backend.write(name, current._row, after);
    Object.keys(after).forEach(function (k) { current[k] = after[k]; });
    return { before: before, after: copyWithoutInternal(current) };
  }

  function copyWithoutInternal(row) {
    var out = {};
    Object.keys(row).forEach(function (k) {
      if (k !== '_row') out[k] = row[k];
    });
    return out;
  }

  /** Strips internal fields before a row is sent to a client. */
  function publicRow(row) {
    return row ? copyWithoutInternal(row) : null;
  }

  function publicRows(arr) {
    return arr.map(publicRow);
  }

  return {
    setBackend: setBackend, beginRequest: beginRequest, list: list, get: get, mustGet: mustGet,
    insert: insert, update: update, publicRow: publicRow, publicRows: publicRows
  };
})();
