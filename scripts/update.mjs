import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { installBinary, nativeTarget, parseUpdateArgs, repository, validRemote } from './update-lib.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
function run(binary, args, capture = false) {
  const result = spawnSync(binary, args, { cwd: root, encoding: 'utf8', windowsHide: true, stdio: capture ? 'pipe' : 'inherit' });
  if (result.error || result.status !== 0) throw new Error(`${path.basename(binary)} ${args[0]} 执行失败；未继续安装。`);
  return (result.stdout ?? '').trim();
}
const git = (...args) => run('git', args, true);

try {
  const options = parseUpdateArgs(process.argv.slice(2));
  if (options.help) {
    console.log('检查：node scripts/update.mjs --check\n更新：node scripts/update.mjs --apply --plugin-dir /absolute/path/to/CPA/plugins\n只支持干净的 main 分支；不会改 CPA 配置、账号数据或自动重启服务。');
  } else {
    const repoRoot = fs.realpathSync(git('rev-parse', '--show-toplevel'));
    if (repoRoot !== fs.realpathSync(root)) throw new Error('请在完整克隆的插件仓库中运行更新，不支持单独复制的脚本或 ZIP 源码。');
    if (!validRemote(git('remote', 'get-url', 'origin'))) throw new Error('origin 不是官方插件源码仓库：' + repository);
    if (git('branch', '--show-current') !== 'main') throw new Error('当前不是 main 分支；为避免覆盖开发工作，已停止。');
    if (git('status', '--porcelain', '--untracked-files=normal')) throw new Error('工作区有未提交修改或未跟踪文件；请先自行保存处理，更新不会覆盖它们。');
    if (options.action === 'check') {
      const remote = git('ls-remote', '--exit-code', 'origin', 'refs/heads/main').split(/\s+/)[0];
      if (!/^[a-f0-9]{40}$/.test(remote)) throw new Error('无法取得 main 分支提交。');
      console.log(remote === git('rev-parse', 'HEAD') ? '本地源码与远端 main 一致。' : '仓库有新提交。运行 --apply 并指定 --plugin-dir 即可更新。');
      console.log('远端提交：' + remote);
    } else if (options.action === 'apply') {
      const target = nativeTarget();
      if (process.env.GOOS && process.env.GOOS !== target.goos || process.env.GOARCH && process.env.GOARCH !== target.goarch) throw new Error('更新必须使用本机平台，不能继承跨编译的 GOOS/GOARCH。');
      run('git', ['fetch', 'origin', 'refs/heads/main:refs/remotes/origin/main']);
      const revision = git('rev-parse', 'refs/remotes/origin/main');
      try { git('merge-base', '--is-ancestor', 'HEAD', revision); }
      catch { throw new Error('本地 main 与远端已分叉或有未推送提交；只允许快进更新，请先自行处理。'); }
      run('git', ['merge', '--ff-only', revision]);
      // Restart from the new, fixed source so the updater and build rules match.
      run(process.execPath, [path.join(root, 'scripts/update.mjs'), '--install-current', '--commit', revision, '--plugin-dir', options.pluginDir]);
    } else {
      if (git('rev-parse', 'HEAD') !== options.commit) throw new Error('源码提交发生变化，已停止安装。');
      run(process.execPath, ['scripts/check.mjs']);
      const tests = fs.readdirSync(path.join(root, 'tests')).filter(file => file.endsWith('.test.mjs')).map(file => path.join('tests', file));
      run(process.execPath, ['--test', ...tests]);
      const go = process.env.GO_BIN || 'go';
      run(go, ['test', './...']);
      run(process.execPath, ['scripts/build.mjs']);
      if (git('rev-parse', 'HEAD') !== options.commit || git('status', '--porcelain', '--untracked-files=normal')) throw new Error('构建期间源码发生变化，未安装。');
      const version = JSON.parse(fs.readFileSync(path.join(root, 'package.json'))).version;
      const target = nativeTarget();
      const binary = path.join(root, 'dist', target.goos, target.goarch, `our-free-model-v${version}.${target.extension}`);
      const result = installBinary({ pluginDir: options.pluginDir, binary, version, commit: options.commit, target });
      console.log(result.unchanged ? '已安装相同构建，无需替换。' : `已安装 ${version}：${result.destination}\n旧插件备份：${result.backup}`);
      console.log('未修改 CPA 配置或账号数据。请现在通过原来的服务管理方式重启 CPA，完成更新。');
    }
  }
} catch (error) {
  console.error('更新未完成：' + error.message);
  process.exitCode = 1;
}
