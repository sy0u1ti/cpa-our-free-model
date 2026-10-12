import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const script = fs.readFileSync(new URL('../web/updater.js', import.meta.url), 'utf8');
const repository = 'https://github.com/sy0u1ti/cpa-our-free-model';
const registry = 'https://raw.githubusercontent.com/sy0u1ti/cpa-our-free-model/main/registry.json';
const existingSource = 'https://example.invalid/existing-registry.json';
const release = {
  currentVersion: '0.3.0', latestVersion: '0.4.0', tag: 'v0.4.0', platform: 'linux/amd64', state: 'available',
  registryUrl: registry, releaseUrl: repository + '/releases/tag/v0.4.0', message: 'Release available',
};

function fixture(options = {}) {
  const elements = new Map();
  const calls = [], messages = [], confirmations = [];
  let sourceList = options.configured ? [existingSource, registry] : [existingSource];
  let runningVersion = '0.3.0';
  let installed = false;
  let checks = 0;
  let sourceReads = 0;
  const element = selector => {
    if (!elements.has(selector)) elements.set(selector, { hidden: false, disabled: false, textContent: '' });
    return elements.get(selector);
  };
  const context = {
    document: { querySelector: element }, AbortSignal, setTimeout,
    window: { confirm: text => { confirmations.push(text); return options.confirm !== false; } },
  };
  vm.runInNewContext(script, context);
  const response = (body, status = 200) => new Response(JSON.stringify(body), { status });
  const updater = context.window.createOFMUpdater({
    setBusy() {}, onMessage: text => messages.push(text), pause: async () => {},
    async fetchManagement(version, path, method, body) {
      calls.push({ version, path, method, body });
      if (path === 'ofm/releases') return response({ ...release, ...options.release, ...(++checks > 1 ? options.recheckedRelease : {}) });
      if (path === 'plugins/store') return response({
        sources: sourceList.includes(registry) ? [{ id: 'source-test', url: registry }] : [],
        plugins: sourceList.includes(registry) ? [{
          id: 'our-free-model', repository, install_type: 'github-release', source_id: 'source-test', source_url: registry,
          install_source_status: options.sourceConflict ? 'unknown' : 'assumed', ...options.entry,
        }] : [],
      });
      if (path === 'config/plugins/store-sources') {
        if (method === 'PUT') { sourceList = JSON.parse(JSON.stringify(body)); return response({ status: 'ok' }); }
        sourceReads++;
        if (options.unsupportedConfig) return new Response('Not found', { status: 404 });
        if (options.missingSources) return response({ error: 'not_found' }, 404);
        return response(options.changedSources && sourceReads > 1 ? [...sourceList, 'https://example.invalid/concurrent'] : sourceList);
      }
      if (path.startsWith('plugins/store/our-free-model/install')) {
        assert.equal(version, 'v8');
        assert.equal(method, 'POST');
        assert.equal(body.version, '0.4.0');
        if (options.restartRequired) return response({ error: 'plugin_update_requires_restart', restart_required: true }, 409);
        installed = true;
        if (!options.noActivation) runningVersion = '0.4.0';
        if (options.disconnect) throw new Error('Connection interrupted');
        return response({ status: 'installed', id: 'our-free-model', version: '0.4.0', restart_required: false });
      }
      if (path === 'ofm/status') return response({ running: true, pluginVersion: runningVersion });
      throw new Error('Unexpected request: ' + path);
    },
  });
  return { updater, element, calls, messages, confirmations, isInstalled: () => installed, sources: () => sourceList };
}

test('one-click update uses only the pinned host install API and preserves existing sources', async () => {
  const p = fixture();
  assert.equal(p.element('#install-update').disabled, true);
  await p.updater.check();
  assert.equal(p.element('#install-update').disabled, false);
  assert.equal(p.calls.some(call => call.method !== 'GET'), false);
  await p.updater.install();
  assert.equal(p.isInstalled(), true);
  assert.deepEqual(p.sources(), [existingSource, registry]);
  assert.equal(p.confirmations.length, 1);
  assert.match(p.confirmations[0], /v8/);
  const installs = p.calls.filter(call => call.path.startsWith('plugins/store/our-free-model/install'));
  assert.equal(installs.length, 1);
  assert.equal(installs[0].path, 'plugins/store/our-free-model/install?source=source-test');
  assert.match(p.messages.at(-1), /更新已生效.*v0.4.0/);
  assert.equal(p.element('#reload-update').hidden, false);
});

test('cancelling update confirmation does not change sources or install anything', async () => {
  const p = fixture({ confirm: false });
  await p.updater.check(); await p.updater.install();
  assert.equal(p.calls.some(call => call.method !== 'GET'), false);
  assert.equal(p.isInstalled(), false);
  assert.match(p.messages.at(-1), /已取消/);
});

test('already configured source is not rewritten', async () => {
  const p = fixture({ configured: true });
  await p.updater.check(); await p.updater.install();
  assert.equal(p.calls.some(call => call.path.startsWith('config/')), false);
  assert.equal(p.isInstalled(), true);
});

test('missing optional sources field is created through the narrow v8 path', async () => {
  const p = fixture({ missingSources: true });
  await p.updater.check(); await p.updater.install();
  assert.deepEqual(p.sources(), [registry]);
  assert.equal(p.isInstalled(), true);
});

test('source conflicts, concurrent edits and unsupported configuration APIs fail closed', async () => {
  for (const options of [{ configured: true, sourceConflict: true }, { changedSources: true }, { unsupportedConfig: true }]) {
    const p = fixture(options);
    await p.updater.check(); await p.updater.install();
    assert.equal(p.isInstalled(), false);
    assert.equal(p.calls.some(call => call.method === 'PUT' || call.method === 'POST'), false);
  }
});

test('unpublished, unsupported-platform, failed checks and development builds never enable installation', async () => {
  for (const state of ['unpublished', 'unpackaged', 'unavailable', 'current', 'development']) {
    const p = fixture({ release: { state } });
    await p.updater.check(); await p.updater.install();
    assert.equal(p.element('#install-update').disabled, true);
    assert.equal(p.confirmations.length, 0);
    assert.equal(p.isInstalled(), false);
  }
});

test('changed version and untrusted release origin cannot trigger an install', async () => {
  for (const options of [
    { recheckedRelease: { state: 'current' } },
    { release: { releaseUrl: 'https://evil.invalid/download' } },
    { release: { registryUrl: 'https://evil.invalid/registry.json' } },
  ]) {
    const p = fixture(options);
    await p.updater.check(); await p.updater.install();
    assert.equal(p.isInstalled(), false);
    assert.equal(p.calls.some(call => call.method !== 'GET'), false);
  }
});

test('successful install response alone is not reported as an active update', async () => {
  const p = fixture({ configured: true, noActivation: true });
  await p.updater.check(); await p.updater.install();
  assert.equal(p.isInstalled(), true);
  assert.doesNotMatch(p.messages.at(-1), /更新已生效/);
  assert.match(p.messages.at(-1), /尚未确认/);
  assert.equal(p.element('#verify-update').hidden, false);
  assert.equal(p.element('#install-update').disabled, true);
});

test('disconnect after install checks the running version rather than installing twice', async () => {
  const p = fixture({ configured: true, disconnect: true });
  await p.updater.check(); await p.updater.install();
  assert.match(p.messages.at(-1), /更新已生效/);
  assert.equal(p.calls.filter(call => call.method === 'POST').length, 1);
});

test('restart-required response is not reported as installed or automatically restarted', async () => {
  const p = fixture({ configured: true, restartRequired: true });
  await p.updater.check(); await p.updater.install();
  assert.equal(p.isInstalled(), false);
  assert.match(p.messages.at(-1), /重启/);
  assert.doesNotMatch(p.messages.at(-1), /更新已生效/);
  assert.equal(p.calls.some(call => /restart|enabled/.test(call.path)), false);
});
