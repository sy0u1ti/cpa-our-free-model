(() => {
  'use strict';
  const repository = 'https://github.com/sy0u1ti/cpa-our-free-model';
  const registry = 'https://raw.githubusercontent.com/sy0u1ti/cpa-our-free-model/main/registry.json';
  const officialRegistry = 'https://raw.githubusercontent.com/router-for-me/CLIProxyAPI-Plugins-Store/main/registry.json';
  const pluginID = 'our-free-model';
  const versionPattern = /^\d+\.\d+\.\d+$/;

  window.createOFMUpdater = ({ fetchManagement, setBusy, onMessage, pause = ms => new Promise(resolve => setTimeout(resolve, ms)) }) => {
    const $ = selector => document.querySelector(selector);
    let candidate;
    let busy = false;
    let pendingVersion = '';
    let installed = false;

    function syncButtons() {
      $('#install-update').disabled = busy || !!pendingVersion || candidate?.state !== 'available';
      $('#updates').disabled = busy || !!pendingVersion;
      $('#verify-update').hidden = !pendingVersion;
      $('#verify-update').disabled = busy;
      $('#reload-update').hidden = !installed;
      $('#update-progress').hidden = !busy;
    }
    async function readResponse(response) {
      let value;
      try { value = await response.json(); } catch { throw new Error('CPA 返回了无法识别的响应，请检查反向代理和 CPA 版本。'); }
      if (!response.ok) {
        const messages = {
          plugin_update_requires_restart: 'CPA 无法在运行时替换此插件，请在维护窗口重启后重新检查。',
          plugin_store_source_conflict: '插件由另一个商店源管理，已停止更新；请从原安装源更新。',
          plugin_store_installed_source_unknown: 'CPA 无法确认原安装源，已停止更新，请先检查插件商店配置。',
          plugin_install_failed: 'CPA 下载、校验或写入安装包失败，请检查服务器网络、目录权限和 CPA 日志。',
          plugin_not_found: '更新源尚未收录此插件，请确认 registry.json 已发布。',
        };
        const error = new Error(messages[value.error] ?? `CPA 返回 HTTP ${response.status}，请检查管理密钥、远程管理设置和 CPA 日志。`);
        error.restartRequired = value.restart_required === true;
        throw error;
      }
      return value;
    }
    const api = async (version, path, method = 'GET', body, timeout = 45000) =>
      readResponse(await fetchManagement(version, path, method, body, AbortSignal.timeout(timeout)));
    const message = text => { $('#update-result').textContent = text; onMessage(text); };
    async function task(action) {
      if (busy) return;
      busy = true; setBusy(true); syncButtons();
      try { await action(); }
      catch (error) { message(error.name === 'TimeoutError' ? '操作超时，未确认更新成功。请检查网络后重试。' : error.message); }
      finally { busy = false; setBusy(false); syncButtons(); }
    }
    function validateRelease(info) {
      if (info.registryUrl !== registry || !versionPattern.test(info.currentVersion ?? '') ||
          !['available', 'current', 'development', 'unpublished', 'unpackaged', 'unavailable'].includes(info.state)) {
        throw new Error('正式版本响应不符合本插件的更新契约，已停止。');
      }
      if (info.state === 'available' && (!versionPattern.test(info.latestVersion ?? '') ||
          info.tag !== 'v' + info.latestVersion && info.tag !== info.latestVersion ||
          info.releaseUrl !== repository + '/releases/tag/' + info.tag)) {
        throw new Error('正式版本来源或版本号不合法，已停止。');
      }
      return info;
    }
    function selectEntry(store) {
      if (!Array.isArray(store.plugins) || !Array.isArray(store.sources)) throw new Error('CPA 不支持所需的插件商店接口，请使用已验证的 CPA 8.0.23 或兼容版本。');
      const entries = store.plugins.filter(entry => entry.id === pluginID && entry.repository === repository &&
        entry.install_type === 'github-release' && [registry, officialRegistry].includes(entry.source_url) &&
        /^[a-z0-9-]+$/.test(entry.source_id ?? '') &&
        store.sources.some(source => source.id === entry.source_id && source.url === entry.source_url));
      const selected = entries.find(entry => entry.installed_source_id === entry.source_id) ??
        entries.find(entry => entry.source_url === registry) ?? entries[0];
      if (selected && (selected.install_source_status === 'unknown' ||
          selected.installed_source_id && selected.installed_source_id !== selected.source_id)) {
        throw new Error('插件的原安装源不匹配，已停止；不会卸载插件或覆盖原来源设置。');
      }
      return selected;
    }
    async function sources() {
      const response = await fetchManagement('v8', 'config/plugins/store-sources', 'GET', undefined, AbortSignal.timeout(15000));
      if (response.status === 404) {
        const value = await response.json().catch(() => null);
        if (value?.error === 'not_found') return [];
        throw new Error('CPA 缺少安全修改更新源的 v8 配置接口，请升级 CPA；不会覆盖整份配置文件。');
      }
      const value = await readResponse(response);
      if (value === null) return [];
      if (!Array.isArray(value) || value.some(item => typeof item !== 'string')) throw new Error('CPA 的插件更新源配置格式不合法。');
      return value;
    }
    async function waitForRunning(target) {
      for (let attempt = 0; attempt < 12; attempt++) {
        try {
          const status = await api('v0', 'ofm/status', 'GET', undefined, 5000);
          if (status.running === true && status.pluginVersion === target) return true;
        } catch {}
        if (attempt < 11) await pause(2500);
      }
      return false;
    }
    function completed(target) {
      pendingVersion = ''; candidate = undefined; installed = true;
      message(`更新已生效：当前运行 v${target}。点击“刷新管理页”加载新版界面，之后需要重新输入管理密钥。`);
    }
    const verify = () => task(async () => {
      if (!pendingVersion) return;
      message(`正在核实 v${pendingVersion} 是否已经运行……`);
      if (await waitForRunning(pendingVersion)) completed(pendingVersion);
      else message(`尚未确认 v${pendingVersion} 运行，不能判定更新成功。请检查 CPA 日志；若宿主要求重启，请重启后再点“确认运行版本”。`);
    });
    const check = () => task(async () => {
      candidate = undefined; installed = false;
      message('正在检查正式 Release 和当前服务器平台……');
      candidate = validateRelease(await api('v0', 'ofm/releases'));
      $('#release-version').textContent = `当前 v${candidate.currentVersion} · 正式版 ${candidate.latestVersion ? 'v' + candidate.latestVersion : '未发布'} · ${candidate.platform}`;
      message(candidate.message);
    });
    const install = () => task(async () => {
      if (candidate?.state !== 'available' || pendingVersion) return;
      const checked = validateRelease(await api('v0', 'ofm/releases'));
      if (checked.state !== 'available' || checked.latestVersion !== candidate.latestVersion) {
        candidate = undefined;
        throw new Error('可安装版本已变化，请重新检查后再更新。');
      }
      message('正在核对 CPA 原生更新能力和插件来源……');
      let entry = selectEntry(await api('v8', 'plugins/store', 'GET', undefined, 120000));
      const previousSources = entry ? undefined : await sources();
      const addSource = !entry && !previousSources.includes(registry);
      const consent = `确认更新到 v${checked.latestVersion}（${checked.platform}）？\n\n` +
        'CPA 将从本插件 GitHub Release 下载指定版本、校验 SHA-256 并安装，随后尝试热加载。切换时正在进行的模型请求可能中断。\n' +
        '不会更改账号数据，不需要在服务器运行编译命令，也不会自动重启整个 CPA。\n' +
        (addSource ? `\n首次使用会把下列地址加入 plugins.store-sources，保留已有更新源。CPA 保存配置时可能将旧布局规范化为 v8。\n${registry}` : '');
      if (!window.confirm(consent)) { message('已取消，未下载或安装插件。'); return; }
      if (addSource) {
        message('正在添加本插件更新源，保留其他源和插件配置……');
        const currentSources = await sources();
        if (JSON.stringify(currentSources) !== JSON.stringify(previousSources)) throw new Error('更新源配置刚刚发生变化，请重新检查；未覆盖其他修改。');
        await api('v8', 'config/plugins/store-sources', 'PUT', [...currentSources, registry]);
      }
      if (!entry) {
        for (let attempt = 0; attempt < 4; attempt++) {
          const store = await api('v8', 'plugins/store', 'GET', undefined, 120000);
          entry = selectEntry(store);
          if (entry) break;
          if (store.sources.some(source => source.url === registry)) break;
          await pause(1000);
        }
      }
      if (!entry) throw new Error('CPA 尚不能读取本插件更新源。请确认 registry.json 与正式 Release 已发布，并检查服务器访问 GitHub 的网络。');
      // Pin the approved version. Never let a later "latest" lookup silently
      // replace the version shown in the confirmation.
      message(`CPA 正在下载、校验并安装 v${checked.latestVersion}，请保持页面打开……`);
      pendingVersion = checked.latestVersion;
      let result;
      try {
        result = await api('v8', `plugins/store/${pluginID}/install?source=${encodeURIComponent(entry.source_id)}`, 'POST', { version: checked.latestVersion }, 180000);
      } catch (error) {
        if (error.restartRequired) {
          message(error.message + ' 尚未确认新版已安装；重启后请重新检查。');
          pendingVersion = '';
          return;
        }
        if (await waitForRunning(checked.latestVersion)) completed(checked.latestVersion);
        else message(error.message + ' 尚未确认运行版本，请先点“确认运行版本”，不要重复安装。');
        return;
      }
      if (result.status !== 'installed' || result.id !== pluginID || result.version !== checked.latestVersion) {
        throw new Error('CPA 安装响应与已确认版本不一致，请先核实运行版本，未判定成功。');
      }
      if (result.restart_required === true) {
        message(`v${checked.latestVersion} 已安装，但 CPA 要求重启才能生效。请手动重启后点“确认运行版本”。`);
        return;
      }
      message(`v${checked.latestVersion} 安装完成，正在确认 CPA 已加载新版……`);
      if (await waitForRunning(checked.latestVersion)) completed(checked.latestVersion);
      else message(`安装接口已完成，但尚未确认 v${checked.latestVersion} 运行。请检查 CPA 日志或重启宿主，再点“确认运行版本”。`);
    });
    syncButtons();
    return { check, install, verify, syncButtons };
  };
})();
