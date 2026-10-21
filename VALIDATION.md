# Validation record

The test suite uses loopback model fixtures, not personal vendor accounts.
It does not establish real model availability, remaining quota, or successful
EAC/Gemini/Loomy authorization. Fixture CPA instances use isolated keys, ports,
plugin directories and data directories inside `.test-output/`.

## Pinned components

| Component | Revision |
| --- | --- |
| OFM | `4e44d453183ca2b60a424c190e501a192078308a` (upstream v2.5.7) |
| Official CPA | v8.0.23 / `d318bcc3afb9ea8782862f5e8cdb541afdc9dfa5` |
| Native contract | C ABI 1, negotiated RPC schema up to 6 |

## Upstream v2.5.7 Sync: 0.5.12

Re-vendored the original OFM runtime from `49171b9` to `4e44d45` (upstream
v2.5.7, 28 commits). The retained set grows from 93 to 94 files
(`src/model-test.js` is new). The served web assets were regenerated: the
channel bundle moves from `channels-kEN3gKhj.js` to `channels-CfC6--A6.js` and
the models bundle from `models-ishsHIe7.js` to `models-CEvvPVd6.js`.

The headline changes are CodeArts' dedicated signed transport (a new
`direct-fetch.ts` plus an `egressFetch` sender seam, so another plugin rewriting
global `fetch` cannot break the signature; proxy, timeout and cancellation are
kept and credits/check-in stay bound to their own plugin instance), a signed
retry that recognises both string and numeric CodeArts `4004` after dropping the
`benefit` header once, managed-install mode disabling in-app upgrade and hot
reload, and a rebuilt manual model test. The test now succeeds only on a
nonempty, normally finished answer, uses a 300s backend budget with a 330s UI
wait, persists success and failure results without letting a cancellation or an
older probe overwrite a newer measurement, and distinguishes "listed",
"verified available" and "verified failed". Low-performance mode is removed
while normal animation, theme switching and the sponsor cards stay.

The multimodal usage fix lands in `src/stream.js`/`src/adapter.js`: inflated
input and total stamps from the Kilo `kilo-auto/free` router are dropped while
output and reasoning counts remain, and once one attempt's input is unknown the
accumulator no longer fabricates an exact prompt/total, so the host can fall
back to its own estimate instead of failing with `CONTEXT_WINDOW_EXCEEDED`.

Ten of the twelve CPA console patches no longer matched after upstream rebuilt
the channel bundle with a new minifier output. All twelve were re-anchored
against the new bytes and are verified to match exactly once by
`TestEACUIHooksMatchOnlyThePinnedBundle` and `tests/eac-ui.test.mjs`; that
test's login-factory stubs were re-pointed at the new minified names. All
seventeen console labels still match without changes. The `/models/test` route
stays on the CPA allowlist and now returns the upstream test result shape.

Both CPA-patched files (`packages/standalone/eac.mjs`,
`packages/standalone/channels/business.mjs`) still match exactly once and apply
byte-for-byte, and the pinned EAC seal digests are unchanged from v2.2.0. The
web dependency versions in the original lockfile are also unchanged, so
re-recording the license sources only moved the commit.

Verified on Windows x64 against official CPA 8.0.23:

- `npm run check` (117 JavaScript files), `npm test` (44 tests), `go test ./...`,
  `go vet ./...`.
- `scripts/cpa-smoke.mjs` against the real plugin binary: 24 checks, including
  the free-lane v2.5 wire assertions and the rebuilt `/models/test` route.
- Provenance audit of all 94 vendored files against the original Git blobs
  (0 mismatches), including the two CPA patches.

## Upstream v2.5.6 Sync: 0.5.11

Re-vendored the original OFM runtime from `25151ba` to `49171b9` (upstream
v2.5.6, 5 commits). The retained set stays at 93 files and the served web
assets are byte-identical to 0.5.10, so all twelve CPA console patches and all
seventeen console labels still match exactly once without re-anchoring. Only
`src/reload.js` changed inside the vendored set.

v2.5.6 is a DSH-plugin-only release. It unifies the Beichen API sponsor card
above the free-model and EAC pages, shrinks its spacing and copy, standardises
the branding to "北辰 API × OFM" with a 10% referral rebate line, and removes
the standalone "来自赞助商的广告" nav item and detail route while keeping the
card and its "立即查看" link. That UI lives in upstream's `client.js` (the DSH
plugin entry), which this adapter does not vendor, so it does not reach the
embedded CPA console; the standalone sponsor page added in v2.5.4/v2.5.5 keeps
its upstream v2.5.5 shape.

The other fix is macOS hot reload: `src/reload.js` used URL-prefix checks to
decide whether a dependency belonged to the current plugin generation, but
temporary-directory paths such as `/var` versus `/private/var` did not match,
so old modules kept running. The resolver now compares `realpathSync` results
for both the parent module and the resolved URL.

Both CPA-patched files (`packages/standalone/eac.mjs`,
`packages/standalone/channels/business.mjs`) are unchanged upstream this round,
so both patches still apply byte-for-byte, and the pinned EAC seal digests are
unchanged from v2.2.0. The web dependency versions in the original lockfile are
also unchanged, so re-recording the license sources only moved the commit.

Verified on Windows x64 against official CPA 8.0.23:

- `npm run check` (116 JavaScript files), `npm test` (44 tests), `go test ./...`,
  `go vet ./...`.
- `scripts/cpa-smoke.mjs` against the real plugin binary: 24 checks, including
  the free-lane v2.5 wire assertions (path, four session headers, descending
  session encoding, read/shell fingerprint, no `tool_choice: 'none'`).
- Provenance audit of all 93 vendored files against the original Git blobs
  (0 mismatches), including the two CPA patches.

## Upstream v2.5.5 Sync: 0.5.10

Re-vendored the original OFM runtime from `f0b979f` to `25151ba` (upstream
v2.5.5, 14 commits covering v2.5.4 and v2.5.5). The retained set grows from 91
to 93 files: `src/sponsor.js` and `src/sponsor.css` are new. The importer now
also selects `.css` under `src/` so the sponsor stylesheet stays reproducible,
and `assets.go` embeds it. The served web assets were regenerated: the channel
bundle moves from `channels-Bo15uddV.js` to `channels-kEN3gKhj.js`, and
`app.js`/`app.css` grew with the sponsor page.

v2.5.4 adds a sponsor page plus a once-per-local-day sponsor notice to the
standalone console, then reworks the desktop shell around it. v2.5.5 removes the
community-group details from the sponsor copy and stops the desktop plugin from
auto-opening the sponsor notice at startup, keeping the page entry and invitation
code. In this adapter the page and the "来自赞助商的广告" menu entry appear
because they are part of the embedded upstream console. The existing console
sandbox already allows popups (`allow-popups`,
`allow-popups-to-escape-sandbox`) and the management key never enters that
frame; the sandbox's in-memory Storage bridge handles the notice's storage
access.

Ten of the twelve CPA console patches no longer matched after upstream rebuilt
the channel bundle with a new minifier output. All twelve were re-anchored
against the new bytes and are verified to match exactly once by
`TestEACUIHooksMatchOnlyThePinnedBundle` and `tests/eac-ui.test.mjs`; that
test's login-factory stubs were re-pointed at the new minified names. All
seventeen console labels still match without changes.

Both CPA-patched files (`packages/standalone/eac.mjs`,
`packages/standalone/channels/business.mjs`) are unchanged upstream this round,
so both patches still apply byte-for-byte, and the pinned EAC seal digests are
unchanged from v2.2.0. The web dependency versions in the original lockfile are
also unchanged, so re-recording the license sources only moved the commit.

Verified on Windows x64 against official CPA 8.0.23:

- `npm run check` (115 JavaScript files), `npm test` (44 tests), `go test ./...`,
  `go vet ./...`.
- `scripts/cpa-smoke.mjs` against the real plugin binary: 24 checks, including
  the free-lane v2.5 wire assertions (path, four session headers, descending
  session encoding, read/shell fingerprint, no `tool_choice: 'none'`).
- Provenance audit of all 93 vendored files against the original Git blobs
  (0 mismatches), including the two CPA patches.

## Upstream v2.5.3 Sync: 0.5.9

Re-vendored the original OFM runtime from `8c2c0f1` to `f0b979f` (upstream
v2.5.3, 7 commits). The retained set stays at 91 files and the served web assets
are byte-identical to 0.5.8, so all twelve CPA console patches and all seventeen
console labels still match exactly once without re-anchoring. Only
`src/adapter.js`, `src/recovery.js`, `src/updater.js` and the upstream package
manifests changed.

The hotfix removes the EAC no-progress cutoff that v2.5.2 introduced. That rule
ended a request with `NO_PROGRESS` after 60 seconds without text, reasoning or
tool progress, which wrongly aborted queuing, silent reasoning, heartbeat-only
waits and long silences after the answer had started. `progressTimeoutMs` is
gone from `RECOVERY_DEFAULTS`, the adapter no longer arms or renews a progress
timer, and a legacy `progressTimeoutMs` setting has no effect. User
cancellation, transport idle detection and the overall recovery deadline keep
their previous behaviour.

Upstream also stops copying `packages/` (standalone product sources and the Rust
`target` cache) into rollback backups when upgrading a development install, and
filters those paths out of older rollback receipts. That change lives in
upstream's own `src/updater.js`; this adapter installs through
`scripts/update.mjs`, so the fix is vendored but inactive here.

Both CPA-patched files (`packages/standalone/eac.mjs`,
`packages/standalone/channels/business.mjs`) are unchanged upstream this round,
so both patches still apply byte-for-byte, and the pinned EAC seal digests are
unchanged from v2.2.0. The web dependency versions in the original lockfile are
also unchanged, so re-recording the license sources only moved the commit.

Verified on Windows x64 against official CPA 8.0.23:

- `npm run check` (115 JavaScript files), `npm test` (44 tests), `go test ./...`,
  `go vet ./...`.
- `scripts/cpa-smoke.mjs` against the real plugin binary: 24 checks, including
  the free-lane v2.5 wire assertions (path, four session headers, descending
  session encoding, read/shell fingerprint, no `tool_choice: 'none'`).
- Provenance audit of all 91 vendored files against the original Git blobs
  (0 mismatches), including the two CPA patches.

## Upstream v2.5.2 Sync: 0.5.8

Re-vendored the original OFM runtime from `0b712bc` to `8c2c0f1` (upstream
v2.5.2, 35 commits including the v2.5.0, v2.5.1 and v2.5.2 releases). The
retained set grows from 87 to 91 files: `src/deferred-response.js`,
`src/failure.js`, `src/open-external.js` and
`packages/standalone/open-external.mjs` are new. The served web assets were
regenerated: the channel bundle moves from `channels-Dyod_rQn.js` to
`channels-Bo15uddV.js`, the models/settings/usage bundles are renamed, and a new
`visibility-data` chunk appears.

The headline upstream fix is the free lane's session-id encoding gate. Since
2026-10-17 the gateway decodes the twelve hex digits after `ses_` and accepts
only the descending layout `~(ms << 12 | counter)` with counter 1-63, whose
tenth digit is `f`; an ascending `ms << 12` value or a hash digest gets
`403 FreeTierError` even with a valid `ses_` shape. Upstream now validates with
`isCanonicalSession()` and deterministically re-encodes anything else through
`canonicalizeSession()`, so a conversation keeps one stable upstream session and
old non-canonical ids in `session-map.json` are re-encoded on read.

The importer's standalone allow-list needed a real fix: the new
`packages/standalone/eac.mjs` imports `./open-external.mjs`, which the previous
allow-list did not select. Both `scripts/import-upstream.mjs` and the
`assets.go` embed list now include `packages/standalone/open-external.mjs`;
without it the embedded service would fail to load at startup.

Other upstream changes folded in: a third recommended project
(EAC-design-world), per-model and per-group model hiding with a new
`visibility-data` console chunk, an opt-in standalone LAN inference relay
(`startStandalone` gained `lanEnabled`/`lanPort`, default off; this adapter does
not enable it), domestic mirrors for the in-app updater and announcement feed,
WorkBuddy session/system-prompt fixes, bounded Raccoon/Loomy account rotation,
real model IDs on the aggregate lane, upstream error classification through all
three forwarding protocols, and a batch of channel-adapter fixes.

Eight of the twelve CPA console patches no longer matched after upstream rebuilt
the channel bundle with a new minifier output. All twelve were re-anchored
against the new bytes and are verified to match exactly once by
`TestEACUIHooksMatchOnlyThePinnedBundle` and `tests/eac-ui.test.mjs`; that test's
login-factory stubs were re-pointed at the new minified names.

Both CPA-patched files (`packages/standalone/eac.mjs`,
`packages/standalone/channels/business.mjs`) changed upstream this round, but
every patch anchor still matches exactly once and `patchOriginal` reproduces the
expected bytes. `src/vault.js` only gained the `tauri` profile check; the pinned
EAC seal digests (`vault-data.js`, `vault-anchor.js`) are unchanged. The web
dependency versions in the original lockfile are unchanged, so re-recording the
license sources only moved the commit.

Verified on Windows x64 against official CPA 8.0.23:

- `npm run check` (115 JavaScript files), `npm test` (44 tests), `go test ./...`,
  `go vet ./...`.
- `scripts/cpa-smoke.mjs` against the real plugin binary: 24 checks, including a
  free-lane assertion that now also verifies the descending session-id encoding
  the upstream gate decodes.
- Provenance audit of all 91 vendored files against the original Git blobs
  (0 mismatches), including the two CPA patches.

## Upstream v2.4.0 Sync: 0.5.7

Re-vendored the original OFM runtime from `e937077` to `0b712bc` (upstream
v2.4.0, 3 commits). The retained set grows from 86 to 87 files: `src/picks.js`
(the recommended-projects page's GitHub star counts) is new, and the served
channel bundle moves from `channels-BNNYYkX2.js` to `channels-Dyod_rQn.js`. Both
changes move with the embed manifest, the Go console test, the EAC UI test and
the provenance test.

The anonymous free lane was re-fingerprinted as the OpenCode v2 client
(`docs/free-lane-wire.md`, measured upstream from 2026-10-14). Four facts change
together, each a `403 FreeTierError` on its own: the User-Agent becomes
`opencode/latest/2.0.26/cli` (the v1 `opencode/1.18.x` shape is refused by
name); the four session headers `x-opencode-session` / `x-opencode-session-id` /
`x-session-affinity` / `x-session-id` must carry one value while the v1-only
`x-opencode-request` must be gone; the tool gate wants `read` and `shell`
declared with OpenCode's own verbatim descriptions and schemas rather than the
old four stub names; and `tool_choice: 'none'` is never sent. Caller tools pass
through untouched, and a caller tool that uses one of the gate names with a
different definition is renamed to `<name>_client` on the wire with history and
`tool_choice` rewritten to match and the response side restoring the caller's
name.

Nine of the twelve CPA console patches no longer matched after upstream rebuilt
the channel bundle with a new minifier output. All twelve were re-anchored
against the new bytes and are verified to match exactly once by
`TestEACUIHooksMatchOnlyThePinnedBundle` and `tests/eac-ui.test.mjs`. The new
"recommended projects" page reads `/picks`, which the embedded standalone
service does not implement (it is a DSH host route) and `consoleAPIRoutes` does
not allow, so the figures fail closed in the CPA console like the other
host-only tabs.

The two CPA-patched files (`packages/standalone/eac.mjs`,
`packages/standalone/channels/business.mjs`) did not change upstream, so both
patches still apply byte-for-byte, and the pinned EAC seal digests are unchanged
from v2.2.0. The web dependency versions in the original lockfile are also
unchanged, so re-recording the license sources only moved the commit.

Verified on Windows x64 against official CPA 8.0.23:

- `npm run check` (111 JavaScript files), `npm test` (44 tests), `go test ./...`,
  `go vet ./...`.
- `scripts/cpa-smoke.mjs` against the real plugin binary, including the free-lane
  wire assertions updated to the v2 contract: `/inference/v1`, the four session
  headers carrying one value, no `x-opencode-request`, a User-Agent in the
  `opencode/<channel>/<version>/<client>` shape with major >= 2, `read` and
  `shell` declared with non-empty schemas, and no `tool_choice: 'none'`.
- Provenance audit of all 87 vendored files against the original Git blobs
  (0 mismatches), including the two CPA patches.

## Upstream v2.3.0 Sync: 0.5.6

Re-vendored the original OFM runtime from `9e61218` to `e937077` (upstream
v2.3.0, 37 commits). The retained set stays at 86 files; the only filename
change is the served channel bundle (`channels-CQJ5sFg_.js` ->
`channels-BNNYYkX2.js`), which moves with the embed manifest, the Go console
test and the provenance test.

The anonymous free lane moved from `/zen/v1` to `/inference/v1` and gained four
gate conditions upstream measured on 2026-10-14 (`docs/free-lane-wire.md`):
`x-opencode-session-id` must be present, the session id must be minted rather
than derived, `bash` and `read` must each declare a non-empty parameter schema,
and a User-Agent containing `deepseek-harness` is refused by name. Upstream also
persists the conversation-to-session map so one conversation keeps one upstream
session across restarts, and reclassifies a free-lane `403 FreeTierError` as a
lane lock instead of an invalid credential.

That session map resolves through `$DSH_HOME/our-free-model/`. The host never
supplies `DSH_HOME` (`childEnvironment` strips it), so the adapter now pins the
variable to the plugin data directory during service initialization; every state
file the vendored runtime writes stays inside `data-dir`. `tests/runtime.test.mjs`
asserts `session-map.json` lands there and records the catalog conversation.

Seven of the twelve CPA console patches no longer matched after upstream
rebuilt the channel bundle with a new minifier output. All twelve were re-anchored
against the new bytes and verified to match exactly once by
`TestEACUIHooksMatchOnlyThePinnedBundle` and `tests/eac-ui.test.mjs`.

The new "plugin upgrade" nav page calls the DSH host's `/update/*` routes, which
the embedded service does not implement and `consoleAPIRoutes` does not allow,
so it fails closed in the CPA console like the other host-only tabs
(`/token-saver`, `/combos`, `/chan-gateway`).

Verified on Windows x64 against official CPA 8.0.23:

- `npm run check` (110 JavaScript files), `npm test` (44 tests), `go test ./...`,
  `go vet ./...`.
- `scripts/cpa-smoke.mjs` against the real plugin binary: 24 checks, including a
  new one that asserts the free lane actually speaks `/inference/v1` with the
  `x-opencode-session-id` header, the `cli` client marker, an attribution
  User-Agent without `deepseek-harness`, and non-empty schemas on `bash`/`read`.
- Provenance audit of all 86 vendored files against the original Git blobs
  (0 mismatches), including the two CPA patches.

## SSE Regression: 0.2.1

The earlier 0.2.0 smoke checks only matched content substrings. They passed even
though CPA double-framed Chat output as `data: data: {...}` and duplicated the
terminal marker. They did not establish SSE-client compatibility. The new strict
JSON event parser reproduces that failure on the original 0.2.0 binary.

The 0.2.1 adapter decodes complete SSE events into bare compact JSON, discards
comments/metadata/empty events, and closes on upstream `[DONE]` without emitting
it. CPA owns client framing and the single terminal marker. Both native callback
and direct-loopback streaming use this decoder. The original OFM vendor files
are unchanged.

CPA 8.0.23's OpenAI-to-Claude translator still expects a `data:` line. A narrowly
scoped response-before-translator hook restores that prefix only for owned OFM
streaming OpenAI-to-Claude conversions, never for Chat output or other providers.

Regression coverage includes multiline events, CRLF/LF, every input split, empty
and heartbeat frames, errors, malformed JSON, immediate DONE without EOF, one
terminal marker, tool arguments, reasoning, usage and model identity. Host smoke
tests parse each client SSE event as JSON, rather than searching the raw body;
they also check single Responses completion and Anthropic message-stop events.

The subsequent whole-adapter review is recorded in `AUDIT.md`. The 0.2.1 build
also fixes oversized control-message hangs, explicit Node path resolution,
unbounded cache-file reads and transient cache-promotion permission errors, and
restricts embedded assets to an explicit allowlist.

Final 0.2.1 checks on 2026-10-10:

- 30 Go regression cases plus one subprocess helper; passed on Linux with
  `-race`. Windows passed with the relative-Node-path case skipped because the
  installed Node executable and workspace are on different volumes.
- `go vet ./...` passed on both platforms; 10 Node tests passed, with direct
  original-source Git-blob verification. JavaScript syntax: 59 files passed.
- Official CPA host checks: 22 normal-path checks and 23 global-proxy checks
  passed on each of Windows amd64 and Linux amd64. Reports include each tested
  native library's SHA-256.
- Chat/Responses/Claude/Gemini SSE is parsed event by event; Chat has exactly one
  DONE. Nonstream cancellation before response and plugin disable during an
  active stream also close upstream work and release the service lock.

The platform sections below retain the original 0.2.0 baseline results for
history; their substring-only streaming checks are superseded by these strict
0.2.1 regressions.

## Direct Original Baseline

Version 0.2.0 supersedes the earlier reference-derived prototype. Original OFM
is the sole product-source upstream. Import and provenance tests compare all
53 files directly to the original commit: 51 unchanged, two CPA-only patches.
The original service and web UI are unchanged. Reference helper modules were
removed and replaced by CPA-owned implementations. Validation of the old
prototype is not treated as validation of the corrected source baseline;
native builds and host smoke tests were rerun for v0.2.0 on both Windows and Linux.

## Windows x64, 2026-10-10

- Node.js 24.15.0; portable Go 1.27.2; Zig 0.15.2 C compiler.
- CPA official Windows amd64 binary and downloaded build tools verified against
  their upstream SHA-256 digests before use.
- 18 Go unit tests: configuration, source registration requirements, model mapping,
  discovery cache/empty results, caller-secret isolation, error statuses,
  SSE framing at every byte boundary, asynchronous delivery, public resource
  safety, embedded asset extraction and tamper detection.
- 8 JavaScript tests: original Git-blob/source hashes, reasoning mapping, live admission,
  actual bundled OFM startup, anonymous/Kilo discovery, API auth, one-use console
  handoff, real HttpOnly session, local key rotation, child exit and lock cleanup,
  opt-in EAC download integrity and redacted local-source errors.
- `go vet ./...`: passed.
- Native `.dll` built and loaded by the real CPA executable.
- Real CPA smoke checks: model registration, static resource/auth boundary,
  Chat JSON and SSE, tool calls, reasoning, token usage, Responses JSON/streaming,
  Anthropic streaming, Gemini nonstream, six concurrent requests, key rotation,
  immediate disable admission, cancellation, config-only catalog refresh,
  real catalog changes, explicit 501 token-count support boundary, error streams,
  reasoning suffix/output budget and plugin disable/child cleanup.
- Smoke repeated with a rejecting CPA global HTTP proxy: model requests still
  work; loopback requests and the private OFM key never reach that proxy.

Machine-readable smoke results are generated under
`dist/CPA_SMOKE_<platform>_<arch>.json` and
`dist/CPA_PROXY_SMOKE_<platform>_<arch>.json`. They contain check names, not credentials.

Windows race-instrumented linking failed with this portable Zig/Go pairing
(`WaitOnAddress`/`WakeByAddress*` import library mismatch); this is not reported
as a passed race check. Ordinary tests and real concurrent requests passed.

## Linux x64 (WSL2 Ubuntu), 2026-10-10

- Ubuntu 24.04.4 on WSL2, glibc 2.39, GCC 13.3.0, Go 1.27.2,
  Node.js 24.21.0; official CPA Linux amd64 v8.0.23.
- `go test -race ./...` and `go vet ./...`: passed on the corrected baseline.
- JS provenance/runtime tests: passed, including direct original Git-blob audit.
- Native Linux `.so` built with GCC and loaded by the official Linux CPA binary.
- The same real-host smoke suite passed in both normal and global-proxy modes.
- This is an actual Linux-host execution, not merely Windows cross-compilation.

macOS, ARM64 and Alpine are not host-tested. Support cannot be inferred from
the source layout or Node download table alone.

## Browser QA

The CPA landing page was inspected at desktop 1440 px and mobile 390 px widths
with Playwright; the private status action was exercised against a mock management
endpoint. This visual check does not imply real third-party account login testing.
At 390 px, document scroll width equals viewport width (no horizontal overflow).

## Reproduction

```sh
npm run check
npm test
go test ./...
go vet ./...
npm run build
CPA_BIN=/absolute/path/to/cli-proxy-api node scripts/cpa-smoke.mjs
CPA_BIN=/absolute/path/to/cli-proxy-api CPA_TEST_PROXY=1 node scripts/cpa-smoke.mjs
```

The main smoke script requires the actual compiled native plugin. It never uses
a fake CPA host. `tests/helpers.mjs` provides only the loopback vendor fixture.
CPA may perform its own background version checks; no real model inference is
sent to external providers by these tests.
