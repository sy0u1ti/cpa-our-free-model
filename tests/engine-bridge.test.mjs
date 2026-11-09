import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const source = fs.readFileSync(new URL('../web/engine-bridge.js', import.meta.url), 'utf8');

function engineFrame() {
  const observers = [], requests = [];
  class Element {
    constructor(tagName = 'SPAN') { this.tagName = tagName; this.nodeType = 1; this.attributes = new Map(); }
    getAttribute(name) { return this.attributes.get(name) ?? null; }
    setAttribute(name, value) { this.attributes.set(name, value); }
    querySelectorAll() { return []; }
  }
  class Image extends Element {
    constructor() { super('IMG'); }
    get src() { return this.getAttribute('src'); }
    set src(value) { this.setAttribute('src', value); }
  }
  const location = new URL('https://cpa.example/proxy/v0/resource/plugins/our-free-model/engine?mode=window&view=providers');
  const window = { Element, HTMLImageElement: Image, addEventListener() {},
    fetch: async request => { requests.push(request); return new Response('asset'); } };
  const context = {
    window, location, parent: { postMessage() {} }, URL, Request, Response, Headers, DOMException, crypto,
    setTimeout, clearTimeout, document: { documentElement: new Element('HTML') },
    MutationObserver: class { constructor(callback) { observers.push(callback); } observe() {} },
  };
  vm.createContext(context);
  vm.runInContext(source, context);
  return { Image, Element, window, requests, mutation: records => observers[0](records) };
}

test('runtime-created engine icons and masks stay under the CPA resource prefix', () => {
  const frame = engineFrame();
  const image = new frame.Image();
  image.src = 'icons/claude-color.svg';
  const icon = new URL(image.src);
  assert.equal(icon.pathname, '/proxy/v0/resource/plugins/our-free-model/engine');
  assert.equal(icon.searchParams.get('path'), 'icons/claude-color.svg');
  image.setAttribute('src', '/api/management/engine/ui/icons/gemini.png');
  assert.equal(new URL(image.src).searchParams.get('path'), 'icons/gemini.png');

  const mask = new frame.Element();
  mask.setAttribute('style', 'mask-image:url("icons/deepseek.svg");color:red');
  frame.mutation([{ type: 'attributes', target: mask }]);
  assert.match(mask.getAttribute('style'), /path=icons%2Fdeepseek\.svg/);
  assert.ok(mask.getAttribute('style').endsWith(';color:red'));
});

test('parser-created engine assets are rewritten without capturing APIs or external resources', () => {
  const frame = engineFrame();
  const image = new frame.Image();
  // innerHTML parsing bypasses JS attribute setters; the observer covers it.
  image.attributes.set('src', 'icons/anthropic.svg');
  frame.mutation([{ type: 'childList', addedNodes: [image] }]);
  assert.equal(new URL(image.src).searchParams.get('path'), 'icons/anthropic.svg');
  for (const value of ['data:image/svg+xml,fixture', 'https://external.example/icon.svg', '/api/private.svg',
    './engine-bridge.js', './engine?path=icons%2Fopenai.svg']) {
    image.src = value;
    assert.equal(image.src, value);
  }
});

test('engine static fetches use the same resource mapping as images', async () => {
  const frame = engineFrame();
  await frame.window.fetch('https://cpa.example/proxy/v0/resource/plugins/our-free-model/icons/qwen.svg');
  const request = frame.requests[0];
  assert.equal(new URL(request.url).searchParams.get('path'), 'icons/qwen.svg');
  assert.equal(request.method, 'GET');
  await frame.window.fetch('https://cpa.example/api/management/engine/ui/icons/gemini.svg');
  assert.equal(new URL(frame.requests[1].url).searchParams.get('path'), 'icons/gemini.svg');
});
