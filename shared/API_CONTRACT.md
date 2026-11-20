# API contract

One endpoint serves every action. The frontend and the Apps Script backend both
follow this contract. Keep it in sync with `apps-script/src/14_api.js`.

## Transport

- `POST <deployment URL>` with a JSON body. The frontend sends `Content-Type: text/plain`
  so browsers do not send a CORS preflight. Apps Script parses the body either way.
- `GET <deployment URL>` returns a health marker only. It exposes no data.
- Every response is HTTP 200. Success and failure are told apart by the `ok` field.

## Request

```json
{
  "action": "res.create",
  "token": "opaque session token (omit for auth.login)",
  "payload": { "...": "action specific" },
  "idempotency_key": "client generated, unique per intended write"
}
```

`idempotency_key` is required for every write action. Retrying with the same key
returns the original result and does not repeat the write.

## Response

Success:

```json
{ "ok": true, "data": { "...": "action specific" } }
```

Failure:

```json
{ "ok": false, "error": { "code": "FORBIDDEN", "message": "Not allowed to perform this action." } }
```

Internal failures return `code: "INTERNAL"` with a generic message. Stack traces and
sheet names are never returned.

## Error codes

| Code | Meaning |
| --- | --- |
| `VALIDATION` | Input is missing or malformed. |
| `UNAUTHENTICATED` | No token, or the session has expired or was revoked. |
| `AUTH_FAILED` | Wrong username or password. The same message is used for unknown users. |
| `ACCOUNT_LOCKED` | Too many failed logins. Retry after the lock period. |
| `NOT_FOUND` | The record does not exist, or the caller has no grant for the function. |
| `FORBIDDEN` | The caller has the function but lacks the required level. |
| `PROPERTY_SUSPENDED` | The property or organization is suspended. |
| `MODULE_DISABLED` | The property has the module turned off. |
| `CONFLICT` | The record changed since it was read (version mismatch). Reload and retry. |
| `NO_AVAILABILITY` | No room of the requested type is free for every night. |
| `ROOM_UNAVAILABLE` | The chosen room is occupied or blocked for the dates. |
| `ROOM_TYPE_MISMATCH` | The chosen room is not of the reservation's room type. |
| `NO_ROOM` | Auto-assignment found no clean, free room. |
| `HK_NOT_READY` | The room is dirty. Clean it before check-in. |
| `BALANCE_DUE` | The folio balance is not zero at check-out. |
| `INVALID_STATE` | The action does not apply to the current status. |
| `APPROVAL_REQUIRED` | The amount is above the caller's approval limit. |
| `DUPLICATE_AUDIT` | Night audit has already completed for this business date. |
| `AUDIT_IN_PROGRESS` | Another night audit is running. |
| `REVENUE_MISMATCH` | Night audit found posted room revenue that does not match the stays. |
| `LEDGER_UNBALANCED` | Night audit found transfer legs that do not net to zero. |
| `RATE_LIMITED` | Too many requests. Slow down. |
| `WRONG_PASSWORD` | The current password given to `auth.change_password` is incorrect. |
| `PASSWORD_CHANGE_REQUIRED` | The user has a temporary password. Only `auth.me`, `auth.logout` and `auth.change_password` are allowed until it is changed. |
| `MAIL_FAILED` | A test email could not be sent. The message includes the provider's reason. |
| `INTERNAL` | Unexpected server error. |

## Action names

Actions are grouped by module. The full list with required functions is in the
`ROUTES` table in `apps-script/src/14_api.js`.

- `auth.login`, `auth.logout`, `auth.me`, `auth.change_password` (`current_password`, `new_password`)
- `admin.users.reset_password` (`user_id`, `version`): new temporary password, emailed, all sessions revoked
- `admin.email.get`, `admin.email.save`, `admin.email.clear_secret` (`which`: smtp_password, relay_secret, resend), `admin.email.test` (System Administrator only)
- `admin.*`: organizations, properties, users, roles, permissions, flags, audit
- `config.*`: room types, rooms, config items
- `res.*`: availability, create, get, list, modify, cancel, no-show, guest search
- `fo.*`: rack, arrivals, departures, check-in, check-out, room status
- `cash.*`: folio view, post, transfer, reverse, open folio
- `audit.*`: night audit status and run
- `rpt.*`: flash, daily revenue, occupancy range, guest ledger, CSV export

## Temporary passwords

`admin.users.create` and `admin.users.reset_password` never return a password. The
response has `email_sent`, `provider` and `reason`. The temporary password is only in the
email. Only one email provider is needed; see `docs/SECURITY.md`.

## Identifiers

Records are identified by stable keys such as `res_id`, `folio_id`, `room_id`.
Sheet row numbers are never exposed or accepted as identifiers.
