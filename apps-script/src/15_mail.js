/**
 * Outgoing email and email settings.
 *
 * Two providers, as configured by the System Administrator:
 *   SMTP    - Apps Script cannot open SMTP connections, so the message is posted to a
 *             small relay (frontend/api/send-smtp.js, deployed on Vercel), which sends
 *             it over SMTP. The relay checks a shared secret on every request.
 *   RESEND  - Resend HTTPS API.
 *
 * Routing: SMTP is tried first when it is active. Resend is used when SMTP is not active,
 * or when SMTP fails and Resend is enabled with a key.
 *
 * Secrets (SMTP password, relay secret, Resend key) are stored encrypted in the
 * Email_Settings sheet with Vault. They are never returned to the browser; only a
 * "saved" flag and the last four characters of the Resend key are shown.
 *
 * Only System Administrators may read or change email settings.
 */

var Mail = (function () {
  var RESEND_URL = 'https://api.resend.com/emails';

  function settingsRow() {
    return Store.list('Email_Settings', function () { return true; })[0] || null;
  }

  function isOn(v) {
    return v === true || String(v) === 'true';
  }

  function publicSettings(row) {
    return {
      setting_id: row ? row.setting_id : '',
      smtp_active: row ? isOn(row.smtp_active) : false,
      smtp_host: row ? row.smtp_host : '',
      smtp_port: row ? Number(row.smtp_port) || 587 : 587,
      smtp_secure: row ? isOn(row.smtp_secure) : false,
      smtp_user: row ? row.smtp_user : '',
      smtp_password_saved: !!(row && row.smtp_password_enc),
      relay_url: row ? row.relay_url : '',
      relay_secret_saved: !!(row && row.relay_secret_enc),
      resend_active: row ? isOn(row.resend_active) : false,
      resend_key_saved: !!(row && row.resend_api_key_enc),
      resend_key_hint: row ? row.resend_key_hint : '',
      from_name: row ? row.from_name : 'Hotel PMS',
      from_email: row ? row.from_email : '',
      app_url: row ? row.app_url : '',
      updated_at: row ? row.updated_at : '',
      version: row ? row.version : null
    };
  }

  function requireSystem(ctx) {
    if (!Perm.isSystemUser(ctx.user)) throw new PmsError('FORBIDDEN', 'System Administrator only', 403);
  }

  function getSettings(ctx) {
    Perm.authorize(ctx, 'ADMIN.EMAIL', 'View');
    requireSystem(ctx);
    return publicSettings(settingsRow());
  }

  /** Validates and stores settings. Secret fields are encrypted; blank secret fields keep the saved value. */
  function saveSettings(ctx, p) {
    Perm.authorize(ctx, 'ADMIN.EMAIL', 'Edit');
    requireSystem(ctx);
    var before = settingsRow();
    var prev = before || {};

    var fromName = Validate.text(p.from_name || 'Hotel PMS', 'from_name', 120);
    var fromEmail = Validate.email(p.from_email);
    if (!fromEmail) throw new PmsError('VALIDATION', 'from_email is required');
    var appUrl = String(p.app_url || '').trim();
    if (appUrl && !/^https:\/\/[^\s]+$/.test(appUrl)) throw new PmsError('VALIDATION', 'app_url must start with https://');

    var smtpActive = isOn(p.smtp_active);
    var smtpHost = String(p.smtp_host || '').trim();
    var smtpPort = Number(p.smtp_port || 587);
    if (!(smtpPort >= 1 && smtpPort <= 65535 && Math.floor(smtpPort) === smtpPort)) {
      throw new PmsError('VALIDATION', 'smtp_port must be a whole number from 1 to 65535');
    }
    var smtpSecure = isOn(p.smtp_secure);
    var smtpUser = String(p.smtp_user || '').trim();
    var relayUrl = String(p.relay_url || '').trim();
    if (relayUrl && !/^https:\/\/[^\s]+$/.test(relayUrl)) throw new PmsError('VALIDATION', 'relay_url must start with https://');

    var patch = {
      smtp_host: smtpHost, smtp_port: String(smtpPort), smtp_secure: smtpSecure ? 'true' : 'false',
      smtp_user: smtpUser, relay_url: relayUrl, from_name: fromName, from_email: fromEmail, app_url: appUrl
    };
    var smtpPassword = String(p.smtp_password || '');
    if (smtpPassword) patch.smtp_password_enc = Vault.encrypt(smtpPassword);
    var relaySecret = String(p.relay_secret || '').trim();
    if (relaySecret) {
      if (relaySecret.length < 24) throw new PmsError('VALIDATION', 'relay_secret must be at least 24 characters');
      patch.relay_secret_enc = Vault.encrypt(relaySecret);
    }
    var resendKey = String(p.resend_api_key || '').trim();
    if (resendKey) {
      if (!/^re_[A-Za-z0-9_]{10,}$/.test(resendKey)) throw new PmsError('VALIDATION', 'Resend API key looks invalid');
      patch.resend_api_key_enc = Vault.encrypt(resendKey);
      patch.resend_key_hint = resendKey.slice(-4);
    }

    var smtpPasswordSaved = !!(patch.smtp_password_enc || prev.smtp_password_enc);
    var relaySecretSaved = !!(patch.relay_secret_enc || prev.relay_secret_enc);
    var resendSaved = !!(patch.resend_api_key_enc || prev.resend_api_key_enc);
    var resendActive = isOn(p.resend_active);

    if (smtpActive && (!smtpHost || !smtpUser || !smtpPasswordSaved || !relayUrl || !relaySecretSaved)) {
      throw new PmsError('VALIDATION', 'To turn SMTP on, enter host, user, password, relay URL and relay secret');
    }
    if (resendActive && !resendSaved) throw new PmsError('VALIDATION', 'To turn Resend on, enter an API key');

    patch.smtp_active = smtpActive ? 'true' : 'false';
    patch.resend_active = resendActive ? 'true' : 'false';

    var result;
    if (before) {
      result = Store.update('Email_Settings', before.setting_id, patch, p.version == null ? null : p.version, ctx.user.user_id);
    } else {
      result = { after: Store.insert('Email_Settings', patch, ctx.user.user_id) };
    }
    // The audit trail records what changed, never the values of secrets.
    Audit.record(ctx, 'ADMIN.EMAIL', 'SAVE', 'Email_Settings', result.after.setting_id,
      before ? { smtp_active: before.smtp_active, resend_active: before.resend_active } : null,
      { smtp_active: patch.smtp_active, resend_active: patch.resend_active,
        secrets_changed: Object.keys(patch).filter(function (k) { return /_enc$/.test(k); }) }, null);
    return publicSettings(result.after);
  }

  var SECRET_FIELDS = { smtp_password: 'smtp_password_enc', relay_secret: 'relay_secret_enc', resend: 'resend_api_key_enc' };

  /** Removes one saved secret and turns off the provider that needs it. */
  function clearSecret(ctx, p) {
    Perm.authorize(ctx, 'ADMIN.EMAIL', 'Edit');
    requireSystem(ctx);
    var field = SECRET_FIELDS[String(p.which)];
    if (!field) throw new PmsError('VALIDATION', 'which must be smtp_password, relay_secret or resend');
    var row = settingsRow();
    if (!row) throw new PmsError('NOT_FOUND', 'Email settings are not saved yet', 404);
    var patch = {};
    patch[field] = '';
    if (field === 'resend_api_key_enc') { patch.resend_key_hint = ''; patch.resend_active = 'false'; }
    if (field === 'smtp_password_enc' || field === 'relay_secret_enc') patch.smtp_active = 'false';
    var result = Store.update('Email_Settings', row.setting_id, patch, null, ctx.user.user_id);
    Audit.record(ctx, 'ADMIN.EMAIL', 'CLEAR_SECRET', 'Email_Settings', row.setting_id, null, { which: p.which }, null);
    return publicSettings(result.after);
  }

  function sendSmtp(from, msg, row) {
    var relaySecret = Vault.decrypt(row.relay_secret_enc);
    var smtpPassword = Vault.decrypt(row.smtp_password_enc);
    var res = UrlFetchApp.fetch(row.relay_url, {
      method: 'post',
      contentType: 'application/json',
      headers: { 'X-Relay-Secret': relaySecret },
      payload: JSON.stringify({
        from: from, to: msg.to, subject: msg.subject, html: msg.html, text: msg.text,
        smtp: { host: row.smtp_host, port: Number(row.smtp_port), secure: isOn(row.smtp_secure),
          user: row.smtp_user, pass: smtpPassword }
      }),
      muteHttpExceptions: true
    });
    var code = res.getResponseCode();
    if (code !== 200) throw new Error('SMTP relay responded with status ' + code);
    return { sent: true, provider: 'SMTP' };
  }

  function sendResend(from, msg, row) {
    var key = Vault.decrypt(row.resend_api_key_enc);
    var fromHeader = from.name ? from.name + ' <' + from.email + '>' : from.email;
    var res = UrlFetchApp.fetch(RESEND_URL, {
      method: 'post',
      contentType: 'application/json',
      headers: { Authorization: 'Bearer ' + key },
      payload: JSON.stringify({ from: fromHeader, to: [msg.to], subject: msg.subject, html: msg.html, text: msg.text }),
      muteHttpExceptions: true
    });
    var code = res.getResponseCode();
    if (code < 200 || code > 299) throw new Error('Resend responded with status ' + code);
    return { sent: true, provider: 'RESEND' };
  }

  /** Sends one message. Never throws: callers get { sent, provider, reason }. */
  function send(msg) {
    var row = settingsRow();
    if (!row || !row.from_email) return { sent: false, provider: 'NONE', reason: 'Sender email is not configured' };
    var from = { name: row.from_name, email: row.from_email };
    var attempts = [];
    if (isOn(row.smtp_active)) attempts.push({ name: 'SMTP', run: sendSmtp });
    if (isOn(row.resend_active)) attempts.push({ name: 'RESEND', run: sendResend });
    if (!attempts.length) return { sent: false, provider: 'NONE', reason: 'No email provider is active' };

    var lastReason = '';
    var lastProvider = 'NONE';
    for (var i = 0; i < attempts.length; i++) {
      lastProvider = attempts[i].name;
      try {
        return attempts[i].run(from, msg, row);
      } catch (err) {
        lastReason = String(err && err.message ? err.message : err);
      }
    }
    return { sent: false, provider: lastProvider, reason: lastReason };
  }

  function test(ctx, p) {
    Perm.authorize(ctx, 'ADMIN.EMAIL', 'Execute');
    requireSystem(ctx);
    var to = Validate.email(p.to);
    if (!to) throw new PmsError('VALIDATION', 'to is required');
    var t = Templates.test({ appName: 'Hotel PMS' });
    var result = send({ to: to, subject: t.subject, html: t.html, text: t.text });
    if (!result.sent) throw new PmsError('MAIL_FAILED', 'Test email was not sent: ' + result.reason, 502);
    return result;
  }

  return {
    getSettings: getSettings, saveSettings: saveSettings, clearSecret: clearSecret,
    send: send, test: test, settingsRow: settingsRow
  };
})();

/** Email bodies. Values are escaped, so a name cannot inject markup. */
var Templates = (function () {
  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function shell(opts) {
    var button = opts.button
      ? '<p style="margin:28px 0 8px"><a href="' + esc(opts.button.href) + '" style="background:#0f172a;color:#ffffff;' +
        'text-decoration:none;padding:12px 22px;border-radius:6px;font-weight:600;display:inline-block">' +
        esc(opts.button.label) + '</a></p>'
      : '';
    return '<!doctype html><html><body style="margin:0;background:#f1f5f9;font-family:Arial,Helvetica,sans-serif;color:#0f172a">' +
      '<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="padding:32px 12px"><tr><td align="center">' +
      '<table role="presentation" width="560" cellspacing="0" cellpadding="0" style="max-width:560px;width:100%;background:#ffffff;border-radius:10px;overflow:hidden">' +
      '<tr><td style="background:#0f172a;color:#ffffff;padding:20px 28px;font-size:18px;font-weight:700">' + esc(opts.appName) + '</td></tr>' +
      '<tr><td style="padding:28px">' +
      '<h1 style="margin:0 0 12px;font-size:20px">' + esc(opts.heading) + '</h1>' +
      opts.bodyHtml + button +
      '</td></tr>' +
      '<tr><td style="padding:16px 28px;background:#f8fafc;color:#64748b;font-size:12px;line-height:18px">' +
      esc(opts.footer) + '</td></tr>' +
      '</table></td></tr></table></body></html>';
  }

  function credentials(v) {
    var body = '<p style="margin:0 0 14px;line-height:22px">Hello ' + esc(v.recipientName) + ',</p>' +
      '<p style="margin:0 0 14px;line-height:22px">' + esc(v.intro) + '</p>' +
      '<table role="presentation" cellspacing="0" cellpadding="0" style="width:100%;background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px">' +
      '<tr><td style="padding:14px 18px;color:#64748b;font-size:13px">Username</td>' +
      '<td style="padding:14px 18px;font-family:Consolas,monospace;font-size:15px;font-weight:700">' + esc(v.username) + '</td></tr>' +
      '<tr><td style="padding:14px 18px;color:#64748b;font-size:13px">Temporary password</td>' +
      '<td style="padding:14px 18px;font-family:Consolas,monospace;font-size:15px;font-weight:700">' + esc(v.tempPassword) + '</td></tr>' +
      '</table>' +
      '<p style="margin:16px 0 0;line-height:22px">For your security, you must choose a new password the first time you sign in. ' +
      'The temporary password stops working after that.</p>' +
      '<p style="margin:12px 0 0;line-height:22px;color:#64748b;font-size:13px">If you did not expect this email, contact your administrator. ' +
      'We will never ask for your password by email.</p>';
    var text = 'Hello ' + v.recipientName + ',\n\n' + v.intro + '\n\nUsername: ' + v.username +
      '\nTemporary password: ' + v.tempPassword + '\n\nYou must choose a new password at first sign-in.' +
      (v.appUrl ? '\nSign in: ' + v.appUrl : '') + '\n\nIf you did not expect this email, contact your administrator.';
    return {
      subject: v.subject,
      html: shell({
        appName: v.appName, heading: v.heading, bodyHtml: body,
        button: v.appUrl ? { href: v.appUrl, label: 'Sign in' } : null,
        footer: 'Sent by ' + v.appName + '. This message contains a one-time credential. Do not forward it.'
      }),
      text: text
    };
  }

  function test(v) {
    return {
      subject: 'Test email from ' + v.appName,
      html: shell({
        appName: v.appName, heading: 'Email is working',
        bodyHtml: '<p style="margin:0;line-height:22px">This test message confirms that outgoing email is configured correctly.</p>',
        footer: 'Sent by ' + v.appName + ' as a configuration test.'
      }),
      text: 'This test message confirms that outgoing email is configured correctly.'
    };
  }

  return { credentials: credentials, test: test, esc: esc };
})();
