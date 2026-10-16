import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import crypto from 'node:crypto';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { patchOriginal } from '../scripts/upstream-patches.mjs';

test('vendored OFM has the original repository as its sole source and explicit CPA patches', () => {
  const root = new URL('../service/vendor/ofm/', import.meta.url);
  const manifest = JSON.parse(fs.readFileSync(new URL('UPSTREAM.json', root)));
  assert.equal(manifest.repository, 'https://github.com/Ebony-Vinyl/dsh-our-free-model');
  assert.equal(manifest.schema, 'cpa-ofm-original-source/v1');
  assert.equal(manifest.commit, 'e937077fa92d8cc21d3108d5d1e1f32f37e2534e');
  for (const file of manifest.files) {
    const bytes = fs.readFileSync(new URL(file.path, root));
    assert.equal(crypto.createHash('sha256').update(bytes).digest('hex'), file.sha256, file.path);
    if (!file.patch) assert.equal(file.sha256, file.originalSha256, file.path);
  }
  assert.equal(manifest.patches.length, 2);
  for (const name of ['vault.js', 'vault-data.js', 'vault-anchor.js']) assert.equal(fs.existsSync(new URL('src/' + name, root)), false);
  // Service entry points, the UI bundle and the seal loader must stay byte-identical:
  // CPA patches only the vendor's channel and EAC entry files.
  for (const path of ['packages/standalone/service.mjs', 'packages/standalone/web/app.js', 'packages/standalone/web/channels-BNNYYkX2.js']) {
    const file = manifest.files.find(row => row.path === path);
    assert.equal(file.sha256, file.originalSha256, path);
  }
  const business = fs.readFileSync(new URL('packages/standalone/channels/business.mjs', root), 'utf8');
  assert.match(business, /var GEMINI_DEFAULT_CLIENT_ID = "";/);
  assert.match(business, /var GEMINI_DEFAULT_CLIENT_SECRET = "";/);
  assert.match(business, /var LOOMY_WECHAT_APP_ID = process.env.OFM_LOOMY_WECHAT_APP_ID \?\? "";/);
});

const workspace = fileURLToPath(new URL('../', import.meta.url));
const checkout = path.join(workspace, '.reference/ofm');
test('audit each retained byte directly against original Git blobs plus CPA patches', { skip: !fs.existsSync(path.join(checkout, '.git')) }, () => {
  const root = path.join(workspace, 'service/vendor/ofm');
  const manifest = JSON.parse(fs.readFileSync(path.join(root, 'UPSTREAM.json')));
  for (const file of manifest.files) {
    const original = execFileSync('git', ['-C', checkout, 'show', `${manifest.commit}:${file.path}`], { maxBuffer: 24 * 1024 * 1024, windowsHide: true });
    assert.equal(crypto.createHash('sha256').update(original).digest('hex'), file.originalSha256, file.path);
    assert.deepEqual(fs.readFileSync(path.join(root, file.path)), patchOriginal(file.path, original), file.path);
  }
});
