import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { parseUpdateArgs, validRemote, installBinary, digest, nativeTarget } from '../scripts/update-lib.mjs';
import { privateTestDirectory, removeTestDirectory } from './helpers.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
test('updater accepts only explicit apply targets and the intended repository', () => {
  assert.equal(parseUpdateArgs([]).action, 'check');
  assert.throws(() => parseUpdateArgs(['--apply']), /plugin-dir/);
  assert.throws(() => parseUpdateArgs(['--apply', '--plugin-dir', 'relative']), /绝对路径/);
  assert.throws(() => parseUpdateArgs(['--apply', '--check']), /一个/);
  assert.ok(validRemote('https://github.com/sy0u1ti/cpa-our-free-model.git'));
  assert.ok(validRemote('git@github.com:sy0u1ti/cpa-our-free-model.git'));
  assert.equal(validRemote('https://github.com/another/repo.git'), false);
  assert.equal(validRemote('https://github.com/sy0u1ti/cpa-our-free-model.git?token=secret'), false);
});

test('installer backs up existing files and atomically installs without editing config or account data', t => {
  const directory = privateTestDirectory(root, 'update');
  t.after(() => removeTestDirectory(directory, root));
  const pluginDir = path.join(directory, 'plugins with spaces');
  const target = nativeTarget();
  const targetDir = path.join(pluginDir, target.goos, target.goarch);
  fs.mkdirSync(targetDir, { recursive: true });
  const previous = path.join(targetDir, `our-free-model-v0.3.0.${target.extension}`);
  const before = Buffer.alloc(2048, 1), after = Buffer.alloc(4096, 2);
  fs.writeFileSync(previous, before);
  fs.writeFileSync(path.join(pluginDir, 'config.yaml'), 'keep: true');
  const binary = path.join(directory, 'new-library'); fs.writeFileSync(binary, after);
  const result = installBinary({ pluginDir, binary, version: '0.3.0', commit: 'a'.repeat(40), target });
  assert.deepEqual(fs.readFileSync(result.destination), after);
  assert.equal(fs.readFileSync(path.join(pluginDir, 'config.yaml'), 'utf8'), 'keep: true');
  const manifest = JSON.parse(fs.readFileSync(path.join(result.backup, 'manifest.json')));
  assert.equal(manifest.previous.length, 1);
  assert.equal(manifest.previous[0].sha256, digest(before));
  assert.deepEqual(fs.readFileSync(path.join(result.backup, manifest.previous[0].backup)), before);
  assert.equal(installBinary({ pluginDir, binary, version: '0.3.0', target }).unchanged, true);
  assert.throws(() => installBinary({ pluginDir, binary, version: '0.2.0', target }), /拒绝降级/);
  assert.deepEqual(fs.readFileSync(previous), after);
});

test('updater refuses a dirty clone before fetching or changing files', t => {
  const directory = privateTestDirectory(root, 'update-dirty');
  t.after(() => removeTestDirectory(directory, root));
  fs.mkdirSync(path.join(directory, 'scripts'));
  for (const name of ['update.mjs', 'update-lib.mjs']) fs.copyFileSync(path.join(root, 'scripts', name), path.join(directory, 'scripts', name));
  const git = args => {
    const result = spawnSync('git', args, { cwd: directory, encoding: 'utf8', windowsHide: true });
    assert.equal(result.status, 0, result.stderr);
  };
  git(['init', '--initial-branch=main']);
  git(['remote', 'add', 'origin', 'https://github.com/sy0u1ti/cpa-our-free-model.git']);
  fs.writeFileSync(path.join(directory, 'private-note.txt'), 'do not change');
  const result = spawnSync(process.execPath, ['scripts/update.mjs', '--check'], { cwd: directory, encoding: 'utf8', windowsHide: true });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /未提交修改/);
  assert.equal(fs.readFileSync(path.join(directory, 'private-note.txt'), 'utf8'), 'do not change');
  assert.equal(fs.existsSync(path.join(directory, '.git/FETCH_HEAD')), false);
});
