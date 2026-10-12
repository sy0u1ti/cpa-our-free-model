import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { privateTestDirectory, removeTestDirectory } from './helpers.mjs';

const root = path.resolve(fileURLToPath(new URL('../', import.meta.url)));
const future = () => Date.now() + 6 * 3600_000;

function seed(directory) {
  fs.mkdirSync(path.join(directory, 'channel-pack'), { recursive: true });
  const expiry = future();
  fs.writeFileSync(path.join(directory, 'channel-credentials.json'), JSON.stringify({
    WORKBUDDY_ACCOUNT_TEST1: JSON.stringify({ access_token: 'synthetic-token', refresh_token: 'synthetic-refresh', expires_at: String(expiry), nickname: 'synthetic' }),
  }));
  fs.writeFileSync(path.join(directory, 'channel-pack', 'state.json'), JSON.stringify({
    accounts: [{ id: 'workbuddy-test1', provider: 'workbuddy', nickname: 'synthetic', enabled: true, credentialRef: 'WORKBUDDY_ACCOUNT_TEST1', refreshable: true, expiresAt: expiry, createdAt: Date.now() }],
    disabledModels: {}, loomyPermanentLocked: false, gatewayEnabled: true, providerOrder: [],
  }));
}

test('a WorkBuddy request without a caller-supplied system message still leads with one', { timeout: 120000 }, async t => {
  const directory = privateTestDirectory(root, 'buddy-system-prompt');
  t.after(() => removeTestDirectory(directory, root));
  seed(directory);

  // A gateway stand-in that enforces the Tencent rule the real one applies: the
  // first wire message must be a system entry, otherwise 400 + code 11128.
  const sent = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (input, init = {}) => {
    const url = typeof input === 'string' ? input : input?.url ?? String(input);
    let parsed = null;
    try { parsed = init.body ? JSON.parse(init.body) : null; } catch {}
    if (url.includes('/chat/completions')) {
      const roles = (parsed?.messages ?? []).map(message => message.role);
      sent.push(roles);
      if (roles[0] !== 'system') {
        return new Response(JSON.stringify({ code: 11128, message: 'first message is not system prompt' }),
          { status: 400, headers: { 'content-type': 'application/json' } });
      }
      const frame = value => 'data: ' + JSON.stringify({ id: 'x', object: 'chat.completion.chunk', created: 1, model: parsed.model, ...value }) + '\n\n';
      return new Response(frame({ choices: [{ index: 0, delta: { content: 'gateway-ok' } }] })
        + frame({ choices: [{ index: 0, delta: {}, finish_reason: 'stop' }], usage: { prompt_tokens: 5, completion_tokens: 2, total_tokens: 7 } })
        + 'data: [DONE]\n\n', { status: 200, headers: { 'content-type': 'text/event-stream' } });
    }
    if (url.includes('/v3/config')) return new Response(JSON.stringify({ data: { models: [] } }), { status: 200, headers: { 'content-type': 'application/json' } });
    if (url.includes('myhuaweicloud.com')) {
      return new Response(JSON.stringify({ credentials: { access_key_id: 'x' }, access_token: 'synthetic-token',
        refresh_token: 'synthetic-refresh', expires_at: String(Date.now() + 6 * 3600_000), nickname: 'synthetic' }),
        { status: 200, headers: { 'content-type': 'application/json' } });
    }
    return new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } });
  };
  t.after(() => { globalThis.fetch = realFetch; });

  // Drive the adapter in-process. The production worker thread inherits
  // `execArgv`, which the test runner's own flags make unusable for a preload,
  // and this keeps the assertion on the exact bytes the adapter writes.
  const { apply } = await import('../service/vendor/ofm/packages/standalone/channels/business.mjs');
  const { createCredentials } = await import('../service/vendor/ofm/packages/standalone/channels/credentials.mjs');
  const adapters = new Map();
  const ctx = {
    platform: { channelHome: directory }, credentials: createCredentials(directory),
    logger: { info() {}, warn() {}, error() {} }, attachments: {},
    connection: { fetch: { register() {} } },
    get(name) { return this[name] },
    provide(name, value) { this[name] = value },
    effect() {}, inject(names, body) { return body(this) }, emit() {},
    llm: {
      registerAdapter(providers, adapter) { for (const provider of providers) adapters.set(provider, adapter) },
      listProviders() { return [...adapters.keys()].map(id => ({ id })) },
      async listModels(provider) { return await adapters.get(provider)?.listModels(provider) ?? [] },
      async resolveModel(provider, model, signal) { return adapters.get(provider).resolveModel(provider, model, signal) },
      async resolveModelInfo(provider, model, signal) { return this.resolveModel(provider, model, signal) },
      async *stream(options) {
        const call = await adapters.get(options.provider).prepareCall(options.provider, options.model, options.signal);
        yield* call.stream(options);
      },
    },
  };
  apply(ctx, { disableOpencode: true });

  const rows = await ctx.llm.listModels('workbuddy');
  const model = rows[0]?.id;
  assert.ok(model, 'the seeded account must expose a WorkBuddy model');

  // Exactly what the console's own model test sends: no system message.
  const options = { provider: 'workbuddy', model, messages: [{ role: 'user', content: [{ type: 'text', text: 'Reply with OK.' }], source: { kind: 'user' } }], signal: new AbortController().signal };
  for await (const _chunk of ctx.llm.stream(options)) { /* drain */ }

  assert.ok(sent.length > 0, 'the gateway must have been called');
  for (const roles of sent) assert.equal(roles[0], 'system', 'every WorkBuddy request must open with a system message');
});
