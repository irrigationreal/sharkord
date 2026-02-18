# Sharkord E2EE v1 Protocol Spec

## Status

- `status`: draft-v1
- `scope`: implementation contract for first strict E2EE rollout
- `normative words`: MUST, SHOULD, MAY are used as RFC keywords

This spec defines:

1. CSC binary format and signing rules
2. ARK and device-authorization object format
3. nonce allocator algorithm and crash-recovery semantics
4. replay window and max-gap policy
5. exact API contracts for core E2EE key and history paths

---

## 1) Security Scope and Threat Model Boundaries

This protocol provides:

1. storage-compromise resistance (DB/object store compromise does not expose plaintext)
2. server-side plaintext blindness for strict E2EE message/file/media payloads
3. cryptographic detection of rollback/downgrade in channel state

This protocol does not automatically provide active malicious-web-server resistance unless deployment also provides an independent client code-integrity trust anchor.

---

## 2) Cryptographic Suite

## Required primitives

1. `HASH`: SHA-256
2. `KDF`: HKDF-SHA-256
3. `SIG`: Ed25519
4. `KEM/HPKE`: X25519 + HKDF-SHA256 + AEAD_CHACHA20_POLY1305 (HPKE mode base)
5. `AEAD message`:
   - primary: AES-256-GCM
   - optional hardened profile: AES-256-GCM-SIV
6. `AEAD file chunks`: AES-256-GCM

## Domain separation labels

All HKDF info fields MUST start with:

- `sharkord/e2ee/v1/`

Defined labels:

1. `ark-rotation`
2. `channel-epoch-key`
3. `sender-chain-root`
4. `plugin-read-key`
5. `voice-epoch-key`

---

## 3) Canonical Encoding Rules

## Canonical serialization

All signed or AEAD-authenticated structured payloads MUST be serialized with deterministic CBOR.

Rules:

1. map keys are integers
2. no duplicate keys
3. shortest-form integer encoding
4. stable ordering by key (deterministic CBOR)

## Authenticated Data (AAD)

`aad` MUST be computed from canonical serialized header bytes.
`aad` MUST NOT be accepted from an untrusted transmitted field.

---

## 4) ARK and Device Authorization

## 4.1 Account Root Key (ARK)

Each user has one active ARK signing public key.
ARK authorizes decrypt-eligible devices.

### ARK record payload (CBOR map)

```text
{
  0: 1,                      ; version
  1: user_id (uint),
  2: ark_version (uint),
  3: ark_pub (bstr, 32),     ; Ed25519 public key
  4: prev_ark_hash (bstr,32|null),
  5: created_at_ms (uint64)
}
```

`ark_hash = SHA256(cbor(payload))`

ARK rotation MUST create a new record with `prev_ark_hash` chained to prior active record.

## 4.2 Device record payload

```text
{
  0: 1,                           ; version
  1: user_id (uint),
  2: device_id (tstr),            ; UUIDv7
  3: device_seq (uint64),         ; monotonic per user
  4: sign_pub (bstr,32),          ; Ed25519 device signing pubkey
  5: kem_pub (bstr,32),           ; X25519 device key-wrapping pubkey
  6: crypto_profile (tstr),       ; e.g. "e2ee-v1"
  7: capabilities (uint),         ; bitset
  8: created_at_ms (uint64)
}
```

`device_record_hash = SHA256(cbor(device_record_payload))`

## 4.3 Device authorization statement

Each active device MUST have ARK authorization:

```text
{
  0: 1,                              ; version
  1: user_id (uint),
  2: ark_version (uint),
  3: device_record_hash (bstr,32),
  4: device_seq (uint64),
  5: action (uint),                  ; 1=add, 2=revoke
  6: created_at_ms (uint64),
  7: signature (bstr,64)             ; Ed25519 over fields 0..6 canonical bytes
}
```

Verification rules:

1. signature MUST verify with active ARK public key for `ark_version`
2. `device_seq` MUST be strictly monotonic for add operations
3. revoked devices MUST NOT receive new channel key envelopes
4. clients MUST refuse to encrypt to devices lacking valid ARK authorization

---

## 5) Channel State Commitment (CSC)

CSC binds channel membership and policy to an epoch and prevents silent rollback/downgrade.

## 5.1 CSC payload format

```text
{
  0: 1,                              ; version
  1: channel_id (uint),
  2: epoch (uint64),
  3: prev_csc_hash (bstr,32|null),
  4: membership_digest (bstr,32),    ; hash(sorted user_id + device_seq view)
  5: policy_digest (bstr,32),        ; hash(encryption_mode + policy flags)
  6: signer_device_id (tstr),
  7: created_at_ms (uint64)
}
```

`csc_hash = SHA256(cbor(csc_payload))`

## 5.2 CSC signed object

```text
{
  0: csc_payload (map),
  1: signature (bstr,64)             ; Ed25519 over SHA256(cbor(csc_payload))
}
```

## 5.3 CSC verification rules

Client MUST verify:

1. signer device is ARK-authorized and not revoked at this epoch
2. signature valid over csc hash
3. epoch is monotonic (`new_epoch = old_epoch + 1` for strict progression)
4. `prev_csc_hash` matches local latest CSC hash
5. policy change is allowed by channel permissions

If any check fails, client marks channel as `state_verification_failed` and MUST NOT accept new decryptable payloads for that epoch.

---

## 6) Message Envelope v1

## 6.1 Header payload (AAD source)

```text
{
  0: 1,                         ; version
  1: channel_id (uint),
  2: epoch (uint64),
  3: csc_hash (bstr,32),
  4: sender_user_id (uint),
  5: sender_device_id (tstr),
  6: sender_key_id (uint32),
  7: counter (uint64),
  8: client_message_id (tstr),  ; UUIDv7
  9: created_at_ms (uint64),
  10: content_type (uint8),     ; 1=text,2=edit,3=delete tombstone,4=system
  11: flags (uint32)
}
```

`aad = cbor(header_payload)`

## 6.2 Envelope transport object

```text
{
  0: header_payload (map),
  1: nonce (bstr,12),            ; 32-bit prefix + 64-bit counter (big-endian)
  2: ciphertext (bstr),          ; body encrypted under message key
  3: tag (bstr,16),              ; if not appended in ciphertext representation
  4: sig (bstr,64|null)          ; optional per-message device signature
}
```

## 6.3 Signature mode

`sig` is optional in baseline mode.
If enabled:

- sign `SHA256(aad || nonce || ciphertext || tag)` with device signing key
- receiver verifies before decrypt completion

---

## 7) Nonce Allocator and Crash Safety

## 7.1 State model

Per `sender_key_id`, maintain durable state:

```text
{
  sender_key_id,
  nonce_prefix_u32,
  next_counter_u64,
  updated_at_ms
}
```

## 7.2 Allocation algorithm

Allocator MUST reserve counter blocks atomically.

Constants:

1. `COUNTER_BLOCK_SIZE = 1024`

Algorithm:

1. transaction begin
2. read row for `sender_key_id` with write lock
3. `start = next_counter`
4. `end = start + COUNTER_BLOCK_SIZE - 1`
5. persist `next_counter = end + 1`
6. commit
7. return local reservation `[start, end]`

Each message allocation uses one counter from local reservation.
If exhausted, reserve next block.

## 7.3 Nonce construction

`nonce = nonce_prefix_u32 || counter_u64_be`

Rules:

1. nonce prefix generated randomly on sender key creation
2. counter never decreases
3. sender key MUST rotate before counter wrap

## 7.4 Crash recovery semantics

1. unused reserved counters are discarded after crash (allowed)
2. reused counters are forbidden
3. allocator reloads from durable `next_counter` and reserves new block
4. device restore MUST use new `device_id` and new sender keys (never reuse old sender key + counter state)
5. allocator state corruption triggers forced sender-key rotation

## 7.5 Concurrency semantics

One logical allocator owner per `sender_key_id` MUST be enforced (worker lock, tab lock, or central allocator service).
Concurrent writers without reservation protocol are forbidden.

---

## 8) Replay Window and Max-Gap Rules

## 8.1 Parameters

1. `REPLAY_WINDOW = 4096`
2. `MAX_COUNTER_GAP = 10000`

## 8.2 Receiver state

Per `(channel_id, sender_device_id, sender_key_id)`:

```text
{
  max_counter_u64,
  bitmap[REPLAY_WINDOW],      ; bit 0 = max_counter
  updated_at_ms
}
```

## 8.3 Accept/reject algorithm

Given incoming counter `c`:

1. if `c > max_counter + MAX_COUNTER_GAP`: reject `counter_gap_exceeded`
2. if `c > max_counter`:
   - shift bitmap right by `delta = c - max_counter`
   - set bit0
   - set `max_counter = c`
   - accept
3. else:
   - `offset = max_counter - c`
   - if `offset >= REPLAY_WINDOW`: reject `too_old`
   - if bit at `offset` already set: reject `duplicate`
   - set bit at `offset`
   - accept

Reject events SHOULD increment abuse telemetry and MAY trigger sender key reset negotiation after threshold.

---

## 9) Channel Epoch Key Publication

## 9.1 Epoch publication object

```text
{
  0: 1,                              ; version
  1: channel_id (uint),
  2: epoch (uint64),
  3: csc_signed_object (map),
  4: key_envelopes (array),          ; per recipient device
  5: plugin_key_envelopes (array),   ; optional delegated plugin recipients
  6: created_at_ms (uint64)
}
```

Device envelope entry:

```text
{
  0: recipient_device_id (tstr),
  1: envelope_alg (tstr),            ; "hpke-x25519-chacha20poly1305"
  2: enc (bstr),                     ; HPKE enc
  3: wrapped_cek (bstr),             ; HPKE ciphertext
  4: aad_hash (bstr,32)
}
```

## 9.2 Plugin delegated key envelope entry

```text
{
  0: plugin_id (tstr),
  1: plugin_principal_id (tstr),     ; key identity or attested principal id
  2: epoch (uint64),
  3: mode (uint8),                   ; 1=local,2=attested-remote,3=unattested-remote
  4: wrapped_prk_alg (tstr),         ; HPKE suite label
  5: enc (bstr),
  6: wrapped_prk (bstr),             ; PRK[C,P,E] wrapped to plugin principal
  7: grant_id (tstr),                ; references server-side grant policy row
  8: expires_at_ms (uint64)
}
```

`PRK[C,P,E] = HKDF(CEK[C,E], "sharkord/e2ee/v1/plugin-read-key|C|P|E")`

Server MUST reject plugin envelopes unless channel mode is `delegated_plugin_read`.

---

## 10) API Contracts (tRPC + HTTP)

All calls require authenticated Sharkord session unless marked public.

## 10.1 `e2ee.registerDevice` (mutation)

Input:

```ts
type RegisterDeviceInput = {
  userId: number;
  deviceRecord: {
    deviceId: string;
    deviceSeq: number;
    signPub: Uint8Array;  // 32
    kemPub: Uint8Array;   // 32
    cryptoProfile: 'e2ee-v1';
    capabilities: number;
    createdAtMs: number;
  };
  authorization: {
    arkVersion: number;
    action: 'add';
    signature: Uint8Array; // 64 over canonical auth statement
  };
  signedPrekey: Uint8Array;
  oneTimePrekeys: Uint8Array[];
};
```

Output:

```ts
type RegisterDeviceOutput = {
  deviceRecordId: string;
  acceptedDeviceSeq: number;
  serverTimeMs: number;
};
```

Validation:

1. ARK authorization signature valid
2. `deviceSeq` monotonic
3. device id unique for user
4. key sizes and crypto profile valid

## 10.2 `e2ee.requestKeyCatchup` (query)

Input:

```ts
type RequestKeyCatchupInput = {
  channelId: number;
  fromEpochInclusive: number;
  toEpochInclusive: number;
  missingSenders?: Array<{
    senderDeviceId: string;
    senderKeyId: number;
  }>;
  reason:
    | 'channel_open'
    | 'scroll_backfill'
    | 'decrypt_pending'
    | 'device_restore';
};
```

Output:

```ts
type RequestKeyCatchupOutput = {
  cscChain: Array<{
    epoch: number;
    cscSigned: Uint8Array;
  }>;
  deviceKeyEnvelopes: Array<{
    epoch: number;
    recipientDeviceId: string;
    envelope: Uint8Array;
  }>;
  pluginKeyEnvelopes?: Array<{
    epoch: number;
    pluginId: string;
    envelope: Uint8Array;
  }>;
  historyBoundaries: Array<{
    type:
      | 'retention_boundary'
      | 'channel_created_boundary'
      | 'access_boundary';
    effectiveFromTs: number;
    reason: string;
  }>;
};
```

Validation:

1. requester has channel access
2. envelopes only for requester device (except policy-authorized plugin retrieval endpoints)
3. epoch range bounded by server limits

## 10.3 `e2ee.publishChannelEpoch` (mutation)

Input:

```ts
type PublishChannelEpochInput = {
  channelId: number;
  epoch: number;
  cscSigned: Uint8Array;             // canonical serialized CSC signed object
  deviceEnvelopes: Uint8Array[];     // serialized device envelope entries
  pluginKeyEnvelopes?: Uint8Array[]; // serialized plugin envelope entries
  createdAtMs: number;
};
```

Output:

```ts
type PublishChannelEpochOutput = {
  accepted: true;
  channelId: number;
  epoch: number;
  cscHash: Uint8Array; // 32
};
```

Validation:

1. signer is authorized to publish epoch for channel
2. CSC verifies and extends prior hash chain
3. epoch monotonic (exact next epoch)
4. all active recipient devices have an envelope (unless explicit exclusion policy)
5. plugin envelopes allowed only when channel mode is `delegated_plugin_read` and grant is active

## 10.4 `e2ee.publishPluginKeyEnvelopes` (mutation)

Input:

```ts
type PublishPluginKeyEnvelopesInput = {
  channelId: number;
  epoch: number;
  pluginEnvelopes: Uint8Array[]; // serialized plugin envelope entries
  grantAuditNote?: string;
};
```

Output:

```ts
type PublishPluginKeyEnvelopesOutput = {
  accepted: true;
  channelId: number;
  epoch: number;
  stored: number;
};
```

Validation:

1. channel mode is `delegated_plugin_read`
2. plugin grant exists and is not expired/revoked
3. principal id matches granted plugin principal
4. envelope epoch matches channel epoch

## 10.5 `GET /auth/discord/start` (public)

Output:

- redirect to Discord OAuth authorize URL

Server obligations:

1. generate single-use `state` with TTL
2. persist hashed state and metadata (`deviceId`, invite code)

## 10.6 `GET /auth/discord/callback` (public)

Behavior:

1. validate state
2. exchange code for provider tokens
3. resolve/create local principal
4. issue Sharkord session
5. redirect to client app with one-time auth completion token (or set cookie in same-origin mode)

---

## 11) State Machine Requirements

## 11.1 Channel entry state machine

Client MUST run:

1. fetch latest envelopes
2. if missing epochs/keys => call `requestKeyCatchup`
3. verify CSC chain continuity
4. decrypt and render
5. if still missing => show `temporary_decrypt_pending`
6. after retries exhausted => `irrecoverable_decrypt_failure`

Silent timeline gaps are forbidden.

## 11.2 Device revocation

On revoke:

1. publish ARK-signed revoke statement
2. rotate channel epochs containing revoked device
3. stop issuing new envelopes to revoked device immediately

---

## 12) Compliance Test Checklist

A build is not protocol-complete until all pass:

1. CSC rollback rejection test
2. ghost-device injection rejection test
3. nonce allocator crash/restart non-reuse test
4. concurrent worker allocator race test
5. replay duplicate and max-gap rejection tests
6. delegated plugin envelope policy enforcement test
7. channel-entry no-silent-gap test

---

## 13) Versioning and Compatibility

1. Protocol version encoded in each payload (`v`)
2. Unsupported major versions MUST fail closed
3. Minor additive changes MAY be ignored if marked optional
4. Any canonical encoding change requires major version bump

