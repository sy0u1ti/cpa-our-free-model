# Our Free Model for CLIProxyAPI

An independent native **CPA plugin**, not an `openai-compatibility` configuration
snippet or a Magpie JavaScript plugin. English quick start is below;
**[完整中文说明](README_CN.md)** covers installation, authorization and troubleshooting.

The original [Our Free Model](https://github.com/Ebony-Vinyl/dsh-our-free-model)
runtime is embedded in the plugin binary, taken **directly from the original
repository**. The [Magpie adaptation](https://github.com/mu-zi-lee/magpie-our-free-model)
is an architectural reference only, not a code source or dependency. The CPA
C ABI integration is separate. Original authorship and MIT licenses are retained.

Version **0.3.0** uses 53 original-source files: 51 unchanged and two documented,
reproducible CPA patches. `npm run vendor:original -- /path/to/original-checkout`
regenerates the snapshot from pinned Git blobs. See `scripts/upstream-patches.mjs`
and `service/vendor/ofm/UPSTREAM.json` for exact provenance.

**New in 0.3.0:** the upstream snapshot is refreshed to OFM `f9cdb664`
(channel proxy support, image pricing, UI rebuilds and upstream fixes), alongside
a Chinese management UI, a same-origin OFM console under CPA's own domain,
manual repository update checks, and a safe source-update/install command.
No extra public listener or copied loopback link is required. The 0.2.1 SSE and
runtime fixes remain in place. The plugin ID remains `our-free-model`.

## Quick start

This repository publishes source only; no prebuilt GitHub Release is published
yet. Clone this repository and follow **Development** to build the native library
before the installation steps below. Generated `dist/` files are not committed.

1. Use a plugin-enabled CLIProxyAPI build. Validated against **CPA 8.0.23**.
2. Copy the matching binary into CPA's configured `plugins` directory:
   `our-free-model-v0.3.0.dll` (Windows), `.so` (Linux), or `.dylib` (macOS).
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
- Manual version/commit checks and a fast-forward-only source updater with backups.
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

## Updating

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
This is source-based updating, not a claim of prebuilt Releases or background
self-updates. On 0.2.x, first `git pull --ff-only` once to obtain this script.

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
