import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { releaseChecksums } from '../scripts/release-checksums.mjs';
import { privateTestDirectory, removeTestDirectory } from './helpers.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
test('release registry uses the fixed plugin ID and repository without stale version fallback', () => {
  const registry = JSON.parse(fs.readFileSync(path.join(root, 'registry.json')));
  assert.equal(registry.schema_version, 1);
  assert.equal(registry.plugins.length, 1);
  assert.equal(registry.plugins[0].id, 'our-free-model');
  assert.equal(registry.plugins[0].repository, 'https://github.com/sy0u1ti/cpa-our-free-model');
  assert.equal(registry.plugins[0].install.type, 'github-release');
  assert.equal(registry.plugins[0].version, undefined);
});

test('checksums include only CPA-compatible archives for the exact release version', t => {
  const directory = privateTestDirectory(root, 'checksums');
  t.after(() => removeTestDirectory(directory, root));
  const bytes = Buffer.alloc(2048, 1);
  const current = 'our-free-model_0.4.0_windows_amd64.zip';
  for (const file of [current, 'our-free-model_0.3.0_windows_amd64.zip', 'other.zip']) fs.writeFileSync(path.join(directory, file), bytes);
  assert.equal(releaseChecksums(directory, '0.4.0'), crypto.createHash('sha256').update(bytes).digest('hex') + '  ' + current + '\n');
  assert.throws(() => releaseChecksums(directory, '0.5.0'), /No native/);
  assert.throws(() => releaseChecksums(directory, '../0.4.0'), /Invalid/);
});
