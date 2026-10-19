# Sources and licenses

This is an independent CPA adaptation, not an official release of OFM or
CLIProxyAPI. CPA adapter source is published at
https://github.com/sy0u1ti/cpa-our-free-model; no plugin-store listing or
binary Release is implied.

## Our Free Model

- Source: https://github.com/Ebony-Vinyl/dsh-our-free-model
- Commit: `f0b979fdf48d3915504f5f20e0a105596712f3c8` (upstream v2.5.3)
- Runtime, providers, console, usage accounting, authentication flows and model
  policy are upstream functionality, not newly authored by this adapter.
- License: `service/vendor/ofm/LICENSE` (MIT).
- Original channel-pack attribution: `service/vendor/ofm/vendor/channel-pack/`.
- Original bundled third-party notices: `service/vendor/ofm/scripts/standalone-third-party.txt`.
- Supplementary web package licenses: `service/vendor/WEB_LICENSES.txt`, fetched
  from versions pinned by the original OFM lockfile. Source URLs and digests are
  in `service/vendor/WEB_LICENSE_SOURCES.json`; no reference-fork license bundle
  is reused.

**The original OFM repository is the sole product-source upstream.** The retained
files are read directly from that repository's pinned Git blobs by
`scripts/import-upstream.mjs`, never from a secondary fork or working-tree copy.
The import covers the whole `src/` tree plus the service entry points and only
those web bundles `assets.json` actually serves, so superseded bundles are not
shipped. Every retained file is byte-for-byte identical to the original except
the two patched files below; `service/vendor/ofm/UPSTREAM.json` records the exact
count. Two CPA-only changes are reproducible in `scripts/upstream-patches.mjs`:

1. Replace the standalone EAC credential-module import with the CPA private
   supplier. The original login, Star validation, signing and authorization
   logic in `eac.mjs` is otherwise unchanged.
2. Remove the channel bundle's built-in Google OAuth defaults and Loomy app ID
   (use explicit private configuration, with a clear missing-config error), and
   lead WorkBuddy/CodeBuddy wire messages with a system entry. The Tencent
   gateway rejects any request whose first message is not a system prompt with
   `400 + code 11128`, and the OpenAI gateway path only forwarded one when the
   caller supplied it.

`service/vendor/ofm/UPSTREAM.json` records original Git blob IDs, original
SHA-256 hashes, resulting hashes, patch IDs and omitted optional credential
files. `service/upstream-eac.json` is generated directly from the original
revision and pins the optional source download. `npm test` verifies retained
hashes; with the original checkout available it also checks every file against
`git show` plus the declared CPA patches.

The original EAC credential module and two encrypted data files are not distributed. EAC is opt-in:
the original pinned source may be installed in a private cache, with pinned
SHA-256 verification, or explicitly loaded from a trusted local source. Its
original standalone entry point, GitHub login, Star check and server-side
authorization remain unchanged. We do not embed, display or log decrypted
gateway material, or provide a way to bypass authorization.

## Reference Only

https://github.com/mu-zi-lee/magpie-our-free-model was inspected to understand
the possibility of adapting OFM to another host. It is not a source or runtime
dependency of v0.2.0: no Magpie snapshot, helper module or frontend patch is
included. The earlier v0.1.0 development prototype used that snapshot and was
superseded after clarification; it is not the delivered baseline.

The CPA adapter, private source loader and console ticket server are local CPA
code. Node version/hash data is verified directly against nodejs.org's official
SHASUMS256.txt rather than using the reference project as the authority.

## CLIProxyAPI

- Source: https://github.com/router-for-me/CLIProxyAPI
- ABI reference and tested release: v8.0.23,
  `d318bcc3afb9ea8782862f5e8cdb541afdc9dfa5`.
- License: `service/vendor/CPA_LICENSE` (MIT).
- C ABI declarations and JSON wire contracts follow its plugin examples and SDK.
  The plugin does not statically link the CPA server or modify CPA source.
- CPA metadata `GitHubRepository` points to this adapter's repository,
  https://github.com/sy0u1ti/cpa-our-free-model. OFM provenance remains the original
  repository and pinned revision recorded above, not this publication address.

## Runtime dependencies

- Go YAML v3 (`gopkg.in/yaml.v3` v3.0.1), MIT/Apache-2.0; its license is retained
  with the source distribution and release license bundle.
- Optional Node.js 24.21.0 comes only from https://nodejs.org/ after verification.
  Node is not embedded in the plugin. Its license and third-party terms are at
  https://github.com/nodejs/node/blob/v24.21.0/LICENSE. Unix archives retain
  their licenses; Windows downloads only the official executable.

No user credentials, API keys, local account data, test toolchains or reference
checkouts belong in the source distribution or release package.
