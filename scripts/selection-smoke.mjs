// Proves the model sync scope end to end against a real CPA binary: a model
// removed from the scope must disappear from the CPA catalog and be rejected by
// the executor, and the scope must survive a plugin reload. Not part of npm test.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';
import { fixtureUpstream, freePort, until, privateTestDirectory, removeTestDirectory } from '../tests/helpers.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const binary = process.env.CPA_BIN || path.join(root, '.tools/cpa/cli-proxy-api.exe');
const platform = process.platform === 'win32' ? 'windows' : process.platform;
const arch = process.arch === 'x64' ? 'amd64' : process.arch;
const extension = { windows: 'dll', darwin: 'dylib' }[platform] ?? 'so';
const version = JSON.parse(fs.readFileSync(path.join(root, 'package.json'))).version;
const plugin = process.env.CPA_PLUGIN || path.join(root, `dist/${platform}/${arch}/our-free-model-v${version}.${extension}`);
assert.ok(fs.existsSync(binary), 'Set CPA_BIN to a real plugin-enabled CLIProxyAPI executable.');
assert.ok(fs.existsSync(plugin), 'Build the plugin first.');

const directory = privateTestDirectory(root, 'selection-smoke');
const plugins = path.join(directory, 'plugins');
const data = path.join(directory, 'ofm-data');
fs.mkdirSync(plugins); fs.mkdirSync(data);
fs.copyFileSync(plugin, path.join(plugins, path.basename(plugin)));
const upstream = await fixtureUpstream();
const port = await freePort();
const base = 'http://127.0.0.1:' + port;
const managementKey = 'selection-fixture-management';
const apiKey = 'selection-fixture-api';
const config = path.join(directory, 'config.yaml');
fs.writeFileSync(config, `host: 127.0.0.1\nport: ${port}\nauth-dir: ${JSON.stringify(path.join(directory, 'auths'))}\napi-keys: [${apiKey}]\nremote-management:\n  secret-key: ${managementKey}\n  disable-control-panel: true\nplugins:\n  enabled: true\n  dir: ${JSON.stringify(plugins)}\n  configs:\n    our-free-model:\n      enabled: true\n      data-dir: ${JSON.stringify(data)}\n      node-path: ${JSON.stringify(process.execPath)}\n      auto-install-node: false\n      auto-install-eac: false\n      port: 0\n      console-port: 0\n      catalog-revision: 1\n`);
const child = spawn(binary, ['--config', config, '--local-model'], {
  cwd: directory, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'],
  env: { ...process.env, OUR_FREE_MODEL_BASE: upstream.url, OUR_FREE_MODEL_KILO_BASE: upstream.url },
});
let logs = '';
child.stdout.on('data', chunk => { logs += chunk; });
child.stderr.on('data', chunk => { logs += chunk; });
const exited = once(child, 'exit');
const management = (route, method = 'GET', body) => fetch(base + route, {
  method, headers: { authorization: 'Bearer ' + managementKey, 'content-type': 'application/json' },
  ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(90000),
});
const api = (route, body) => fetch(base + route, {
  method: body === undefined ? 'GET' : 'POST',
  headers: { authorization: 'Bearer ' + apiKey, 'content-type': 'application/json' },
  ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(90000),
});
const catalog = async () => ((await (await api('/v1/models')).json()).data ?? []).map(row => row.id);
const pass = name => console.log('PASS ' + name);
let failed = false;
try {
  const model = 'ofm/' + upstream.state.model;
  await until(async () => (await catalog()).includes(model), 90000);
  pass('baseline: ' + model + ' is in the CPA catalog');

  const selection = await management('/v0/management/ofm/selection');
  assert.equal(selection.status, 200, await selection.clone().text());
  const listed = await selection.json();
  assert.ok(Array.isArray(listed.models) && listed.models.some(row => row.id === upstream.state.model),
    'the selection view must list the upstream model without the CPA prefix');
  assert.equal(listed.syncedCount, listed.total, 'a fresh install syncs everything');
  pass('selection view lists ' + listed.total + ' upstream models, all synced');

  const write = await management('/v0/management/ofm/selection', 'POST', { hidden: [upstream.state.model] });
  assert.equal(write.status, 200, await write.clone().text());
  pass('saved a scope that excludes ' + upstream.state.model);

  // Before CPA reloads anything, its catalog still lists the model. The plugin
  // must already refuse it: that window is exactly why the executor re-checks.
  assert.ok((await catalog()).includes(model), 'this fixture needs CPA to still list the model before the reload');
  const staleChat = await api('/v1/chat/completions', { model, messages: [{ role: 'user', content: 'hi' }], max_tokens: 64 });
  const staleText = await staleChat.clone().text();
  // CPA refuses it as soon as the plugin declines to own the model (its generic
  // "no provider accepted this" answer), and the plugin's own executor check
  // answers 404 if CPA dispatches anyway. Either way it must never be served.
  assert.notEqual(staleChat.status, 200, 'a stale catalog entry served traffic: ' + staleText);
  assert.match(staleText, /our-free-model/, 'the refusal must name this provider: ' + staleText);
  pass('a call to the excluded model was refused with HTTP ' + staleChat.status + ' while the host catalog was still stale');

  // The management page bumps catalog-revision right after saving; CPA only
  // re-reads a plugin's model catalog when that value changes.
  const bump = await management('/v8/management/config/plugins/configs/our-free-model', 'PATCH', { 'catalog-revision': Date.now() });
  assert.equal(bump.status, 200, await bump.clone().text());

  // The plugin must report the reduced catalog even before CPA reloads it.
  await until(async () => {
    const rows = await (await management('/v0/management/ofm/models')).json();
    return Array.isArray(rows.Models) && rows.Models.every(row => row.ID !== 'ofm/' + upstream.state.model);
  }, 60000);
  pass('plugin model catalog already excludes the model');

  await until(async () => !(await catalog()).includes(model), 90000);
  pass('excluded model disappeared from the CPA catalog');

  const selectionAfter = await (await management('/v0/management/ofm/selection')).json();
  assert.deepEqual(selectionAfter.hidden, [upstream.state.model]);
  assert.equal(selectionAfter.syncedCount, selectionAfter.total - 1);
  pass('selection view reports the exclusion');

  // Once the catalog reloads, CPA itself rejects the unknown model.
  const chat = await api('/v1/chat/completions', { model, messages: [{ role: 'user', content: 'hi' }], max_tokens: 64 });
  assert.notEqual(chat.status, 200, 'an excluded model must not serve traffic');
  pass('after the reload the excluded model was still refused with HTTP ' + chat.status);

  // Changing only the CPA prefix must not disturb the saved scope.
  await management('/v8/management/config/plugins/configs/our-free-model', 'PATCH', { 'model-prefix': 'scoped/' });
  await until(async () => {
    const ids = await catalog();
    return ids.length === 0 || ids.some(id => id.startsWith('scoped/'));
  }, 90000);
  const ids = await catalog();
  assert.ok(!ids.includes('scoped/' + upstream.state.model), 'the exclusion must survive a prefix change');
  assert.ok(ids.includes('scoped/' + upstream.state.model) === false);
  pass('prefix change kept the exclusion intact (' + ids.join(', ') + ')');

  // Reloading the plugin re-reads the scope file from disk.
  await management('/v8/management/config/plugins/configs/our-free-model', 'PATCH', { 'catalog-revision': Date.now() });
  await until(async () => (await catalog()).length > 0, 90000);
  assert.ok(!(await catalog()).includes('scoped/' + upstream.state.model), 'the scope must survive a reload');
  pass('scope survived a plugin catalog reload');

  // Restoring the model must put it back into the catalog.
  const restore = await management('/v0/management/ofm/selection', 'POST', { hidden: [] });
  assert.equal(restore.status, 200, await restore.clone().text());
  const bumpAgain = await management('/v8/management/config/plugins/configs/our-free-model', 'PATCH', { 'catalog-revision': Date.now() });
  assert.equal(bumpAgain.status, 200, await bumpAgain.clone().text());
  await until(async () => (await catalog()).includes('scoped/' + upstream.state.model), 90000);
  pass('clearing the scope restored the model');
} catch (error) {
  failed = true;
  fs.writeFileSync(path.join(directory, 'cpa.log'), logs);
  console.error('Fixture retained with logs: ' + directory);
  throw error;
} finally {
  if (child.exitCode === null) child.kill();
  await exited;
  await upstream.close();
  await until(() => !fs.existsSync(path.join(data, 'service.lock')), 15000).catch(() => {});
  if (!failed) removeTestDirectory(directory, root);
}
