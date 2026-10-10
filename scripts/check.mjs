import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const files = [];
for (const directory of ['service', 'scripts', 'tests']) {
  for (const file of fs.readdirSync(path.join(root, directory), { recursive: true })) {
    if (/\.(mjs|js)$/.test(file)) files.push(path.join(root, directory, file));
  }
}
for (const file of files) {
  const check = spawnSync(process.execPath, ['--check', file], { encoding: 'utf8', windowsHide: true });
  if (check.status !== 0) { process.stderr.write(check.stderr); process.exit(1); }
}
console.log(`JavaScript syntax: ${files.length} files passed.`);
