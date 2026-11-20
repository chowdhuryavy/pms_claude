# Scope status

This file says what is built, what is tested, and what is not built. It is the
first document to read before relying on the system.

## Verification

| Layer | Status |
| --- | --- |
| Backend logic (Apps Script sources) | 27 automated tests pass under Node 22 (`npm test`). They run the real files in `apps-script/src` with stubs for Apps Script globals and an in-memory sheet backend. |
| Sheets read/write path (`SheetsBackend`) | Written against the documented `SpreadsheetApp` API. **Not yet exercised against a live spreadsheet.** Run the deployment checklist in `docs/DEPLOYMENT.md` before trusting it. |
| Frontend (React, TypeScript, Vite, Tailwind) | Source is complete for six portals. **Not yet type-checked or built in the authoring environment**, because the package registry was unreachable there. CI runs `npm run typecheck` and `npm run build`. Expect a first-build fix pass. |
| Deployed end-to-end | Not yet done. |

## Built

**Authentication and sessions.** Username and password with salted, iterated SHA-256
(2,000 rounds). Opaque session tokens stored as hashes, 8-hour expiry, logout revokes.
Five failed logins lock the account for 15 minutes. Password policy: 12+ characters,
a letter and a digit. Generic error messages so usernames cannot be probed.

**Authorization.** Function-level grants per role, with nine levels (View, Create,
Edit, Delete, Approve, Execute, Export, Full Access). Hidden functions return
NOT_FOUND. Missing levels return FORBIDDEN. Property scope is checked on every
property-bound call. A suspended property blocks all operations. A disabled module
(feature flag) hides its functions for that property. No privilege escalation: a
non-system user can grant only levels they hold. User limits are enforced per
property. Users inherit their org from their property; the system scope `*` is only
set by bootstrap.

**Organizations, properties and licensing.** Create, update, activate and suspend.
Licensed room count enforced at room creation. Properties start with all modules on
and default codes seeded.

**Property configuration.** Room types (with base rate, occupancy), rooms (with
out-of-order status), and config items for rate, transaction, market, source, package
and payment codes, and tax rules (basis points). Transaction codes carry a kind:
CHARGE, PAYMENT, ADJUSTMENT, REBATE, TRANSFER or REVERSAL.

**Reservations.** Night-by-night availability per room type. Booking with guest
profile find-or-create by email, rate from request, rate code, or room type base.
Market and source codes validated against configuration. Modify dates or room type
(re-checks availability, excluding the booking itself). Cancel (not after check-in).
No-show (only on or after arrival date). Search by guest name, email or confirmation
number. Idempotency key on writes.

**Front office.** Room rack with summary counts. Arrivals and departures for the
business date. Check-in with auto-assignment (skips dirty, out-of-order and busy
rooms, requires matching room type) or a chosen room. Check-in opens a folio.
Check-out requires a zero balance, shortens an early departure to today, and marks the
room dirty. Housekeeping status changes. Out-of-order blocked while occupied.

**Cashiering.** Folio view with balance (computed from transactions). Charges,
payments, adjustments and rebates with the code's kind and sign applied on the server.
Transfers between folios as paired entries that net to zero. Reversals (one per
transaction; a reversal cannot be reversed). Rebates and adjustments above the
caller's approval limit are refused. Client-supplied `txn_key` makes a posting
idempotent.

**Night audit.** Pre-audit checks (unresolved arrivals, overdue departures, already
run, in progress). Run: no-show processing, room and tax posting for in-house stays
with deterministic keys, revenue validation, ledger validation (transfers net to zero),
business-date rollover. Failure leaves the date unchanged and records the error.
A completed date cannot be audited again.

**Reports.** Manager flash for a date (occupancy, ADR, RevPAR, room and total
revenue, payments, arrivals, departures, no-shows). Occupancy, ADR and RevPAR over a
date range with daily detail. Daily revenue by transaction code. Guest ledger (open
folios with a balance). CSV export of daily revenue (requires Export level). Definitions
are in `docs/REPORTS.md`.

**Audit trail.** Every write to configuration, permissions, reservations, folios,
postings and audit runs records before and after values with user, function ID and
time. The audit viewer is filtered by property and paged.

**Email and passwords.** Email settings (System Administrator only): SMTP (sent through a Vercel relay,
because Apps Script cannot open SMTP connections) and Resend. SMTP is used first when on;
Resend when SMTP is off or fails. Secrets are encrypted in the sheet. The API key is stored in Script Properties and is never
shown again. New users and admin resets receive a random temporary password by email and
must change it at first sign-in. The server blocks every other action until they do. Users
can change their password at any time; the page shows live rules and a match check.
Changing a password signs out other sessions. Emails are HTML with a plain-text part.

**Frontend portals.** Six separate HTML pages, one per portal, plus a password page: sign-in, administration
(organizations, properties, users, roles and approval limits, permission matrix,
module flags, audit log), property setup, front desk (rack, arrivals, departures,
availability and booking, reservation list with check-in, check-out, no-show and
cancel), cashier (folio, postings, transfers, reversals), and night audit with
reports. Buttons are hidden from users whose grants do not allow them. The server
enforces the same rules.

## Not built

These are part of the original brief and are not implemented:

- **Multi-factor authentication.** Not implemented. The brief asks for it where supported.
- **Email delivery retries and a delivery log.** A failed send is reported once, with the reason. It is not queued for retry.
- **Engineering module.** Maintenance requests, work orders, preventive maintenance, equipment register.
- **Housekeeping detail.** Cleaning assignments, inspections as a workflow, discrepancies, lost and found, linen tracking. Only room housekeeping status exists.
- **Purchasing and inventory.** Suppliers, requisitions, purchase orders, goods receipts, stock transfers, valuation, counts.
- **Finance ledgers.** Guest ledger is reported; city ledger, accounts receivable and aging, accounts payable, general ledger, chart of accounts, journals, trial balance, bank reconciliation, P&L and balance sheet are not built.
- **Approval workflow.** Over-limit postings are refused, with no request queue. A higher-limit user must post them directly.
- **Room blocks and allotments, group bookings, room moves, upgrades, deposits and deposit ledger, forecasting, rate calendars, revenue management.**
- **Packages.** Package codes can be configured but are not applied to postings.
- **Notification templates and integration APIs.** Not built.
- **Custom report builder, budget comparison, MTD/YTD comparison views** (date ranges are supported, comparisons are not).
- **Period locks.** Night audit prevents re-running a date, but there is no lock that blocks back-dated postings.
- **Multi-currency conversion.** Each folio uses its reservation's currency. No exchange.
- **Tax calculation by jurisdiction.** One rate per tax rule; the placeholder VAT rule (10%) must be set per property.
- **Business-date timezone handling.** Dates are plain calendar dates. The property timezone is stored but not used.
- **Reports on large data.** Report and history queries scan whole sheets. Indexes and archiving are not built.
- **Automated backups and reconciliation jobs.** The reconciler described in the design is not scheduled. Night audit validates the day it runs.
- **Mobile layout.** Frontend is desktop-first.
- **Tests for the frontend.** The UI has no automated tests.

## Known limitations in what is built

- **Sheets scale.** Every read loads the sheet once per request. Sessions and Transactions grow without bound. A date-indexed or archived design is needed for large hotels.
- **Global write lock.** All writes serialize through one script lock, across all properties. This is correct but limits throughput.
- **Web app access.** The deployment uses `access: ANYONE` so that the Vercel-hosted frontend can call it without a Google sign-in. Every call except login requires a valid session token, and the URL is only useful with one. The brief's preferred option is an authenticated gateway in front of the script. That is not built.
- **Session storage.** The frontend keeps the token in `sessionStorage`. A cross-site script injection could read it. The Content Security Policy in `vercel.json` reduces that risk but does not remove it.
- **Rate limiting** uses a fixed one-minute window in CacheService and is approximate under parallel load.
- **Idempotency** cache entries last up to six hours, the CacheService maximum.
- **Transfer legs** can be reversed individually, which breaks the pair. Reverse a transfer by transferring back instead. Blocking single-leg reversal is not yet done.
- **Early departure policy.** Checking out early shortens the stay to the checkout date, so a same-day departure is charged no room night. Hotels often charge a day-use rate instead. This is a policy decision to confirm.
