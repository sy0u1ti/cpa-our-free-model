import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'node:http';

const root = fileURLToPath(new URL('../', import.meta.url));
const file = path.join(root, 'web/index.html');
const server = createServer((req, res) => {
  if (req.url === '/v0/management/ofm/status') {
    if (req.headers.authorization !== 'Bearer preview') { res.writeHead(401); return res.end('{}'); }
    res.setHeader('content-type', 'application/json');
    return res.end(JSON.stringify({ running: true, url: 'http://127.0.0.1:18900', models: 12, preview: true }));
  }
  if (req.url !== '/') { res.writeHead(404); return res.end(); }
  res.setHeader('content-type', 'text/html; charset=utf-8');
  res.end(fs.readFileSync(file));
});
server.listen(0, '127.0.0.1', () => {
  const port = server.address().port;
  console.log('Preview only: http://127.0.0.1:' + port + ' (test key: preview)');
  fs.mkdirSync(path.join(root, '.test-output'), { recursive: true });
  fs.writeFileSync(path.join(root, '.test-output/ui-port.txt'), String(port));
});
