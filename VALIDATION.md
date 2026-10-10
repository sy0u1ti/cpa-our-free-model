# Validation record

The test suite uses loopback model fixtures, not personal vendor accounts.
It does not establish real model availability, remaining quota, or successful
EAC/Gemini/Loomy authorization. Fixture CPA instances use isolated keys, ports,
plugin directories and data directories inside `.test-output/`.

## Pinned components

| Component | Revision |
| --- | --- |
| OFM | `f8974369c5904858c696b520d8b9b82ad4425f78` |
| Official CPA | v8.0.23 / `d318bcc3afb9ea8782862f5e8cdb541afdc9dfa5` |
| Native contract | C ABI 1, negotiated RPC schema up to 6 |

## Direct Original Baseline

Version 0.2.0 supersedes the earlier reference-derived prototype. Original OFM
is the sole product-source upstream. Import and provenance tests compare all
51 files directly to the original commit: 49 unchanged, two CPA-only patches.
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
