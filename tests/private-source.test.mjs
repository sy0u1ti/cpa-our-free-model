import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { configureEac, eacDiagnostic, originalCredential } from '../service/src/eac-provider.mjs';
import { privateTestDirectory, removeTestDirectory } from './helpers.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
test('private original-source loading is opt-in and rejects tampered bytes before import', async t => {
  const directory = privateTestDirectory(root, 'source');
  t.after(() => removeTestDirectory(directory, root));
  let requests = 0;
  const fetcher = async () => { requests++; return new Response('not the pinned original module'); };
  await configureEac({ dataDir: directory, autoInstallEac: false }, { fetch: fetcher });
  assert.equal(requests, 0);
  assert.equal(originalCredential(), null);
  assert.equal(eacDiagnostic().state, 'disabled');
  await configureEac({ dataDir: directory, autoInstallEac: true }, { fetch: fetcher });
  assert.equal(requests, 1);
  assert.equal(originalCredential(), null);
  assert.equal(eacDiagnostic().state, 'failed');
  assert.deepEqual(fs.readdirSync(path.join(directory, 'runtime')), []);
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
