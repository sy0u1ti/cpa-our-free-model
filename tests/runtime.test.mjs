import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { fixtureUpstream, privateTestDirectory, removeTestDirectory, startRunner, until } from './helpers.mjs';

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
  await runner.close();
  await until(() => !fs.existsSync(path.join(directory, 'service.lock')));
});
