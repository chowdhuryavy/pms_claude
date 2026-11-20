/**
 * Updater. Keeps this Apps Script project in step with the GitHub repo, without a computer.
 *
 * A push to the branch calls the web app (GitHub webhook). The files in apps-script/src are
 * read from GitHub, the project's code is replaced with them, a new version is made, and the
 * web app deployment is moved to that version. The /exec address does not change.
 *
 * Script properties (Project Settings → Script properties):
 *   WEBHOOK_KEY    required. Long random text. The webhook URL ends with &key=<this text>.
 *   GITHUB_TOKEN   optional. Only needed if the repo is private. Read-only "Contents" access.
 *   GITHUB_REPO    optional. Default chowdhuryavy/pms_claude
 *   GITHUB_BRANCH  optional. Default main
 *
 * Requires "Google Apps Script API" turned on at script.google.com/home/usersettings.
 * Run updateNow once from the editor to authorize and publish the first update.
 */

var Updater = (function () {
  var DEFAULT_REPO = 'chowdhuryavy/pms_claude';
  var SRC_RX = /^apps-script\/src\/([^\/]+)\.js$/;
  var MANIFEST_PATH = 'apps-script/src/appsscript.json';

  function config() {
    var p = PropertiesService.getScriptProperties();
    return {
      repo: p.getProperty('GITHUB_REPO') || DEFAULT_REPO,
      branch: p.getProperty('GITHUB_BRANCH') || 'main',
      token: String(p.getProperty('GITHUB_TOKEN') || '').replace(/\s+/g, ''),
      key: String(p.getProperty('WEBHOOK_KEY') || '')
    };
  }

  function github(cfg, path) {
    var headers = { Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' };
    if (cfg.token) headers.Authorization = 'Bearer ' + cfg.token;
    var res = UrlFetchApp.fetch('https://api.github.com/repos/' + cfg.repo + path, { headers: headers, muteHttpExceptions: true });
    if (res.getResponseCode() !== 200) throw new Error('GitHub returned ' + res.getResponseCode() + ' for ' + path + '. Check GITHUB_REPO and GITHUB_BRANCH.');
    return res.getContentText();
  }

  function rawFile(cfg, sha, path) {
    var headers = {};
    if (cfg.token) headers.Authorization = 'token ' + cfg.token;
    var res = UrlFetchApp.fetch('https://raw.githubusercontent.com/' + cfg.repo + '/' + sha + '/' + path,
      { headers: headers, muteHttpExceptions: true });
    if (res.getResponseCode() !== 200) throw new Error('Could not read ' + path + ' from GitHub (' + res.getResponseCode() + ')');
    return res.getContentText();
  }

  /** Reads the files of one commit. Returns [{ name, type, source }]. */
  function readFiles(cfg, sha) {
    var tree = JSON.parse(github(cfg, '/git/trees/' + sha + '?recursive=1'));
    var files = [];
    tree.tree.forEach(function (t) {
      if (t.type !== 'blob') return;
      if (t.path === MANIFEST_PATH) {
        files.push({ name: 'appsscript', type: 'JSON', source: rawFile(cfg, sha, t.path), path: t.path });
        return;
      }
      var m = t.path.match(SRC_RX);
      if (m) files.push({ name: m[1], type: 'SERVER_JS', source: rawFile(cfg, sha, t.path), path: t.path });
    });
    if (!files.some(function (f) { return f.path === 'apps-script/src/Updater.js'; })) {
      throw new Error('Updater.js is missing from the repo. The update was stopped so the updater keeps working.');
    }
    if (!files.some(function (f) { return f.name === 'appsscript'; })) {
      throw new Error('appsscript.json is missing from the repo.');
    }
    return files;
  }

  function api(method, path, body) {
    var res = UrlFetchApp.fetch('https://script.googleapis.com/v1/projects/' + ScriptApp.getScriptId() + path, {
      method: method,
      contentType: 'application/json',
      payload: body ? JSON.stringify(body) : undefined,
      headers: { Authorization: 'Bearer ' + ScriptApp.getOAuthToken() },
      muteHttpExceptions: true
    });
    var text = res.getContentText();
    if (res.getResponseCode() >= 300) {
      if (/has not enabled the Apps Script API/i.test(text)) {
        throw new Error('Turn on "Google Apps Script API" at script.google.com/home/usersettings, wait 2 to 3 minutes and try again.');
      }
      throw new Error('Apps Script API ' + res.getResponseCode() + ': ' + text.slice(0, 300));
    }
    return text ? JSON.parse(text) : {};
  }

  function hashOf(files) {
    var text = files.map(function (f) { return f.name + '\n' + f.source; }).join('\n\u0000\n');
    return Utilities.base64Encode(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, text, Utilities.Charset.UTF_8));
  }

  /** Publishes the repo's newest code. Returns a message for the log or the webhook response. */
  function run(cfg) {
    var lock = LockService.getScriptLock();
    if (!lock.tryLock(30000)) return 'Another update is running. Try again in a minute.';
    try {
      var props = PropertiesService.getScriptProperties();
      var sha = JSON.parse(github(cfg, '/commits/' + encodeURIComponent(cfg.branch))).sha;
      if (!sha) throw new Error('Could not read the latest commit of ' + cfg.branch);

      var files = readFiles(cfg, sha);
      var hash = hashOf(files);
      if (hash === props.getProperty('CONTENT_HASH')) {
        return 'No code changes in ' + sha.slice(0, 7) + '. Nothing to update.';
      }

      api('put', '/content', { files: files.map(function (f) { return { name: f.name, type: f.type, source: f.source }; }) });

      var version = api('post', '/versions', { description: 'GitHub ' + sha.slice(0, 7) }).versionNumber;
      var deployments = api('get', '/deployments?pageSize=50').deployments || [];
      var webApps = deployments.filter(function (d) {
        return d.deploymentConfig && d.deploymentConfig.versionNumber &&
          (d.entryPoints || []).some(function (e) { return e.entryPointType === 'WEB_APP'; });
      });
      var failed = [];
      webApps.forEach(function (d) {
        try {
          api('put', '/deployments/' + d.deploymentId, { deploymentConfig: {
            scriptId: ScriptApp.getScriptId(), versionNumber: version,
            manifestFileName: 'appsscript', description: 'GitHub ' + sha.slice(0, 7) } });
        } catch (err) { failed.push(String(err.message || err)); }
      });
      if (failed.length) {
        // Leave the hash unchanged so the next run tries again.
        throw new Error('Code was updated, but ' + failed.length + ' web app link(s) did not move: ' + failed[0]);
      }
      props.setProperty('CONTENT_HASH', hash);
      return 'Updated to GitHub ' + sha.slice(0, 7) + ' (version ' + version + ').';
    } finally {
      lock.releaseLock();
    }
  }

  function safeEqual(a, b) {
    if (a.length !== b.length) return false;
    var diff = 0;
    for (var i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
    return diff === 0;
  }

  function json(obj) {
    return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
  }

  /** GitHub webhook. The request must carry ?key=WEBHOOK_KEY. */
  function webhook(e) {
    var cfg = config();
    var given = e && e.parameter ? String(e.parameter.key || '') : '';
    if (!cfg.key || !safeEqual(given, cfg.key)) {
      return json({ ok: false, error: { code: 'FORBIDDEN', message: 'Not allowed' } });
    }
    var payload = {};
    try { payload = JSON.parse((e.postData && e.postData.contents) || '{}'); } catch (err) { payload = {}; }
    if (payload.zen) return json({ ok: true, data: { message: 'Webhook connected.' } });
    if (payload.ref && payload.ref !== 'refs/heads/' + cfg.branch) {
      return json({ ok: true, data: { message: 'Ignored: push to another branch.' } });
    }
    try {
      return json({ ok: true, data: { message: run(cfg) } });
    } catch (err) {
      console.error('Updater: ' + (err && err.message ? err.message : err));
      return json({ ok: false, error: { code: 'UPDATE_FAILED', message: String(err && err.message ? err.message : err) } });
    }
  }

  return { run: run, webhook: webhook, config: config };
})();

/** Editor entry point: run once to authorize, and to update on demand. */
function updateNow() {
  Logger.log(Updater.run(Updater.config()));
}

/** Web app entry point for GitHub. doPost calls this when ?hook=github is present. */
function updaterWebhook(e) {
  return Updater.webhook(e);
}
