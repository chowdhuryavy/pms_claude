# Deployment

No computer or command line is needed after the first setup. Everything below can be done in
a web browser.

## 1. Google Sheets and Apps Script (one time)

1. Apps Script project: paste the files from `apps-script/src` (one file each, names without
   the extension). `Updater.js` must be included, because the updater lives in that file.
2. Turn on the Apps Script API: script.google.com/home/usersettings → "Google Apps Script API" on.
3. Project Settings → Script properties. Add:
   - `WEBHOOK_KEY`: a long random text (30 or more characters). Keep it private.
   - `GITHUB_TOKEN`: only if the repo is private. Otherwise leave it out.
4. Run `updateNow` once from the editor and approve the permissions. It loads the code,
   makes a version and moves the web app to it.
5. Run `setupInitialize` (creates the five spreadsheets), then `setupFirstAdmin` after
   adding `PMS_BOOTSTRAP_USER` and `PMS_BOOTSTRAP_PASSWORD` in Script properties.
6. Deploy → Manage deployments → the web app deployment. Keep its `/exec` URL. It does not
   change when the updater runs.

## 2. Updates from GitHub (automatic)

Every push to `main` updates the app. GitHub calls the web app, which:

1. reads the files in `apps-script/src` from the repo,
2. replaces the project's code with them,
3. makes a new version, and
4. moves the web app deployment to that version.

Pushes that change only other files (README, docs, frontend) do nothing in Apps Script.

One-time webhook setup on GitHub: repo → Settings → Webhooks → Add webhook.

- Payload URL: `<your /exec URL>?hook=github&key=<WEBHOOK_KEY>`
- Content type: `application/json`
- Events: "Just the push event"

Run `updateNow` in the editor to see the last result in Executions.

## 3. Frontend on Vercel (automatic)

The Vercel project is connected to the repo with root directory `frontend`. Every push
builds and deploys it. Environment variables used by the build and the relay:

- `VITE_API_URL`: the `/exec` URL.
- `MAIL_RELAY_SECRET`: the same value as the relay secret in the Email tab.

## 4. Verification checklist

- [ ] Sign in with the first admin works. A wrong password gives AUTH_FAILED.
- [ ] Create a property, a room type and rooms. Rows appear in DB_ROOMS.
- [ ] Create a reservation, check it in, post a charge, check out.
- [ ] Audit_Log has a row for each write.
- [ ] Night audit advances the business date.
- [ ] Email tab: send a test email through SMTP and through Resend.

## Rollback

Open Manage deployments and point the web app to an earlier version. Sheet data is not
rolled back. The ledger is append-only, so a bad posting is fixed by a reversal.
