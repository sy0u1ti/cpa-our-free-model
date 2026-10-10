import { createServer } from 'node:http';
import { randomBytes } from 'node:crypto';
import { readFile } from 'node:fs/promises';

const policy = {
  'cache-control': 'no-store', 'referrer-policy': 'no-referrer',
  'x-content-type-options': 'nosniff', 'content-security-policy': "default-src 'none'; frame-ancestors 'none'",
};

export async function openConsoleTickets(service, port = 0) {
  const tokens = new Map();
  let origin;
  async function exchange(req, res) {
    res.setHeader('cache-control', 'no-store');
    if (req.method !== 'GET' || req.headers.host !== new URL(origin).host ||
        req.headers.origin && req.headers.origin !== origin) {
      res.writeHead(403, policy); res.end('Local console access only.'); return;
    }
    const url = new URL(req.url, origin);
    const token = url.pathname.match(/^\/open\/([a-f0-9]{64})$/)?.[1];
    const expiry = token && tokens.get(token);
    if (!expiry || expiry <= Date.now() || url.search) {
      res.writeHead(401, policy); res.end('Expired console link. Request a new link from the CPA plugin page.'); return;
    }
    tokens.delete(token);
    try {
      const settings = JSON.parse(await readFile(service.keyFile, 'utf8'));
      const response = await fetch(service.url + '/api/management/session', {
        method: 'POST', redirect: 'error', signal: AbortSignal.timeout(5000),
        headers: { origin: service.url, 'content-type': 'application/json' },
        body: JSON.stringify({ key: settings.forwardKey }),
      });
      const session = response.headers.get('set-cookie');
      await response.body?.cancel();
      if (!response.ok || !session || !/HttpOnly/i.test(session)) throw new Error('Session refused');
      res.writeHead(303, { ...policy, 'set-cookie': session, location: service.url + '/' });
      res.end();
    } catch {
      res.writeHead(502, policy); res.end('Cannot create an OFM session. Request a new link after checking service status.');
    }
  }
  const server = createServer((req, res) => { void exchange(req, res).catch(() => { res.destroy(); }); });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen({ host: '127.0.0.1', port }, resolve);
  });
  origin = 'http://127.0.0.1:' + server.address().port;
  return {
    issue() {
      for (const [token, expiry] of tokens) if (expiry <= Date.now()) tokens.delete(token);
      while (tokens.size >= 24) tokens.delete(tokens.keys().next().value);
      const token = randomBytes(32).toString('hex');
      tokens.set(token, Date.now() + 600000);
      return origin + '/open/' + token;
    },
    close() {
      tokens.clear();
      server.closeAllConnections();
      return new Promise(resolve => server.close(resolve));
    },
  };
}
