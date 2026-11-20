/**
 * Core helpers: errors, money (integer minor units), dates, ids, validation.
 */

/** Error with a stable machine-readable code. Returned to clients as-is. */
function PmsError(code, message, status) {
  this.name = 'PmsError';
  this.code = code;
  this.message = message || code;
  this.status = status || 400;
}
PmsError.prototype = Object.create(Error.prototype);
PmsError.prototype.constructor = PmsError;

var Money = (function () {
  var DECIMALS = 2;
  var SCALE = Math.pow(10, DECIMALS);

  /** Parses "123", "123.4", "-12.50" into integer minor units. Never uses floats for storage. */
  function parse(value, field) {
    if (typeof value === 'number') {
      if (!isFinite(value) || Math.floor(value) !== value) {
        throw new PmsError('VALIDATION', (field || 'amount') + ' must be a decimal string');
      }
      return value * SCALE;
    }
    var s = String(value === null || value === undefined ? '' : value).trim();
    var m = /^(-?)(\d+)(?:\.(\d{1,2}))?$/.exec(s);
    if (!m) {
      throw new PmsError('VALIDATION', (field || 'amount') + ' must be a decimal with at most 2 places');
    }
    var whole = parseInt(m[2], 10);
    var frac = m[3] ? parseInt((m[3] + '0').slice(0, 2), 10) : 0;
    var minor = whole * SCALE + frac;
    return m[1] === '-' ? -minor : minor;
  }

  /** Formats integer minor units as "1,234.50". */
  function format(minor) {
    var negative = minor < 0;
    var abs = Math.abs(minor);
    var whole = Math.floor(abs / SCALE);
    var frac = abs % SCALE;
    var wholeText = String(whole).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    var fracText = frac < 10 ? '0' + frac : String(frac);
    return (negative ? '-' : '') + wholeText + '.' + fracText;
  }

  /** Round half away from zero for integer math on minor units. */
  function roundDiv(numerator, denominator) {
    var sign = numerator < 0 ? -1 : 1;
    return sign * Math.floor((Math.abs(numerator) + Math.floor(denominator / 2)) / denominator);
  }

  return { parse: parse, format: format, roundDiv: roundDiv, SCALE: SCALE };
})();

var Dates = (function () {
  var fixedNow = null;

  function now() {
    return fixedNow ? fixedNow : new Date().toISOString();
  }

  /** Test hook: freeze the clock. */
  function setNow(iso) {
    fixedNow = iso;
  }

  function isIsoDate(s) {
    if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
    var d = new Date(s + 'T00:00:00Z');
    return !isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
  }

  function assertIsoDate(s, field) {
    if (!isIsoDate(s)) throw new PmsError('VALIDATION', (field || 'date') + ' must be YYYY-MM-DD');
    return s;
  }

  function addDays(iso, days) {
    var d = new Date(iso + 'T00:00:00Z');
    d.setUTCDate(d.getUTCDate() + days);
    return d.toISOString().slice(0, 10);
  }

  /** Nights between arrival (inclusive) and departure (exclusive). */
  function nights(arrival, departure) {
    var a = new Date(arrival + 'T00:00:00Z').getTime();
    var d = new Date(departure + 'T00:00:00Z').getTime();
    return Math.round((d - a) / 86400000);
  }

  /** Two stays overlap when each arrives before the other departs. */
  function overlaps(aArr, aDep, bArr, bDep) {
    return aArr < bDep && aDep > bArr;
  }

  return {
    now: now, setNow: setNow, isIsoDate: isIsoDate, assertIsoDate: assertIsoDate,
    addDays: addDays, nights: nights, overlaps: overlaps
  };
})();

var Ids = (function () {
  function uuid() {
    return Utilities.getUuid().replace(/-/g, '');
  }

  /** Permanent, prefixed identifier. Never derived from a row number. */
  function newId(prefix) {
    return prefix + '_' + uuid().slice(0, 20).toUpperCase();
  }

  /** Short human confirmation number, e.g. "K7Q2M9XD". */
  function confirmationNo() {
    return uuid().slice(0, 8).toUpperCase();
  }

  return { newId: newId, confirmationNo: confirmationNo };
})();

var Validate = (function () {
  function required(obj, fields) {
    fields.forEach(function (f) {
      var v = obj[f];
      if (v === undefined || v === null || String(v).trim() === '') {
        throw new PmsError('VALIDATION', f + ' is required');
      }
    });
  }

  function text(value, field, max) {
    var s = String(value === undefined || value === null ? '' : value).trim();
    if (!s) throw new PmsError('VALIDATION', field + ' is required');
    if (s.length > (max || 200)) throw new PmsError('VALIDATION', field + ' is too long');
    return s;
  }

  function integer(value, field, min, max) {
    var n = Number(value);
    if (!Number.isInteger(n) || n < min || (max !== undefined && n > max)) {
      throw new PmsError('VALIDATION', field + ' must be an integer between ' + min + ' and ' + (max === undefined ? 'any' : max));
    }
    return n;
  }

  function oneOf(value, field, allowed) {
    if (allowed.indexOf(value) === -1) {
      throw new PmsError('VALIDATION', field + ' must be one of ' + allowed.join(', '));
    }
    return value;
  }

  function email(value) {
    var s = String(value || '').trim();
    if (s && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(s)) throw new PmsError('VALIDATION', 'email is invalid');
    return s;
  }

  return { required: required, text: text, integer: integer, oneOf: oneOf, email: email };
})();
