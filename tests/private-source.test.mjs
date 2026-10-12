import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { configureEac, eacDiagnostic, originalCredential, warmupEac } from '../service/src/eac-provider.mjs';
import { privateTestDirectory, removeTestDirectory } from './helpers.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
test('private original-source loading is opt-in and rejects tampered bytes before import', async t => {
  const directory = privateTestDirectory(root, 'source');
  t.after(() => removeTestDirectory(directory, root));
  let requests = 0;
  const fetcher = async () => { requests++; return new Response('not the pinned original module'); };
  await configureEac({ dataDir: directory, autoInstallEac: false }, { fetch: fetcher });
  await warmupEac();
  assert.equal(requests, 0);
  assert.equal(originalCredential(), null);
  assert.equal(eacDiagnostic().state, 'disabled');
  await configureEac({ dataDir: directory, autoInstallEac: true }, { fetch: fetcher });
  assert.equal(requests, 1);
  assert.equal(originalCredential(), null);
  assert.equal(eacDiagnostic().state, 'failed');
  assert.deepEqual(fs.readdirSync(path.join(directory, 'runtime')), []);
});

test('first console warmup retries a failed opt-in source only once, including concurrent opens', async t => {
  const directory = privateTestDirectory(root, 'source-warmup');
  t.after(() => removeTestDirectory(directory, root));
  let requests = 0;
  const fetcher = async () => { requests++; return new Response('not a pinned source'); };
  await configureEac({ dataDir: directory, autoInstallEac: true }, { fetch: fetcher });
  assert.equal(requests, 1);
  assert.equal(eacDiagnostic().state, 'failed');
  const outcomes = await Promise.all([warmupEac(), warmupEac(), warmupEac()]);
  assert.equal(requests, 2);
  assert.ok(outcomes.every(value => value.state === 'failed'));
  await warmupEac();
  assert.equal(requests, 2);
  assert.equal(originalCredential(), null);
  assert.deepEqual(fs.readdirSync(path.join(directory, 'runtime')), []);
});

test('cold EAC preparation is awaited and a ready source is not initialized again', async t => {
  const directory = privateTestDirectory(root, 'source-cold');
  t.after(() => removeTestDirectory(directory, root));
  fs.mkdirSync(path.join(directory, 'src'));
  fs.writeFileSync(path.join(directory, 'package.json'), '{"type":"module"}');
  const marker = path.join(directory, 'loaded');
  fs.writeFileSync(path.join(directory, 'src/vault.js'),
    `import fs from 'node:fs'; fs.appendFileSync(${JSON.stringify(marker)}, 'loaded\\n'); export const openSeal=()=>({base:'https://eac-fixture.invalid/v1',mode:'worker',signingSecret:'fixture-only-not-a-secret-000000000000'});`);
  const prepared = configureEac({ dataDir: directory, eacSourceDir: directory, autoInstallEac: true });
  const states = await Promise.all([warmupEac(), warmupEac(), prepared.then(() => eacDiagnostic())]);
  assert.ok(states.every(value => value.state === 'ready'));
  await warmupEac();
  assert.equal(fs.readFileSync(marker, 'utf8'), 'loaded\n');
  assert.equal(fs.existsSync(path.join(directory, 'eac-user.json')), false);
});

test('first console warmup can recover a source that became available after startup', async t => {
  const directory = privateTestDirectory(root, 'source-recovered');
  t.after(() => removeTestDirectory(directory, root));
  await configureEac({ dataDir: directory, eacSourceDir: directory });
  assert.equal(eacDiagnostic().state, 'failed');
  fs.mkdirSync(path.join(directory, 'src'));
  fs.writeFileSync(path.join(directory, 'package.json'), '{"type":"module"}');
  fs.writeFileSync(path.join(directory, 'src/vault.js'),
    `export const openSeal=()=>({base:'https://eac-fixture.invalid/v1',mode:'worker',signingSecret:'fixture-only-not-a-secret-000000000000'});`);
  assert.equal((await warmupEac()).state, 'ready');
  assert.equal(originalCredential().mode, 'worker');
  assert.equal(fs.existsSync(path.join(directory, 'eac-user.json')), false);
});

test('selected local module errors cannot disclose credentials in diagnostics', async t => {
  const directory = privateTestDirectory(root, 'source-error');
  t.after(() => removeTestDirectory(directory, root));
  fs.mkdirSync(path.join(directory, 'src'));
  fs.writeFileSync(path.join(directory, 'package.json'), '{"type":"module"}');
  fs.writeFileSync(path.join(directory, 'src/vault.js'), 'throw new Error("DO_NOT_DISCLOSE_FIXTURE");');
  await configureEac({ dataDir: directory, eacSourceDir: directory, autoInstallEac: false });
  assert.equal(originalCredential(), null);
  assert.equal(eacDiagnostic().state, 'failed');
  assert.ok(!JSON.stringify(eacDiagnostic()).includes('DO_NOT_DISCLOSE_FIXTURE'));
});
