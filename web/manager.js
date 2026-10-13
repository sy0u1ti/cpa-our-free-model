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
  const embedded = window.self !== window.top;
  document.documentElement.dataset.cpaEmbedded = String(embedded);
  $('#standalone-link').hidden = !embedded;
  $('#standalone-link').href = prefix + resourcePath + '/console';
  let modelPrefix = 'ofm/';
  let updater;

  function authorize() {
    if (!key.value.trim()) throw new Error('请先填写 CPA 管理密钥。');
    if (location.protocol !== 'https:' && !['localhost', '127.0.0.1', '[::1]'].includes(location.hostname)) {
      throw new Error('远程管理需要 HTTPS。请启用域名 TLS，或通过 SSH 转发后的 localhost 访问。');
    }
  }
  async function managementFetch(version, path, method = 'GET', body, signal) {
    authorize();
    return fetch(prefix + '/' + version + '/management/' + path, { method, signal, credentials: 'omit', redirect: 'error', cache: 'no-store',
      headers: { Authorization: 'Bearer ' + key.value.trim(), 'Content-Type': 'application/json' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  }
  const request = (path, method, body, signal) => managementFetch('v0', path, method, body, signal);
  async function api(path, method, body) {
    const response = await request(path, method, body, AbortSignal.timeout(180000));
    if (!response.ok) throw new Error(`CPA 返回 HTTP ${response.status}，请检查管理密钥、插件状态及远程管理设置。`);
    return response.json();
  }
  function setBusy(busy) {
    const buttons = [...$('#landing').querySelectorAll('button')];
    buttons.forEach(button => { button.disabled = busy; });
  }
  async function run(action) {
    setBusy(true);
    output.textContent = '正在处理，请稍候……'; $('#details').hidden = true;
    try { await action(); }
    catch (error) { output.textContent = error.name === 'TimeoutError' ? '操作超时，请检查 CPA 服务。' : error.message; }
    finally { setBusy(false); updater?.syncButtons(); }
  }
  async function cancelCall(id) {
    calls.get(id)?.abort();
    try { await request('ofm/console-cancel', 'POST', { id }, AbortSignal.timeout(5000)); } catch {}
  }
  // During `pagehide` an ordinary fetch is likely to be dropped with the page.
  // `keepalive` is the one request the browser promises to finish after unload,
  // so the cancel actually reaches CPA instead of only stopping the local wait.
  function cancelCallOnUnload(id) {
    calls.get(id)?.abort();
    try {
      authorize();
      fetch(prefix + '/v0/management/ofm/console-cancel', {
        method: 'POST', keepalive: true, credentials: 'omit', redirect: 'error', cache: 'no-store',
        headers: { Authorization: 'Bearer ' + key.value.trim(), 'Content-Type': 'application/json' },
        body: JSON.stringify({ id }),
      }).catch(() => {});
    } catch { /* no key or insecure origin: the server-side timeout is the backstop */ }
  }
  function closeConsole(clear = false) {
    for (const id of calls.keys()) void cancelCall(id);
    frame.src = 'about:blank'; $('#workspace').hidden = true; $('#landing').hidden = false;
    document.documentElement.dataset.consoleOpen = 'false';
    $('#connection-panel').hidden = true;
    $('#connection-toggle').setAttribute('aria-expanded', 'false');
    $('#workspace-feedback').textContent = '';
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
    output.textContent = '正在准备控制台与已启用的 EAC 来源；首次下载可能需要稍候，不会自动登录。';
    const value = await api('ofm/console', 'POST', {});
    if (value.url !== resourcePath + '/app') throw new Error('控制台地址不符合当前 CPA 路由。');
    setState(await api('ofm/status'));
    $('#landing').hidden = true; $('#workspace').hidden = false;
    document.documentElement.dataset.consoleOpen = 'true';
    frame.src = prefix + value.url + (embedded ? '?layout=embedded' : '');
  });
  $('#refresh').onclick = () => run(async () => {
    const models = await api('ofm/models');
    await api('plugins/our-free-model/config', 'PATCH', { 'catalog-revision': Date.now() });
    const selection = await api('ofm/selection');
    const excluded = selection.hidden?.length ?? 0;
    output.textContent = excluded
      ? `已请求同步 ${models.Models.length} 个模型（另有 ${excluded} 个已在同步范围外），CPA 会在几秒内重新载入目录。`
      : `已请求同步 ${models.Models.length} 个模型，CPA 会在几秒内重新载入目录。`;
  });

  // The selection panel keeps its own working copy of the checkboxes so a
  // half-finished edit is never written back, and so "cancel" is a pure
  // client-side discard.
  const selectionState = { models: [], checked: new Set(), saving: false };
  function selectionVisible() {
    const term = $('#selection-search').value.trim().toLocaleLowerCase();
    if (!term) return selectionState.models;
    return selectionState.models.filter(row => `${row.name ?? ''} ${row.id}`.toLocaleLowerCase().includes(term));
  }
  function renderSelection() {
    const rows = selectionVisible();
    const list = $('#selection-list');
    list.textContent = '';
    rows.forEach((row, index) => {
      const item = document.createElement('li');
      const box = document.createElement('input');
      box.type = 'checkbox';
      box.checked = selectionState.checked.has(row.id);
      box.disabled = selectionState.saving;
      // Sanitized IDs can collide (for example "a/b" and "a-b"), so the label
      // target includes the row index to stay unique.
      const id = 'selection-' + index + '-' + row.id.replace(/[^\w-]/g, '_');
      box.id = id;
      box.addEventListener('change', () => {
        if (box.checked) selectionState.checked.add(row.id); else selectionState.checked.delete(row.id);
        renderSelectionSummary();
      });
      const label = document.createElement('label');
      label.htmlFor = id;
      const name = document.createElement('span');
      name.className = 'selection-name';
      name.textContent = row.name || row.id;
      const code = document.createElement('span');
      code.className = 'selection-id';
      code.textContent = row.id;
      label.append(name, code);
      const meta = document.createElement('span');
      meta.className = 'selection-meta';
      meta.textContent = row.contextWindow ? `${Math.round(row.contextWindow / 1024)}K 上下文` : '';
      item.append(box, label, meta);
      list.append(item);
    });
    if (!rows.length) {
      const item = document.createElement('li');
      item.textContent = selectionState.models.length ? '没有匹配的模型。' : '上游目录暂时为空，请先刷新清单。';
      list.append(item);
    }
    renderSelectionSummary();
  }
  function renderSelectionSummary() {
    const total = selectionState.models.length;
    const chosen = selectionState.checked.size;
    $('#selection-summary').textContent = `已选 ${chosen} / ${total} 个模型；未勾选的 ${total - chosen} 个不会同步到 CPA。`;
    const stale = selectionState.stale ?? [];
    const note = $('#selection-stale');
    note.hidden = !stale.length;
    if (stale.length) note.textContent = `另有 ${stale.length} 个已保存但当前目录中不存在的模型仍保持排除：${stale.slice(0, 6).join('、')}${stale.length > 6 ? ' 等' : ''}。`;
  }
  function setSelectionBusy(busy) {
    selectionState.saving = busy;
    for (const selector of ['#selection-search', '#selection-all', '#selection-none', '#selection-invert', '#selection-save', '#selection-cancel']) {
      $(selector).disabled = busy;
    }
    for (const box of $('#selection-list').querySelectorAll('input[type="checkbox"]')) box.disabled = busy;
  }
  $('#choose-models').onclick = () => run(async () => {
    output.textContent = '正在读取上游模型目录…';
    const value = await api('ofm/selection');
    const rows = Array.isArray(value.models) ? value.models : [];
    selectionState.models = rows;
    selectionState.stale = Array.isArray(value.stale) ? value.stale : [];
    selectionState.checked = new Set(rows.filter(row => row.synced !== false).map(row => row.id));
    $('#selection-search').value = '';
    $('#selection-panel').hidden = false;
    renderSelection();
    output.textContent = `已读取 ${rows.length} 个上游模型，取消勾选即可排除。`;
  });
  $('#selection-all').onclick = () => { for (const row of selectionVisible()) selectionState.checked.add(row.id); renderSelection(); };
  $('#selection-none').onclick = () => { for (const row of selectionVisible()) selectionState.checked.delete(row.id); renderSelection(); };
  $('#selection-invert').onclick = () => {
    for (const row of selectionVisible()) {
      if (selectionState.checked.has(row.id)) selectionState.checked.delete(row.id); else selectionState.checked.add(row.id);
    }
    renderSelection();
  };
  $('#selection-search').oninput = () => renderSelection();
  $('#selection-cancel').onclick = () => {
    $('#selection-panel').hidden = true;
    selectionState.models = []; selectionState.checked = new Set(); selectionState.stale = [];
    output.textContent = '已取消选择，未改变同步范围。';
  };
  $('#selection-save').onclick = () => run(async () => {
    if (!selectionState.models.length) throw new Error('没有可保存的模型目录，请先刷新清单。');
    setSelectionBusy(true);
    try {
      const hidden = selectionState.models.filter(row => !selectionState.checked.has(row.id)).map(row => row.id);
      const result = await api('ofm/selection', 'POST', { hidden });
      // Bumping catalog-revision is what makes CPA re-read the plugin catalog;
      // without it the change would only take effect on the next restart.
      await api('plugins/our-free-model/config', 'PATCH', { 'catalog-revision': Date.now() });
      const synced = result.syncedCount ?? selectionState.checked.size;
      output.textContent = `已保存：同步 ${synced} 个模型，排除 ${hidden.length} 个。CPA 目录会在几秒内重新载入。`;
      $('#selection-panel').hidden = true;
      $('#details').hidden = true;
    } finally {
      setSelectionBusy(false);
    }
  });
  updater = window.createOFMUpdater({ fetchManagement: managementFetch, setBusy, onMessage: text => { output.textContent = text; } });
  $('#updates').onclick = updater.check;
  $('#install-update').onclick = updater.install;
  $('#verify-update').onclick = updater.verify;
  $('#reload-update').onclick = () => { key.value = ''; location.reload(); };
  $('#source-updates').onclick = () => run(async () => {
    const info = await api('ofm/updates');
    $('#source-update-result').textContent = `当前 ${info.currentVersion} / 仓库 ${info.latestVersion ?? '未知'}。${info.message}`;
    output.textContent = info.state === 'unavailable' ? '暂时无法检查更新。' : '版本检查完成，未修改运行中的插件。';
  });
  const copy = async text => {
    const target = $('#workspace').hidden ? output : $('#workspace-feedback');
    try { await navigator.clipboard.writeText(text); target.textContent = '已复制。'; }
    catch { target.textContent = '浏览器不允许复制，请手动选中文字。'; }
  };
  $('#copy-command').onclick = () => copy($('#update-command').textContent);
  $('#copy-base').onclick = () => copy(apiBase);
  $('#connection-toggle').onclick = () => {
    const panel = $('#connection-panel');
    panel.hidden = !panel.hidden;
    $('#connection-toggle').setAttribute('aria-expanded', String(!panel.hidden));
  };
  $('#forget').onclick = () => { closeConsole(true); $('#details').textContent = ''; $('#details').hidden = true; };
  $('#back').onclick = () => closeConsole();
  $('#logout').onclick = () => closeConsole(true);
  key.addEventListener('keydown', event => { if (event.key === 'Enter') $('#open').click(); });

  // The embedded original UI never receives the CPA key. Only this exact child
  // window can request allowlisted management operations through this page.
  window.addEventListener('message', event => {
    // The frame is sandboxed without `allow-same-origin`, so its origin is opaque
    // and arrives as "null". The frame's window object is the real identity check:
    // only this exact child can post through it.
    if (event.source !== frame.contentWindow || $('#workspace').hidden) return;
    if (event.origin !== 'null' && event.origin !== location.origin) return;
    const message = event.data;
    if (message?.kind === 'ofm-theme' && ['light', 'dark'].includes(message.theme)) {
      $('#workspace').dataset.theme = message.theme;
      return;
    }
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
        if (!$('#workspace').hidden) source.postMessage({ kind: 'ofm-response', id: message.id, status: response.status, text, apiBase, modelPrefix }, '*');
      } catch (error) {
        if (!$('#workspace').hidden) source.postMessage({ kind: 'ofm-response', id: message.id, status: 502, text: JSON.stringify({ error: '控制台请求失败、已取消或连接中断。' }) }, '*');
      } finally { calls.delete(message.id); }
    })();
  });
  // `abort()` only drops the browser's wait. The management side keeps working
  // (and spending quota) until it is told to stop, so tell it on the way out.
  window.addEventListener('pagehide', () => {
    for (const id of calls.keys()) cancelCallOnUnload(id);
    key.value = '';
  });
})();
