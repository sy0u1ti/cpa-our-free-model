# Our Free Model for CLIProxyAPI

An independent native **CPA plugin**, not an `openai-compatibility` configuration
snippet or a Magpie JavaScript plugin. English quick start is below;
**[完整中文说明](README_CN.md)** covers installation, authorization and troubleshooting.

The original [Our Free Model](https://github.com/Ebony-Vinyl/dsh-our-free-model)
runtime is embedded in the plugin binary, taken **directly from the original
repository**. The [Magpie adaptation](https://github.com/mu-zi-lee/magpie-our-free-model)
is an architectural reference only, not a code source or dependency. The CPA
C ABI integration is separate. Original authorship and MIT licenses are retained.

Version **0.2.1** uses 51 original-source files: 49 unchanged and two documented,
reproducible CPA patches. `npm run vendor:original -- /path/to/original-checkout`
regenerates the snapshot from pinned Git blobs. See `scripts/upstream-patches.mjs`
and `service/vendor/ofm/UPSTREAM.json` for exact provenance.

**Upgrade from 0.2.0:** 0.2.1 fixes double `data:` prefixes and duplicate `[DONE]`
markers in Chat streaming. Pull the source, rebuild, stop CPA, replace the installed
plugin binary and restart CPA. Keep the existing config and private data directory;
account login is not required again. The plugin ID remains `our-free-model`.
The same update rejects oversized requests without wedging the local service,
uses an explicit embedded-file allowlist, and hardens cache/startup handling.
See `AUDIT.md` for the review findings and validation limits.

## Quick start

This repository publishes source only; no prebuilt GitHub Release is published
yet. Clone this repository and follow **Development** to build the native library
before the installation steps below. Generated `dist/` files are not committed.

1. Use a plugin-enabled CLIProxyAPI build. Validated against **CPA 8.0.23**.
2. Copy the matching binary into CPA's configured `plugins` directory:
   `our-free-model-v0.2.1.dll` (Windows), `.so` (Linux), or `.dylib` (macOS).
3. Merge `config.example.yaml` into CPA's configuration and restart CPA:

```yaml
plugins:
  enabled: true
  dir: plugins
  configs:
    our-free-model:
      enabled: true
```

4. Open **Our Free Model** in CPA's plugin sidebar, enter your CPA **management
   key**, and request a one-use link to the original OFM console.
5. Anonymous/Kilo pools need no account. Log in to other channels in that console,
   then click **Sync models to CPA**. Client model IDs start with `ofm/`.

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
- Private loopback service and one-use, HttpOnly console handoff.
- Native host HTTP callbacks normally; direct cancellable local IPC when CPA's
  global proxy would otherwise receive a private loopback API key.
- Stop/reconfigure lifecycle, content-addressed embedded assets and integrity checks.

No custom frontend-auth provider is installed. Normal CPA client and management
authentication remain in force. Plugin menu resources are unauthenticated in CPA,
so the menu is a static page only; all private operations require management auth.

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
CGO_ENABLED=1 go build -trimpath -buildmode=c-shared -o our-free-model-v0.2.1.so .
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
