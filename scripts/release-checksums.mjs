import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

export function releaseChecksums(directory, version) {
  if (!/^\d+\.\d+\.\d+$/.test(version)) throw new Error('Invalid release version');
  const escapedVersion = version.replaceAll('.', '\\.');
  const expression = new RegExp(`^our-free-model_${escapedVersion}_(windows|linux|darwin)_(amd64|arm64)\\.zip$`);
  const files = fs.readdirSync(directory).filter(name => expression.test(name)).sort();
  if (!files.length) throw new Error('No native release archives found');
  return files.map(name => {
    const file = path.join(directory, name);
    const stat = fs.lstatSync(file);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size < 1024) throw new Error('Invalid release archive: ' + name);
    return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex') + '  ' + name;
  }).join('\n') + '\n';
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = fileURLToPath(new URL('../', import.meta.url));
  const version = JSON.parse(fs.readFileSync(path.join(root, 'package.json'))).version;
  const directory = path.join(root, 'dist');
  const checksums = releaseChecksums(directory, version);
  fs.writeFileSync(path.join(directory, 'checksums.txt'), checksums);
  console.log(checksums.trim());
}
