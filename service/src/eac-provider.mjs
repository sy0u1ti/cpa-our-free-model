import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { pathToFileURL } from 'node:url';

const definition = JSON.parse(await fs.readFile(new URL('../upstream-eac.json', import.meta.url), 'utf8'));
let credential = () => null;
let diagnostic = { state: 'disabled', message: 'Optional EAC source is disabled.' };
export const originalCredential = () => credential();
export const eacDiagnostic = () => ({ ...diagnostic });
const digest = bytes => crypto.createHash('sha256').update(bytes).digest('hex');

async function verify(directory) {
  try {
    if ((await fs.lstat(directory)).isSymbolicLink() || (await fs.lstat(path.join(directory, 'src'))).isSymbolicLink()) return false;
    const pkg = JSON.parse(await fs.readFile(path.join(directory, 'package.json'), 'utf8'));
    if (pkg.type !== 'module') return false;
    for (const file of definition.files) {
      const target = path.join(directory, file.path);
      const stat = await fs.lstat(target);
      if (!stat.isFile() || stat.size !== file.bytes || digest(await fs.readFile(target)) !== file.sha256) return false;
    }
    return true;
  } catch { return false; }
}

async function downloadSource(cache, fetcher) {
  const directory = path.join(cache, 'ofm-eac-' + definition.commit);
  if (await verify(directory)) return directory;
  try {
    await fs.access(directory);
    throw new Error('EAC cache integrity failed; remove only this versioned cache while CPA is stopped.');
  } catch (error) { if (error.code !== 'ENOENT') throw error; }
  await fs.mkdir(cache, { recursive: true, mode: 0o700 });
  const stage = await fs.mkdtemp(path.join(cache, '.ofm-eac-'));
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 25000);
  try {
    await fs.mkdir(path.join(stage, 'src'), { mode: 0o700 });
    for (const file of definition.files) {
      const response = await fetcher(`https://raw.githubusercontent.com/Ebony-Vinyl/dsh-our-free-model/${definition.commit}/${file.path}`, {
        redirect: 'error', signal: controller.signal,
      });
      if (!response.ok || !response.body) throw new Error('EAC source download failed');
      const chunks = [];
      let length = 0;
      for await (const chunk of response.body) {
        length += chunk.byteLength;
        if (length > file.bytes) throw new Error('EAC source exceeds its pinned size');
        chunks.push(chunk);
      }
      const bytes = Buffer.concat(chunks);
      if (length !== file.bytes || digest(bytes) !== file.sha256) throw new Error('EAC source checksum mismatch');
      await fs.writeFile(path.join(stage, file.path), bytes, { flag: 'wx', mode: 0o600 });
    }
    await fs.writeFile(path.join(stage, 'package.json'), '{"private":true,"type":"module"}\n', { flag: 'wx', mode: 0o600 });
    if (!await verify(stage)) throw new Error('EAC staged files failed verification');
    try { await fs.rename(stage, directory); }
    catch (error) { if (!await verify(directory)) throw error; }
    return directory;
  } finally {
    clearTimeout(timer); controller.abort();
    const relative = path.relative(path.resolve(cache), path.resolve(stage));
    if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) throw new Error('Unsafe EAC staging path');
    await fs.rm(stage, { recursive: true, force: true });
  }
}

export async function configureEac(settings, dependencies = {}) {
  credential = () => null;
  diagnostic = { state: 'disabled', message: 'Enable auto-install-eac or set a trusted eac-source-dir to use the original EAC authorization flow.' };
  if (!settings.eacSourceDir && settings.autoInstallEac !== true) return;
  const source = settings.eacSourceDir ? 'local' : 'original-download';
  try {
    const directory = settings.eacSourceDir || await downloadSource(path.join(settings.dataDir, 'runtime'), dependencies.fetch || fetch);
    const module = await import(pathToFileURL(path.join(directory, 'src/vault.js')).href);
    if (typeof module.openSeal !== 'function') throw new Error('Original standalone entry missing');
    const lane = module.openSeal();
    if (lane !== null) {
      const url = new URL(lane.base);
      if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash || !url.pathname.endsWith('/v1') ||
          lane.mode !== 'worker' || typeof lane.signingSecret !== 'string' || lane.signingSecret.length < 32) throw new Error('Unsupported EAC lane');
    }
    credential = module.openSeal;
    diagnostic = { state: lane ? 'ready' : 'unavailable', source, commit: definition.commit };
  } catch {
    // Imported source can throw arbitrary text, including secrets. Return only
    // fixed diagnostics; original server login and authorization stay upstream.
    diagnostic = { state: 'failed', source, message: 'Could not load verified original EAC source. Check the selected path, cache integrity or access to raw.githubusercontent.com, then restart the plugin.' };
  }
}
