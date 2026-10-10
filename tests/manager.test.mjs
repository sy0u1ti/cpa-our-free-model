import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { setImmediate } from 'node:timers/promises';

const script = fs.readFileSync(new URL('../web/manager.js', import.meta.url), 'utf8');
function page() {
  const elements = new Map();
  const events = new Map();
  const requests = [], replies = [];
  const location = new URL('https://cpa.example:8443/proxy/v0/resource/plugins/our-free-model/console');
  const element = selector => {
    if (!elements.has(selector)) elements.set(selector, { hidden: false, value: '', textContent: '', addEventListener() {}, querySelectorAll: () => [], contentWindow: { postMessage: (...value) => replies.push(value) } });
    return elements.get(selector);
  };
  element('#workspace').hidden = true;
  element('#key').value = 'management-fixture-only';
  const context = {
    document: { querySelector: element }, location, console, AbortSignal, AbortController,
    navigator: { clipboard: { writeText: async () => {} } },
    window: { addEventListener: (event, handler) => events.set(event, handler) },
    async fetch(url, options) {
      requests.push({ url, options });
      const body = url.endsWith('/console') ? { url: '/v0/resource/plugins/our-free-model/app' }
        : url.endsWith('/status') ? { modelPrefix: 'ofm/', pluginVersion: '0.3.0', models: 2, running: true }
        : { ok: true };
      return new Response(JSON.stringify(body), { headers: { 'content-type': 'application/json' } });
    },
  };
  vm.runInNewContext(script, context);
  return { element, events, requests, replies, location };
}

test('Chinese manager opens original UI under the exact current CPA origin and proxy prefix', async () => {
  const p = page();
  await p.element('#open').onclick();
  assert.equal(p.element('#console-frame').src, '/proxy/v0/resource/plugins/our-free-model/app');
  assert.equal(p.element('#workspace').hidden, false);
  assert.match(p.element('#connection-note').textContent, /https:\/\/cpa.example:8443\/proxy\/v1/);
  for (const request of p.requests) {
    assert.ok(request.url.startsWith('/proxy/v0/management/'));
    assert.equal(request.options.headers.Authorization, 'Bearer management-fixture-only');
    assert.ok(!request.url.includes('127.0.0.1'));
  }
});

test('manager accepts requests only from its own same-origin console frame and never sends it the key', async () => {
  const p = page(); await p.element('#open').onclick();
  const handler = p.events.get('message');
  const source = p.element('#console-frame').contentWindow;
  const data = { kind: 'ofm-request', id: 'a'.repeat(32), path: '/api/management/summary', method: 'GET' };
  const before = p.requests.length;
  handler({ origin: 'https://evil.invalid', source, data });
  handler({ origin: p.location.origin, source: {}, data });
  await setImmediate(); assert.equal(p.requests.length, before);
  handler({ origin: p.location.origin, source, data });
  await setImmediate(); await setImmediate();
  assert.equal(p.requests.length, before + 1);
  assert.equal(p.replies.length, 1);
  assert.ok(!JSON.stringify(p.replies).includes('management-fixture-only'));
  assert.equal(p.replies[0][1], p.location.origin);
  p.element('#logout').onclick();
  assert.equal(p.element('#key').value, '');
  assert.equal(p.element('#workspace').hidden, true);
});
