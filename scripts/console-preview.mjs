// Isolated real-CPA browser fixture. No personal configuration or accounts.
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';
import { fixtureUpstream, privateTestDirectory, removeTestDirectory, freePort, until } from '../tests/helpers.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const directory = privateTestDirectory(root, 'console-preview');
const version = JSON.parse(fs.readFileSync(path.join(root, 'package.json'))).version;
const windows = process.platform === 'win32';
const library = path.join(root, 'dist', windows ? 'windows' : 'linux', 'amd64', `our-free-model-v${version}.${windows ? 'dll' : 'so'}`);
fs.mkdirSync(path.join(directory, 'plugins'));
fs.copyFileSync(library, path.join(directory, 'plugins', path.basename(library)));
const fixture = await fixtureUpstream();
const port = await freePort();
const key = 'preview-management-not-production';
const config = path.join(directory, 'config.yaml');
fs.writeFileSync(config, `host: 127.0.0.1\nport: ${port}\nauth-dir: ${JSON.stringify(path.join(directory, 'auths'))}\napi-keys: [preview-api]\nremote-management:\n  secret-key: ${key}\n  disable-control-panel: true\nplugins:\n  enabled: true\n  dir: ${JSON.stringify(path.join(directory, 'plugins'))}\n  configs:\n    our-free-model:\n      enabled: true\n      data-dir: ${JSON.stringify(path.join(directory, 'data'))}\n      node-path: ${JSON.stringify(process.execPath)}\n      auto-install-node: false\n      auto-install-eac: false\n`);
const binary = process.env.CPA_BIN || path.join(root, '.tools/cpa/cli-proxy-api.exe');
const child = spawn(binary, ['--config', config, '--local-model'], { cwd: directory, windowsHide: true,
  env: { ...process.env, OUR_FREE_MODEL_BASE: fixture.url, OUR_FREE_MODEL_KILO_BASE: fixture.url }, stdio: ['ignore', 'pipe', 'pipe'] });
let logs = ''; child.stdout.on('data', data => { logs += data; }); child.stderr.on('data', data => { logs += data; });
const exit = once(child, 'exit');
const proxy = http.createServer((request, response) => {
  if (!request.url.startsWith('/gateway/')) { response.writeHead(404); response.end(); return; }
  const upstream = http.request({ host: '127.0.0.1', port, path: request.url.slice('/gateway'.length), method: request.method,
    headers: { ...request.headers, host: '127.0.0.1:' + port } }, reply => {
    response.writeHead(reply.statusCode, reply.headers); reply.pipe(response);
  });
  upstream.on('error', () => { if (!response.headersSent) response.writeHead(502); response.end(); });
  request.pipe(upstream); response.once('close', () => upstream.destroy());
});
proxy.listen(0, '127.0.0.1'); await once(proxy, 'listening');
let stopped = false;
async function stop() {
  if (stopped) return; stopped = true;
  proxy.closeAllConnections(); proxy.close(); child.kill(); await exit; await fixture.close();
  await until(() => !fs.existsSync(path.join(directory, 'data/service.lock')), 10000).catch(() => {});
  removeTestDirectory(directory, root); process.exit(0);
}
process.on('SIGINT', stop); process.on('SIGTERM', stop);
try {
  await until(async () => (await fetch(`http://127.0.0.1:${port}/v0/management/ofm/status`, { headers: { authorization: 'Bearer ' + key } })).ok, 60000);
  const url = `http://127.0.0.1:${proxy.address().port}/gateway/v0/resource/plugins/our-free-model/console`;
  fs.writeFileSync(path.join(root, '.test-output/console-preview.json'), JSON.stringify({ url, key }));
  console.log('真实 CPA 隔离测试入口：' + url + '\n测试管理密钥：' + key + '\n仅本机模拟上游。Ctrl+C 结束。');
} catch (error) { console.error(logs); console.error(error); await stop(); }
