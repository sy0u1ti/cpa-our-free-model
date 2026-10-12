# Our Free Model for CLIProxyAPI

An independent native **CPA plugin**, not an `openai-compatibility` configuration
snippet or a Magpie JavaScript plugin. English quick start is below;
**[完整中文说明](README_CN.md)** covers installation, authorization and troubleshooting.

The original [Our Free Model](https://github.com/Ebony-Vinyl/dsh-our-free-model)
runtime is embedded in the plugin binary, taken **directly from the original
repository**. The [Magpie adaptation](https://github.com/mu-zi-lee/magpie-our-free-model)
is an architectural reference only, not a code source or dependency. The CPA
C ABI integration is separate. Original authorship and MIT licenses are retained.

Version **0.5.0** vendors OFM `7e3a1da` (upstream v2.1.0). Only the files the
served UI actually references are kept, and the private EAC seal is never
vendored. `npm run vendor:original -- /path/to/original-checkout` regenerates the
snapshot from pinned Git blobs. See `scripts/upstream-patches.mjs` and
`service/vendor/ofm/UPSTREAM.json` for exact provenance.

**New in 0.5.0:** the upstream sync brings v2.1.0's rebuilt six-page console plus
the aggregate lane, token savers, fallback chains and a native Anthropic
`/v1/messages` endpoint. Three confirmed defects are fixed: WorkBuddy
international failed every model because the Tencent gateway requires the first
wire message to be `system` while the OpenAI gateway path only forwarded one when
the caller supplied it (the console's own model test does not) - the adapter now
inserts one; the backup import dialog claimed it "merged" while the service
replaced the whole pool, so it now says so plainly and reports what was written;
and the console frame is sandboxed without `allow-same-origin`, so it can no
longer read the CPA management key from the parent page. Leaving the page now
also cancels in-flight management work, and the fallback source updater creates
traversable install directories on Linux.

**Retained from 0.4.0:** one-click binary updates through CPA's native plugin
installer, with real Release/platform checks, preserved store sources and
verification that the new version is running before reporting success.

**Retained from 0.3.0:** a Chinese management UI, a same-origin OFM console under
CPA's own domain, manual repository update checks, and a safe source-update and
install command.
No extra public listener or copied loopback link is required. The 0.2.1 SSE and
runtime fixes remain in place. The plugin ID remains `our-free-model`.

## Quick start

Since v0.5.0, prebuilt GitHub Releases are published for Windows x64 and Linux
x64. Download `our-free-model_0.5.0_<os>_amd64.zip` from
[Releases](https://github.com/sy0u1ti/cpa-our-free-model/releases) and verify it
against `checksums.txt`, or clone this repository and follow **Development** to
build the native library yourself. Generated `dist/` files are not committed.

1. Use a plugin-enabled CLIProxyAPI build. Validated against **CPA 8.0.23**.
2. Copy the matching binary into CPA's configured `plugins` directory:
   `our-free-model-v0.5.0.dll` (Windows), `.so` (Linux), or `.dylib` (macOS).
3. Merge `config.example.yaml` into CPA's configuration and restart CPA:

```yaml
plugins:
  enabled: true
  dir: plugins
  configs:
    our-free-model:
      enabled: true
```

4. Open **免费模型管理** in CPA's plugin sidebar, enter your CPA **management
   key**, and click **打开账号控制台**. It opens inside the same CPA page/domain.
5. Anonymous/Kilo pools need no account. Log in to other channels in that console,
   then click **同步模型到 CPA**. Client model IDs start with `ofm/`.

The plugin manages a private Node child process automatically. It uses installed
Node.js 22.19+ or 24+, or installs a pinned SHA-256-verified official Node build
in its own data directory. It never changes system Node or PATH. To prohibit
downloads, set `auto-install-node: false` and provide `node-path`.

EAC source installation is **off by default**. Opt in with `auto-install-eac:
true` or configure a trusted local `eac-source-dir`, then complete the original
GitHub login/Star authorization. Installing source is not authorization.
Gemini and Loomy require private OAuth/App ID configuration; see the Chinese guide.

## Capabilities

- Model discovery and CPA routing without creating fake provider accounts.
- Streaming/nonstream Chat Completions; CPA translates Responses, Anthropic
  Messages and Gemini clients to/from that protocol.
- Original OFM account console, account pools, token usage and channel behavior.
- Tool calls, streaming reasoning, real effort controls and cancellation.
- Prefix isolation; live model/account admission checks; local key rotation.
- Same-origin remote console: original static assets stay public; all data
  operations pass through CPA management authentication and an API allowlist.
- One-click native binary updates, with manual source/commit checks as a fallback.
- Native host HTTP callbacks normally; direct cancellable local IPC when CPA's
  global proxy would otherwise receive a private loopback API key.
- Stop/reconfigure lifecycle, content-addressed embedded assets and integrity checks.

No custom frontend-auth provider is installed. Normal CPA client and management
authentication remain in force. Plugin menu resources are unauthenticated in CPA,
so the menu is a static page only; all private operations require management auth.
The parent page keeps the management key in memory and never sends it to the
embedded console, URLs or browser storage. The server substitutes the private
OFM key only for fixed loopback management endpoints. Local key export, terminal
launch and arbitrary forwarding are unavailable through the remote console.
The nested iframe is sandboxed **without** `allow-same-origin`, so its scripts
run in an opaque origin: reading the parent page's key raises `SecurityError`,
and the parent accepts messages only from that exact frame object. The console
needs no other origin (its requests are same-origin management paths, rewritten
through the parent), so no capability is lost. See `REVIEW_CN.md` for the
remaining separately identified hardening work.

## Updating

### From the management page

Click **检查更新**, then **一键更新** and confirm. Only a stable GitHub Release
with the matching platform ZIP and `checksums.txt` can enable the install button.
Unpublished Releases, missing assets, failed checks and local development builds
are not presented as installable updates.

The page uses CPA 8.0.23's `/v8/management/plugins/store` installer, not an arbitrary
shell endpoint or self-overwrite in the plugin. On first use, with confirmation,
it may add the following source through the narrowly scoped
`/v8/management/config/plugins/store-sources` API, retaining existing sources:

```text
https://raw.githubusercontent.com/sy0u1ti/cpa-our-free-model/main/registry.json
```

CPA can normalize older configuration layouts to v8 when saving this setting.
The native installer also records its store manifest and selected version in the
plugin configuration; other plugin options and account data are retained. Requests
may be interrupted during hot loading. An HTTP install success alone is not an
activation success: the page checks the running version afterward. If activation
cannot be confirmed, it offers a verification retry and does not reinstall blindly.
If CPA requires a restart, it says so; the page never restarts the whole server.

Reverse proxies must also route `/v8/management/` to CPA, with the same path prefix.
Upgrading from a version older than v0.5.0 needs one initial manual installation of
v0.5.0. v0.5.0 is the first published Release and ships `registry.json`, so later
versions can be installed from the page. Missing releases, missing platform
archives, failed GitHub requests or local development builds keep the install
button disabled with an explicit state.

### Source fallback

In a clean clone on the CPA server, with Go, a C compiler and Node available:

```sh
node scripts/update.mjs --check
node scripts/update.mjs --apply --plugin-dir /absolute/path/to/CPA/plugins
```

The second command verifies `origin`, requires clean `main`, fetches/fast-forwards
to a fixed commit, runs JS checks/tests and Go tests, builds a native library,
backs up existing plugin files under `<plugins>/.ofm-backups/`, and installs the
versioned library with an atomic rename. Restart CPA afterward. It never rewrites
CPA configuration or account data, resets local changes, or restarts your service.
If a build fails, the source can already be updated but the installed library is
left intact; fix the toolchain and rerun. A backup manifest records rollback paths.
This fallback is source-based updating, separate from the native binary update
button. On 0.2.x, first `git pull --ff-only` once to obtain this script.

### Publishing

`.github/workflows/release.yml` builds and tests Windows/Linux amd64 on a version
tag matching `package.json`, stages a draft with both platform ZIPs and
`checksums.txt`, then publishes it. Manual workflow runs build artifacts without
publishing. Release ZIP names follow CPA's
`our-free-model_<version>_<os>_<arch>.zip` convention; their native library is at
the ZIP root. Do not replace the contents of an already published version.

Local packaging and native installer verification:

```sh
npm run build
npm run package
npm run release:checksums
CPA_BIN=/path/to/cli-proxy-api CPA_UPDATE_PREVIOUS=/path/to/older-plugin.so npm run smoke:update
```

The installer smoke uses a loopback registry and isolated CPA/data directories.
It verifies checksum rejection, configuration preservation, hot loading and
inference after updating; it does not publish or install into a user's CPA.

The **检查仓库更新** button reads fixed GitHub metadata only (five-minute cache).
Failed checks never claim that the installation is current. `npm run build`
embeds the source commit and dirty-state marker for accurate comparison.

## VPS Access

Use the existing HTTPS CPA domain and its management authorization policy.
Requests use `/v0/resource/plugins/our-free-model/...` for static files and
`/v0/management/ofm/...` for authenticated data. Reverse proxies must forward
both; deployments under a path prefix are supported when the proxy strips it.
Do not open the OFM internal ports. Some vendor OAuth flows still require their
own registered localhost callback and may need an SSH tunnel for that callback.
The explicit `/v0/management/ofm/console-local` endpoint retains the old local
one-use handoff for advanced users; it is no longer the default UI entry.

## Development

Go 1.24+ and a C compiler are required for the native plugin. Node is needed to
run the JS checks and build helper. No npm dependencies are needed.

```sh
npm run check
npm test
go test ./...
go vet ./...
npm run build
CPA_BIN=/path/to/cli-proxy-api npm run smoke
CPA_BIN=/path/to/cli-proxy-api CPA_TEST_PROXY=1 npm run smoke
```

Build directly if preferred:

```sh
CGO_ENABLED=1 go build -trimpath -buildmode=c-shared -o our-free-model-v0.3.0.so .
```

Windows needs MinGW-w64 or Zig as `CC`; MSVC alone does not support Go cgo. The
build helper uses `GO_BIN`/`CC`, with an optional local `.tools` fallback. Windows
Go race tests with some Zig versions need a different compiler; Linux GCC race
tests are the portable reference. See `VALIDATION.md` for actual executed checks.

## Boundaries

- Not yet published to a plugin store or GitHub Release. Source builds and local
  installation are supported; binary releases and store listing are separate steps.
- CPA Home direct-plugin routing is not supported by CPA 8.0.23.
- Model list changes require a CPA configuration revision/reload. Request-time
  admission still immediately blocks disabled models and accounts.
- Exact token counting, image generation, native Responses state/resume, DSH
  update/announcement integration and Tailscale management are not implemented.
- Some OFM errors are flattened upstream to HTTP 502 or SSE error objects. The
  bridge preserves the status it receives; it cannot reconstruct lost vendor status.
- Free capacity, regional availability and vendor login flows are not guaranteed.
  Tests do not validate real personal accounts, EAC authorization or available quota.
- Requests go to the original upstreams; free pools may log prompts. Do not send
  secrets or sensitive information. Use only channels you are authorized to access.
- OFM request bodies are limited to 8 MiB, including inline images. For long
  reasoning pauses, configure CPA's `streaming.keepalive-seconds`; plugin executor
  chunks must contain JSON, so upstream comment heartbeats are not forwarded as data.

See `NOTICE.md`, `service/vendor/ofm/UPSTREAM.json` and `VALIDATION.md` for
provenance, exact revisions, tests and known compatibility limits.
