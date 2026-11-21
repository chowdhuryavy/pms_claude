const test = require('node:test');
const assert = require('node:assert/strict');
const { createEnv } = require('./helpers/gas-env');

function setup() {
  const env = createEnv();
  const g = env.ctx;
  g.PropertiesService.getScriptProperties().setProperty('WEBHOOK_KEY', 'webhook-key-for-tests-0123456789');
  env.web.repo.files = {
    'apps-script/src/Updater.js': 'function updaterWebhook(e){}',
    'apps-script/src/00_config.js': 'var CFG = {};',
    'apps-script/src/appsscript.json': '{"timeZone":"Etc/UTC"}',
    'README.md': 'not deployed',
    'tests/unit.test.js': 'not deployed'
  };
  env.web.project.deployments = [
    { deploymentId: 'DEP_EXEC', entryPoints: [{ entryPointType: 'WEB_APP' }], deploymentConfig: { versionNumber: 1 } }
  ];
  return env;
}

const hook = (key, body) => ({
  parameter: { hook: 'github', key },
  postData: { contents: JSON.stringify(body) }
});
const parse = (out) => JSON.parse(out.getContent());

test('updateNow loads only the app files, makes a version and moves the web app', () => {
  const env = setup();
  env.ctx.updateNow();
  const names = env.web.project.content.map((f) => f.name).sort();
  assert.deepEqual(names, ['00_config', 'Updater', 'appsscript']);
  assert.equal(env.web.project.content.find((f) => f.name === 'appsscript').type, 'JSON');
  assert.equal(env.web.project.versions, 1);
  assert.equal(env.web.project.deployments[0].deploymentConfig.versionNumber, 1);
});

test('a second run with no code changes does nothing', () => {
  const env = setup();
  env.ctx.updateNow();
  env.web.project.versions = 1;
  const message = env.ctx.Updater.run(env.ctx.Updater.config());
  assert.match(message, /No code changes/);
  assert.equal(env.web.project.versions, 1);
});

test('the webhook refuses a missing or wrong key', () => {
  const env = setup();
  const none = parse(env.ctx.updaterWebhook(hook('', { ref: 'refs/heads/main' })));
  assert.equal(none.ok, false);
  assert.equal(none.error.code, 'FORBIDDEN');
  const wrong = parse(env.ctx.updaterWebhook(hook('nope', { ref: 'refs/heads/main' })));
  assert.equal(wrong.ok, false);
  assert.equal(env.web.project.versions, 0);
});

test('the webhook publishes on a push to the branch and ignores other branches', () => {
  const env = setup();
  const ping = parse(env.ctx.updaterWebhook(hook('webhook-key-for-tests-0123456789', { zen: 'Keep it logical' })));
  assert.equal(ping.ok, true);
  assert.match(ping.data.message, /connected/);
  const other = parse(env.ctx.updaterWebhook(hook('webhook-key-for-tests-0123456789', { ref: 'refs/heads/dev' })));
  assert.match(other.data.message, /another branch/);
  assert.equal(env.web.project.versions, 0);
  const push = parse(env.ctx.updaterWebhook(hook('webhook-key-for-tests-0123456789', { ref: 'refs/heads/main' })));
  assert.match(push.data.message, /Updated to GitHub/);
  assert.equal(env.web.project.versions, 1);
});

test('if a web app link cannot be moved, the update is retried on the next run', () => {
  const env = setup();
  env.web.failMove = true;
  assert.throws(() => env.ctx.updateNow(), /web app link\(s\) did not move/);
  env.web.failMove = false;
  env.ctx.updateNow();
  assert.equal(env.web.project.deployments[0].deploymentConfig.versionNumber, 2);
});

test('the update refuses a repo without the updater file', () => {
  const env = setup();
  delete env.web.repo.files['apps-script/src/Updater.js'];
  assert.throws(() => env.ctx.updateNow(), /Updater.js is missing/);
  assert.equal(env.web.project.content, null);
});

test('the 5-minute timer loads a new commit without any webhook call', () => {
  const env = setup();
  env.ctx.updateNow();
  assert.equal(env.web.project.versions, 1);
  // nothing new on GitHub: the timer only reads the commit id
  env.ctx.autoUpdate();
  assert.equal(env.web.project.versions, 1);
  // a new commit with changed app code: the timer publishes it
  env.web.repo.sha = 'b'.repeat(40);
  env.web.repo.files['apps-script/src/00_config.js'] = 'var CFG = { changed: true };';
  env.ctx.autoUpdate();
  assert.equal(env.web.project.versions, 2);
  assert.equal(env.web.project.deployments[0].deploymentConfig.versionNumber, 2);
  // the same commit again: nothing happens
  env.ctx.autoUpdate();
  assert.equal(env.web.project.versions, 2);
});

test('a new commit that only changes files outside the app does not make a version', () => {
  const env = setup();
  env.ctx.updateNow();
  env.web.repo.sha = 'c'.repeat(40);
  env.web.repo.files['README.md'] = 'changed readme';
  env.ctx.autoUpdate();
  assert.equal(env.web.project.versions, 1);
});

test('installAutoUpdate creates one 5-minute timer and removeAutoUpdate removes it', () => {
  const env = setup();
  env.ctx.installAutoUpdate();
  env.ctx.installAutoUpdate();
  assert.equal(env.web.triggers.filter((t) => t.handler === 'autoUpdate').length, 1);
  env.ctx.removeAutoUpdate();
  assert.equal(env.web.triggers.filter((t) => t.handler === 'autoUpdate').length, 0);
});
