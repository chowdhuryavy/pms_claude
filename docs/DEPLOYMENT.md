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

## 3. Continuous deployment of the backend

The workflow `.github/workflows/deploy-apps-script.yml` pushes `apps-script/` with clasp
on each change to `main`. Add these repository secrets first:

- `CLASPRC_JSON`: contents of a local `~/.clasprc.json` after `clasp login`.
- `APPS_SCRIPT_ID`: the Apps Script project ID.
- `APPS_SCRIPT_DEPLOYMENT_ID` (optional): the web app deployment to update.

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
