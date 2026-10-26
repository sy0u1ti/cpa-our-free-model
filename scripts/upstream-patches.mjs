// Executable CPA-only patches against exact, pinned original OFM Git blobs.
// Do not include the original credential literals in source patches or logs.
function replaceOne(source, pattern, replacement, name) {
  const matches = [...source.matchAll(new RegExp(pattern.source, 'g'))];
  if (matches.length !== 1) throw new Error(`Original OFM changed: ${name} matched ${matches.length} times`);
  return source.replace(pattern, replacement);
}

export const PATCHES = Object.freeze({
  'packages/standalone/eac.mjs': {
    id: 'cpa-private-eac-source',
    reason: 'Use a CPA-owned credential supplier instead of distributing the original encrypted gateway material. All original authorization logic remains unchanged.',
    apply(source) {
      return replaceOne(source, /import \{ openSeal \} from '\.\.\/\.\.\/src\/vault\.js'/,
        "import { originalCredential as openSeal } from '../../../../src/eac-provider.mjs'", 'standalone EAC import');
    },
  },
  'packages/standalone/channels/business.mjs': {
    id: 'cpa-private-oauth-settings',
    reason: 'Remove distributed Google OAuth defaults and the Loomy WeChat app identifier (use explicit private configuration instead).',
    apply(source) {
      for (const name of ['GEMINI_DEFAULT_CLIENT_ID', 'GEMINI_DEFAULT_CLIENT_SECRET']) {
        source = replaceOne(source, new RegExp(`var ${name} = "[^"\\r\\n]*";`), `var ${name} = "";`, name);
      }
      source = replaceOne(source, /var LOOMY_WECHAT_APP_ID = "[^"\r\n]*";/,
        'var LOOMY_WECHAT_APP_ID = process.env.OFM_LOOMY_WECHAT_APP_ID ?? "";', 'Loomy app configuration');
      source = replaceOne(source, /function buildLoomyWechatAuthUrl\(state\) \{/,
        'function buildLoomyWechatAuthUrl(state) {\n  if (!LOOMY_WECHAT_APP_ID) throw new Error("Configure OFM_LOOMY_WECHAT_APP_ID before Loomy WeChat login");', 'Loomy missing configuration');
      return source;
    },
  },
  'src/subscriptions.js': {
    id: 'cpa-private-gemini-subscription-oauth',
    reason: 'Remove the distributed Gemini CLI OAuth client credentials from the private subscription sidecar; use explicit CPA-local configuration instead.',
    apply(source) {
      for (const name of ['GEMINI_CLIENT_ID', 'GEMINI_CLIENT_SECRET']) {
        source = replaceOne(source, new RegExp(`const ${name} = '[^'\\r\\n]*'`), `const ${name} = ''`, name);
      }
      source = replaceOne(source,
        /      const form = \{\n        grant_type: 'refresh_token', refresh_token: c\.refreshToken,\n        client_id: account\.provider === 'codex' \? 'app_EMoamEEZ73f0CkXaXp7hrann' : GEMINI_CLIENT_ID,\n        \.\.\.\(account\.provider === 'gemini' \? \{ client_secret: GEMINI_CLIENT_SECRET \} : \{\}\),\n      \}/,
        `      const form = {\n        grant_type: 'refresh_token', refresh_token: c.refreshToken,\n        client_id: account.provider === 'codex' ? 'app_EMoamEEZ73f0CkXaXp7hrann' : GEMINI_CLIENT_ID,\n        client_secret: account.provider === 'gemini' ? GEMINI_CLIENT_SECRET : undefined,\n      }\n      if (account.provider === 'gemini' && (!form.client_id || !form.client_secret)) {\n        throw fail('AUTH_REQUIRED', 'Gemini OAuth client credentials are not configured in CPA', 401)\n      }`,
        'Gemini subscription OAuth configuration');
      return source;
    },
  },
});

export function patchOriginal(file, bytes) {
  const patch = PATCHES[file];
  return patch ? Buffer.from(patch.apply(bytes.toString('utf8'))) : bytes;
}
