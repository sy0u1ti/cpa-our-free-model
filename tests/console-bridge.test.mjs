import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const source = fs.readFileSync(new URL('../web/console-bridge.js', import.meta.url), 'utf8');

function consoleFrame({ engineCount = 0 } = {}) {
  const handlers = [], sent = [];
  const parent = { postMessage: message => sent.push(message) };
  const location = new URL('https://cpa.example/proxy/v0/resource/plugins/our-free-model/app?layout=embedded');
  const window = { origin: 'null', top: parent, fetch() { throw new Error('Unexpected direct fetch'); },
    addEventListener(type, handler) { if (type === 'message') handlers.push(handler); } };
  window.self = window;
  const engines = Array.from({ length: engineCount }, () => {
    const replies = [];
    return { replies, contentWindow: { postMessage: message => replies.push(message) } };
  });
  const context = { window, parent, location, URL, URLSearchParams, Request, Response, DOMException, crypto,
    setTimeout, clearTimeout, MutationObserver: class { observe() {} },
    document: { documentElement: { dataset: {} }, querySelectorAll() { return engines; } } };
  vm.createContext(context);
  vm.runInContext(source, context);
  return {
    request: () => window.fetch(location.origin + '/api/management/plugins'),
    sent, engines,
    message(sender, data) { for (const handler of handlers) handler({ source: sender, origin: 'null', data }); },
    host(data) { for (const handler of handlers) handler({ source: parent, origin: 'null', data }); },
    reply(body, sender = parent) {
      const request = sent.find(message => message.kind === 'ofm-request');
      for (const handler of handlers) handler({ source: sender, origin: 'null',
        data: { kind: 'ofm-response', id: request.id, status: 200, text: JSON.stringify(body) } });
    },
  };
}

test('plugin page capabilities keep the CPA proxy prefix through the opaque console bridge', async () => {
  const frame = consoleFrame();
  const response = frame.request();
  const page = { id: 'plugin:fixture:main', url: '/api/management/plugins/assets/' + 'a'.repeat(32) + '/page/index.html' };
  frame.reply({ pages: [page], plugins: { pages: [page] } });
  const body = await (await response).json();
  for (const entry of [body.pages[0], body.plugins.pages[0]]) {
    const url = new URL(entry.url);
    assert.equal(url.pathname, '/proxy/v0/resource/plugins/our-free-model/plugin-asset');
    assert.equal(url.searchParams.get('token'), 'a'.repeat(32));
    assert.equal(url.searchParams.get('path'), 'page/index.html');
    assert.equal(url.origin, 'https://cpa.example');
  }
});

test('standalone and legacy workspace replies return only to the engine that made the request', () => {
  const frame = consoleFrame({ engineCount: 2 });
  const id = 'c'.repeat(32);
  const request = { kind: 'ofm-engine-request', id, method: 'GET', path: '/api/state' };
  frame.message({}, request);
  assert.equal(frame.sent.length, 0, 'an unrelated frame cannot issue engine requests');
  frame.message(frame.engines[1].contentWindow, request);
  assert.equal(frame.sent.length, 1);
  const reply = { kind: 'ofm-engine-response', id, status: 200, text: '{"providers":[]}', headers: {} };
  frame.message({}, reply);
  assert.equal(frame.engines[1].replies.length, 0, 'only the CPA parent can answer');
  frame.host(reply);
  assert.equal(frame.engines[0].replies.length, 0);
  assert.deepEqual(frame.engines[1].replies, [reply]);
  frame.host(reply);
  assert.equal(frame.engines[1].replies.length, 1, 'a completed request cannot receive another reply');
});

test('engine cancellation cannot cancel a sibling request or forward a late response', () => {
  const frame = consoleFrame({ engineCount: 2 });
  const id = 'd'.repeat(32);
  frame.message(frame.engines[0].contentWindow, { kind: 'ofm-engine-request', id, method: 'GET', path: '/api/state' });
  frame.message(frame.engines[1].contentWindow, { kind: 'ofm-engine-cancel', id });
  assert.equal(frame.sent.length, 1);
  frame.message(frame.engines[0].contentWindow, { kind: 'ofm-engine-cancel', id });
  assert.equal(frame.sent.at(-1).kind, 'ofm-engine-cancel');
  frame.host({ kind: 'ofm-engine-response', id, status: 200, text: '{}' });
  assert.equal(frame.engines[0].replies.length, 0);
});

test('plugin page URLs cannot replace the parent or escape the capability resource', async () => {
  const frame = consoleFrame();
  const response = frame.request();
  frame.reply({ pages: [{ url: 'https://untrusted.invalid/page.html' }] }, {});
  frame.reply({ pages: [
    { url: 'https://untrusted.invalid/page.html' },
    { url: 'javascript:alert(1)' },
    { url: '/api/management/plugins/assets/' + 'b'.repeat(32) + '/../secret.html' },
  ] });
  const body = await (await response).json();
  assert.deepEqual(body.pages.map(page => page.url), ['about:blank', 'about:blank', 'about:blank']);
});
