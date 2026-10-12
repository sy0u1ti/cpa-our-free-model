import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { setImmediate } from 'node:timers/promises';

const script = fs.readFileSync(new URL('../web/manager.js', import.meta.url), 'utf8');
const updaterScript = fs.readFileSync(new URL('../web/updater.js', import.meta.url), 'utf8');
function page({ embedded = false } = {}) {
  const elements = new Map();
  const events = new Map();
  const requests = [], replies = [];
  const location = new URL('https://cpa.example:8443/proxy/v0/resource/plugins/our-free-model/console');
  const element = selector => {
    if (!elements.has(selector)) elements.set(selector, { hidden: false, value: '', textContent: '', dataset: {}, attributes: {},
      setAttribute(name, value) { this.attributes[name] = value; },
      addEventListener() {}, querySelectorAll: () => [], contentWindow: { postMessage: (...value) => replies.push(value) } });
    return elements.get(selector);
  };
  element('#workspace').hidden = true;
  element('#connection-panel').hidden = true;
  element('#key').value = 'management-fixture-only';
  const context = {
    document: { querySelector: element, documentElement: { dataset: {} } }, location, console, AbortSignal, AbortController,
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
  context.window.self = context.window;
  context.window.top = embedded ? {} : context.window;
  vm.createContext(context);
  vm.runInContext(updaterScript, context);
  vm.runInContext(script, context);
  return { element, events, requests, replies, location, document: context.document };
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

test('CPA embedded mode selects a compact child layout without reading the host DOM or exposing keys', async () => {
  const p = page({ embedded: true });
  await p.element('#open').onclick();
  assert.equal(p.document.documentElement.dataset.cpaEmbedded, 'true');
  assert.equal(p.document.documentElement.dataset.consoleOpen, 'true');
  assert.equal(p.element('#console-frame').src, '/proxy/v0/resource/plugins/our-free-model/app?layout=embedded');
  assert.equal(p.element('#standalone-link').hidden, false);
  assert.equal(p.element('#standalone-link').href, '/proxy/v0/resource/plugins/our-free-model/console');
  assert.ok(!p.element('#standalone-link').href.includes('management-fixture'));
  assert.equal(p.element('#connection-panel').hidden, true);
  p.element('#connection-toggle').onclick();
  assert.equal(p.element('#connection-panel').hidden, false);
  assert.equal(p.element('#connection-toggle').attributes['aria-expanded'], 'true');
  p.element('#back').onclick();
  assert.equal(p.document.documentElement.dataset.consoleOpen, 'false');
  assert.equal(p.element('#connection-panel').hidden, true);
});

test('workspace theme synchronization accepts only the owned child and known theme names', async () => {
  const p = page(); await p.element('#open').onclick();
  const handler = p.events.get('message'), source = p.element('#console-frame').contentWindow;
  const send = (theme, origin = 'null', window = source) => handler({ origin, source: window, data: { kind: 'ofm-theme', theme } });
  send('dark', 'https://evil.invalid'); send('dark', p.location.origin, {});
  assert.equal(p.element('#workspace').dataset.theme, undefined);
  send('dark');
  assert.equal(p.element('#workspace').dataset.theme, 'dark');
  send('unexpected');
  assert.equal(p.element('#workspace').dataset.theme, 'dark');
  send('light');
  assert.equal(p.element('#workspace').dataset.theme, 'light');
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
  handler({ origin: 'null', source, data });
  await setImmediate(); await setImmediate();
  assert.equal(p.requests.length, before + 1);
  assert.equal(p.replies.length, 1);
  assert.ok(!JSON.stringify(p.replies).includes('management-fixture-only'));
  // The child is opaque-origin, so replies must use the wildcard target; the
  // window object is what confines delivery to that one frame.
  assert.equal(p.replies[0][1], '*');
  p.element('#logout').onclick();
  assert.equal(p.element('#key').value, '');
  assert.equal(p.element('#workspace').hidden, true);
});

test('the console frame is sandboxed so it cannot read the parent page or its key', () => {
  const html = fs.readFileSync(new URL('../web/index.html', import.meta.url), 'utf8');
  const tag = /<iframe[^>]*id="console-frame"[^>]*>/.exec(html)?.[0] ?? '';
  const sandbox = /sandbox="([^"]*)"/.exec(tag)?.[1] ?? '';
  assert.ok(sandbox.includes('allow-scripts'), 'the console needs to run its own scripts');
  assert.ok(sandbox.includes('allow-forms') && sandbox.includes('allow-modals') && sandbox.includes('allow-downloads'));
  assert.ok(!sandbox.includes('allow-same-origin'), 'allow-same-origin would restore parent DOM access');
  // The child must not assume a usable origin when it talks to the parent.
  const bridge = fs.readFileSync(new URL('../web/console-bridge.js', import.meta.url), 'utf8');
  assert.match(bridge, /window\.self\.origin === 'null'/);
  assert.doesNotMatch(bridge, /postMessage\(\{[^}]*\},\s*location\.origin\)/);
});

test('regression: a sandboxed opaque-origin console can still write theme storage', () => {
  // The console iframe is sandboxed without allow-same-origin, so touching the
  // real localStorage throws SecurityError. Upstream's theme toggle writes
  // before it updates React state, so that throw froze the button after one
  // click (dark -> light, then stuck). The bridge must install an in-memory
  // Storage before the console bundle runs, and must not seed it with secrets.
  const bridge = fs.readFileSync(new URL('../web/console-bridge.js', import.meta.url), 'utf8');
  assert.match(bridge, /if \(sandboxed\) \{/, 'the shim must be scoped to opaque-origin frames');
  assert.match(bridge, /Object\.defineProperty\(window, 'localStorage'/);
  assert.match(bridge, /Object\.defineProperty\(window, 'sessionStorage'/);
  assert.doesNotMatch(bridge, /Bearer|Authorization|management[-_ ]?key/i, 'the shim must never carry credentials');

  // Execute just the shim in a sandboxed-like window and prove the upstream
  // write/read/state sequence now completes instead of throwing.
  const start = bridge.indexOf('const entries = new Map();');
  const end = bridge.indexOf('  }\n', bridge.indexOf('a host that forbids redefining it'));
  assert.ok(start > 0 && end > start, 'the shim block must be locatable');
  const shimSource = bridge.slice(start, end);
  // Model the frame's global object: `window` and `self` are the same object and
  // its origin is the opaque "null", exactly as the sandbox produces.
  const frame = { top: {} };
  frame.window = frame;
  frame.self = frame;
  frame.origin = 'null';
  vm.createContext(frame);
  vm.runInContext(`const sandboxed = true;\n${shimSource}`, frame);
  // The upstream toggle sequence: write the preference, then read it back.
  vm.runInContext(`localStorage.setItem('ofm-theme', 'light'); result = localStorage.getItem('ofm-theme');`, frame);
  assert.equal(frame.result, 'light');
  vm.runInContext(`sessionStorage.setItem('tab', 'channels'); result = sessionStorage.getItem('tab');`, frame);
  assert.equal(frame.result, 'channels');
});

test('leaving the page cancels management work instead of only dropping the wait', async () => {
  const p = page(); await p.element('#open').onclick();
  const handler = p.events.get('message');
  const source = p.element('#console-frame').contentWindow;
  const before = p.requests.length;
  // Cancel while the proxied call is still in flight, not after it settles.
  handler({ origin: 'null', source, data: { kind: 'ofm-request', id: 'b'.repeat(32), path: '/api/management/summary', method: 'GET' } });
  p.events.get('pagehide')();
  await setImmediate();
  const cancel = p.requests.slice(before).find(row => row.url.endsWith('/ofm/console-cancel'));
  assert.ok(cancel, 'pagehide must tell CPA to stop the in-flight management call');
  assert.equal(JSON.parse(cancel.options.body).id, 'b'.repeat(32));
  // A request issued during unload must be keepalive, or the browser may drop it.
  assert.equal(cancel.options.keepalive, true, 'the unload cancel must survive page teardown');
  assert.equal(cancel.options.headers.Authorization, 'Bearer management-fixture-only');
  assert.equal(p.element('#key').value, '');
});
