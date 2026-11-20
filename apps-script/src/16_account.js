/**
 * Passwords for user accounts: temporary passwords for new users and admin resets,
 * and voluntary or forced password changes.
 *
 * - A temporary password is random, sent by email, and never shown on screen or logged.
 * - A user with must_change_password set can call only auth.me, auth.logout and
 *   auth.change_password (enforced in Api.dispatch).
 * - Changing or resetting a password revokes the user's other sessions.
 */

var Account = (function () {

  /** 16 random hex characters in four groups, e.g. 3fa9-0c1e-b7d2-94e5. Always has a letter and a digit. */
  function temporaryPassword() {
    for (var attempt = 0; attempt < 5; attempt++) {
      var hex = (Utilities.getUuid() + Utilities.getUuid()).replace(/-/g, '').slice(0, 16).toLowerCase();
      var pwd = hex.slice(0, 4) + '-' + hex.slice(4, 8) + '-' + hex.slice(8, 12) + '-' + hex.slice(12, 16);
      if (/[a-z]/.test(pwd) && /\d/.test(pwd)) return pwd;
    }
    throw new PmsError('INTERNAL', 'Could not generate a password');
  }

  /** Hash fields for a fresh temporary password. The plain text is returned only for the email body. */
  function prepareTemporary() {
    var pwd = temporaryPassword();
    var salt = Hash.newSalt();
    return { password: pwd, salt: salt, password_hash: Hash.passwordHash(pwd, salt) };
  }

  /** Emails credentials. Returns { sent, provider, reason }. Never throws, so the account change still stands. */
  function sendTemporary(user, tempPassword, kind) {
    var settings = Mail.settingsRow();
    var appUrl = settings ? settings.app_url : '';
    var appName = 'Hotel PMS';
    var recipient = user.display_name || user.username;
    var isReset = kind === 'reset';
    var tpl = Templates.credentials({
      appName: appName,
      appUrl: appUrl,
      recipientName: recipient,
      username: user.username,
      tempPassword: tempPassword,
      subject: isReset ? 'Your Hotel PMS password was reset' : 'Your Hotel PMS account is ready',
      heading: isReset ? 'Your password was reset' : 'Welcome to Hotel PMS',
      intro: isReset
        ? 'An administrator reset your password. Use the temporary password below to sign in.'
        : 'An administrator created an account for you. Use the temporary password below to sign in.'
    });
    return Mail.send({ to: user.email, subject: tpl.subject, html: tpl.html, text: tpl.text });
  }

  /** Admin reset: new temporary password, sessions revoked, email sent. */
  function resetByAdmin(ctx, p) {
    Perm.authorize(ctx, 'ADMIN.USER', 'Edit');
    var target = Store.mustGet('Users', p.user_id);
    if (target.org_id === '*' && !Perm.isSystemUser(ctx.user)) {
      throw new PmsError('FORBIDDEN', 'Only a System Administrator can reset this account', 403);
    }
    Auth.splitList(target.property_ids).forEach(function (pid) { Perm.assertPropertyScope(ctx.user, pid); });
    if (!target.email) throw new PmsError('VALIDATION', 'This user has no email address. Add one before resetting.');

    var temp = prepareTemporary();
    Store.update('Users', target.user_id, {
      password_hash: temp.password_hash, salt: temp.salt,
      must_change_password: 'true', password_changed_at: '',
      failed_logins: 0, locked_until: ''
    }, p.version == null ? null : p.version, ctx.user.user_id);
    Auth.revokeSessions(target.user_id, null);

    var mail = sendTemporary(target, temp.password, 'reset');
    Audit.record(ctx, 'ADMIN.USER', 'PASSWORD_RESET', 'Users', target.user_id, null,
      { email_sent: mail.sent, provider: mail.provider }, null);
    return { user_id: target.user_id, email_sent: mail.sent, provider: mail.provider, reason: mail.sent ? '' : mail.reason };
  }

  /** Signed-in user changes their own password. Keeps the current session, revokes the others. */
  function changePassword(ctx, p) {
    var current = String(p.current_password || '');
    var next = Admin.assertPasswordPolicy(p.new_password);
    if (!current) throw new PmsError('VALIDATION', 'current_password is required');
    if (current === next) throw new PmsError('VALIDATION', 'New password must differ from the current one');
    var user = Store.mustGet('Users', ctx.user.user_id);
    if (Hash.passwordHash(current, user.salt) !== user.password_hash) {
      throw new PmsError('WRONG_PASSWORD', 'Current password is incorrect', 400);
    }
    var salt = Hash.newSalt();
    Store.update('Users', user.user_id, {
      password_hash: Hash.passwordHash(next, salt), salt: salt,
      must_change_password: '', password_changed_at: Dates.now(), failed_logins: 0, locked_until: ''
    }, null, user.user_id);
    Auth.revokeSessions(user.user_id, ctx.session.token_hash);
    Audit.record(ctx, 'AUTH', 'PASSWORD_CHANGE', 'Users', user.user_id, null, { changed: true }, null);
    return { changed: true };
  }

  return { temporaryPassword: temporaryPassword, prepareTemporary: prepareTemporary,
    sendTemporary: sendTemporary, resetByAdmin: resetByAdmin, changePassword: changePassword };
})();
