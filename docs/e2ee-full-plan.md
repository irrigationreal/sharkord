# Sharkord Full E2EE Plan

## Purpose

This document is an implementation plan to move Sharkord from server-readable chat/media into full end-to-end encryption (E2EE) with:

- strong practical security
- high runtime performance
- low-friction UX (no repeated prompts, minimal user ceremony)

This plan is written for the current Sharkord architecture (Bun server, tRPC over WebSocket, SQLite, mediasoup SFU, React client).

For targeted deep research on E2EE full-text search, plugin commands, and external-origin media streams, see:

- `docs/e2ee-research-search-plugins-external.md`
- `docs/e2ee-v1-protocol-spec.md` (normative v1 object formats and API contracts)

---

## Current Constraints (From Code Reality)

Sharkord is currently not E2EE by design:

- messages are plaintext in DB and server logic (`apps/server/src/db/schema.ts`, `apps/server/src/routers/messages/send-message.ts`)
- server parses/sanitizes/processes message content and metadata (`apps/server/src/routers/messages/send-message.ts`, `apps/server/src/queues/message-metadata/get-message-metadata.ts`)
- files are uploaded/stored/served in plaintext (`apps/server/src/http/upload.ts`, `apps/server/src/utils/file-manager.ts`, `apps/server/src/http/public.ts`)
- voice uses SFU transport without client-layer media encryption (`apps/server/src/runtimes/voice.ts`, `apps/client/src/components/voice-provider/hooks/use-transports.ts`)
- credential/session baseline needs hardening before E2EE (SHA-256 password hashing, localStorage password persistence, shared secret use)

E2EE requires architectural changes across client, server, schema, and product feature model.

---

## Security Targets

## Trust Boundary Clarification (Web Delivery)

E2EE claims depend on what "server compromise" means.

In a web-delivered client model, an active malicious server may alter JS bundle delivery and effectively compromise endpoints.

Therefore define two explicit assurances:

1. `storage-compromise resistance` (required baseline)
   - DB/object-store/server-state theft does not reveal plaintext.
2. `active-malicious-server resistance` (higher bar)
   - requires independent client code trust anchor beyond same compromised server path.

High-assurance deployment options:

- signed desktop/mobile clients for strict E2EE spaces
- browser wrapper/extension with pinned app signing key
- reproducible builds + code transparency logs + externally anchored release verification

If these are not enabled, market the guarantee as storage-compromise resistant E2EE, not fully malicious-server resistant.

## Threat Model Levels

Use explicit levels instead of one vague "fully secure" label.

### Level 0: Hardened Non-E2EE

Protects against common internet threats and weak auth/storage practices.
Does not protect message/file content from server compromise.

### Level 1: E2EE Text and Files

Protects message/file content from:

- compromised server process
- database exfiltration
- object/file store theft
- passive network interception

Still leaks metadata needed for routing and product functionality (user IDs, channel IDs, timing, sizes, membership).

### Level 2: E2EE Voice/Video

Adds client-layer media encryption on top of SFU transport.
SFU routes packets but cannot decrypt media payloads.

Metadata leakage still exists at transport level (who is in call, bitrate patterns, timing).

---

## Adversary Matrix

| Adversary | Capability | Level 0 | Level 1 | Level 2 |
|---|---|---|---|---|
| Passive network observer | Sniff traffic | TLS/WSS blocks plaintext | Same | Same |
| Active MITM | Tamper/replay | TLS + session hardening | Same + AEAD message auth | Same + media frame auth |
| DB thief | Stolen SQLite backup | Reads plaintext today | Gets ciphertext only | Gets ciphertext only |
| Server RCE | Full app process control | Can read everything | Cannot read message/file plaintext keys unless endpoint compromised | Cannot read message/file/media plaintext keys unless endpoint compromised |
| Malicious plugin | Reads server events/data | Can read today | Must be sandboxed; cannot access plaintext payload | Same |
| Malicious channel member | Authorized recipient | Can read own channels | Can read own channels | Can read own channels |
| Stolen user device | Local compromise | Depends on local secrets | Depends on local key protection + lock state | Same |
| XSS in web client | Execute JS in origin | Critical | Critical; can steal decrypted data live | Critical |

Key point: E2EE does not remove endpoint compromise risk. Browser hardening is mandatory.
Key point: web bundle integrity strategy determines how far "server compromise" resistance really extends.

---

## UX Principles (Low Friction, High Trust)

1. No repeated prompts in normal operation.
2. One-time key bootstrap on first login/device creation.
3. New-device setup should be "silent if possible", explicit ceremony only when needed.
4. Advanced verification is available but optional.
5. Failure modes degrade predictably ("cannot decrypt message", "re-request key"), never silent corruption.

## History UX Contract (Non-Negotiable)

Default user expectation:

- entering a channel shows all accessible history unless explicitly marked otherwise.

### Requirements

1. No silent holes in timeline.
2. If history is intentionally unavailable, UI must show explicit reason marker.
3. Key unavailability must trigger automatic key-catchup before showing permanent failure.
4. New devices should recover channel history without manual user intervention.

### Allowed explicit markers

Only these states may appear as visible boundaries:

1. `retention_boundary`
   - server/channel retention policy intentionally removed older content
2. `channel_created_boundary`
   - no messages existed before channel creation
3. `access_boundary`
   - user was not entitled to earlier content by policy
4. `temporary_decrypt_pending`
   - key retrieval/recovery in progress
5. `irrecoverable_decrypt_failure`
   - content cannot be decrypted after automated retries and recovery attempts

Anything else is a bug.

### Channel Entry Behavior

On channel open:

1. render local cached decrypted history immediately
2. request newest envelope window from server
3. start background backfill toward oldest known boundary
4. run automatic key catchup for missing epochs/devices
5. merge and dedupe timeline deterministically

User should not have to click "load missing keys" in normal flow.

### New Device History Bootstrap

1. restore keys from trusted-device transfer or recovery bundle
2. sync encrypted history envelopes and encrypted index segments
3. decrypt in background with progressive render
4. keep scroll position stable while backfill completes

### Product Rule

If a channel is marked as standard chat (not ephemeral), history completeness is a release requirement.
If a channel is ephemeral/retention-limited, boundaries must be clearly labeled at all times.

### UX Modes

- Default mode: frictionless, no recurring prompts, encrypted backup enabled automatically.
- High-assurance mode: requires device-to-device approval (QR or one-time code) for new devices.

Default mode keeps product slick; high-assurance mode covers stronger operator/security teams.

---

## Crypto Architecture

## Primitive Choices (Performance + Availability)

- ECDH: X25519 (via audited library/wasm)
- Signatures: Ed25519
- KDF: HKDF-SHA256
- Symmetric AEAD (messages/files): AES-256-GCM (WebCrypto native path)
- Optional message-layer AEAD hardening: AES-GCM-SIV (misuse-resistant mode)
- Hash: SHA-256 (for protocol digest, not password hashing)
- Password hashing: Argon2id

Notes:

- AES-GCM is selected for browser-native performance and hardware acceleration.
- AES-GCM-SIV is recommended for message envelopes if library/perf budget allows, to reduce catastrophic nonce-reuse failure risk.
- Avoid ad-hoc crypto; use established protocol libraries where practical.

## Protocol Stack

### Pairwise Device Sessions

- X3DH-style prekey bootstrap per device pair.
- Double Ratchet for pairwise encrypted control messages and key envelopes.

### Group/Channel Messaging

- Sender Keys model per channel epoch for throughput and low overhead.
- Each sender uses symmetric sender chain keys for channel messages.
- Membership changes trigger epoch rotation and sender key redistribution.

Trust hardening requirements:

- account/device recipient authorization must not be server-writable without client-verifiable signatures.
- channel/group state must include signed monotonic commitments to detect rollback/downgrade/equivocation.

Why sender keys first:

- good performance for active group chat
- simpler migration in current architecture
- proven in large-scale messaging systems

Future path:

- MLS can be introduced later for formal group state semantics after baseline E2EE is stable.

### Channel State Commitments (CSC)

Each epoch transition publishes a signed state commitment:

- `channelId`
- `epoch`
- `prevCscHash`
- `membershipDigest`
- `encryptionPolicyDigest`
- `createdByDeviceId`
- `createdAt`
- `signature`

Clients verify:

1. monotonic epoch progression
2. hash-chain continuity
3. signer authorization
4. policy consistency (for downgrade resistance)

Messages bind `cscHash` in authenticated header context.

### File Encryption

- Per-file DEK generated client-side.
- File encrypted client-side in chunks (streaming AES-GCM with per-chunk nonce schedule).
- DEK encrypted for channel epoch as metadata envelope.
- Server stores opaque ciphertext bytes and encrypted envelope only.

### Voice/Video Encryption

- Keep WebRTC + mediasoup transport.
- Add Insertable Streams frame encryption (SFrame-style).
- Per-room epoch keys with frequent ratchet (time-based and membership-based).
- SFU forwards encrypted payload, cannot decrypt frame content.

---

## Key Hierarchy

1. Account Root Key (ARK, long-lived signing trust anchor)
2. Device Identity Key Pair (long-lived, per device, ARK-authorized)
3. Signed Prekeys + One-time Prekeys (rotating)
4. Pairwise Session Keys (double ratchet state)
5. Channel Epoch Key (rotates on membership change)
6. Sender Chain Keys (per sender, per epoch)
7. File DEKs (per object)
8. Voice Room Media Keys (per room epoch)

All content keys are generated and used client-side.

---

## Key Lifecycle and Recovery (Minimal Prompt Strategy)

## First Login On Device

- Client generates identity keypair + prekeys.
- Client generates or imports ARK trust material.
- Client registers device and prekeys with server.
- Client creates encrypted recovery bundle.
- Recovery bundle upload happens automatically.

No prompt required in default mode.

## Recovery Bundle Design

- Bundle contains encrypted private key material needed for new device restore.
- Encrypt bundle with Recovery Key material derived from recovery factors using Argon2id/HKDF.
- Store only encrypted bundle + metadata on server.

Default mode:

- Derive recovery key from:
  - WebAuthn passkey assertion gate, and
  - high-entropy recovery code (or equivalent offline factor).
- Tradeoff: recovery UX is slightly more complex, but avoids tying key authority to OAuth or password reuse.

High-assurance option:

- additional offline recovery factor + delayed recovery release window.

## New Device Bootstrap

Preferred order:

1. If trusted device online: device-to-device encrypted transfer (QR or short code once).
2. Else: decrypt recovery bundle locally and restore keys.
3. Else: create new identity (requires account-level rekey procedure).

## Rotation and Revocation

- rotate signed prekeys periodically (for example daily)
- rotate one-time prekeys aggressively (on use + refill)
- rotate channel epoch on membership change and compromise events
- allow per-device revoke flow, then trigger channel key re-encryption wave
- ARK-signed device revocation statements must gate recipient eligibility immediately

All of this is background automation from user perspective.

---

## Discord Sign-In Model (No Local Account UX)

This section answers the "login with Discord, no manual account creation" requirement.

## Principle

Use Discord OAuth for identity bootstrap, but never for encryption authority.

- Discord proves who the user is.
- Device keys and recovery factors prove who can access decrypted data.

## Why Keys Must Not Be Derived From Discord Tokens

Do not derive AMK or content keys from:

- Discord access tokens
- Discord refresh tokens
- Discord user ID directly

Reasons:

1. token rotation/expiration semantics are IdP-managed and unstable for key material
2. OAuth compromise would become immediate decryption compromise
3. key continuity across IdP outages and account events becomes fragile

Correct model:

- generate Account Master Key (AMK) client-side once
- wrap AMK to trusted devices and recovery factors
- Discord sign-in only gates identity/session bootstrap

## Accountless UX With Local Principal

User experience:

1. user clicks "Continue with Discord"
2. no local username/password form required
3. Sharkord auto-provisions or links local principal silently

Backend reality:

- local `users` row still exists for authorization, roles, memberships, permissions
- `auth_identities` table links provider identity to local principal
- first OAuth login can create user automatically if invite/registration policy allows

## OAuth Flow (Server-Side Authorization Code)

1. Client hits server `GET /auth/discord/start`.
2. Server generates `state` and `nonce`, stores hashed state with TTL.
3. Server redirects to Discord authorize endpoint with `response_type=code` and `scope=identify`.
4. Discord redirects back to `GET /auth/discord/callback?code=...&state=...`.
5. Server validates state, exchanges code at Discord token endpoint.
6. Server calls Discord `/users/@me` to get stable subject id.
7. Server resolves/creates local principal and issues Sharkord session.

Reference endpoints:

- authorize: `https://discord.com/oauth2/authorize`
- token exchange: `https://discord.com/api/oauth2/token`
- current user: `https://discord.com/api/users/@me`

Recommended additional behavior:

- pass and persist `deviceId` through start/callback
- apply invite and `allowNewUsers` policy during first-time OAuth provisioning
- create/update `user_devices` and bind session to device record

## Session Model For Discord Login

Use revocable server-side sessions instead of JWT-only stateless auth.

- access token: short TTL, opaque random value, hash stored in `auth_sessions`
- refresh token: rotating, reuse detection
- bind tokens to `user_device` record
- include `auth_provider` metadata for audit

Keep current transport shape in phase 1:

- WS `connectionParams.token`
- upload `x-token`

Swap backend validator from token decode/signature validation to session lookup.

## Key-Release Policy (Critical)

Default secure policy for OAuth users:

1. OAuth success gives app session.
2. Decryption key release requires one of:
   - existing trusted device approval, or
   - recovery threshold factors (for example passkey + recovery code), or
   - delayed recovery escrow policy.

This prevents "Discord takeover => immediate plaintext access".

## Recovery Policy (Low Prompt, Stronger Safety)

Recommended default:

- recovery passkey (WebAuthn discoverable credential)
- plus recovery code
- optional 24h delayed escrow path if both unavailable

Normal daily use remains silent; prompts appear only for risky flows:

- new device enrollment
- recovery start
- device revoke
- disabling security settings

## Invite and Server Password Compatibility

OAuth-first login still respects current server policy:

- if `allowNewUsers=false`, invite required for first OAuth identity
- server password gate in join flow can remain as optional server-level access control

But server password handling must be hardened:

- do not store plaintext
- do not emit raw value to admin clients/logs

---

## Discord Feature-Parity Under E2EE (Practical)

This matrix reflects current Sharkord features and the required E2EE behavior.

| Feature | Current State | E2EE-Compatible Direction | Cost |
|---|---|---|---|
| text messages | server plaintext | ciphertext envelopes, client decrypt | L |
| edits/deletes | server content mutation | envelope replacement + tombstones | M |
| reactions | server metadata | keep metadata server-side | S |
| typing | server metadata | unchanged | S |
| unread/read states | server metadata | unchanged with envelope IDs | S |
| file attachments | plaintext objects | client chunk encryption + encrypted manifests | XL |
| avatar/banner/logo/emoji files | plaintext files | optional keep plaintext; configurable encrypted assets mode | M |
| link previews | server URL fetch | client-side preview or disabled in strict channels | M |
| plugin commands from message text | server parses plaintext | explicit command RPC, no message-text parsing in E2EE channels | L |
| moderation/search | server-readable content | metadata-first + client report bundles + local search index | L |
| voice/video/screen share | SFU can access media payload | insertable streams frame encryption + room key epochs | XL |
| external plugin streams | server-origin media | disable in strict E2EE rooms initially | M |

---

## Required Server Changes

## Schema Additions

Add new tables (names indicative):

- `user_root_keys`
  - `user_id`, `ark_pub`, `version`, `created_at`, `rotated_at`
- `device_authorizations`
  - `user_id`, `device_id`, `ark_version`, `device_record_hash`, `ark_signature`, `created_at`, `revoked_at`
- `auth_identities`
  - `id`, `user_id`, `provider`, `provider_subject`, `created_at`, `updated_at`, `last_login_at`
- `auth_sessions`
  - `id`, `user_id`, `user_device_id`, `token_hash`, `refresh_hash`, `auth_provider`, `created_at`, `expires_at`, `revoked_at`
- `oauth_states`
  - `state_hash`, `provider`, `device_id`, `invite_code`, `created_at`, `expires_at`, `consumed_at`
- `user_devices`
  - `id`, `user_id`, `device_id`, `identity_pub`, `signing_pub`, `created_at`, `last_seen_at`, `revoked_at`
- `device_prekeys`
  - `device_id`, `prekey_id`, `prekey_pub`, `signature`, `one_time`, `created_at`, `used_at`
- `channel_key_epochs`
  - `channel_id`, `epoch`, `created_by_device_id`, `created_at`
- `channel_state_commitments`
  - `channel_id`, `epoch`, `prev_hash`, `membership_digest`, `policy_digest`, `csc_hash`, `signer_device_id`, `signature`, `created_at`
- `channel_key_envelopes`
  - `channel_id`, `epoch`, `recipient_device_id`, `encrypted_epoch_key`, `created_at`
- `encrypted_messages`
  - `message_id`, `channel_id`, `sender_device_id`, `epoch`, `ciphertext`, `aad`, `nonce`, `algorithm`, `created_at`
- `encrypted_files`
  - `file_id`, `uploader_device_id`, `cipher_manifest`, `encrypted_dek_envelope`, `chunk_size`, `algorithm`
- `key_backups`
  - `user_id`, `backup_id`, `ciphertext`, `salt`, `kdf_params`, `created_at`, `updated_at`

Existing `messages.content` and metadata flows should remain temporarily for migration mode only, then be deprecated for E2EE channels.

Add history-boundary metadata model (for explicit UX markers):

- `channel_history_boundaries`
  - `channel_id`, `type`, `effective_from_message_id`, `effective_from_ts`, `reason`, `created_at`

This prevents ambiguous gaps and supports deterministic client rendering.

## API and Router Additions

Add an `e2ee` router namespace:

- `registerDevice`
- `uploadPrekeys`
- `claimPrekey`
- `publishChannelEpoch`
- `fetchChannelEpochEnvelopes`
- `uploadEncryptedMessage`
- `getEncryptedMessages`
- `uploadEncryptedFileManifest`
- `getEncryptedFileManifest`
- `putKeyBackup`
- `getKeyBackup`
- `revokeDevice`
- `getHistoryBoundaries`
- `requestKeyCatchup`

Add auth endpoints/routes for Discord-first login:

- `GET /auth/discord/start`
- `GET /auth/discord/callback`
- `POST /auth/session/refresh`
- `POST /auth/logout`

Update connection parameters (`packages/shared/src/types.ts`) with:

- `deviceId`
- `clientCryptoVersion`
- `capabilities` (text_e2ee, file_e2ee, voice_e2ee)

## Server Behavior Changes

- server stops sanitizing/parsing E2EE message payloads
- server treats E2EE payload as opaque bytes + minimal envelope metadata
- server no longer computes link metadata for E2EE channels
- plugin event bus must not receive plaintext content from E2EE channels
- OAuth state/nonce must be strict single-use with short TTL and replay rejection
- Discord identity link is keyed by stable provider subject, not mutable username
- server must not be able to add decrypt-eligible devices without ARK-verifiable authorization
- server must enforce monotonic CSC epochs and reject rollback

Migration-safe approach:

- channel-level mode flag: `plaintext`, `mixed`, `e2ee_required`

---

## Required Client Changes

## New Client Crypto Subsystem

Create modules under a new feature namespace (for example `apps/client/src/features/e2ee/`):

- key store (IndexedDB-backed)
- crypto worker bridge
- session manager (pairwise/device)
- channel epoch manager
- sender key manager
- decrypt pipeline and retry queue
- backup manager

## Message Pipeline Changes

Current path in `messages.send` and subscription consumers must be split:

- plaintext channels: existing behavior
- E2EE channels:
  - compose plaintext in UI
  - encrypt in worker
  - send ciphertext envelope
  - optimistic render local plaintext
  - remote messages decrypt async, then render
  - if decrypt fails due missing epoch/key: auto-run key catchup and retry before final error marker

## File Pipeline Changes

Current upload in `apps/client/src/helpers/upload-file.ts` becomes:

1. chunk + encrypt file in worker
2. upload ciphertext stream
3. upload encrypted manifest/dek envelope
4. render using local decrypt-on-read

URL query access tokens for private files should be replaced with authenticated opaque fetch endpoints that return ciphertext blobs.

## Voice Pipeline Changes

In `use-transports.ts` and voice provider:

- attach insertable stream transforms on sender and receiver tracks
- fetch current room media key epoch from e2ee subsystem
- encrypt/decrypt frames in worker-compatible transform path
- handle key epoch updates without reconnecting transport where possible

Implementation standard:

- align with WebRTC Encoded Transform APIs (`RTCRtpScriptTransform`) and SFrame-compatible frame metadata semantics.

---

## Performance Plan

## Latency and CPU Budgets

Target budgets on average laptop hardware:

- text encrypt/decrypt: < 2 ms per typical message payload
- file encryption throughput: >= 120 MB/s local (browser-limited)
- message send P95 added latency due to crypto: < 20 ms
- timeline decrypt of 100 messages P95: < 250 ms (background streaming decode)
- voice frame crypto overhead: < 5% CPU per active stream at 720p30
- channel open with warm cache P95: < 300 ms first meaningful paint
- channel open cold history fetch start P95: < 800 ms
- key-catchup recovery success for missing epochs: > 99.9% without user action

## Implementation Tactics

1. WebCrypto first for symmetric ops.
2. Run encryption/decryption in Web Workers to keep UI thread clean.
3. Batch decrypt history and progressive render.
4. Cache derived keys in memory with strict lifecycle and wipe on disconnect.
5. Use binary envelope encoding (CBOR or compact MessagePack) over JSON for large volumes.
6. For files, use fixed chunk sizes (for example 256 KB or 1 MB based on browser memory profile).
7. Precompute sender message keys in short windows for burst typing.
8. Use lazy decrypt for off-screen messages.

## Observability for Performance

Track metrics that do not leak content:

- encryption queue depth
- decrypt failure rates (categorized)
- key fetch latency
- epoch rotation latency
- worker utilization
- media transform drop rate

---

## Feature Compatibility and Product Decisions

## Plugins

Current server plugins consume message content/events.
Under strict E2EE:

- plugins cannot access plaintext message content server-side
- command parsing via plaintext messages must move client-side or be disabled for E2EE channels

Recommended:

- keep plugin commands only in plaintext channels initially
- design a signed client-command execution model later if needed

Advanced supported model:

- `delegated_plugin_read` channels where explicitly granted plugins can decrypt content via scoped plugin keys.
- this is not equivalent to `strict_e2ee`; it is explicit delegated access mode with admin warnings and audit.

## Link Previews and Metadata

Server-side preview scraping is incompatible with strict E2EE content secrecy.

Options:

1. client-side preview fetch (privacy tradeoff to external sites)
2. no previews in E2EE channels
3. explicit user opt-in preview proxy

## Moderation and Search

Server-side content moderation and full-text search are incompatible with strict E2EE.

Practical model:

- metadata moderation remains server-side
- client-side reporting can submit decrypted excerpts intentionally when users report abuse
- optional per-client local search index for E2EE channels

## Read States

Read states can remain server-managed metadata.
No plaintext dependency required.

---

## Security Hardening Prerequisites (Do Before E2EE Rollout)

1. Replace password hashing with Argon2id.
2. Remove plaintext password storage from localStorage.
3. Separate secrets by purpose (session token signing/derivation, file token, future e2ee server auth).
4. Enforce TLS deployment guidance and secure defaults.
5. Tighten CORS to configured allowed origins.
6. Introduce trusted proxy settings before using forwarded IP headers.
7. Add session revocation and token rotation support.
8. Add CSP, Trusted Types (if feasible), and strict dependency hygiene to reduce XSS risk.

Without these, E2EE still leaves major practical compromise paths.

---

## Phased Delivery Plan

## Phase 0: Baseline Hardening

Scope:

- auth/session/password storage fixes
- secret separation
- transport security defaults

Effort: M
Exit criteria:

- no plaintext stored credentials
- Argon2id in use
- secure session model with revocation

## Phase 1: Crypto Substrate

Scope:

- device keys, prekeys, key backup storage, worker crypto foundation

Effort: L
Exit criteria:

- multi-device key lifecycle works in dev/staging
- deterministic crypto tests passing

## Phase 2: E2EE Text Channels (Opt-in)

Scope:

- encrypted message envelopes
- channel epoch management
- mixed-mode channel support

Effort: L
Exit criteria:

- server cannot decrypt text payload for e2ee channels
- production-safe migration path for existing channels

## Phase 3: E2EE Files

Scope:

- client-side file encryption + encrypted manifests
- ciphertext object serving path

Effort: L
Exit criteria:

- server stores/serves opaque file blobs for e2ee channels
- file UX remains near-current responsiveness

## Phase 4: E2EE Voice/Video

Scope:

- insertable streams + media key epochs + rekey logic

Effort: XL
Exit criteria:

- SFU cannot decrypt media payloads
- acceptable CPU/network impact on supported browsers

## Phase 5: Cleanup and Strict Mode

Scope:

- remove plaintext fallback for channels set to e2ee_required
- harden policy controls and admin UX

Effort: M
Exit criteria:

- clean separation of legacy vs strict E2EE mode

---

## Testing Strategy

## Crypto Correctness

- test vectors for all primitives and envelope formats
- cross-client deterministic decryption tests
- malformed/corrupted payload rejection tests

## Protocol Reliability

- out-of-order message handling
- dropped envelope recovery
- device revoke and rekey propagation
- concurrent membership changes
- deterministic history merge with no silent timeline gaps
- automatic key-catchup path on channel entry and deep scroll

## Security Tests

- replay attempts
- nonce reuse guards
- downgrade attempts (forcing plaintext mode)
- unauthorized key envelope fetch attempts
- ghost-device injection attempts (server-side forged device records)
- CSC rollback/equivocation simulation tests

## Performance Tests

- message throughput benchmarks (1:1 and large channels)
- history decrypt benchmarks
- file encrypt/upload/download benchmarks
- voice media overhead benchmarks

## Migration Tests

- mixed channel mode (legacy + e2ee)
- rollback path from failed epoch publish
- compatibility across client versions
- history boundary marker correctness (retention/access/channel-start)
- new-device full-history restoration for non-ephemeral channels

---

## Deployment and Rollout

1. Ship behind feature flags.
2. Enable internal/staging servers first.
3. Roll out to opt-in channels.
4. Observe metrics and crash/decrypt-failure rates.
5. Gradually move to default-on for new channels.
6. Keep legacy read path until error rate and support burden are acceptable.

---

## Wire Format and Envelope Spec (Concrete)

## Message Envelope v1

Use compact binary encoding (CBOR preferred) over the WebSocket transport.
Canonical logical structure:

```ts
type MessageEnvelopeV1 = {
  v: 1;
  channelId: number;
  messageIdClient: string; // client-generated UUID for idempotency
  senderUserId: number;
  senderDeviceId: string;
  epoch: number;
  senderKeyId: number;
  cscHash: ArrayBuffer; // channel state commitment hash
  counter: number; // monotonic per senderKeyId
  createdAtClient: number;
  nonce: ArrayBuffer; // 96-bit for AES-GCM
  ciphertext: ArrayBuffer; // encrypted message body
  tag: ArrayBuffer; // if not included in ciphertext representation
};
```

Encrypted message body shape:

```ts
type MessageBodyV1 = {
  text: string;
  attachments: Array<{
    fileIdClient: string;
    manifestId: string;
  }>;
  replyToMessageId?: number;
  editedFromMessageId?: number;
};
```

## Nonce and Replay Rules

1. Never reuse `(key, nonce)` pairs.
2. Nonce strategy:
   - 32-bit random prefix per sender key epoch
   - 64-bit monotonically increasing counter
3. Server stores `counter` high-water mark per `(channelId, senderDeviceId, senderKeyId)` to reject obvious replay.
4. Client validates message counter ordering with a bounded out-of-order window.
5. Counter allocation must be crash-safe and concurrency-safe (durable allocator with reserved counter windows).
6. Message processing must enforce `MAX_COUNTER_GAP` and reject pathological jumps.

## AAD Requirements

AAD must be derived from canonical serialized header bytes (not trust a transmitted `aad` field).

Authenticated header must include at minimum:

- `v`
- `channelId`
- `senderUserId`
- `senderDeviceId`
- `epoch`
- `senderKeyId`
- `cscHash`
- `counter`

Any mutation in transit fails auth verification.

## File Manifest v1

```ts
type FileManifestV1 = {
  v: 1;
  fileIdClient: string;
  originalName: string;
  mimeType: string;
  totalBytes: number;
  chunkBytes: number;
  chunks: Array<{
    i: number;
    nonce: ArrayBuffer;
    sizeCipher: number;
    sha256Cipher: ArrayBuffer;
  }>;
  dekEnvelope: {
    algorithm: "AES-256-GCM";
    epoch: number;
    wrappedDek: ArrayBuffer;
    nonce: ArrayBuffer;
  };
};
```

## Voice Key Epoch Packet

Control-plane message (pairwise-ratcheted or server-delivered envelope):

```ts
type VoiceEpochUpdateV1 = {
  v: 1;
  roomId: number;
  epoch: number;
  mediaKeyWrappedForDevice: ArrayBuffer;
  validFromTs: number;
  senderDeviceId: string;
  signature: ArrayBuffer;
};
```

---

## API Contract Draft (tRPC)

These are implementation targets, not final signatures.

## `e2ee.registerDevice`

Input:

- `deviceId`
- `identityPub`
- `signingPub`
- `clientCryptoVersion`

Output:

- `serverTime`
- `deviceRecordId`

## `e2ee.uploadPrekeys`

Input:

- `deviceId`
- `signedPrekey`
- `oneTimePrekeys[]`

Output:

- `storedCount`

## `e2ee.claimPrekey`

Input:

- `targetUserId`
- `targetDeviceId`

Output:

- `identityPub`
- `signedPrekey`
- `oneTimePrekey?`

## `e2ee.publishChannelEpoch`

Input:

- `channelId`
- `epoch`
- `recipientEnvelopes[]` (device-specific encrypted epoch key)

Output:

- `accepted: boolean`

## `e2ee.sendMessageEnvelope`

Input:

- `channelId`
- `envelope` (MessageEnvelopeV1 bytes)

Output:

- `serverMessageId`
- `acceptedCounter`

## `e2ee.getMessageEnvelopes`

Input:

- `channelId`
- `cursor`
- `limit`

Output:

- `envelopes[]`
- `nextCursor`

## `e2ee.uploadFileCipherChunk`

Input:

- `uploadId`
- `chunkIndex`
- `cipherBytes`

Output:

- `ok`

## `e2ee.finalizeFileManifest`

Input:

- `uploadId`
- `manifest`

Output:

- `fileId`

## `e2ee.putKeyBackup`

Input:

- `backupCiphertext`
- `salt`
- `kdfParams`

Output:

- `backupVersion`

## `e2ee.getKeyBackup`

Input:

- none

Output:

- `backupCiphertext`
- `salt`
- `kdfParams`

---

## Detailed Migration Model

## Channel Encryption Policy

Add channel property:

- `encryptionMode: plaintext | mixed | e2ee_required | delegated_plugin_read`

Semantics:

- `plaintext`: legacy behavior only
- `mixed`: accepts legacy and e2ee payloads while clients migrate
- `e2ee_required`: rejects plaintext sends and plaintext metadata jobs
- `delegated_plugin_read`: E2EE for normal participants, but selected plugins are authorized recipients via scoped plugin envelopes

For delegated plugin mode, derive plugin read keys per channel/plugin/epoch:

- `PRK[C,P,E] = HKDF(CEK[C,E], "plugin-read:v1|C|P|E")`

Rotate epoch on plugin grant/revoke and membership changes.

## Legacy Data Compatibility

1. Existing messages remain readable as legacy rows.
2. New E2EE messages write into encrypted envelope table.
3. UI timeline merges legacy + E2EE items by timestamp.
4. Admin tooling shows "legacy content available" badge for old plaintext rows.

## Cutover Rules

- new channels can default to `e2ee_required` once client coverage threshold is met
- old channels stay `mixed` until admin migration action
- irreversible lock option:
  - "Disallow plaintext forever" for high-security channels

---

## Client Runtime Design (Concrete)

## Crypto Worker Topology

- `encryptWorker`: message + file encryption
- `decryptWorker`: timeline + file chunk decryption
- `keyWorker`: ratchet/session/key derivation

Workers communicate through structured clone with transferable `ArrayBuffer` to avoid copy overhead.

## In-Memory Key Cache Policy

- L1 cache in JS memory only
- TTL-based eviction (for example 10 min inactivity)
- immediate wipe on logout/disconnect/hard refresh signal

## Failure Handling

On decrypt failure:

1. mark message as "locked"
2. request missing epoch envelope
3. retry decryption
4. if still failing, surface actionable status (not generic error)

No silent drops.

## Offline Send Queue

- encrypted envelopes queued in IndexedDB outbox
- include idempotency key (`messageIdClient`)
- on reconnect, resend in original order
- server deduplicates by `(senderDeviceId, messageIdClient)`

---

## Voice E2EE Detail

## Browser Support Policy

Launch support target:

- Chromium-based browsers first
- Firefox/Safari as they satisfy required insertable streams capabilities

Unsupported clients:

- either block joining e2ee voice rooms
- or join in listen-only non-e2ee mode (not recommended for strict rooms)

## Rekey Cadence

Rotate room media key on:

1. participant join
2. participant leave
3. device revoke
4. periodic timer (for example every 2 minutes)

Grace window:

- keep previous epoch for short overlap (for example 5 seconds) to handle jitter.

## Packet Loss and Ordering

- decryption pipeline must tolerate out-of-order frames
- stale epoch frames dropped after grace window
- metrics capture decrypt fail spikes during rekey events

---

## Security Guardrails

## Downgrade Protection

- channel policy in signed server state snapshot
- client must refuse plaintext send in `e2ee_required`
- server rejects plaintext writes in `e2ee_required`

## Device Verification States

Each peer device has state:

- `unverified`
- `verified`
- `revoked`

Default UI should not block chat on unverified state but must show subtle trust indicator.

## Compromise Playbook

If device compromise suspected:

1. revoke device
2. rotate all channel epochs
3. rotate voice room epochs
4. invalidate all active sessions
5. prompt affected users with concise action notice

---

## Execution Plan by Sprint (Example)

This is one practical 10-sprint sequence with parallel tracks.

## Sprint 1-2

- Phase 0 hardening
- schema migrations scaffold for devices/prekeys
- client storage security updates

## Sprint 3-4

- register device + prekeys
- worker framework + key store foundation
- protocol test harness

## Sprint 5-6

- e2ee text envelope send/fetch in one channel mode
- mixed-mode timeline rendering
- decrypt retry and telemetry

## Sprint 7

- file chunk encryption + manifest path
- ciphertext serving endpoint

## Sprint 8

- key backup + restore flow
- device revoke + epoch rekey fanout

## Sprint 9

- voice insertable streams prototype
- media epoch rotation and metrics

## Sprint 10

- production hardening
- migration tooling and admin controls
- rollout guardrails and documentation

---

## Risk Register

| Risk | Impact | Mitigation |
|---|---|---|
| Browser crypto API inconsistency | blocked rollout for some users | capability detection + staged support matrix |
| Plugin feature breakage in E2EE channels | product regression | explicit plugin policy and client-side alternatives |
| Rekey storms on large channel membership churn | latency spikes | batch envelope publish + backoff + queue |
| Worker overhead on low-end devices | UX jank | adaptive batching + fallback chunk sizes |
| Metadata expectations mismatch ("full secure" misunderstanding) | trust gap | explicit docs and channel security labels |

---

## Concrete Repo Touchpoints (First Pass)

Likely first files to change:

- `packages/shared/src/types.ts` (connection params, envelope types)
- `apps/server/src/db/schema.ts` (device/prekey/epoch/envelope tables)
- `apps/server/src/http/index.ts` (register OAuth/session endpoints)
- `apps/server/src/db/queries/users.ts` (session validation path replacement)
- `apps/server/src/utils/wss.ts` (device-aware auth context bootstrapping)
- `apps/server/src/http/upload.ts` (session-backed auth checks)
- `apps/server/src/routers/messages/send-message.ts` (opaque payload path)
- `apps/server/src/routers/messages/get-messages.ts` (ciphertext fetch path)
- `apps/server/src/http/upload.ts` and `apps/server/src/http/public.ts` (cipher blob flows)
- `apps/server/src/queues/message-metadata/*` (disable for e2ee channels)
- `apps/server/src/plugins/event-bus.ts` and plugin integrations (no plaintext in e2ee)
- `apps/client/src/helpers/storage.ts` and connect flow (credential handling)
- `apps/client/src/features/server/messages/*` (encrypt/send/decrypt/render pipeline)
- `apps/client/src/helpers/upload-file.ts` (encrypt-before-upload)
- `apps/client/src/components/voice-provider/hooks/use-transports.ts` (insertable streams)

New likely files:

- `apps/server/src/http/auth/discord-start.ts`
- `apps/server/src/http/auth/discord-callback.ts`
- `apps/server/src/http/session-refresh.ts`
- `apps/server/src/http/auth/logout.ts`
- `apps/server/src/services/auth.ts`
- `apps/server/src/db/queries/auth-identities.ts`
- `apps/server/src/db/queries/auth-sessions.ts`
- `apps/server/src/db/queries/auth-sessions.ts`

---

## Open Decisions (Must Be Resolved Early)

1. Do we support full E2EE in all channels, or per-channel opt-in with immutable mode after creation?
2. Is Discord login mandatory, or Discord-primary with local fallback for self-hosted/offline-only environments?
3. For Discord OAuth users, is key release policy "existing-device approval OR recovery threshold", or softer policy?
4. What exact plugin capabilities remain allowed in E2EE channels?
5. Is link preview disabled, client-side, or opt-in proxy for E2EE channels?
6. Which browsers are officially supported for voice E2EE at launch?
7. Should external plugin-provided voice streams be blocked in strict E2EE voice channels?
8. Should `delegated_plugin_read` be allowed by default, or require explicit per-channel security override?

---

## Recommended Immediate Next Steps

1. Approve this phased model and threat target levels.
2. Lock the Discord auth decision:
   - Discord-primary identity, auto-provision local principal, no manual account creation UI.
3. Implement Phase 0 hardening first.
4. Build a combined auth+crypto spike:
   - `GET /auth/discord/start` + callback + session record
   - device keys in IndexedDB
   - prekey registration route
   - encrypted message envelope prototype for one channel
5. Benchmark crypto worker path before broad refactor.
6. Freeze plugin semantics and external stream policy for E2EE channels before Phase 2.
