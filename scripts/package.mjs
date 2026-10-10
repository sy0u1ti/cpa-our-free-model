import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const version = JSON.parse(fs.readFileSync(path.join(root, 'package.json'))).version;
const platform = process.argv[2] || (process.platform === 'win32' ? 'windows' : process.platform);
const arch = process.argv[3] || (process.arch === 'x64' ? 'amd64' : process.arch);
if (!['windows', 'linux', 'darwin'].includes(platform) || !['amd64', 'arm64'].includes(arch)) throw new Error('Unsupported package target');
const extension = { windows: 'dll', linux: 'so', darwin: 'dylib' }[platform];
const binary = path.join(root, 'dist', platform, arch, `our-free-model-v${version}.${extension}`);
if (!fs.existsSync(binary)) throw new Error('Build the target binary first.');
const stage = fs.mkdtempSync(path.join(root, 'dist', '.package-'));
try {
  fs.copyFileSync(binary, path.join(stage, path.basename(binary)));
  for (const name of ['README.md', 'README_CN.md', 'NOTICE.md', 'LICENSE', 'VALIDATION.md', 'config.example.yaml']) fs.copyFileSync(path.join(root, name), path.join(stage, name));
  fs.mkdirSync(path.join(stage, 'licenses'));
  for (const [from, to] of [
    ['service/vendor/ofm/LICENSE', 'OFM_LICENSE'], ['service/vendor/CPA_LICENSE', 'CPA_LICENSE'],
    ['service/vendor/ofm/scripts/standalone-third-party.txt', 'OFM_THIRD_PARTY_NOTICES.txt'],
    ['service/vendor/ofm/vendor/channel-pack/LICENSE', 'CHANNEL_LICENSE'],
    ['service/vendor/ofm/vendor/channel-pack/NOTICE.md', 'CHANNEL_NOTICE.md'],
    ['service/vendor/YAML_LICENSE', 'YAML_LICENSE'],
    ['service/vendor/WEB_LICENSES.txt', 'WEB_LICENSES.txt'],
    ['service/vendor/WEB_LICENSE_SOURCES.json', 'WEB_LICENSE_SOURCES.json'],
  ]) fs.copyFileSync(path.join(root, from), path.join(stage, 'licenses', to));
  fs.copyFileSync(path.join(root, 'service/vendor/ofm/UPSTREAM.json'), path.join(stage, 'UPSTREAM.json'));
  const digest = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
  const files = fs.readdirSync(stage, { recursive: true }).filter(file => fs.statSync(path.join(stage, file)).isFile())
    .map(file => ({ path: file.split(path.sep).join('/'), sha256: digest(fs.readFileSync(path.join(stage, file))) }));
  fs.writeFileSync(path.join(stage, 'PACKAGE.json'), JSON.stringify({ version, platform, arch,
    upstream: JSON.parse(fs.readFileSync(path.join(root, 'service/vendor/ofm/UPSTREAM.json'))).commit,
    files }, null, 2) + '\n');
  const archive = path.join(root, 'dist', `our-free-model-v${version}-${platform}-${arch}.zip`);
  if (process.platform === 'win32') {
    const cmd = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command',
      'Compress-Archive -Path (Join-Path $env:OFM_PACKAGE_STAGE "*") -DestinationPath $env:OFM_PACKAGE_ARCHIVE -Force'],
      { windowsHide: true, stdio: 'inherit', env: { ...process.env, OFM_PACKAGE_STAGE: stage, OFM_PACKAGE_ARCHIVE: archive } });
    if (cmd.status !== 0) throw new Error('Archive failed');
  } else {
    const cmd = spawnSync('zip', ['-r', archive, '.'], { cwd: stage, stdio: 'inherit' });
    if (cmd.status !== 0) throw new Error('Install zip to package releases');
  }
  fs.writeFileSync(archive + '.sha256', crypto.createHash('sha256').update(fs.readFileSync(archive)).digest('hex') + '  ' + path.basename(archive) + '\n');
  console.log(archive);
} finally {
  const parent = path.resolve(root, 'dist') + path.sep;
  if (!path.resolve(stage).startsWith(parent)) throw new Error('Refusing unsafe stage cleanup');
  fs.rmSync(stage, { recursive: true, force: true });
}
