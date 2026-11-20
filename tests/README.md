# Tests

`npm test` runs two suites with Node's built-in test runner. No install is needed.

- `unit.test.js`: money, dates, validation, hashing and password policy.
- `flows.test.js`: end-to-end business flows against the real Apps Script sources,
  using an in-memory sheet backend. Covers booking, check-in and check-out, folio
  posting and reversal, approval limits, night audit and its recovery, permissions,
  lockout, sessions and the API envelope.

`helpers/gas-env.js` loads the files in `apps-script/src` into a sandboxed context
with stubs for `Utilities`, `PropertiesService`, `LockService`, `CacheService` and
`SpreadsheetApp`. It does not call Google.

Not covered by these tests: the `SheetsBackend` calls to a live spreadsheet, and
the React frontend. See `docs/SCOPE_STATUS.md`.
