// One-off verification harness: serves this repository's real registry.json over
// loopback so a stock CPA binary resolves the store entry through its normal
// github-release path, downloads the real published release asset, checks the
// checksum, hot-loads it and serves a chat completion. Not part of npm test.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';
import { fixtureUpstream, freePort, until, privateTestDirectory, removeTestDirectory } from '../tests/helpers.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const version = JSON.parse(fs.readFileSync(path.join(root, 'package.json'))).version;
const platform = process.platform === 'win32' ? 'windows' : process.platform;
const arch = process.arch === 'x64' ? 'amd64' : process.arch;
const extension = { windows: 'dll', darwin: 'dylib' }[platform] ?? 'so';
const binary = process.env.CPA_BIN || path.join(root, '.tools/cpa/cli-proxy-api.exe');
const previous = path.join(root, `dist/${platform}/${arch}/our-free-model-v0.3.0.${extension}`);
assert.ok(fs.existsSync(binary), 'Set CPA_BIN to a real plugin-enabled CLIProxyAPI executable.');
assert.ok(fs.existsSync(previous), 'Provide the previous-version binary at dist/<platform>/<arch>.');

const registryBytes = fs.readFileSync(path.join(root, 'registry.json'));
const directory = privateTestDirectory(root, 'store-install');
const plugins = path.join(directory, 'plugins');
const data = path.join(directory, 'data');
fs.mkdirSync(plugins); fs.mkdirSync(data);
fs.copyFileSync(previous, path.join(plugins, path.basename(previous)));

const server = createServer((req, res) => {
  if (req.url === '/registry.json') {
    res.setHeader('content-type', 'application/json');
    return res.end(registryBytes);
  }
  res.writeHead(404); res.end('{}');
});
server.listen(0, '127.0.0.1'); await once(server, 'listening');
const registryBase = 'http://127.0.0.1:' + server.address().port;

const upstream = await fixtureUpstream();
const port = await freePort();
const base = 'http://127.0.0.1:' + port;
const managementKey = 'store-verify-fixture-only';
const apiKey = 'store-verify-api-fixture';
const config = path.join(directory, 'config.yaml');
fs.writeFileSync(config, `host: 127.0.0.1\nport: ${port}\nauth-dir: ${JSON.stringify(path.join(directory, 'auths'))}\napi-keys: [${apiKey}]\nremote-management:\n  secret-key: ${managementKey}\n  disable-control-panel: true\nplugins:\n  enabled: true\n  dir: ${JSON.stringify(plugins)}\n  store-sources: [${JSON.stringify(registryBase + '/registry.json')}]\n  store-auth:\n    - match: ${JSON.stringify(registryBase + '/')}\n      type: none\n      allow-insecure: true\n  configs:\n    our-free-model:\n      enabled: true\n      data-dir: ${JSON.stringify(data)}\n      node-path: ${JSON.stringify(process.execPath)}\n      auto-install-node: false\n      auto-install-eac: false\n      port: 0\n      console-port: 0\n      catalog-revision: 1\n`);

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
  ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(120000),
});
const api = (route, body) => fetch(base + route, {
  method: body === undefined ? 'GET' : 'POST',
  headers: { authorization: 'Bearer ' + apiKey, 'content-type': 'application/json' },
  ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(120000),
});
const pass = name => console.log('PASS ' + name);
fs.writeFileSync(path.join(data, 'review-preserve.txt'), 'fixture account data must remain intact');
let failed = false;
try {
  await until(async () => (await management('/v0/management/ofm/status')).ok, 90000);
  const before = await (await management('/v0/management/ofm/status')).json();
  assert.notEqual(before.pluginVersion, version, 'the previous plugin must be a different version');
  pass('previous plugin ' + before.pluginVersion + ' is running');

  const store = await management('/v8/management/plugins/store');
  assert.equal(store.status, 200, await store.clone().text());
  const listing = await store.json();
  const entry = (listing.plugins ?? []).find(row => row.id === 'our-free-model');
  assert.ok(entry, 'the store must list our-free-model');
  assert.equal(entry.install_type, 'github-release');
  assert.equal(entry.version, version);
  assert.equal(entry.logo, 'https://raw.githubusercontent.com/sy0u1ti/cpa-our-free-model/main/assets/logo.png');
  assert.equal(entry.source_url, registryBase + '/registry.json');
  pass('store resolves the entry at version ' + entry.version + ' with its logo and source');

  const install = await management('/v8/management/plugins/store/our-free-model/install', 'POST', {});
  const installBody = await install.text();
  assert.equal(install.status, 200, installBody);
  pass('install endpoint returned 200: ' + installBody.replace(/\s+/g, ' ').trim().slice(0, 160));

  await until(async () => {
    const status = await management('/v0/management/ofm/status');
    if (!status.ok) return false;
    const value = await status.json();
    return value.pluginVersion === version && value.running === true;
  }, 120000);
  pass('hot-loaded v' + version + ' and its service reported running without restarting CPA');

  const model = 'ofm/' + upstream.state.model;
  // The hot-loaded plugin republishes its catalog asynchronously.
  await until(async () => {
    const listing = await api('/v1/models');
    if (!listing.ok) return false;
    return ((await listing.json()).data ?? []).some(row => row.id === model);
  }, 90000);
  pass('CPA re-registered ' + model + ' after the hot-load');

  // The executor accepts traffic only once the restarted OFM service is reachable.
  let chatBody = '';
  await until(async () => {
    const chat = await api('/v1/chat/completions', { model, messages: [{ role: 'user', content: 'hi' }], max_tokens: 1024 });
    chatBody = await chat.text();
    return chat.status === 200;
  }, 90000);
  assert.equal(JSON.parse(chatBody).choices[0].message.content, 'cpa-ofm-ok');
  pass('ofm/' + upstream.state.model + ' served a chat completion after the install');

  const settings = fs.readFileSync(config, 'utf8');
  assert.ok(settings.includes('our-free-model'), 'the plugin config must survive the install');
  assert.equal(fs.readFileSync(path.join(data, 'review-preserve.txt'), 'utf8'), 'fixture account data must remain intact');
  pass('plugin configuration and data directory were preserved');
} catch (error) {
  failed = true;
  fs.writeFileSync(path.join(directory, 'cpa.log'), logs);
  console.error('Fixture retained with logs: ' + directory);
  throw error;
} finally {
  server.close();
  if (child.exitCode === null) child.kill();
  await exited;
  await until(() => !fs.existsSync(path.join(data, 'service.lock')), 15000).catch(() => {});
  if (!failed) removeTestDirectory(directory, root);
}
