(() => {
  'use strict';
  const nativeFetch = window.fetch.bind(window);
  const pending = new Map();
  const makeID = () => [...crypto.getRandomValues(new Uint8Array(16))].map(value => value.toString(16).padStart(2, '0')).join('');
  const prefix = '/api/management';
  const messageJSON = (status, error) => new Response(JSON.stringify({ error }), { status, headers: { 'content-type': 'application/json' } });

  window.addEventListener('message', event => {
    if (event.origin !== location.origin || event.source !== parent || event.data?.kind !== 'ofm-response') return;
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
      parent.postMessage({ kind: 'ofm-logout' }, location.origin);
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
        parent.postMessage({ kind: 'ofm-cancel', id }, location.origin);
        reject(new DOMException('请求已取消', 'AbortError'));
      };
      const timer = setTimeout(() => {
        abort();
      }, 125000);
      pending.set(id, { resolve, reject, timer, signal: request.signal, abort, path: url.pathname });
      request.signal.addEventListener('abort', abort, { once: true });
      parent.postMessage({ kind: 'ofm-request', id, path: url.pathname + url.search, method: request.method, body }, location.origin);
    });
  };
})();
