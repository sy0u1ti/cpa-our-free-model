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
    id: 'cpa-private-oauth-settings-and-buddy-system-prompt',
    reason: 'Remove distributed Google OAuth defaults and the Loomy WeChat app identifier (use explicit private configuration instead), and always lead the WorkBuddy/CodeBuddy wire messages with a system entry.',
    apply(source) {
      for (const name of ['GEMINI_DEFAULT_CLIENT_ID', 'GEMINI_DEFAULT_CLIENT_SECRET']) {
        source = replaceOne(source, new RegExp(`var ${name} = "[^"\\r\\n]*";`), `var ${name} = "";`, name);
      }
      source = replaceOne(source, /var LOOMY_WECHAT_APP_ID = "[^"\r\n]*";/,
        'var LOOMY_WECHAT_APP_ID = process.env.OFM_LOOMY_WECHAT_APP_ID ?? "";', 'Loomy app configuration');
      source = replaceOne(source, /function buildLoomyWechatAuthUrl\(state\) \{/,
        'function buildLoomyWechatAuthUrl(state) {\n  if (!LOOMY_WECHAT_APP_ID) throw new Error("Configure OFM_LOOMY_WECHAT_APP_ID before Loomy WeChat login");', 'Loomy missing configuration');
      // The Tencent gateway rejects any request whose first wire message is not a
      // system entry with `400 + code 11128` ("first message is not system
      // prompt"). The OpenAI gateway path only forwards a system entry when the
      // caller supplied one, so a request that opens with `user` (the console's
      // own model test does exactly that) failed for every WorkBuddy model. Lead
      // with the same probe system prompt the account re-test already relies on.
      return replaceOne(source, /(\n    const messages = serializeMessages2\(options\.messages, imageUrls\);\n)(    if \(options\.system !== void 0 && options\.system\.length > 0\) \{\n      messages\.unshift\(\{ role: "system", content: options\.system \}\);\n    \}\n)/,
        '$1$2    if (messages[0]?.role !== "system") {\n      messages.unshift({ role: "system", content: PROBE_SYSTEM });\n    }\n', 'Buddy leading system message');
    },
  },
});

export function patchOriginal(file, bytes) {
  const patch = PATCHES[file];
  return patch ? Buffer.from(patch.apply(bytes.toString('utf8'))) : bytes;
}
