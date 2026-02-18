# E2EE Research Addendum: Search, Plugin Commands, External-Origin Media

## Why This Exists

You asked for feasible ways to keep Discord-like functionality while moving to strict E2EE, specifically:

1. full-text search over large histories
2. plugin commands in E2EE channels
3. external server-origin media streams in E2EE voice/video

This document focuses on what is practical to ship in Sharkord, with explicit tradeoffs.

---

## Executive Summary

## 1) E2EE Full-Text Search

Fully private, globally scalable search is feasible, but not with one single "perfect" technique today.

Best practical architecture is hybrid:

1. local-first encrypted index (hot data, zero server query leakage)
2. encrypted index shard sync for multi-device continuity
3. optional remote assisted search for cold history:
   - leakage-accepting DSSE mode (fastest single-server)
   - two-server pattern-hiding mode (stronger privacy)
   - attested enclave search mode (operationally simpler than two-server, trust shifts to TEE root)

## 2) Plugin Commands

Feasible in E2EE if command invocation is explicit and no longer inferred from plaintext message parsing:

1. client-side command packaging/signing/encryption
2. capability-scoped execution model:
   - local deterministic plugins (best privacy)
   - attested confidential server plugins (for secretful integrations)
   - legacy plaintext-only plugin mode for incompatible plugins

## 3) External Server-Origin Streams

Feasible in E2EE by turning source endpoints into cryptographic participants:

1. treat each external source as a "publisher device" (bot identity)
2. ingest via WHIP/WebRTC
3. encrypt frames with SFrame-style keys before SFU forwarding
4. optional attestation gate before key release to server-run publisher agents

---

## 4) Active Malicious Server Caveat

If an attacker can modify the web bundle served to clients, they can exfiltrate keys/plaintext at runtime.

So E2EE claims must explicitly distinguish:

1. storage-compromise resistance (DB/object-store/server-state theft)
2. active malicious-server resistance (requires independent client code integrity trust anchor)

High-assurance options:

- signed native clients
- wrapper/extension with pinned release signing key
- transparency log + reproducible builds + externally anchored verification

---

## A. E2EE Search: What Is Actually Feasible

## A1. Ground Truth

### Deployed pattern in current E2EE products

- Proton Mail performs content search via local index on user device/browser; index is local and encrypted-at-rest on device context.
- Element/Matrix encrypted-room search is client-side/cache-driven and has practical client constraints.

Implication:

- local-first search is proven and feasible
- server-only opaque search with no leakage is still hard at product scale

### Research frontier

- Modern searchable encryption can be fast, but leakage remains the core risk in many schemes.
- Newer systems such as MUSES reduce leakage significantly using multi-party cryptography, but add system complexity and assumptions (multiple non-colluding parties).

---

## A2. Technique Matrix

| Technique | Privacy | Performance | Large History | Operational Complexity | Feasibility for Sharkord |
|---|---|---|---|---|---|
| Local-only index | Strongest (server sees no query) | Great for hot/local data | Bounded by device storage | Low-Medium | High |
| Single-server DSSE | Medium (leakage risk) | High | High | Medium | High |
| Two-server pattern-hiding (MUSES-like) | Strong | Medium-High | High | High | Medium |
| PIR-assisted retrieval | Strong query privacy | Medium | Medium-High (depends on infra) | High | Medium-Low |
| TEE search enclave | Medium-Strong (depends on attestation trust) | High | High | Medium-High | High (for managed/self-hosted advanced mode) |
| FHE full text search | Strong on paper | Low today for this use case | Low-Medium | Very High | Low (not recommended now) |

---

## A3. Recommended Search Architecture for Sharkord

### Tier 0: Local-First Default

1. Build per-channel inverted index client-side.
2. Encrypt stored index segments using client key hierarchy.
3. Keep recent history and frequently accessed channels indexed locally.
4. Run BM25/token ranking fully on device.

Pros:

- no query leakage to server
- very responsive for day-to-day usage

Limits:

- new device bootstrap requires index catch-up or background rebuild
- huge histories need additional strategy

### Tier 1: Encrypted Index Segment Sync (EISS)

Novel-but-feasible step:

1. client periodically emits encrypted compressed index segments (not plaintext docs)
2. server stores opaque segments
3. new device downloads encrypted segments and reconstructs local index quickly

This is effectively "search-state sync", not plaintext sync.

History UX implication:

- new devices can become search-usable quickly while full envelope decryption continues in background.
- this supports "enter channel and see history" expectations without waiting for complete reindex from scratch.

### Tier 2: Cold History Remote Assist

Support multiple policies:

1. `remote_search_mode = off`
   - strict privacy, local only
2. `remote_search_mode = dsse`
   - fastest large-scale search with leakage caveats
3. `remote_search_mode = two_server`
   - stronger privacy using non-colluding services
4. `remote_search_mode = tee`
   - attested enclave computes search over encrypted/guarded index

### Query Planner

For each query:

1. search local hot index first
2. if results insufficient and user allows, query cold tier per policy
3. merge and rerank results locally

Timeline consistency rule:

- search results must resolve to an existing timeline item or an explicit boundary marker.
- no result should point to an invisible/silent gap.

### Leakage Controls (if DSSE used)

1. query batching
2. cover queries
3. periodic key/epoch rotation
4. posting-list padding and bounded bucketization
5. server-observable telemetry minimization

Important:

- leakage attacks against SSE/DSSE remain active research and practical concern.
- DSSE mode must be explicitly labeled as privacy-performance tradeoff.

---

## A4. Where This Fits in Sharkord Code

Primary touchpoints:

- `apps/client/src/features/server/messages/*`
- `apps/client/src/components/channel-view/text/*`
- `apps/server/src/routers/messages/get-messages.ts`
- `apps/server/src/routers/messages/send-message.ts`
- `packages/shared/src/types.ts`
- new `apps/client/src/features/e2ee/search/*`
- new `apps/server/src/routers/e2ee-search/*` (for cold-tier assist only)

---

## B. Plugin Commands Under E2EE

## B1. Current Incompatibility

Today server parses plaintext message content to detect/execute plugin commands:

- `apps/server/src/routers/messages/send-message.ts`
- `apps/server/src/helpers/parse-command-args.ts`
- `apps/server/src/plugins/index.ts`
- `packages/plugin-sdk/src/index.ts`

This breaks strict E2EE assumptions.

## B2. Feasible Replacement Model

### Command Invocation Envelope

Instead of "parse text on server":

1. client UI triggers command explicitly (slash UI / command palette)
2. client builds signed command envelope:
   - plugin id
   - command name
   - encrypted args payload
   - capability token
   - idempotency key
3. envelope sent to command executor path
4. results returned as encrypted response envelope

Message text remains opaque to server.

### Plugin Capability Classes

Define three execution classes:

1. `LOCAL_ONLY`
   - runs in client sandbox (Wasm component)
   - best privacy
2. `CONFIDENTIAL_REMOTE`
   - runs in attested confidential runtime
   - key release only after attestation policy pass
3. `PLAINTEXT_LEGACY`
   - disallowed in strict E2EE channels

### Why Wasm Components

WebAssembly Component Model + WASI give a practical capability-oriented sandbox model for untrusted plugin logic.

### Why Attestation for remote plugins

Some commands need network-side secrets (e.g. integrations, webhooks, enterprise systems).
Use remote attestation (RATS model) + enclave measurement policy before releasing minimal per-command decryption material.

This is not perfect trustlessness, but it is feasible and auditable.

## B5. Delegated Plugin Read Keys (Your Shared-Key Idea, Safely)

Yes, this is feasible, but do it as **scoped delegated keys**, not a single shared channel key for everything.

## Design Goal

Allow specific plugins to read channel content in E2EE channels while keeping blast radius constrained.

## Channel Security Modes

Introduce explicit modes:

1. `strict_e2ee`
   - no plugin plaintext access
2. `delegated_plugin_read`
   - only explicitly granted plugins can decrypt channel content
3. `plaintext_legacy`
   - existing behavior

## Key Model

For channel `C`, plugin `P`, epoch `E`:

1. channel epoch key: `CEK[C,E]` (human participants)
2. plugin read key: `PRK[C,P,E] = HKDF(CEK[C,E], "plugin-read:v1|C|P|E")`

Do not reuse keys across:

- channels
- plugins
- epochs

## Message Encryption Pattern

1. message payload encrypted once with `MK` (message key)
2. sender includes normal member envelopes for human devices
3. sender includes plugin envelope(s) for granted plugins:
   - `wrap(MK, PRK[C,P,E])` or HPKE-wrapped to plugin device key

This keeps payload duplication low while preserving recipient scoping.

## Plugin Identity Requirements

Each plugin gets cryptographic identity:

- `plugin_id`
- long-term public key
- optional attestation policy (measurement allowlist)

Granting plugin read access means:

- plugin principal becomes authorized recipient for that channel/epoch

## Rotation Rules

Rotate channel epoch (and all derived plugin keys) on:

1. plugin grant
2. plugin revoke
3. member join/leave
4. plugin key rotation
5. compromise event

## Revocation Semantics

After revoke:

- plugin loses future decrypt ability post-epoch-rotation
- past messages remain readable if plugin already obtained keys

If stronger "no historical access" is required, do not grant plugin read in first place.

## UX Recommendation

When admin enables plugin read access:

Show a hard warning:

- "This plugin can read message content in selected channels."

Also display:

- which channels
- granted capabilities
- last attestation status (if remote confidential plugin)

## Practical Security Tiers

1. `Local plugin read` (client-side plugin)
   - strongest privacy
2. `Attested remote plugin read`
   - moderate-strong, operationally practical
3. `Unattested remote plugin read`
   - convenience mode, clearly marked reduced security

## Why This Is Better Than One Shared Key

A single shared key creates catastrophic cross-plugin/cross-channel blast radius.

Scoped delegated keys provide:

- per-plugin isolation
- per-channel isolation
- epoch-bounded forward control

---

## B3. Novel Practical Add-on: Privacy-Preserving Command Quotas

Use Privacy Pass / OPRF-style blind issuance to separate:

- permission to execute command
- user identity observability at the quota-check layer

Potential use:

- anti-abuse credits for expensive commands
- reduced direct linkage between command execution rate checks and user identity

This is optional advanced mode, not phase-1 critical path.

---

## B4. Sharkord Integration Points

Must change:

- `apps/server/src/routers/messages/send-message.ts` (remove command parsing dependency in E2EE mode)
- `apps/server/src/routers/plugins/execute-command.ts` (accept command envelope types)
- `apps/server/src/plugins/index.ts` (capability classes + attested executor hooks)
- `packages/plugin-sdk/src/index.ts` (declare execution class and permissions)
- `packages/shared/src/plugins.ts` (new envelope/capability types)
- client command UI:
  - `apps/client/src/components/tiptap-input/*`
  - `apps/client/src/components/dialogs/plugin-commands/*`
  - new `apps/client/src/features/e2ee/commands/*`

---

## C. External Server-Origin Streams in E2EE Rooms

## C1. Problem

Current external streams are created server-side via plugin actions:

- `packages/plugin-sdk/src/index.ts`
- `apps/server/src/plugins/index.ts`
- `apps/server/src/runtimes/voice.ts`

In strict E2EE, SFU/server should not have media plaintext keys.

## C2. Feasible "Find a Way" Design

### Publisher Device Pattern

Treat each external source as an E2EE participant:

1. source adapter process joins room as bot/publisher device
2. receives room media key envelopes (same policy as real clients)
3. encrypts outbound encoded frames (SFrame-style) before media leaves publisher
4. SFU only forwards encrypted frames

### Ingestion Path

- Prefer WebRTC ingestion using WHIP endpoint semantics.
- For non-WebRTC sources (RTMP/file/live input), transcode in publisher process and then send encrypted WebRTC frames.

### Attested Publisher Option

For managed deployments, run publisher in TEE.
Room key release requires attestation match:

- expected measurement
- allowed plugin/source identity
- time-bound key lease

### Rekey Handling

On membership/device changes:

1. room epoch rotates
2. publisher receives new wrapped key
3. transform switches key epoch with overlap window

### Security Posture

- strict mode: only attested or user-trusted publisher devices may inject
- relaxed mode: allow normal publisher bots with admin warning badge

---

## C3. Sharkord Integration Points

- `apps/client/src/components/voice-provider/hooks/use-transports.ts`
- `apps/client/src/components/voice-provider/index.tsx`
- `apps/server/src/routers/voice/*` (new epoch and publisher metadata routes/events)
- `apps/server/src/runtimes/voice.ts` (publisher identity + epoch bookkeeping)
- `packages/shared/src/voice.ts` and `packages/shared/src/events.ts` (new E2EE voice event types)
- plugin API:
  - `packages/plugin-sdk/src/index.ts`
  - `apps/server/src/plugins/index.ts`

---

## D. Concrete Recommended Plan (What To Build)

## D1. Search

Phase S1:

1. local encrypted inverted index
2. background indexing worker
3. encrypted index segment sync

Phase S2:

1. optional DSSE cold-tier mode with explicit privacy label
2. leakage mitigations and query batching

Phase S3:

1. two-server pattern-hiding mode (enterprise/high-privacy)
2. optional TEE mode for operators preferring single control plane

Validation experiments:

1. DSSE leakage simulation (frequency/access-pattern inference tests)
2. cold-history latency benchmark at 1M+ message/channel scale
3. failure injection: missing index segments with timeline consistency checks

## D2. Plugin Commands

Phase P1:

1. explicit command envelopes (no plaintext parsing)
2. `LOCAL_ONLY` and `PLAINTEXT_LEGACY` classes
3. add `delegated_plugin_read` channel mode and admin warnings

Phase P2:

1. `CONFIDENTIAL_REMOTE` class with attestation-gated execution
2. encrypted result envelopes
3. plugin-scoped read key derivation (`PRK[C,P,E]`) and envelope support

Phase P3:

1. optional OPRF/Privacy-Pass style anonymous command credits

Validation experiments:

1. plugin sandbox escape test suite
2. command-envelope replay/forgery corpus tests
3. attestation-policy mismatch behavior tests (reject + user-visible diagnostics)

## D3. External-Origin Streams

Phase X1:

1. publisher device abstraction
2. E2EE media inject path with SFrame-like transforms

Phase X2:

1. WHIP-based ingest adapters
2. strict-mode policy controls and trust badges

Phase X3:

1. attested publisher support
2. key lease + revocation automation

Validation experiments:

1. rekey-storm tests under heavy join/leave churn
2. packet-loss + epoch-overlap correctness tests
3. compromised publisher revocation MTTR measurement

---

## E. Non-Negotiable Product Decisions

These need explicit policy choices:

1. Is DSSE leakage-accepting mode enabled by default or opt-in?
2. Are `PLAINTEXT_LEGACY` plugins blocked in `e2ee_required` channels?
3. Are external server-origin streams allowed in strict E2EE without attestation?
4. Is two-server privacy mode supported only for managed deployments?
5. What is the UX copy for search privacy levels?

---

## F. References

Primary references used for feasibility and design constraints:

1. Proton content search (local encrypted index model):  
   `https://proton.me/support/search-message-content`
2. Proton engineering details for local search design:  
   `https://proton.me/blog/engineering-message-content-search`
3. Matrix encrypted-room search operational behavior (client caching reality):  
   `https://docs.matrix.kit.edu/en/messaging/search/`
4. MUSES (USENIX Security 2024) multi-user encrypted search with pattern hiding:  
   `https://www.usenix.org/conference/usenixsecurity24/presentation/le`
5. Leakage-abuse attack literature (MUSE leakage risk evidence):  
   `https://petsymposium.org/popets/2017/popets-2017-0034.php`  
   `https://dblp.org/rec/journals/iacr/CashGPR16.html`
6. SFrame standard (E2EE media over SFU):  
   `https://datatracker.ietf.org/doc/html/rfc9605`
7. WebRTC encoded transform standard (worker transforms):  
   `https://www.w3.org/TR/webrtc-encoded-transform/`  
   `https://developer.mozilla.org/en-US/docs/Web/API/RTCRtpScriptTransform`
8. WHIP ingest standard (WebRTC HTTP ingestion):  
   `https://datatracker.ietf.org/doc/html/rfc9725`
9. MLS protocol and architecture (group keying baseline):  
   `https://www.ietf.org/rfc/rfc9420.html`  
   `https://datatracker.ietf.org/doc/html/rfc9750`
10. Discord OAuth2 docs (auth flow constraints/endpoints):  
    `https://discord.com/developers/docs/topics/oauth2`
11. Remote attestation architecture and operational references:  
    `https://datatracker.ietf.org/doc/html/rfc9334`  
    `https://docs.aws.amazon.com/enclaves/latest/user/set-up-attestation.html`
12. OPRF / Privacy Pass standards for privacy-preserving token issuance patterns:  
    `https://datatracker.ietf.org/doc/html/rfc9497`  
    `https://datatracker.ietf.org/doc/html/rfc9578`
13. WebAssembly component and sandbox capability references:  
    `https://component-model.bytecodealliance.org/`  
    `https://docs.wasmtime.dev/security.html`
14. Practical searchable-encryption beacon tradeoffs (industry implementation caveats):  
    `https://docs.aws.amazon.com/database-encryption-sdk/latest/devguide/searchable-encryption.html`
