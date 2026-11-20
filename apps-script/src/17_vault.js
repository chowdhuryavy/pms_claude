/**
 * Encryption for secrets stored in sheets (API keys, SMTP and relay passwords).
 *
 * Apps Script has no AES library, so this uses a standard construction built from
 * HMAC-SHA256 (available in Utilities):
 *   - Keystream: HMAC-SHA256(encKey, nonce:counter), XORed with the plaintext.
 *   - Integrity: HMAC-SHA256(macKey, version|nonce|ciphertext), checked before decrypting
 *     (encrypt-then-MAC). Tampered values are refused.
 *   - encKey and macKey are derived from a 256-bit master key in Script Properties.
 *
 * The database holds only ciphertext. The master key lives in Script Properties, which
 * is encrypted at rest and visible only to the project's editors. If the master key is
 * lost, stored secrets cannot be recovered and must be entered again.
 *
 * This is not a vetted AES implementation. If a standard AES-GCM library becomes
 * available in Apps Script, switch to it.
 */

var Vault = (function () {
  var PROP_MASTER = 'VAULT_MASTER_KEY';
  var VERSION = 'v1';

  function toHex(bytes) {
    var out = '';
    for (var i = 0; i < bytes.length; i++) out += ((bytes[i] & 0xff) + 0x100).toString(16).slice(1);
    return out;
  }

  function unsigned(bytes) {
    return bytes.map(function (b) { return b & 0xff; });
  }

  function signed(bytes) {
    return bytes.map(function (b) { return b > 127 ? b - 256 : b; });
  }

  function hmac(key, message) {
    return unsigned(Utilities.computeHmacSha256Signature(message, key));
  }

  function masterKey() {
    var props = PropertiesService.getScriptProperties();
    var key = props.getProperty(PROP_MASTER);
    if (!key) {
      // 256 bits from Apps Script's secure random UUID generator.
      key = (Utilities.getUuid() + Utilities.getUuid()).replace(/-/g, '');
      props.setProperty(PROP_MASTER, key);
    }
    return key;
  }

  function derive(label) {
    return toHex(hmac(masterKey(), 'pms-vault|' + label));
  }

  function keystream(encKey, nonce, length) {
    var out = [];
    var counter = 0;
    while (out.length < length) {
      var block = hmac(encKey, nonce + ':' + counter);
      for (var j = 0; j < block.length && out.length < length; j++) out.push(block[j]);
      counter++;
    }
    return out;
  }

  function constantTimeEqual(a, b) {
    if (a.length !== b.length) return false;
    var diff = 0;
    for (var i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
    return diff === 0;
  }

  /** Returns "v1.<nonce>.<ciphertext base64>.<tag>". */
  function encrypt(plain) {
    if (plain === null || plain === undefined || plain === '') throw new Error('Nothing to encrypt');
    var encKey = derive('enc');
    var macKey = derive('mac');
    var nonce = Utilities.getUuid().replace(/-/g, '').slice(0, 32);
    var data = unsigned(Utilities.newBlob(String(plain), 'text/plain').getBytes());
    var stream = keystream(encKey, nonce, data.length);
    var ct = data.map(function (b, i) { return b ^ stream[i]; });
    var ctB64 = Utilities.base64Encode(signed(ct));
    var tag = toHex(hmac(macKey, VERSION + '|' + nonce + '|' + ctB64));
    return [VERSION, nonce, ctB64, tag].join('.');
  }

  /** Returns the plaintext, or throws if the value is malformed or was altered. */
  function decrypt(stored) {
    var parts = String(stored || '').split('.');
    if (parts.length !== 4 || parts[0] !== VERSION) throw new Error('Stored secret has an unknown format');
    var nonce = parts[1];
    var ctB64 = parts[2];
    var encKey = derive('enc');
    var macKey = derive('mac');
    var expected = toHex(hmac(macKey, VERSION + '|' + nonce + '|' + ctB64));
    if (!constantTimeEqual(expected, parts[3])) throw new Error('Stored secret failed its integrity check');
    var ct = unsigned(Utilities.base64Decode(ctB64));
    var stream = keystream(encKey, nonce, ct.length);
    var plain = ct.map(function (b, i) { return b ^ stream[i]; });
    return Utilities.newBlob(signed(plain), 'text/plain').getDataAsString('UTF-8');
  }

  return { encrypt: encrypt, decrypt: decrypt, toHex: toHex };
})();
