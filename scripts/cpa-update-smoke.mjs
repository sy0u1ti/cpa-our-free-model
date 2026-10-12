import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';
import { fixtureUpstream, freePort, until, privateTestDirectory, removeTestDirectory } from '../tests/helpers.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const platform = process.platform === 'win32' ? 'windows' : process.platform;
const arch = process.arch === 'x64' ? 'amd64' : process.arch;
const extension = { windows: 'dll', darwin: 'dylib' }[platform] ?? 'so';
const version = JSON.parse(fs.readFileSync(path.join(root, 'package.json'))).version;
const binary = process.env.CPA_BIN || path.join(root, '.tools/cpa/cli-proxy-api.exe');
const previous = process.env.CPA_UPDATE_PREVIOUS || path.join(root, `dist/${platform}/${arch}/our-free-model-v0.3.0.${extension}`);
const archive = path.join(root, `dist/our-free-model_${version}_${platform}_${arch}.zip`);
assert.ok(fs.existsSync(binary) && fs.existsSync(previous) && fs.existsSync(archive), 'Provide CPA_BIN, CPA_UPDATE_PREVIOUS and package the current plugin first.');
const directory = privateTestDirectory(root, 'cpa-update');
const plugins = path.join(directory, 'plugins'), data = path.join(directory, 'data');
fs.mkdirSync(plugins); fs.mkdirSync(data);
const previousFile = path.join(plugins, path.basename(previous));
fs.copyFileSync(previous, previousFile);
fs.writeFileSync(path.join(data, 'review-preserve.txt'), 'fixture account data must remain intact');
const archiveBytes = fs.readFileSync(archive);
const digest = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
let badChecksum = true;
let registryBase;
const server = createServer((req, res) => {
  res.setHeader('content-type', 'application/json');
  if (req.url === '/existing.json') return res.end('{"schema_version":1,"plugins":[]}');
  if (req.url === '/registry.json') return res.end(JSON.stringify({
    schema_version: 2,
    plugins: [{
      id: 'our-free-model', name: 'Isolated OFM update fixture', description: 'Native installer integration test', author: 'test',
      version, repository: 'https://github.com/sy0u1ti/cpa-our-free-model',
      install: { type: 'direct', artifacts: [{ goos: platform, goarch: arch, url: registryBase + '/plugin.zip',
        sha256: badChecksum ? '0'.repeat(64) : digest(archiveBytes), size: archiveBytes.length }] },
    }],
  }));
  if (req.url === '/plugin.zip') { res.setHeader('content-type', 'application/zip'); return res.end(archiveBytes); }
  res.writeHead(404); res.end('{}');
});
server.listen(0, '127.0.0.1'); await once(server, 'listening');
registryBase = 'http://127.0.0.1:' + server.address().port;
const upstream = await fixtureUpstream(), port = await freePort(), base = 'http://127.0.0.1:' + port;
const managementKey = 'update-review-fixture-only';
const config = path.join(directory, 'config.yaml');
fs.writeFileSync(config, `host: 127.0.0.1\nport: ${port}\nauth-dir: ${JSON.stringify(path.join(directory, 'auths'))}\napi-keys: [update-api-fixture]\nremote-management:\n  secret-key: ${managementKey}\n  disable-control-panel: true\nplugins:\n  enabled: true\n  dir: ${JSON.stringify(plugins)}\n  store-sources: [${JSON.stringify(registryBase + '/existing.json')}]\n  store-auth:\n    - match: ${JSON.stringify(registryBase + '/')}\n      type: none\n      allow-insecure: true\n  configs:\n    our-free-model:\n      enabled: true\n      data-dir: ${JSON.stringify(data)}\n      node-path: ${JSON.stringify(process.execPath)}\n      auto-install-node: false\n      auto-install-eac: false\n      model-prefix: review/\n      review-keep: preserve-this-setting\n`);
const child = spawn(binary, ['--config', config, '--local-model'], {
  cwd: directory, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'],
  env: { ...process.env, OUR_FREE_MODEL_BASE: upstream.url, OUR_FREE_MODEL_KILO_BASE: upstream.url },
});
let logs = '';
child.stdout.on('data', chunk => { logs += chunk; });
child.stderr.on('data', chunk => { logs += chunk; });
const exited = once(child, 'exit');
const api = (route, method = 'GET', body) => fetch(base + route, {
  method, headers: { authorization: 'Bearer ' + managementKey, 'content-type': 'application/json' },
  ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(60000),
});
const checks = [];
const pass = name => { checks.push(name); console.log('PASS ' + name); };
let failed = false;
try {
  await until(async () => (await api('/v0/management/ofm/status')).ok, 60000);
  const before = await (await api('/v0/management/ofm/status')).json();
  assert.notEqual(before.pluginVersion, version, 'Previous plugin must have a different version');
  const sourceURL = registryBase + '/registry.json';
  const sourceID = 'source-' + digest(Buffer.from(sourceURL)).slice(0, 12);
  const sources = await (await api('/v8/management/config/plugins/store-sources')).json();
  assert.equal((await api('/v8/management/config/plugins/store-sources', 'PUT', [...sources, sourceURL])).status, 200);
  await until(async () => {
    const value = await (await api('/v8/management/config/plugins/store-sources')).json();
    return value.includes(sourceURL) && value.includes(registryBase + '/existing.json');
  });
  pass('Native v8 source setup preserves existing sources and accepts the older CPA config layout');
  const route = '/v8/management/plugins/store/our-free-model/install?source=' + sourceID;
  const rejected = await api(route, 'POST', { version });
  assert.equal(rejected.status, 502, await rejected.clone().text());
  const rejection = await rejected.json();
  assert.equal(rejection.error, 'plugin_install_failed');
  assert.match(rejection.message, /checksum mismatch/);
  assert.equal(digest(fs.readFileSync(previousFile)), digest(fs.readFileSync(previous)));
  assert.equal((await (await api('/v0/management/ofm/status')).json()).pluginVersion, before.pluginVersion);
  pass('Checksum failure leaves the existing native binary and running service unchanged');
  badChecksum = false;
  const installed = await api(route, 'POST', { version });
  assert.equal(installed.status, 200, await installed.clone().text());
  const result = await installed.json();
  assert.equal(result.status, 'installed');
  assert.equal(result.version, version);
  await until(async () => {
    const response = await api('/v0/management/ofm/status');
    if (!response.ok) return false;
    const status = await response.json();
    return status.pluginVersion === version && status.running === true;
  }, 60000);
  assert.equal(child.exitCode, null);
  pass('CPA installs the versioned package and hot-loads the new running version without restarting its process');
  const retained = await (await api('/v8/management/config/plugins/configs/our-free-model')).json();
  assert.equal(retained['model-prefix'], 'review/');
  assert.equal(retained['review-keep'], 'preserve-this-setting');
  assert.equal(retained['data-dir'], data);
  assert.equal(fs.readFileSync(path.join(data, 'review-preserve.txt'), 'utf8'), 'fixture account data must remain intact');
  const completion = await fetch(base + '/v1/chat/completions', {
    method: 'POST', headers: { authorization: 'Bearer update-api-fixture', 'content-type': 'application/json' },
    body: JSON.stringify({ model: 'review/' + upstream.state.model, messages: [{ role: 'user', content: 'hello' }] }),
  });
  assert.equal(completion.status, 200, await completion.clone().text());
  assert.equal((await completion.json()).choices[0].message.content, 'cpa-ofm-ok');
  pass('Plugin configuration, data and inference survive native hot update');
  fs.writeFileSync(path.join(root, `dist/CPA_UPDATE_SMOKE_${platform}_${arch}.json`),
    JSON.stringify({ platform, arch, from: before.pluginVersion, to: version, archiveSHA256: digest(archiveBytes), checks }, null, 2) + '\n');
} catch (error) {
  failed = true;
  fs.writeFileSync(path.join(directory, 'cpa.log'), logs);
  console.error('Fixture retained: ' + directory);
  throw error;
} finally {
  child.kill(); await exited; await upstream.close();
  server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
  await until(() => !fs.existsSync(path.join(data, 'service.lock')), 15000).catch(() => {});
  if (!failed) removeTestDirectory(directory, root);
}
