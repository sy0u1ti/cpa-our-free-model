import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const feedback = fs.readFileSync(new URL('../web/eac-feedback.js', import.meta.url), 'utf8');
const bundle = fs.readFileSync(new URL('../service/vendor/ofm/packages/standalone/web/channels-BNNYYkX2.js', import.meta.url), 'utf8');
const adapter = fs.readFileSync(new URL('../console.go', import.meta.url), 'utf8');
const patches = [...adapter.slice(adapter.indexOf('var eacConsolePatches'), adapter.indexOf('func validateConsoleRequest')).matchAll(/\{`([^`]+)`,\s*`([^`]+)`\}/g)]
  .map(([, before, after]) => [before, after]);
// EAC reason hooks (login start, logout, structured start error, the poll
// request's own reason mapping, and the EAC page's pool line) plus two
// backup-import truthfulness hooks: honest wording, and a result summary that is
// not immediately overwritten by the generic "saved" line.
assert.equal(patches.length, 12);
let served = bundle;
for (const [before, after] of patches) served = served.replaceAll(before, after);
assert.ok(!served.includes('导入会合并备份'), 'the merge wording must not survive');
assert.ok(!served.includes('replace("{reason}",G)'), 'polling must not keep its own unreachable fallback');
assert.match(served, /dt!==!0&&ee\("已保存。"\)/, 'the import summary must suppress the generic saved line');
assert.doesNotMatch(served, /se==null\?M\("p",null,se===void 0\?"正在查询资源池…":"资源池暂时无法查询/,
  'the EAC page must surface the pool reason instead of a hardcoded fallback');

// The pinned login factory is a closure over its own state helpers. These stubs
// mirror just enough of them to drive `login()` and read the notice it sets.
function loginHook(source, failure) {
  const states = [];
  const useState = value => { const index = states.length; states.push(typeof value === 'function' ? value() : value); return [states[index], next => { states[index] = next; }]; };
  // The pinned factory destructures its React helpers by minified name:
  // b=useState, j=useEffect, ve=useMemo, ee=useRef, ae=useCallback.
  const context = {
    window: {}, b: useState, y: useState,
    j() {}, ve: fn => fn(), ee: value => ({ current: value }), ae: fn => fn,
    D: async () => { throw new Error(failure); },
    V: async () => { throw new Error('unused'); },
    dt: () => null, lt: () => null, Ha() {}, Oa: 600000, da: 'ofm.eac.pending:test',
  };
  vm.createContext(context);
  vm.runInContext(feedback, context);
  const start = source.indexOf('function ca({t:n,summary:a,onAuth:t})');
  const end = source.indexOf('function ma(n){');
  if (start < 0 || end < 0) throw new Error('pinned EAC login factory not found');
  const hook = source.slice(start, end);
  vm.runInContext(hook + ';this.login=ca({t:key=>key==="eac.startFailed"?"Unable to start ({reason})":key,summary:{},onAuth(){}}).login;', context);
  // `ca()` allocates [busy, notice, pending, copied]; the notice is slot 1.
  return { run: context.login, notice: () => states[1], feedback: context.window.ofmEacFeedback };
}

test('regression: original pinned UI converts no-lane to unreachable, served UI preserves the actual cause', async () => {
  const before = loginHook(bundle, 'no-lane');
  await before.run();
  assert.equal(before.notice(), 'Unable to start (unreachable)');
  const after = loginHook(served, 'no-lane');
  await after.run();
  assert.match(after.notice(), /渠道尚未准备好/);
  assert.doesNotMatch(after.notice(), /unreachable|网关暂不可达/);
});

test('EAC source preparation, disabled state and real gateway failures have different user-facing reasons', async () => {
  for (const [error, expected] of [
    ['eac-disabled', /来源未启用/], ['eac-loading', /正在准备/], ['eac-source-failed', /来源加载失败/],
    ['eac-unavailable', /没有可用渠道/], ['unreachable', /授权网关暂不可达/], ['not-writable', /无法写入 CPA 私有数据目录/],
    ['gateway-http-503', /HTTP 503/], ['malformed', /数据格式异常/],
  ]) {
    const hook = loginHook(served, error);
    await hook.run();
    assert.match(hook.notice(), expected);
  }
});

test('unknown EAC error details cannot expose upstream secrets or be mislabeled as network failures', () => {
  const hook = loginHook(served, '');
  const message = hook.feedback.reason(new Error('fixture-private-token should not be shown'));
  assert.doesNotMatch(message, /fixture-private-token|unreachable|网关暂不可达/);
  assert.match(message, /尚不能判定/);
});

test('EAC page starts in a loading state instead of presenting stale summary authorization', () => {
  assert.match(served, /function Ln\(\{summary:Y\}\)\{const\[\$,Z\]=G\.useState\(void 0\)/);
  assert.doesNotMatch(served, /function Ln\(\{summary:Y\}\)\{const\[\$,Z\]=G\.useState\(Y\.eacAuth\)/);
});
