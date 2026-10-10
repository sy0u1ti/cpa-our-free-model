# CPA adapter review - 0.2.1

Reviewed on 2026-10-10 after the reported malformed streaming response.
Scope: all CPA-owned Go source, Node runner/helpers, build/import/packaging
scripts, static management page, and their boundaries with the pinned original
OFM runtime and CPA 8.0.23. The 51 original-source files and two existing CPA
patches are unchanged. This is not a line-by-line security audit of the generated
third-party channel bundle or a live login test for every provider.

## Confirmed and fixed

1. **P1 - invalid client SSE and duplicate completion.** The executor returned
   full `data:` frames but CPA's Chat handler frames executor chunks again.
   Old tests only searched for text and missed the malformed protocol. The strict
   client parser fails on the original binary and passes with the fix. The adapter
   now emits bare compact JSON, drops metadata/heartbeat frames, stops on DONE,
   and lets CPA own the single terminal marker. A scoped converter hook preserves
   CPA 8.0.23's Claude translator, which requires a prefixed input line.
2. **P1 - oversized control messages could wedge the service.** The control
   scanner's limit equalled the maximum inference payload size, leaving no room
   for its envelope. A scanner error then waited for a child whose stdin was still
   open. Requests now fail with 413 before IPC when larger than OFM's 8 MiB cap;
   the control envelope has headroom and a broken reader closes/reaps its child.
   Regression tests reproduce the previous hang and verify subsequent requests.
3. **P2 - local files could enter a distributed binary.** `all:service` included
   ignored/hidden files placed under that directory. The binary now embeds only
   explicit source/asset/license paths. Tests verify the exact allowed set against
   provenance and reject recursive/wildcard embed directives.
4. **P2 - relative Node executable paths broke after changing working directory.**
   A relative executable could pass the probe but fail when the runner set
   `cmd.Dir` to its extracted cache. Resolved executable paths are now absolute;
   an actual Node probe test covers this on Linux.
5. **P2 - transient Windows extraction locks caused startup failure.** Real
   Windows host runs intermittently returned permission/share errors at the atomic
   cache rename. Retry is bounded and limited to permission failures; it never
   deletes an existing cache or bypasses integrity verification. A deterministic
   injected-rename test covers retry, exhaustion and unrelated errors.
6. **P2 - unbounded cache-file reads during integrity verification.** Cache
   verification now checks regular-file type and exact expected size before
   reading, so an oversized replaced file is rejected before allocation.

The new Claude converter hook also retains ownership for an active request if a
concurrent catalog refresh removes its model, then releases it on completion.
This prevents the streaming fix itself from introducing a mid-response regression.

## Validation

- Go unit tests and `go vet`; Linux `go test -race`.
- JS source/provenance/runtime tests plus strict SSE parser regression cases.
- Official CPA 8.0.23 on Windows amd64 and WSL2 Ubuntu amd64, both normal host
  HTTP callbacks and direct-loopback mode with a rejecting global proxy.
- Per-event JSON parsing of Chat, Responses, Anthropic and Gemini streaming;
  exact completion markers, model IDs, text, reasoning, tool arguments and usage.
- Concurrent calls, key rotation, disabled-model admission, real catalog change,
  oversized-request recovery, cancellation before headers/after content, plugin
  disable with an active stream, and service/lock cleanup.
- Management authentication, one-use tickets, Host/Origin rejection, local-only
  listening and exclusion of caller credentials from upstream requests.

Host smoke reports in `dist/` record the native binary SHA-256 so passing checks
can be tied to a specific build. No personal account, API key or real vendor quota
is used by these fixtures.

Final result: 30 Go regression cases plus a subprocess helper, 10 Node tests,
Linux race tests, and 22 normal / 23 proxy host checks per tested platform passed.
The relative-Node-path test runs on Linux; Windows skips it when Node and the
workspace are on separate volumes. No remaining confirmed adapter defect was
identified in this pass; the limits below are not claimed as tested or resolved.

## Residual boundaries

- Real EAC authorization, vendor login/refresh, quotas and region availability
  require the user's own accounts/network and are not certified by mock tests.
- macOS, ARM64 and Alpine are not host-tested; Windows race linking with the
  available portable Zig setup remains unavailable. Linux race tests cover the
  shared Go logic, not every OS-specific path.
- CPA Home direct-plugin routing remains unsupported by CPA 8.0.23. Exact token
  counting returns 501; vendor error details lost by original OFM cannot be rebuilt.
- Runtime caches and explicitly selected local EAC source must remain in a
  trusted user-owned directory. An executable on an explicitly configured PATH is
  trusted; this plugin is not a sandbox against another process with the same
  filesystem privileges. Never commit the private data directory.
- Source builds/manual installation are supported. GitHub Releases, official-store
  packaging and deployment to the user's remote machine are separate actions.
- Upstream SSE comments are consumed, not emitted as JSON. Use CPA's own
  `streaming.keepalive-seconds` if downstream clients require idle heartbeats.
