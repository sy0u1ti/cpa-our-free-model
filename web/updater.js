(() => {
  'use strict';
  const repository = 'https://github.com/sy0u1ti/cpa-our-free-model';
  const registry = 'https://raw.githubusercontent.com/sy0u1ti/cpa-our-free-model/main/registry.json';
  const officialRegistry = 'https://raw.githubusercontent.com/router-for-me/CLIProxyAPI-Plugins-Store/main/registry.json';
  const pluginID = 'our-free-model';
  const versionPattern = /^\d+\.\d+\.\d+$/;

  window.createOFMUpdater = ({ fetchManagement, setBusy, onMessage, pause = ms => new Promise(resolve => setTimeout(resolve, ms)) }) => {
    const $ = selector => document.querySelector(selector);
    const { t, fromServer } = window.ofmI18n;
    const storeErrors = ['plugin_update_requires_restart', 'plugin_store_source_conflict',
      'plugin_store_installed_source_unknown', 'plugin_install_failed', 'plugin_not_found'];
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
      try { value = await response.json(); } catch { throw new Error(t('updater.badResponse')); }
      if (!response.ok) {
        const error = new Error(storeErrors.includes(value.error) ? t('updater.error.' + value.error)
          : t('updater.httpError', { status: response.status }));
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
      catch (error) { message(error.name === 'TimeoutError' ? t('updater.timeout') : error.message); }
      finally { busy = false; setBusy(false); syncButtons(); }
    }
    function validateRelease(info) {
      if (info.registryUrl !== registry || !versionPattern.test(info.currentVersion ?? '') ||
          !['available', 'current', 'development', 'unpublished', 'unpackaged', 'unavailable'].includes(info.state)) {
        throw new Error(t('updater.badContract'));
      }
      if (info.state === 'available' && (!versionPattern.test(info.latestVersion ?? '') ||
          info.tag !== 'v' + info.latestVersion && info.tag !== info.latestVersion ||
          info.releaseUrl !== repository + '/releases/tag/' + info.tag)) {
        throw new Error(t('updater.badRelease'));
      }
      return info;
    }
    function selectEntry(store) {
      if (!Array.isArray(store.plugins) || !Array.isArray(store.sources)) throw new Error(t('updater.storeUnsupported'));
      const entries = store.plugins.filter(entry => entry.id === pluginID && entry.repository === repository &&
        entry.install_type === 'github-release' && [registry, officialRegistry].includes(entry.source_url) &&
        /^[a-z0-9-]+$/.test(entry.source_id ?? '') &&
        store.sources.some(source => source.id === entry.source_id && source.url === entry.source_url));
      const selected = entries.find(entry => entry.installed_source_id === entry.source_id) ??
        entries.find(entry => entry.source_url === registry) ?? entries[0];
      if (selected && (selected.install_source_status === 'unknown' ||
          selected.installed_source_id && selected.installed_source_id !== selected.source_id)) {
        throw new Error(t('updater.sourceMismatch'));
      }
      return selected;
    }
    async function sources() {
      const response = await fetchManagement('v8', 'config/plugins/store-sources', 'GET', undefined, AbortSignal.timeout(15000));
      if (response.status === 404) {
        const value = await response.json().catch(() => null);
        if (value?.error === 'not_found') return [];
        throw new Error(t('updater.configUnsupported'));
      }
      const value = await readResponse(response);
      if (value === null) return [];
      if (!Array.isArray(value) || value.some(item => typeof item !== 'string')) throw new Error(t('updater.badSources'));
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
      message(t('updater.completed', { version: target }));
    }
    const verify = () => task(async () => {
      if (!pendingVersion) return;
      message(t('updater.verifying', { version: pendingVersion }));
      if (await waitForRunning(pendingVersion)) completed(pendingVersion);
      else message(t('updater.notConfirmed', { version: pendingVersion }));
    });
    const check = () => task(async () => {
      candidate = undefined; installed = false;
      message(t('updater.checking'));
      candidate = validateRelease(await api('v0', 'ofm/releases'));
      $('#release-version').textContent = t('updater.releaseLine', { current: candidate.currentVersion,
        latest: candidate.latestVersion ? 'v' + candidate.latestVersion : t('updater.unpublished'), platform: candidate.platform });
      message(fromServer('server.release.' + candidate.state, candidate.message));
    });
    const install = () => task(async () => {
      if (candidate?.state !== 'available' || pendingVersion) return;
      const checked = validateRelease(await api('v0', 'ofm/releases'));
      if (checked.state !== 'available' || checked.latestVersion !== candidate.latestVersion) {
        candidate = undefined;
        throw new Error(t('updater.versionChanged'));
      }
      message(t('updater.checkingStore'));
      let entry = selectEntry(await api('v8', 'plugins/store', 'GET', undefined, 120000));
      const previousSources = entry ? undefined : await sources();
      const addSource = !entry && !previousSources.includes(registry);
      const consent = t('updater.confirmHead', { version: checked.latestVersion, platform: checked.platform }) +
        t('updater.confirmBody') + (addSource ? t('updater.confirmSource', { registry }) : '');
      if (!window.confirm(consent)) { message(t('updater.cancelled')); return; }
      if (addSource) {
        message(t('updater.addingSource'));
        const currentSources = await sources();
        if (JSON.stringify(currentSources) !== JSON.stringify(previousSources)) throw new Error(t('updater.sourcesChanged'));
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
      if (!entry) throw new Error(t('updater.sourceUnreadable'));
      // Pin the approved version. Never let a later "latest" lookup silently
      // replace the version shown in the confirmation.
      message(t('updater.installing', { version: checked.latestVersion }));
      pendingVersion = checked.latestVersion;
      let result;
      try {
        result = await api('v8', `plugins/store/${pluginID}/install?source=${encodeURIComponent(entry.source_id)}`, 'POST', { version: checked.latestVersion }, 180000);
      } catch (error) {
        if (error.restartRequired) {
          message(error.message + t('updater.restartUnconfirmed'));
          pendingVersion = '';
          return;
        }
        if (await waitForRunning(checked.latestVersion)) completed(checked.latestVersion);
        else message(error.message + t('updater.runningUnconfirmed'));
        return;
      }
      if (result.status !== 'installed' || result.id !== pluginID || result.version !== checked.latestVersion) {
        throw new Error(t('updater.installMismatch'));
      }
      if (result.restart_required === true) {
        message(t('updater.restartRequired', { version: checked.latestVersion }));
        return;
      }
      message(t('updater.installed', { version: checked.latestVersion }));
      if (await waitForRunning(checked.latestVersion)) completed(checked.latestVersion);
      else message(t('updater.installedUnconfirmed', { version: checked.latestVersion }));
    });
    syncButtons();
    return { check, install, verify, syncButtons };
  };
})();
