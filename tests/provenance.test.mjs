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
  assert.equal(manifest.commit, 'f8974369c5904858c696b520d8b9b82ad4425f78');
  for (const file of manifest.files) {
    const bytes = fs.readFileSync(new URL(file.path, root));
    assert.equal(crypto.createHash('sha256').update(bytes).digest('hex'), file.sha256, file.path);
    if (!file.patch) assert.equal(file.sha256, file.originalSha256, file.path);
  }
  assert.equal(manifest.patches.length, 2);
  for (const name of ['vault.js', 'vault-data.js', 'vault-anchor.js']) assert.equal(fs.existsSync(new URL('src/' + name, root)), false);
  const standalone = manifest.files.find(file => file.path === 'packages/standalone/service.mjs');
  const ui = manifest.files.find(file => file.path === 'packages/standalone/web/app.js');
  assert.equal(standalone.sha256, standalone.originalSha256);
  assert.equal(ui.sha256, ui.originalSha256);
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
