(() => {
  'use strict';
  // The console runs in a sandboxed frame with an opaque origin: `location.origin`
  // is the literal string "null" and cannot address the parent. Messages are
  // still origin-checked on the parent side, which is the side that owns the key.
  // In a sandboxed frame `location.origin` still reflects the URL, but the
  // document's own origin is opaque and `self.origin` is the string "null".
  const sandboxed = window.self !== window.top && window.self.origin === 'null';
  const parentTarget = sandboxed ? '*' : location.origin;
  const fromParent = event => sandboxed ? event.source === parent : event.origin === location.origin && event.source === parent;

  // A sandboxed frame without `allow-same-origin` has an opaque origin, so
  // reading `localStorage` throws SecurityError. Upstream guards its reads but
  // not its writes: the console's theme toggle writes first and calls setState
  // second, so the throw left React's state on its initial value and the button
  // stopped toggling after the first click. Same for the channel-page tab and
  // the reload badge. Give the console a working in-memory Storage instead of
  // weakening the sandbox: the preference is per-open anyway, and the theme
  // itself still round-trips to the parent page, which owns the real storage.
  if (sandboxed) {
    const entries = new Map();
    const memoryStorage = {
      getItem: key => entries.has(String(key)) ? entries.get(String(key)) : null,
      setItem: (key, value) => { entries.set(String(key), String(value)); },
      removeItem: key => { entries.delete(String(key)); },
      clear: () => entries.clear(),
      key: index => [...entries.keys()][index] ?? null,
      get length() { return entries.size; },
    };
    try {
      Object.defineProperty(window, 'localStorage', { configurable: true, value: memoryStorage });
      Object.defineProperty(window, 'sessionStorage', { configurable: true, value: memoryStorage });
    } catch { /* a host that forbids redefining it keeps the upstream try/catch */ }
  }
  document.documentElement.dataset.cpaEmbedded = String(new URLSearchParams(location.search).get('layout') === 'embedded');
  const shareTheme = () => {
    const theme = document.documentElement.dataset.theme;
    if (parent !== window && ['light', 'dark'].includes(theme)) parent.postMessage({ kind: 'ofm-theme', theme }, parentTarget);
  };
  new MutationObserver(shareTheme).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
  shareTheme();
  const nativeFetch = window.fetch.bind(window);
  const pending = new Map();
  const makeID = () => [...crypto.getRandomValues(new Uint8Array(16))].map(value => value.toString(16).padStart(2, '0')).join('');
  const prefix = '/api/management';
  const messageJSON = (status, error) => new Response(JSON.stringify({ error }), { status, headers: { 'content-type': 'application/json' } });

  window.addEventListener('message', event => {
    if (!fromParent(event) || event.data?.kind !== 'ofm-response') return;
    const entry = pending.get(event.data.id);
    if (!entry) return;
    pending.delete(event.data.id); clearTimeout(entry.timer); entry.signal?.removeEventListener('abort', entry.abort);
    let text = event.data.text;
    try {
      const body = JSON.parse(text);
      const publicBase = String(event.data.apiBase ?? '');
      if (body.baseUrl && publicBase) body.baseUrl = publicBase.replace(/\/v1$/, '');
      if (Array.isArray(body.catalog)) for (const row of body.catalog) row.id = (event.data.modelPrefix ?? 'ofm/') + row.id;
      if (entry.path === prefix + '/channels/rpc' && body.value?.address && publicBase) {
        const base = new URL(publicBase); body.value.address = { host: base.hostname, port: Number(base.port || (base.protocol === 'https:' ? 443 : 80)) };
        if (Array.isArray(body.value.models)) for (const row of body.value.models) row.id = (event.data.modelPrefix ?? 'ofm/') + row.id;
      }
      text = JSON.stringify(body);
    } catch { text = JSON.stringify({ error: 'CPA 返回了无法识别的管理响应，请返回插件设置重新验证管理密钥。' }); }
    entry.resolve(new Response(text, { status: event.data.status, headers: { 'content-type': 'application/json' } }));
  });

  window.fetch = async (input, options = {}) => {
    const request = new Request(input, options);
    const url = new URL(request.url, location.href);
    if (url.origin !== location.origin || !url.pathname.startsWith(prefix + '/')) return nativeFetch(request);
    if (parent === window) return messageJSON(401, '请从 CPA 侧栏的“免费模型管理”进入控制台。');
    if (url.pathname === prefix + '/logout') {
      parent.postMessage({ kind: 'ofm-logout' }, parentTarget);
      return new Response('{"ok":true}', { headers: { 'content-type': 'application/json' } });
    }
    if (!['GET', 'POST'].includes(request.method)) return messageJSON(405, '不支持此操作。');
    let body;
    if (request.method === 'POST') {
      try { body = JSON.parse(await request.text()); } catch { return messageJSON(400, '控制台请求必须是 JSON 对象。'); }
    }
    request.signal.throwIfAborted();
    const id = makeID();
    return new Promise((resolve, reject) => {
      const abort = () => {
        const entry = pending.get(id); if (!entry) return;
        clearTimeout(entry.timer); pending.delete(id);
        parent.postMessage({ kind: 'ofm-cancel', id }, parentTarget);
        reject(new DOMException('请求已取消', 'AbortError'));
      };
      const timer = setTimeout(() => {
        abort();
      }, 125000);
      pending.set(id, { resolve, reject, timer, signal: request.signal, abort, path: url.pathname });
      request.signal.addEventListener('abort', abort, { once: true });
      parent.postMessage({ kind: 'ofm-request', id, path: url.pathname + url.search, method: request.method, body }, parentTarget);
    });
  };
})();
