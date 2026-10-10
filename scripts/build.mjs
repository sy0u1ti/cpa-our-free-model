import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const ext = { win32: 'dll', darwin: 'dylib' }[process.platform] ?? 'so';
const platform = { win32: 'windows' }[process.platform] ?? process.platform;
const arch = { x64: 'amd64' }[process.arch] ?? process.arch;
const version = JSON.parse(fs.readFileSync(path.join(root, 'package.json'))).version;
const go = process.env.GO_BIN || (fs.existsSync(path.join(root, '.tools/go/bin/go.exe')) ? path.join(root, '.tools/go/bin/go.exe') : 'go');
const env = { ...process.env, CGO_ENABLED: '1' };
if (env.GOOS && env.GOOS !== platform || env.GOARCH && env.GOARCH !== arch) throw new Error('构建脚本仅生成本机平台产物；跨平台构建请显式使用 go build 并选择输出路径。');
const revisionResult = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8', windowsHide: true });
const revision = revisionResult.status === 0 && /^[a-f0-9]{40}$/.test(revisionResult.stdout.trim()) ? revisionResult.stdout.trim() : 'unknown';
const dirtyResult = spawnSync('git', ['status', '--porcelain', '--untracked-files=normal'], { cwd: root, encoding: 'utf8', windowsHide: true });
const dirty = dirtyResult.status === 0 && dirtyResult.stdout.trim() ? 'true' : 'false';
if (process.platform === 'win32' && !env.CC) {
  const tools = path.join(root, '.tools');
  const zig = fs.existsSync(tools) && fs.readdirSync(tools).find(name => name.startsWith('zig-') && fs.existsSync(path.join(tools, name, 'zig.exe')));
  if (zig) env.CC = '"' + path.join(tools, zig, 'zig.exe') + '" cc';
}
const directory = path.join(root, 'dist', platform, arch);
fs.mkdirSync(directory, { recursive: true });
const output = path.join(directory, `our-free-model-v${version}.${ext}`);
const built = spawnSync(go, ['build', '-trimpath', '-buildmode=c-shared', '-ldflags', `-s -w -X main.version=${version} -X main.sourceRevision=${revision} -X main.sourceDirty=${dirty}`, '-o', output, '.'],
  { cwd: root, env, stdio: 'inherit', windowsHide: true });
if (built.error) throw built.error;
if (built.status !== 0) process.exit(built.status ?? 1);
fs.writeFileSync(output + '.sha256', crypto.createHash('sha256').update(fs.readFileSync(output)).digest('hex') + '  ' + path.basename(output) + '\n');
console.log(output);
