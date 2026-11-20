/**
 * Outgoing email and email settings.
 *
 * Providers:
 *   RESEND  - Resend HTTPS API. The API key is kept in Script Properties (encrypted at
 *             rest by Google, never written to a sheet, never returned to the browser).
 *   GOOGLE  - MailApp, sent from the Google account that deployed the web app.
 *
 * Apps Script cannot open raw SMTP connections, so an SMTP server cannot be used
 * directly. Use a relay that offers an HTTPS sending API instead.
 *
 * Routing: the active provider is tried first. If it is GOOGLE and it fails, or the
 * setting is off, mail goes through RESEND when a key is configured.
 *
 * Only System Administrators may change email settings.
 */

var Mail = (function () {
  var PROP_RESEND_KEY = 'MAIL_RESEND_API_KEY';
  var RESEND_URL = 'https://api.resend.com/emails';

  function settingsRow() {
    return Store.list('Email_Settings', function () { return true; })[0] || null;
  }

  function resendKey() {
    return PropertiesService.getScriptProperties().getProperty(PROP_RESEND_KEY) || '';
  }

  function publicSettings(row) {
    var key = resendKey();
    return {
      setting_id: row ? row.setting_id : '',
      provider: row ? row.provider : 'RESEND',
      is_active: row ? String(row.is_active) === 'true' : false,
      from_name: row ? row.from_name : '',
      from_email: row ? row.from_email : '',
      app_url: row ? row.app_url : '',
      resend_configured: key !== '',
      resend_key_hint: key ? 're_••••' + key.slice(-4) : '',
      updated_at: row ? row.updated_at : '',
      version: row ? row.version : null
    };
  }

  function getSettings(ctx) {
    Perm.authorize(ctx, 'ADMIN.EMAIL', 'View');
    return publicSettings(settingsRow());
  }

  function requireSystem(ctx) {
    if (!Perm.isSystemUser(ctx.user)) throw new PmsError('FORBIDDEN', 'System Administrator only', 403);
  }

  function saveSettings(ctx, p) {
    Perm.authorize(ctx, 'ADMIN.EMAIL', 'Edit');
    requireSystem(ctx);
    var provider = Validate.oneOf(p.provider, 'provider', ['RESEND', 'GOOGLE']);
    var active = p.is_active === true || String(p.is_active) === 'true';
    var fromName = Validate.text(p.from_name, 'from_name', 120);
    var fromEmail = Validate.email(p.from_email);
    if (!fromEmail) throw new PmsError('VALIDATION', 'from_email is required');
    var appUrl = String(p.app_url || '').trim();
    if (appUrl && !/^https?:\/\/[^\s]+$/.test(appUrl)) throw new PmsError('VALIDATION', 'app_url must start with https://');

    var newKey = String(p.resend_api_key || '').trim();
    if (newKey) {
      if (newKey.length < 20 || newKey.indexOf(' ') !== -1) throw new PmsError('VALIDATION', 'Resend API key looks invalid');
      PropertiesService.getScriptProperties().setProperty(PROP_RESEND_KEY, newKey);
    }
    if (active && provider === 'RESEND' && !resendKey()) {
      throw new PmsError('VALIDATION', 'Add a Resend API key before activating Resend');
    }

    var patch = {
      provider: provider,
      is_active: active ? 'true' : 'false',
      from_name: fromName,
      from_email: fromEmail,
      app_url: appUrl,
      resend_key_hint: resendKey() ? resendKey().slice(-4) : ''
    };
    var before = settingsRow();
    var result;
    if (before) {
      result = Store.update('Email_Settings', before.setting_id, patch, p.version == null ? null : p.version, ctx.user.user_id);
    } else {
      result = { after: Store.insert('Email_Settings', patch, ctx.user.user_id) };
    }
    // The audit trail records the change without any secret value.
    Audit.record(ctx, 'ADMIN.EMAIL', 'SAVE', 'Email_Settings', result.after.setting_id,
      before ? { provider: before.provider, is_active: before.is_active } : null,
      { provider: provider, is_active: active ? 'true' : 'false', new_key_set: !!newKey }, null);
    return publicSettings(result.after);
  }

  function clearKey(ctx) {
    Perm.authorize(ctx, 'ADMIN.EMAIL', 'Edit');
    requireSystem(ctx);
    PropertiesService.getScriptProperties().deleteProperty(PROP_RESEND_KEY);
    var row = settingsRow();
    if (row) {
      Store.update('Email_Settings', row.setting_id,
        { resend_key_hint: '', is_active: row.provider === 'RESEND' ? 'false' : row.is_active }, null, ctx.user.user_id);
    }
    Audit.record(ctx, 'ADMIN.EMAIL', 'CLEAR_KEY', 'Email_Settings', row ? row.setting_id : '', null, { cleared: true }, null);
    return publicSettings(settingsRow());
  }

  function sendResend(from, msg) {
    var key = resendKey();
    if (!key) throw new Error('Resend is not configured');
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

  function sendGoogle(from, msg) {
    MailApp.sendEmail({
      to: msg.to, subject: msg.subject, htmlBody: msg.html, body: msg.text,
      name: from.name || 'Hotel PMS', replyTo: from.email
    });
    return { sent: true, provider: 'GOOGLE' };
  }

  /** Sends one message. Never throws: callers get { sent, provider, reason }. */
  function send(msg) {
    var row = settingsRow();
    var from = { name: row ? row.from_name : '', email: row ? row.from_email : '' };
    var active = row && String(row.is_active) === 'true' ? row.provider : null;
    if (!from.email) return { sent: false, provider: active || 'NONE', reason: 'Sender email is not configured' };

    var attempts = [];
    if (active === 'GOOGLE') attempts.push(sendGoogle);
    attempts.push(sendResend);
    var lastReason = 'No email provider is active';
    for (var i = 0; i < attempts.length; i++) {
      try {
        return attempts[i](from, msg);
      } catch (err) {
        lastReason = String(err && err.message ? err.message : err);
      }
    }
    return { sent: false, provider: active || 'NONE', reason: lastReason };
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
    getSettings: getSettings, saveSettings: saveSettings, clearKey: clearKey,
    send: send, test: test, settingsRow: settingsRow, resendKey: resendKey
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
    var html = '<!doctype html><html><body style="margin:0;background:#f1f5f9;font-family:Arial,Helvetica,sans-serif;color:#0f172a">' +
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
    return html;
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
