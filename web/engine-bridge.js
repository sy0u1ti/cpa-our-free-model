(() => {
  'use strict';

  const pending = new Map();
  const nativeFetch = window.fetch.bind(window);
  const pageOrigin = new URL(location.href).origin;
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
