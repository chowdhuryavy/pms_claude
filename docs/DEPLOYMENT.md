# Deployment

## 1. Google Sheets and Apps Script

1. Create an Apps Script project bound to nothing, and copy `apps-script/src/*` into it
   (or use `clasp push` from `apps-script/` after creating `.clasp.json` from
   `.clasp.json.example`).
2. Run `setupInitialize` once from the editor and authorize. This creates the five
   spreadsheets and stores their IDs in Script Properties.
3. Add Script Properties `PMS_BOOTSTRAP_USER` and `PMS_BOOTSTRAP_PASSWORD`.
4. Run `setupFirstAdmin` once. It deletes the bootstrap password when done.
5. Deploy: Deploy > New deployment > Web app. Execute as "User deploying",
   access "Anyone". Copy the `/exec` URL.

## 2. Frontend on Vercel

1. Import the GitHub repository in Vercel. Set the root directory to `frontend`.
2. Set the environment variable `VITE_API_URL` to the `/exec` URL.
3. Deploy. `vercel.json` sets the build command, output folder and security headers.

## 3. Updating the backend

The workflow `.github/workflows/deploy-apps-script.yml` is the updater. Apps Script
allows about 200 versions per project, so the two kinds of update are kept apart:

- **Small change (no new version):** push to `main` with a change under `apps-script/`.
  The code is uploaded to the project's HEAD. Test it at the **/dev** URL of the
  deployment (Deploy > Test deployments). The live **/exec** URL is unchanged.
- **Release (new version):** GitHub > Actions > Deploy Apps Script > Run workflow,
  set `mode` to `release` and enter a short note. This publishes a new version to the
  existing /exec deployment, so the frontend picks it up.

Batch several small changes into one release. Do not release after every commit.

One-time setup: add these repository secrets.

- `CLASPRC_JSON`: contents of `~/.clasprc.json` after `clasp login` on your machine.
- `APPS_SCRIPT_ID`: the Apps Script project ID (Project Settings).
- `APPS_SCRIPT_DEPLOYMENT_ID`: the ID of the web app deployment (Manage deployments).

The `production` environment in GitHub can require your approval before each run.

Files that are not part of the Apps Script project: `scripts/`, `tests/` and the
frontend configs are Node-only and must not be copied into the Apps Script editor.
Only `apps-script/src/*.js` and `appsscript.json` are uploaded.

## 4. Verification checklist

Run these after the first deployment. The tests in `npm test` cover the logic but
not the live Sheets calls.

- [ ] Login with the first admin succeeds and a wrong password returns AUTH_FAILED.
- [ ] Create a property, a room type and rooms. Check the rows appear in DB_ROOMS.
- [ ] Create a reservation, check it in, post a charge, and check out.
- [ ] Reload the Audit_Log sheet and confirm each write has a row.
- [ ] Run night audit for a test date and confirm the business date advances.
- [ ] Confirm `SheetsBackend` header validation fails loudly if a header is renamed.

## Rollback

Apps Script keeps versions. Open the deployment, choose the previous version, and
update the deployment. Sheet data is not rolled back by this; the append-only
ledger means a bad posting is fixed by a reversal, not by editing rows.
