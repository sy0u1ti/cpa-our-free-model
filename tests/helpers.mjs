import fs from 'node:fs';
import path from 'node:path';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';

export const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
export async function until(work, timeout = 30000) {
  const end = Date.now() + timeout;
  let last;
  while (Date.now() < end) {
    try { const value = await work(); if (value) return value; } catch (error) { last = error; }
    await delay(100);
  }
  throw new Error('Timed out waiting for fixture' + (last ? ': ' + last.message : ''));
}

export async function freePort() {
  const server = createServer();
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const port = server.address().port;
  await new Promise(resolve => server.close(resolve));
  return port;
}

export async function fixtureUpstream() {
  const calls = [];
  const state = { model: 'mimo-v2.6-flash-free', status: 200, long: false, cancelled: 0 };
  const server = createServer(async (req, res) => {
    let raw = '';
    for await (const chunk of req) raw += chunk;
    const url = new URL(req.url, 'http://localhost');
    const body = raw ? JSON.parse(raw) : {};
    calls.push({ path: url.pathname, headers: req.headers, body });
    const json = value => { res.setHeader('content-type', 'application/json'); res.end(JSON.stringify(value)); };
    if (url.pathname === '/inference/v1/models') return json({ data: [{ id: state.model }] });
    if (url.pathname === '/models') return json({ data: [{ id: 'fixture/free', isFree: true, context_length: 128000 }] });
    if (!url.pathname.endsWith('/chat/completions')) return json({ data: [] });
    if (state.status !== 200) {
      res.writeHead(state.status, { 'content-type': 'application/json', 'retry-after': '2' });
      return res.end(JSON.stringify({ error: { message: 'Fixture failure', type: 'fixture_error' } }));
    }
    // Deliberately incorrect content type tests the unchanged OFM body sniffer.
    res.writeHead(200, { 'content-type': 'application/json' });
    const frame = value => 'data: ' + JSON.stringify({ id: 'chatcmpl-fixture', object: 'chat.completion.chunk', created: 1, model: body.model, ...value }) + '\n\n';
    res.write(frame({ choices: [{ index: 0, delta: { role: 'assistant', reasoning_content: 'fixture-thinking' } }] }));
    res.write(frame({ choices: [{ index: 0, delta: { content: 'cpa-ofm-ok' } }] }));
    if (state.long) {
      const timer = setInterval(() => { res.write(': fixture heartbeat\n\n'); }, 100);
      res.on('close', () => { clearInterval(timer); state.cancelled++; });
      return;
    }
    const hasTool = body.tools?.some(tool => tool.function?.name === 'lookup');
    if (hasTool) res.write(frame({ choices: [{ index: 0, delta: { tool_calls: [
      { index: 0, id: 'call_fixture', type: 'function', function: { name: 'lookup', arguments: '{"value":42}' } },
    ] } }] }));
    res.write(frame({ choices: [{ index: 0, delta: {}, finish_reason: hasTool ? 'tool_calls' : 'stop' }],
      usage: { prompt_tokens: 7, completion_tokens: 5, total_tokens: 12, completion_tokens_details: { reasoning_tokens: 2 } } }));
    res.end('data: [DONE]\n\n');
  });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  return { calls, state, url: 'http://127.0.0.1:' + server.address().port,
    close: () => new Promise(resolve => { server.closeAllConnections(); server.close(resolve); }) };
}

export function startRunner(root, settings, environment = {}) {
  const child = spawn(process.execPath, [path.join(root, 'service/runner.mjs')], {
    cwd: root, env: { ...process.env, ...environment }, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true,
  });
  child.stdin.on('error', () => {});
  const closed = once(child, 'exit');
  let stderr = '';
  child.stderr.on('data', data => { stderr += data; });
  const pending = new Map();
  let sequence = 0;
  let readyResolve;
  let readyReject;
  const ready = new Promise((resolve, reject) => { readyResolve = resolve; readyReject = reject; });
  child.once('exit', () => { readyReject(new Error('Runner exited: ' + stderr)); for (const item of pending.values()) item.reject(new Error('Runner exited')); });
  const lines = createInterface({ input: child.stdout });
  lines.on('line', line => {
    const reply = JSON.parse(line);
    if (reply.type === 'ready') readyResolve();
    if (reply.type === 'error') readyReject(new Error(reply.error));
    if (reply.id && pending.has(reply.id)) {
      const item = pending.get(reply.id); pending.delete(reply.id);
      if (reply.error) item.reject(new Error(reply.error)); else item.resolve(reply.value);
    }
  });
  child.stdin.write(JSON.stringify({ ...settings, parentPid: process.pid }) + '\n');
  return { child, ready,
    async call(type, payload = {}) {
      await ready;
      const id = ++sequence;
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => { pending.delete(id); reject(new Error('Control fixture timed out')); }, 45000);
        pending.set(id, { resolve(value) { clearTimeout(timer); resolve(value); }, reject(error) { clearTimeout(timer); reject(error); } });
        child.stdin.write(JSON.stringify({ type, id, ...payload }) + '\n');
      });
    },
    async close() {
      child.stdin.end();
      const timer = setTimeout(() => child.kill(), 8000);
      await closed; clearTimeout(timer);
    },
  };
}

export function privateTestDirectory(root, label) {
  const base = path.join(root, '.test-output');
  fs.mkdirSync(base, { recursive: true });
  return fs.mkdtempSync(path.join(base, label + '-'));
}

export function removeTestDirectory(directory, root) {
  const base = path.resolve(root, '.test-output') + path.sep;
  const target = path.resolve(directory);
  if (!target.startsWith(base) || target === base.slice(0, -1)) throw new Error('Refusing cleanup outside test workspace');
  fs.rmSync(target, { recursive: true, force: true, maxRetries: 8, retryDelay: 200 });
}
