import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { fixtureUpstream, privateTestDirectory, removeTestDirectory, startRunner, until } from './helpers.mjs';
import { request as httpRequest } from 'node:http';

const root = fileURLToPath(new URL('../', import.meta.url));

test('real bundled OFM service: discovery, auth fences, key rotation, console, shutdown', { timeout: 60000 }, async t => {
  const directory = privateTestDirectory(root, 'runtime');
  const upstream = await fixtureUpstream();
  const runner = startRunner(root, { dataDir: directory, port: 0, consolePort: 0, autoInstallEac: false },
    { OUR_FREE_MODEL_BASE: upstream.url, OUR_FREE_MODEL_KILO_BASE: upstream.url });
  t.after(async () => { await runner.close(); await upstream.close(); removeTestDirectory(directory, root); });
  await runner.ready;
  const rows = await runner.call('models');
  assert.ok(rows.some(row => row.id === upstream.state.model));
  assert.ok(rows.some(row => row.id.includes('fixture/free')));
  const connection = await runner.call('connection');
  assert.equal(new URL(connection.url).hostname, '127.0.0.1');
  assert.equal((await fetch(connection.url + '/v1/models')).status, 401);
  const models = await fetch(connection.url + '/v1/models', { headers: { authorization: 'Bearer ' + connection.key } });
  assert.equal(models.status, 200);
  const prepared = await runner.call('prepare', { model: upstream.state.model, body: { messages: [{ role: 'user', content: 'hi' }], reasoning_effort: 'high' } });
  assert.equal(prepared.admitted, true);
  assert.equal(prepared.body.reasoning_effort, 'deep');
  assert.equal((await runner.call('prepare', { model: 'unknown', body: {} })).admitted, false);
  const complete = await fetch(connection.url + '/v1/chat/completions', { method: 'POST',
    headers: { 'content-type': 'application/json', authorization: 'Bearer ' + connection.key }, body: JSON.stringify(prepared.body) });
  assert.equal(complete.status, 200);
  assert.equal((await complete.json()).choices[0].message.content, 'cpa-ofm-ok');
  const ticket = await runner.call('console');
  assert.ok(!ticket.includes(connection.key));
  // Browser navigation from a localhost CPA tab to a 127.0.0.1 ticket is
  // cross-site but authorized by its unguessable one-use token.
  const opened = await fetch(ticket, { redirect: 'manual', headers: { 'sec-fetch-site': 'cross-site' } });
  assert.equal(opened.status, 303);
  const cookie = opened.headers.get('set-cookie');
  assert.match(cookie, /HttpOnly/i);
  assert.equal((await fetch(ticket, { redirect: 'manual' })).status, 401);
  const guardedTicket = await runner.call('console');
  assert.equal((await fetch(guardedTicket, { headers: { origin: 'https://untrusted.invalid' }, redirect: 'manual' })).status, 403);
  const rebound = await new Promise((resolve, reject) => {
    const req = httpRequest(guardedTicket, { headers: { host: 'untrusted.invalid' } }, res => { res.resume(); res.once('end', () => resolve(res.statusCode)); });
    req.once('error', reject); req.end();
  });
  assert.equal(rebound, 403);
  assert.equal((await fetch(guardedTicket, { redirect: 'manual' })).status, 303);
  const headers = { cookie: cookie.split(';')[0], origin: connection.url, 'content-type': 'application/json' };
  const summary = await fetch(connection.url + '/api/management/summary', { headers });
  assert.equal(summary.status, 200);
  const changed = await fetch(connection.url + '/api/management/key/rotate', { method: 'POST', headers, body: '{"confirm":true}' });
  // The route is verified against the pinned service; a mismatch is an integration regression.
  assert.equal(changed.status, 200, await changed.text());
  const rotated = await runner.call('connection');
  assert.notEqual(rotated.key, connection.key);
  const status = await runner.call('status');
  assert.equal(status.pid, runner.child.pid);
  assert.ok(fs.existsSync(path.join(directory, 'service.lock')));
  // Upstream persists the free lane's session map under $DSH_HOME; the runner
  // pins that variable to the plugin data directory so no state can escape it.
  const sessionMap = path.join(directory, 'our-free-model', 'session-map.json');
  assert.ok(fs.existsSync(sessionMap), 'free-lane session map must live inside the plugin data directory');
  assert.ok(JSON.parse(fs.readFileSync(sessionMap, 'utf8')).sessions['catalog:our-free-model']);
  assert.equal((await runner.call('eac-warmup')).state, 'disabled');
  await runner.close();
  await until(() => !fs.existsSync(path.join(directory, 'service.lock')));
});

test('first runner status waits for configured EAC source before opening the console, without OAuth', { timeout: 60000 }, async t => {
  const directory = privateTestDirectory(root, 'eac-first-open');
  const source = path.join(directory, 'source'), data = path.join(directory, 'data');
  fs.mkdirSync(path.join(source, 'src'), { recursive: true });
  fs.writeFileSync(path.join(source, 'package.json'), '{"type":"module"}');
  fs.writeFileSync(path.join(source, 'src/vault.js'),
    `export const openSeal=()=>({base:'https://eac-fixture.invalid/v1',mode:'worker',signingSecret:'fixture-only-not-a-secret-000000000000'});`);
  const runner = startRunner(root, { dataDir: data, eacSourceDir: source, autoInstallEac: true, refresh: false, port: 0 });
  t.after(async () => { await runner.close(); removeTestDirectory(directory, root); });
  const status = await runner.call('status');
  assert.equal(status.eacSource.state, 'ready');
  assert.equal((await runner.call('eac-warmup')).state, 'ready');
  assert.equal(fs.existsSync(path.join(data, 'eac-user.json')), false);
  assert.equal(fs.existsSync(path.join(root, 'eac-user.json')), false);
});
