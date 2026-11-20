# Security

## Controls in place

- Passwords are stored as salted, iterated SHA-256 digests (2,000 rounds), never in plain text.
- Session tokens are random values. Only their hashes are stored. Sessions expire
  after 8 hours and logout revokes the session.
- Five failed logins lock the account for 15 minutes. Login errors do not reveal
  whether a username exists.
- Every permission check runs on the server. The frontend hides buttons for
  convenience only.
- A non-system user cannot grant a permission level they do not hold.
- Writes run under a script lock with idempotency keys and optimistic version checks.
- Every write is recorded in `Audit_Log` with before and after values.
- Responses for unexpected errors are generic. Stack traces stay in Apps Script logs.
- Money and folio balances are computed on the server from ledger rows.

## Passwords and email

- Temporary passwords are random (16 hex characters in four groups) and are generated on
  the server. Administrators never choose or see them.
- A new user or a reset user must change the password at first sign-in. Until then the
  server refuses every action except viewing their own account and changing the password.
- Changing or resetting a password signs out the user's other sessions.
- Temporary passwords are sent only by email. They are not written to any sheet or to the
  audit log, and the API never returns them.
- SMTP password, relay secret and Resend key are stored encrypted in the Email_Settings
  sheet (Vault in `17_vault.js`). The master key is in Script Properties. The browser
  only receives "saved" flags and the last four characters of the Resend key.
- Apps Script has no AES library, so Vault uses HMAC-SHA256 as a keystream with an
  encrypt-then-MAC tag. Tampered values are refused. It is not a vetted AES implementation.
- If the master key (`VAULT_MASTER_KEY` in Script Properties) is lost, stored secrets
  cannot be decrypted and must be entered again. Keep a copy in a password manager.
- SMTP is sent through the Vercel relay (`frontend/api/send-smtp.js`). The relay accepts
  requests only with the shared secret, which is `MAIL_RELAY_SECRET` in Vercel.

## Secrets and configuration

- Sheet IDs are stored in Apps Script Script Properties, not in source.
- `.clasprc.json`, `.clasp.json`, `.env` and `.env.local` are git-ignored.
- Deployment credentials are GitHub secrets: `CLASPRC_JSON`, `APPS_SCRIPT_ID`,
  `APPS_SCRIPT_DEPLOYMENT_ID`.
- The bootstrap password is held in Script Properties only while the first admin is
  created, then deleted by `setupFirstAdmin`.

## Known gaps

- Multi-factor authentication is not implemented.
- The web app is deployed with `ANYONE` access so the Vercel frontend can call it.
  Only a valid session token can do anything beyond login, but the endpoint is public.
  Put a gateway in front of it before production use if the brief's stricter
  requirement applies.
- The frontend keeps the session token in `sessionStorage`. A script injection
  could read it. The Content Security Policy in `frontend/vercel.json` reduces this risk.
- Logs of every login attempt are not yet exported to a SIEM.
- SMTP credentials pass through the Vercel relay during each send. Use a relay you control.

## Reporting a vulnerability

Do not open a public issue. Contact the repository owner directly.
