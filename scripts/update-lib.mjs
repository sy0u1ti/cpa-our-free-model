import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

export const repository = 'https://github.com/sy0u1ti/cpa-our-free-model';
export const digest = bytes => crypto.createHash('sha256').update(bytes).digest('hex');

export function validRemote(remote) {
  return ['https://github.com/sy0u1ti/cpa-our-free-model', 'https://github.com/sy0u1ti/cpa-our-free-model.git',
    'git@github.com:sy0u1ti/cpa-our-free-model.git', 'ssh://git@github.com/sy0u1ti/cpa-our-free-model.git'].includes(remote);
}

export function parseUpdateArgs(args) {
  const result = { action: 'check' };
  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    if (arg === '--check' || arg === '--apply' || arg === '--install-current') {
      if (result.explicit) throw new Error('只能指定一个更新操作。');
      result.action = arg.slice(2); result.explicit = true;
    } else if (['--plugin-dir', '--commit'].includes(arg)) {
      const value = args[++index];
      if (!value || value.startsWith('--')) throw new Error(`${arg} 缺少参数。`);
      result[arg === '--plugin-dir' ? 'pluginDir' : 'commit'] = value;
    } else if (arg === '--help') result.help = true;
    else throw new Error('未知参数：' + arg);
  }
  if (result.help) return result;
  if (result.action !== 'check' && (!result.pluginDir || !path.isAbsolute(result.pluginDir))) throw new Error('--plugin-dir 必须指定 CPA 插件目录的绝对路径。');
  if (result.action === 'install-current' && !/^[a-f0-9]{40}$/.test(result.commit ?? '')) throw new Error('内部安装阶段缺少固定提交。');
  return result;
}

export function nativeTarget(platform = process.platform, arch = process.arch) {
  const goos = { win32: 'windows', linux: 'linux', darwin: 'darwin' }[platform];
  const goarch = { x64: 'amd64', arm64: 'arm64' }[arch];
  if (!goos || !goarch) throw new Error('当前平台暂不支持自动安装。');
  return { goos, goarch, extension: { windows: 'dll', linux: 'so', darwin: 'dylib' }[goos] };
}

export function compareVersions(a, b) {
  const left = a.split('.').map(Number), right = b.split('.').map(Number);
  for (let index = 0; index < 3; index++) { if (left[index] !== right[index]) return left[index] < right[index] ? -1 : 1; }
  return 0;
}

function inside(root, target) {
  const relative = path.relative(root, target);
  if (!relative || relative === '..' || relative.startsWith('..' + path.sep) || path.isAbsolute(relative)) throw new Error('拒绝访问插件目录以外的路径。');
  return target;
}

function directory(root, target) {
  const relative = path.relative(root, target);
  let current = root;
  for (const part of relative.split(path.sep).filter(Boolean)) {
    current = inside(root, path.join(current, part));
    if (fs.existsSync(current)) {
      const stat = fs.lstatSync(current);
      if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error('安装目录包含非普通目录或符号链接：' + current);
    } else fs.mkdirSync(current, { mode: 0o700 });
  }
}

export function installBinary({ pluginDir, binary, version, commit, target = nativeTarget() }) {
  if (!path.isAbsolute(pluginDir) || !/^\d+\.\d+\.\d+$/.test(version)) throw new Error('安装目录或版本不合法。');
  if (fs.existsSync(pluginDir) && fs.lstatSync(pluginDir).isSymbolicLink()) throw new Error('请使用真实插件目录，不要使用符号链接。');
  fs.mkdirSync(pluginDir, { recursive: true, mode: 0o700 });
  const root = fs.realpathSync(pluginDir);
  const platformDirectory = inside(root, path.join(root, target.goos, target.goarch));
  directory(root, platformDirectory);
  const installed = [];
  const expression = new RegExp('^our-free-model(?:-v(\\d+\\.\\d+\\.\\d+))?\\.' + target.extension + '$');
  for (const dir of [root, platformDirectory]) {
    for (const name of fs.readdirSync(dir)) {
      const match = expression.exec(name);
      if (!match) continue;
      const file = inside(root, path.join(dir, name));
      if (!fs.lstatSync(file).isFile() || fs.lstatSync(file).isSymbolicLink()) throw new Error('插件文件不是普通文件：' + file);
      if (match[1] && compareVersions(match[1], version) > 0) throw new Error('已安装更高版本，拒绝降级：' + name);
      installed.push(file);
    }
  }
  const bytes = fs.readFileSync(binary);
  if (bytes.length < 1024) throw new Error('构建产物过小，拒绝安装。');
  const filename = `our-free-model-v${version}.${target.extension}`;
  const destination = inside(root, path.join(platformDirectory, filename));
  const hash = digest(bytes);
  if (fs.existsSync(destination) && digest(fs.readFileSync(destination)) === hash) return { destination, unchanged: true, hash };
  const backupRoot = inside(root, path.join(root, '.ofm-backups'));
  directory(root, backupRoot);
  const backup = fs.mkdtempSync(path.join(backupRoot, 'update-'));
  const records = [];
  for (let index = 0; index < installed.length; index++) {
    const contents = fs.readFileSync(installed[index]);
    const name = `${index}-${path.basename(installed[index])}`;
    fs.writeFileSync(path.join(backup, name), contents, { mode: 0o600 });
    records.push({ original: path.relative(root, installed[index]), backup: name, sha256: digest(contents) });
  }
  fs.writeFileSync(path.join(backup, 'manifest.json'), JSON.stringify({ version, commit, destination: path.relative(root, destination), sha256: hash, previous: records }, null, 2) + '\n');
  const temporary = inside(root, path.join(platformDirectory, `.ofm-install-${crypto.randomBytes(12).toString('hex')}.tmp`));
  try {
    fs.writeFileSync(temporary, bytes, { flag: 'wx', mode: 0o755 });
    if (digest(fs.readFileSync(temporary)) !== hash) throw new Error('临时文件校验失败，未替换插件。');
    // Never truncate a loaded library in place. A same-directory rename keeps
    // the old mapped inode intact until CPA restarts. Locked Windows files fail safely.
    fs.renameSync(temporary, destination);
  } finally {
    if (fs.existsSync(temporary)) fs.unlinkSync(inside(root, temporary));
  }
  return { destination, backup, hash, unchanged: false };
}
