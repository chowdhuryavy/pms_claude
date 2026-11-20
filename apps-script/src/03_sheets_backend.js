/**
 * Real Google Sheets backend. Implements the Store backend contract with one
 * getValues() call per sheet and one setValues() per write.
 */

var SheetsBackend = (function () {
  var openCache = {};

  function spreadsheetFor(sheetName) {
    var domain = SCHEMA[sheetName].domain;
    var id = PropertiesService.getScriptProperties().getProperty(DOMAIN_PROP[domain]);
    if (!id) throw new PmsError('INTERNAL', 'Spreadsheet for ' + domain + ' not configured. Run Setup.initialize.', 500);
    if (!openCache[id]) openCache[id] = SpreadsheetApp.openById(id);
    return openCache[id];
  }

  function sheetFor(sheetName) {
    var sheet = spreadsheetFor(sheetName).getSheetByName(sheetName);
    if (!sheet) throw new PmsError('INTERNAL', 'Sheet ' + sheetName + ' is missing. Run Setup.initialize.', 500);
    return sheet;
  }

  function read(sheetName, headers) {
    var sheet = sheetFor(sheetName);
    var values = sheet.getDataRange().getValues();
    var actual = values[0] || [];
    for (var i = 0; i < headers.length; i++) {
      if (actual[i] !== headers[i]) {
        throw new PmsError('INTERNAL', 'Header mismatch in ' + sheetName + ' at column ' + (i + 1), 500);
      }
    }
    var out = [];
    for (var r = 1; r < values.length; r++) {
      var rowValues = values[r];
      if (rowValues.join('') === '') continue;
      var obj = { _row: r + 1 };
      headers.forEach(function (h, idx) {
        var v = rowValues[idx];
        obj[h] = v instanceof Date ? v.toISOString() : v;
      });
      out.push(obj);
    }
    return out;
  }

  function toArray(sheetName, obj) {
    return SCHEMA[sheetName].headers.map(function (h) {
      var v = obj[h];
      return v === undefined || v === null ? '' : v;
    });
  }

  function append(sheetName, obj) {
    var sheet = sheetFor(sheetName);
    sheet.appendRow(toArray(sheetName, obj));
    return sheet.getLastRow();
  }

  function write(sheetName, rowNumber, obj) {
    var sheet = sheetFor(sheetName);
    var values = toArray(sheetName, obj);
    sheet.getRange(rowNumber, 1, 1, values.length).setValues([values]);
  }

  return { read: read, append: append, write: write };
})();
