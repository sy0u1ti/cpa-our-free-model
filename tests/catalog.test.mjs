import test from 'node:test';
import assert from 'node:assert/strict';
import { modelRows, normalizeBody, admitModel } from '../service/src/catalog.mjs';

const service = () => ({ runtime: {
  state: () => ({ settings: { enabled: true } }),
  publicModelRows: () => [{ id: 'free' }],
  catalog: [{ id: 'free', name: 'Free', reasoning: true, vision: true, maxOutput: 16384, contextWindow: 128000 }, { id: 'hidden' }],
}, channels: { handles: id => id.startsWith('buddy/') } });

test('catalog preserves real capabilities and filters unadvertised rows', () => {
  const rows = modelRows(service());
  assert.equal(rows.length, 1);
  assert.deepEqual(rows[0].efforts, ['light', 'balanced', 'deep']);
  assert.deepEqual(rows[0].input, ['text', 'image']);
  assert.equal(rows[0].context_window, 128000);
  const disabled = service();
  disabled.runtime.state = () => ({ settings: { enabled: false } });
  assert.deepEqual(modelRows(disabled), []);
});

test('canonical effort maps onto real OFM budgets without inventing off', () => {
  const [row] = modelRows(service());
  const body = { model: 'wrong', messages: [], max_completion_tokens: 4096, reasoning_effort: 'high', tools: [{ type: 'function' }] };
  const mapped = normalizeBody(body, row);
  assert.equal(mapped.model, 'free');
  assert.equal(mapped.max_tokens, 4096);
  assert.equal(mapped.reasoning_effort, 'deep');
  assert.equal(body.reasoning_effort, 'high');
  assert.equal(normalizeBody(body, row, 'light').reasoning_effort, 'light');
  assert.throws(() => normalizeBody({ reasoning_effort: 'none' }, row), /Unsupported/);
  const native = { id: 'kilo/free', efforts: ['off', 'low', 'medium', 'high'] };
  assert.equal(normalizeBody({ reasoning: { effort: 'none' } }, native).reasoning_effort, 'off');
  assert.equal(normalizeBody({ reasoning_effort: 'high' }, native).reasoning_effort, 'high');
});

test('admission checks current account and disabled-model state, not stale catalog', async () => {
  const current = service();
  let enabled = true;
  let disabled = false;
  current.channels.rpc = async ({ method }) => ({ ok: true, value: method === 'model.list'
    ? { models: [{ id: 'model', disabled }] } : { accounts: [{ enabled }] } });
  assert.equal(await admitModel(current, 'free'), true);
  assert.equal(await admitModel(current, 'hidden'), false);
  assert.equal(await admitModel(current, 'buddy/model'), true);
  enabled = false;
  assert.equal(await admitModel(current, 'buddy/model'), false);
  enabled = true; disabled = true;
  assert.equal(await admitModel(current, 'buddy/model'), false);
});
