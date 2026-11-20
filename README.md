# PMS Claude

A multi-property hotel PMS and ERP. The backend is Google Apps Script with Google
Sheets as the database. The frontend is React, TypeScript, Vite and Tailwind, split
into one page per portal and hosted on Vercel.

## What is in the repository

| Path | Contents |
| --- | --- |
| `apps-script/src/` | Backend. One file per module, loaded in order by Apps Script. |
| `frontend/` | Six portal pages: sign-in, admin, property setup, front desk, cashier, audit. |
| `tests/` | Node tests that run the Apps Script logic against an in-memory backend. |
| `shared/API_CONTRACT.md` | Request and response envelope, error codes, action names. |
| `docs/` | Scope and status, deployment, security, report definitions, schema. |
| `scripts/` | Generates `docs/SCHEMA.md` from the code. |
| `.github/workflows/` | CI (tests and frontend build) and Apps Script deployment. |

## Quick start

```bash
npm test                      # backend tests (no install needed)
cd frontend && npm install    # frontend dependencies
cp .env.example .env.local    # then set VITE_API_URL
npm run dev
```

## Read first

- `docs/SCOPE_STATUS.md` states what is built, what is tested, and what is not.
- `docs/DEPLOYMENT.md` covers setting up Sheets, Apps Script and Vercel.

## Status

The backend logic passes its tests. The frontend has not yet been built in CI
and the code has not yet run against a live spreadsheet. Treat the first deployment
as a verification step.
