import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

// License texts come from the exact package versions in the ORIGINAL OFM lock,
// not from the secondary reference repository. No downloaded code is executed.
const root = fileURLToPath(new URL('../', import.meta.url));
const checkout = path.resolve(process.argv[2] || path.join(root, '.reference/ofm'));
const commit = JSON.parse(fs.readFileSync(path.join(root, 'service/vendor/ofm/UPSTREAM.json'))).commit;
const lock = JSON.parse(execFileSync('git', ['-C', checkout, 'show', `${commit}:packages/standalone/package-lock.json`], { maxBuffer: 2 * 1024 * 1024, windowsHide: true }));
const packages = ['react', 'react-dom', 'scheduler', '@radix-ui/react-slot', '@radix-ui/react-compose-refs',
  '@tanstack/react-virtual', '@tanstack/virtual-core', 'lucide-react', 'clsx', 'tailwind-merge', 'tailwindcss'];
let text = 'Web dependency licenses for the original OFM standalone UI\nOriginal lock commit: ' + commit + '\n';
const sources = [];
for (const name of packages) {
  const row = lock.packages['node_modules/' + name];
  if (!row?.version) throw new Error('Missing original lock entry: ' + name);
  let found;
  for (const file of ['LICENSE', 'LICENSE.txt', 'LICENSE.md', 'license', 'license.txt']) {
    const url = `https://cdn.jsdelivr.net/npm/${name}@${row.version}/${file}`;
    const response = await fetch(url, { signal: AbortSignal.timeout(20000), redirect: 'error' });
    if (response.ok) { found = { url, bytes: Buffer.from(await response.arrayBuffer()) }; break; }
  }
  if (!found || found.bytes.length < 500 || found.bytes.length > 40000) throw new Error('Missing or invalid license: ' + name);
  sources.push({ package: name, version: row.version, url: found.url, sha256: crypto.createHash('sha256').update(found.bytes).digest('hex') });
  text += `\n${'='.repeat(72)}\n${name} ${row.version}\n${found.url}\n\n${found.bytes.toString('utf8')}\n`;
}
fs.writeFileSync(path.join(root, 'service/vendor/WEB_LICENSES.txt'), text.trimEnd() + '\n');
fs.writeFileSync(path.join(root, 'service/vendor/WEB_LICENSE_SOURCES.json'), JSON.stringify({ originalCommit: commit, sources }, null, 2) + '\n');
console.log(`Recorded ${sources.length} web package licenses from versions pinned by the original project.`);
