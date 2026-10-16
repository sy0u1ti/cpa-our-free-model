import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { PATCHES, patchOriginal } from './upstream-patches.mjs';

export const ORIGINAL_REPOSITORY = 'https://github.com/Ebony-Vinyl/dsh-our-free-model';
export const ORIGINAL_COMMIT = 'e937077fa92d8cc21d3108d5d1e1f32f37e2534e';
const root = fileURLToPath(new URL('../', import.meta.url));
const checkout = path.resolve(process.argv[2] || path.join(root, '.reference/ofm'));
const destination = path.join(root, 'service/vendor/ofm');
const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const git = args => execFileSync('git', ['-C', checkout, ...args], { maxBuffer: 24 * 1024 * 1024, windowsHide: true });
const resolved = git(['rev-parse', ORIGINAL_COMMIT + '^{commit}']).toString().trim();
if (resolved !== ORIGINAL_COMMIT) throw new Error('Original OFM revision does not resolve');
const tree = git(['ls-tree', '-r', '--name-only', ORIGINAL_COMMIT]).toString().trim().split(/\r?\n/);
// The private seal is never vendored: it is loaded only from a verified cache
// or an explicit trusted local source at runtime.
const withheld = new Set(['src/vault.js', 'src/vault-data.js', 'src/vault-anchor.js']);
const webAssets = JSON.parse(git(['show', `${ORIGINAL_COMMIT}:packages/standalone/web/assets.json`]).toString('utf8'));
const selected = [
  'LICENSE', 'package.json', 'scripts/standalone-third-party.txt', 'packages/standalone/README.md',
  ...['package.json', 'cli.mjs', 'service.mjs', 'management.mjs', 'login-terminal.mjs', 'eac.mjs'].map(file => 'packages/standalone/' + file),
  ...['business', 'contracts', 'credentials', 'images', 'runtime', 'worker'].map(file => `packages/standalone/channels/${file}.mjs`),
  // Only the files the served index.html and assets.json actually reference:
  // the original repo keeps superseded bundles around, and shipping dead code
  // in a security-sensitive vendored tree is not worth the few saved bytes.
  'packages/standalone/web/index.html', 'packages/standalone/web/assets.json',
  ...webAssets.map(file => `packages/standalone/web/${file}`),
  // Everything under src/ except the seal, so a new upstream module cannot be
  // missed by an allow-list that silently forgets to name it.
  ...tree.filter(file => /^src\/.*\.(js|json)$/.test(file) && !withheld.has(file)),
  'vendor/channel-pack/qoder-auth-wasm.wasm', 'vendor/channel-pack/LICENSE', 'vendor/channel-pack/NOTICE.md',
].sort();
if (new Set(selected).size !== selected.length) throw new Error('Duplicate entry in the vendored file list');
const manifest = { schema: 'cpa-ofm-original-source/v1', repository: ORIGINAL_REPOSITORY, commit: ORIGINAL_COMMIT,
  method: 'git show <original-commit>:<path>; no working-tree bytes and no secondary fork',
  files: [], patches: Object.entries(PATCHES).map(([file, patch]) => ({ file, id: patch.id, reason: patch.reason })), omitted: [] };
fs.mkdirSync(destination, { recursive: true });
for (const file of selected) {
  if (!tree.includes(file)) throw new Error('Missing original OFM file: ' + file);
  const original = git(['show', `${ORIGINAL_COMMIT}:${file}`]);
  const result = patchOriginal(file, original);
  const target = path.join(destination, file);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, result);
  manifest.files.push({ path: file, gitBlob: git(['rev-parse', `${ORIGINAL_COMMIT}:${file}`]).toString().trim(),
    originalSha256: hash(original), sha256: hash(result), ...(PATCHES[file] ? { patch: PATCHES[file].id } : {}) });
}
const privateFiles = ['src/vault.js', 'src/vault-data.js', 'src/vault-anchor.js', 'LICENSE'].map(file => {
  const bytes = git(['show', `${ORIGINAL_COMMIT}:${file}`]);
  return { path: file, sha256: hash(bytes), bytes: bytes.length };
});
for (const file of privateFiles.filter(file => file.path !== 'LICENSE')) {
  manifest.omitted.push({ ...file, reason: 'Optional original EAC source is loaded only from a verified private cache or an explicit trusted local source.' });
}
// Remove only regular files left by a previous generated snapshot, never user data.
const keep = new Set([...selected, 'UPSTREAM.json']);
for (const relative of fs.readdirSync(destination, { recursive: true })) {
  const target = path.join(destination, relative);
  const stat = fs.lstatSync(target);
  if (stat.isSymbolicLink()) throw new Error('Unexpected symlink inside vendor output');
  if (stat.isFile() && !keep.has(relative.split(path.sep).join('/'))) fs.unlinkSync(target);
}
fs.writeFileSync(path.join(destination, 'UPSTREAM.json'), JSON.stringify(manifest, null, 2) + '\n');
fs.writeFileSync(path.join(root, 'service/upstream-eac.json'), JSON.stringify({ repository: ORIGINAL_REPOSITORY, commit: ORIGINAL_COMMIT, files: privateFiles }, null, 2) + '\n');
console.log(`Imported ${selected.length} files directly from original OFM ${ORIGINAL_COMMIT}; ${Object.keys(PATCHES).length} explicit CPA-only patches.`);
