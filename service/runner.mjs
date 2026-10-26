import fs from 'node:fs';
import path from 'node:path';
import { createInterface } from 'node:readline';
import { startStandalone } from './vendor/ofm/packages/standalone/service.mjs';
import { configureEac, eacDiagnostic, warmupEac } from './src/eac-provider.mjs';
import { openConsoleTickets } from './src/console-tickets.mjs';
import { admitModel, modelRows, normalizeBody } from './src/catalog.mjs';

let service;
let handoff;
let handoffPromise;
let stopping;
let parentWatch;
let initialized;
let inputClosed = false;
let initialReady;
let settingsInUse;
let managementSession;
const input = createInterface({ input: process.stdin });
// Stdout is a private control protocol, never a vendor logging sink.
const send = value => process.stdout.write(JSON.stringify(value) + '\n');
for (const method of ['log', 'info', 'warn', 'error', 'debug']) console[method] = () => {};
process.stdout.on('error', () => { void stop(); });

function stop() {
  if (stopping) return stopping;
  inputClosed = true;
  clearInterval(parentWatch);
  stopping = (async () => {
    await initialized?.catch(() => {});
    await handoffPromise?.catch(() => {});
    await Promise.allSettled([handoff?.close(), service?.close()]);
  })().finally(() => process.exit(0));
  return stopping;
}
process.once('SIGTERM', stop);
process.once('SIGINT', stop);
input.once('close', () => { void stop(); });

function privateClientConfig(settings) {
  const google = path.join(settings.dataDir, 'gemini-oauth.json');
  const wechat = path.join(settings.dataDir, 'loomy-wechat.json');
  if (fs.existsSync(google)) {
    const value = JSON.parse(fs.readFileSync(google, 'utf8'));
    if (![value.clientId, value.clientSecret].every(item => typeof item === 'string' && item.trim())) throw new Error('Invalid gemini-oauth.json');
    process.env.CMDC_PAK_GOOGLE_CLIENT_ID = value.clientId.trim();
    process.env.CMDC_PAK_GOOGLE_CLIENT_SECRET = value.clientSecret.trim();
  }
  if (fs.existsSync(wechat)) {
    const value = JSON.parse(fs.readFileSync(wechat, 'utf8'));
    if (typeof value.appId !== 'string' || !value.appId.trim()) throw new Error('Invalid loomy-wechat.json');
    process.env.OFM_LOOMY_WECHAT_APP_ID = value.appId.trim();
  }
}

function recoverDeadLock(directory) {
  const lock = path.join(directory, 'service.lock');
  if (!fs.existsSync(lock)) return;
  let previous;
  try { previous = JSON.parse(fs.readFileSync(lock, 'utf8')); } catch { return; }
  if (previous.product !== 'our-free-model-standalone' || !Number.isInteger(previous.pid) || previous.pid < 1) return;
  try { process.kill(previous.pid, 0); }
  catch (error) { if (error.code === 'ESRCH') fs.unlinkSync(lock); }
}

async function initialize(settings) {
  if (!path.isAbsolute(settings.dataDir) || !Number.isInteger(settings.parentPid) || settings.parentPid < 1) throw new Error('Invalid service settings');
  settingsInUse = settings;
  fs.mkdirSync(settings.dataDir, { recursive: true, mode: 0o700 });
  // Upstream resolves the free lane's persisted session map through
  // "$DSH_HOME/our-free-model". The host environment never supplies
  // DSH_HOME (childEnvironment strips it), so pin it to the plugin's own data
  // directory: every byte the service writes stays inside data-dir instead of
  // leaking into the CPA host's home directory or colliding with another
  // instance that shares the same machine.
  process.env.DSH_HOME = settings.dataDir;
  privateClientConfig(settings);
  recoverDeadLock(settings.dataDir);
  await configureEac(settings);
  if (inputClosed) return;
  service = await startStandalone({ dataDir: settings.dataDir, port: settings.port,
    refresh: settings.refresh !== false,
    logger: { info() {}, warn() {}, error() {} } });
  initialReady = service.ready.catch(() => {});
  if (inputClosed) return;
  send({ type: 'ready' });
  parentWatch = setInterval(() => {
    try { process.kill(settings.parentPid, 0); }
    catch (error) { if (error.code === 'ESRCH') void stop(); }
  }, 2000);
  parentWatch.unref();
}

function connection() {
  const { forwardKey } = JSON.parse(fs.readFileSync(service.keyFile, 'utf8'));
  if (typeof forwardKey !== 'string' || !forwardKey) throw new Error('Missing local API key');
  return { url: service.url, key: forwardKey };
}

async function consoleConnection() {
  const value = connection();
  const settings = JSON.parse(fs.readFileSync(service.keyFile, 'utf8'));
  if (typeof settings.managementKey !== 'string' || !settings.managementKey) {
    throw new Error('Missing local management key');
  }
  if (!managementSession || managementSession.expiresAt <= Date.now()) {
    const response = await fetch(service.url + '/api/management/session', {
      method: 'POST', redirect: 'error', signal: AbortSignal.timeout(5000),
      headers: { origin: service.url, 'content-type': 'application/json' },
      body: JSON.stringify({ key: settings.managementKey }),
    });
    const header = response.headers.get('set-cookie') ?? '';
    const cookie = header.split(';', 1)[0];
    await response.text();
    if (!response.ok || !cookie || !/HttpOnly/i.test(header)) throw new Error('Management session was refused');
    // The upstream session lasts eight hours. Refresh one hour early so a
    // long-lived management page never sends an expired cookie.
    managementSession = { cookie, expiresAt: Date.now() + 7 * 60 * 60 * 1000 };
  }
  return { ...value, session: managementSession.cookie };
}

async function command(message) {
  await initialized;
  if (!service || inputClosed) throw new Error('Service is stopping');
  switch (message.type) {
    case 'connection': return connection();
    case 'console-connection': return consoleConnection();
    case 'eac-warmup': return warmupEac();
    case 'console': {
      handoffPromise ??= openConsoleTickets(service, settingsInUse.consolePort).then(value => { handoff = value; return value; }, error => { handoffPromise = undefined; throw error; });
      await handoffPromise;
      if (inputClosed) throw new Error('Service is stopping');
      return handoff.issue();
    }
    case 'models': {
      // Initial discovery waits for bounded catalog work, not model inference.
      let timer;
      await Promise.race([initialReady, new Promise(resolve => { timer = setTimeout(resolve, 30000); })]);
      clearTimeout(timer);
      return modelRows(service);
    }
    case 'prepare': {
      if (typeof message.model !== 'string' || !await admitModel(service, message.model)) return { admitted: false };
      const row = modelRows(service).find(row => row.id === message.model);
      if (!row) return { admitted: false };
      try { return { admitted: true, ...connection(), body: normalizeBody(message.body, row, message.effort) }; }
      catch { return { admitted: true, invalid: true }; }
    }
    case 'status': return { running: true, url: service.url, pid: process.pid, dataDir: service.dataDir,
      models: modelRows(service).length, channels: service.channels.state(), eacSource: eacDiagnostic() };
    default: throw new Error('Unsupported service command');
  }
}

input.on('line', line => {
  let message;
  try { message = JSON.parse(line); }
  catch { send({ type: 'error', error: 'Invalid control JSON' }); return; }
  if (!initialized) {
    initialized = initialize(message);
    initialized.catch(async error => {
      send({ type: 'error', error: error.code === 'EEXIST' ? 'Data directory is already in use by another service' :
        'Could not initialize OFM; check private client configuration, data directory permissions and Node version' });
      await stop();
    });
    return;
  }
  if (!Number.isSafeInteger(message.id) || message.id < 1) return;
  command(message).then(value => send({ id: message.id, value }), () =>
    send({ id: message.id, error: 'OFM service could not complete the control request' }));
});
