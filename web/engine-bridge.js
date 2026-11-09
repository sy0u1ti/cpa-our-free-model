(() => {
  'use strict';

  const pending = new Map();
  const nativeFetch = window.fetch.bind(window);
  const pageOrigin = new URL(location.href).origin;
  const pageURL = new URL(location.href);
  const assetDirectory = pageURL.pathname.slice(0, pageURL.pathname.lastIndexOf('/') + 1);
  const ownedAssets = new Set(['engine-bridge.js', 'engine-workspace.css'].map(name => assetDirectory + name));
  const staticAssetURL = value => {
    if (typeof value !== 'string' || /^(?:#|data:|blob:)/i.test(value)) return value;
    let url;
    try { url = new URL(value, location.href); } catch { return value; }
    if (url.origin !== pageOrigin || url.pathname === pageURL.pathname || ownedAssets.has(url.pathname)) return value;
    const mount = '/api/management/engine/ui/';
    const name = url.pathname.startsWith(mount) ? url.pathname.slice(mount.length)
      : url.pathname.startsWith(assetDirectory) ? url.pathname.slice(assetDirectory.length) : url.pathname.slice(1);
    if (!/^(?:[A-Za-z0-9._~-]+\/)*[A-Za-z0-9._~-]+\.(?:js|mjs|css|svg|png|jpe?g|gif|webp|avif|woff2?|ttf|otf)$/i.test(name) ||
      name.startsWith('.') || name.includes('/.') || name.startsWith('api/') || name.includes('/api/')) return value;
    const target = new URL(pageURL.pathname, pageOrigin);
    target.searchParams.set('path', name);
    target.hash = url.hash;
    return target.href;
  };
  const resourceAttribute = (element, name) =>
    name === 'src' && ['IMG', 'SCRIPT', 'SOURCE', 'VIDEO', 'AUDIO'].includes(element.tagName) ||
    name === 'href' && element.tagName === 'LINK' || name === 'poster' && element.tagName === 'VIDEO';
  // Upstream creates provider icons after loading its state. These URLs never
  // pass through the server's HTML/CSS rewrite, so normalize them at creation.
  for (const [name, property] of [['HTMLImageElement', 'src'], ['HTMLScriptElement', 'src'],
    ['HTMLLinkElement', 'href'], ['HTMLSourceElement', 'src'], ['HTMLMediaElement', 'src'],
    ['HTMLVideoElement', 'poster']]) {
    const prototype = window[name]?.prototype;
    const descriptor = prototype && Object.getOwnPropertyDescriptor(prototype, property);
    if (descriptor?.set) Object.defineProperty(prototype, property, {
      ...descriptor, set(value) { descriptor.set.call(this, staticAssetURL(value)); },
    });
  }
  const elementPrototype = window.Element?.prototype;
  if (elementPrototype) {
    const setAttribute = elementPrototype.setAttribute;
    elementPrototype.setAttribute = function(name, value) {
      return setAttribute.call(this, name, resourceAttribute(this, String(name).toLowerCase()) ? staticAssetURL(value) : value);
    };
  }
  const rewriteElement = element => {
    if (element.nodeType !== 1) return;
    for (const name of ['src', 'href', 'poster']) {
      const value = element.getAttribute(name);
      if (value === null || !resourceAttribute(element, name)) continue;
      const next = staticAssetURL(value);
      if (next !== value) element.setAttribute(name, next);
    }
    const style = element.getAttribute('style');
    if (style) {
      const next = style.replace(/url\(\s*(?:"([^"]*)"|'([^']*)'|([^)]*))\s*\)/gi,
        (original, double, single, bare) => {
          const value = (double ?? single ?? bare).trim();
          const target = staticAssetURL(value);
          return target === value ? original : `url("${target}")`;
        });
      if (next !== style) element.setAttribute('style', next);
    }
  };
  const rewriteTree = node => {
    rewriteElement(node);
    for (const element of node.querySelectorAll?.('[src],[href],[poster],[style]') ?? []) rewriteElement(element);
  };
  new MutationObserver(records => {
    for (const record of records) {
      if (record.type === 'attributes') rewriteElement(record.target);
      else for (const node of record.addedNodes) rewriteTree(node);
    }
  }).observe(document.documentElement, { subtree: true, childList: true, attributes: true, attributeFilter: ['src', 'href', 'poster', 'style'] });
  rewriteTree(document.documentElement);
  const makeID = () => [...crypto.getRandomValues(new Uint8Array(16))]
    .map(value => value.toString(16).padStart(2, '0')).join('');
  const json = (status, error) => new Response(JSON.stringify({ error }), {
    status,
    headers: { 'content-type': 'application/json' },
  });

  window.addEventListener('message', event => {
    if (event.source !== parent || event.data?.kind !== 'ofm-engine-response') return;
    const entry = pending.get(event.data.id);
    if (!entry) return;
    pending.delete(event.data.id);
    clearTimeout(entry.timer);
    entry.signal?.removeEventListener('abort', entry.abort);
    const status = Number(event.data.status);
    if (!Number.isInteger(status) || status < 200 || status > 599) {
      entry.reject(new Error('Invalid engine response'));
      return;
    }
    const headers = new Headers();
    for (const [name, value] of Object.entries(event.data.headers ?? {})) {
      if (typeof value !== 'string' || value.length > 2048) continue;
      if (!['retry-after', 'x-magpie-reading', 'x-request-id'].includes(name.toLowerCase())) continue;
      headers.set(name, value);
    }
    const text = status === 204 || entry.method === 'HEAD' ? null : String(event.data.text ?? '');
    if (text !== null && !headers.has('content-type')) headers.set('content-type', 'application/json');
    entry.resolve(new Response(text, { status, headers }));
  });

  window.fetch = async (input, options = {}) => {
    const request = new Request(input, options);
    const url = new URL(request.url, location.href);
    const asset = staticAssetURL(request.url);
    if (asset !== request.url) return nativeFetch(new Request(asset, request));
    if (url.origin !== pageOrigin || (url.pathname !== '/api' && !url.pathname.startsWith('/api/'))) {
      return nativeFetch(request);
    }
    const method = request.method.toUpperCase();
    if (method !== 'GET' && method !== 'POST') return json(405, 'Unsupported engine request method');

    let body;
    if (method === 'POST') {
      try {
        body = JSON.parse(await request.text());
      } catch {
        return json(400, 'Engine request body must be a JSON object');
      }
      if (!body || typeof body !== 'object' || Array.isArray(body)) {
        return json(400, 'Engine request body must be a JSON object');
      }
    }
    request.signal.throwIfAborted();
    const id = makeID();
    const response = await new Promise((resolve, reject) => {
      const abort = () => {
        const entry = pending.get(id);
        if (!entry) return;
        clearTimeout(entry.timer);
        pending.delete(id);
        parent.postMessage({ kind: 'ofm-engine-cancel', id }, '*');
        reject(new DOMException('Engine request was cancelled', 'AbortError'));
      };
      const timer = setTimeout(abort, 125000);
      pending.set(id, { resolve, reject, timer, signal: request.signal, abort, method });
      request.signal.addEventListener('abort', abort, { once: true });
      parent.postMessage({
        kind: 'ofm-engine-request', id, path: url.pathname + url.search, method, body,
      }, '*');
    });
    if (response.ok && method === 'POST') parent.postMessage({ type: 'ofm:engine-changed' }, '*');
    return response;
  };

  // A sandboxed document cannot address its parent by origin. The console
  // bridge treats this identity handshake as permission to relay engine calls.
  parent.postMessage({ kind: 'ofm-engine-ready' }, '*');
})();
