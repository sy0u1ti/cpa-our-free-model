(() => {
  'use strict';
  const $ = selector => document.querySelector(selector);
  const key = $('#key');
  const output = $('#result');
  const frame = $('#console-frame');
  const resourcePath = '/v0/resource/plugins/our-free-model';
  const pathIndex = location.pathname.lastIndexOf(resourcePath + '/console');
  const prefix = pathIndex < 0 ? '' : location.pathname.slice(0, pathIndex);
  const apiBase = location.origin + prefix + '/v1';
  const calls = new Map();
  let modelPrefix = 'ofm/';

  function authorize() {
    if (!key.value.trim()) throw new Error('请先填写 CPA 管理密钥。');
    if (location.protocol !== 'https:' && !['localhost', '127.0.0.1', '[::1]'].includes(location.hostname)) {
      throw new Error('远程管理需要 HTTPS。请启用域名 TLS，或通过 SSH 转发后的 localhost 访问。');
    }
  }
  async function request(path, method = 'GET', body, signal) {
    authorize();
    return fetch(prefix + '/v0/management/' + path, { method, signal, credentials: 'omit', redirect: 'error', cache: 'no-store',
      headers: { Authorization: 'Bearer ' + key.value.trim(), 'Content-Type': 'application/json' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  }
  async function api(path, method, body) {
    const response = await request(path, method, body, AbortSignal.timeout(180000));
    if (!response.ok) throw new Error(`CPA 返回 HTTP ${response.status}，请检查管理密钥、插件状态及远程管理设置。`);
    return response.json();
  }
  async function run(action) {
    const buttons = [...$('#landing').querySelectorAll('button')];
    buttons.forEach(button => { button.disabled = true; });
    output.textContent = '正在处理，请稍候……'; $('#details').hidden = true;
    try { await action(); }
    catch (error) { output.textContent = error.name === 'TimeoutError' ? '操作超时，请检查 CPA 服务。' : error.message; }
    finally { buttons.forEach(button => { button.disabled = false; }); }
  }
  async function cancelCall(id) {
    calls.get(id)?.abort();
    try { await request('ofm/console-cancel', 'POST', { id }, AbortSignal.timeout(5000)); } catch {}
  }
  function closeConsole(clear = false) {
    for (const id of calls.keys()) void cancelCall(id);
    frame.src = 'about:blank'; $('#workspace').hidden = true; $('#landing').hidden = false;
    if (clear) key.value = '';
    output.textContent = clear ? '已退出管理，页面密钥已清除。' : '已返回插件设置。';
  }
  function setState(state) {
    modelPrefix = state.modelPrefix ?? 'ofm/';
    $('#connection-note').textContent = `客户端地址：${apiBase}；模型前缀：${modelPrefix || '无'}。使用 CPA 客户端密钥，不是管理密钥。`;
    const status = { '插件版本': state.pluginVersion, '服务状态': state.running ? '运行中' : '未运行', '模型数量': state.models,
      '账号渠道': state.channels?.state === 'ready' ? '已就绪' : '未就绪', '控制台访问': '当前 CPA 域名，无需额外端口',
      '客户端地址': apiBase, 'EAC 来源': ({ ready: '已就绪', disabled: '未启用', failed: '加载失败', unavailable: '不可用' })[state.eacSource?.state] ?? '未知' };
    $('#details').textContent = Object.entries(status).map(([name, value]) => `${name}：${value ?? '未知'}`).join('\n');
  }
  $('#status').onclick = () => run(async () => {
    setState(await api('ofm/status')); $('#details').hidden = false; output.textContent = '已获取服务状态。';
  });
  $('#open').onclick = () => run(async () => {
    const value = await api('ofm/console', 'POST', {});
    if (value.url !== resourcePath + '/app') throw new Error('控制台地址不符合当前 CPA 路由。');
    setState(await api('ofm/status'));
    $('#landing').hidden = true; $('#workspace').hidden = false;
    frame.src = prefix + value.url;
  });
  $('#refresh').onclick = () => run(async () => {
    const models = await api('ofm/models');
    await api('plugins/our-free-model/config', 'PATCH', { 'catalog-revision': Date.now() });
    output.textContent = `已请求同步 ${models.Models.length} 个模型，CPA 会在几秒内重新载入目录。`;
  });
  $('#updates').onclick = () => run(async () => {
    const info = await api('ofm/updates');
    $('#update-result').textContent = `当前 ${info.currentVersion} / 仓库 ${info.latestVersion ?? '未知'}。${info.message}`;
    output.textContent = info.state === 'unavailable' ? '暂时无法检查更新。' : '版本检查完成，未修改运行中的插件。';
  });
  const copy = async text => { try { await navigator.clipboard.writeText(text); output.textContent = '已复制。'; } catch { output.textContent = '浏览器不允许复制，请手动选中文字。'; } };
  $('#copy-command').onclick = () => copy($('#update-command').textContent);
  $('#copy-base').onclick = () => copy(apiBase);
  $('#forget').onclick = () => { closeConsole(true); $('#details').textContent = ''; $('#details').hidden = true; };
  $('#back').onclick = () => closeConsole();
  $('#logout').onclick = () => closeConsole(true);
  key.addEventListener('keydown', event => { if (event.key === 'Enter') $('#open').click(); });

  // The embedded original UI never receives the CPA key. Only this exact child
  // window can request allowlisted management operations through this page.
  window.addEventListener('message', event => {
    if (event.origin !== location.origin || event.source !== frame.contentWindow || $('#workspace').hidden) return;
    const message = event.data;
    if (message?.kind === 'ofm-logout') { closeConsole(true); return; }
    if (!message || !/^[a-f0-9]{32}$/.test(message.id ?? '')) return;
    if (message.kind === 'ofm-cancel') { void cancelCall(message.id); return; }
    if (message.kind !== 'ofm-request' || calls.has(message.id)) return;
    const controller = new AbortController();
    calls.set(message.id, controller);
    const source = event.source;
    (async () => {
      try {
        const response = await request('ofm/console-api', 'POST', { id: message.id, path: message.path, method: message.method, body: message.body }, controller.signal);
        const text = await response.text();
        if (!$('#workspace').hidden) source.postMessage({ kind: 'ofm-response', id: message.id, status: response.status, text, apiBase, modelPrefix }, location.origin);
      } catch (error) {
        if (!$('#workspace').hidden) source.postMessage({ kind: 'ofm-response', id: message.id, status: 502, text: JSON.stringify({ error: '控制台请求失败、已取消或连接中断。' }) }, location.origin);
      } finally { calls.delete(message.id); }
    })();
  });
  window.addEventListener('pagehide', () => { for (const controller of calls.values()) controller.abort(); key.value = ''; });
})();
