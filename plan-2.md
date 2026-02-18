# Plan 2: Device Trust and Crypto Substrate (Phase 1)

## Objective
Implement the cryptographic trust substrate so server-side directory tampering, rollback, and key-distribution ambiguity are detectable and rejectable.

## Scope
- ARK/device authorization model
- CSC (Channel State Commitment) chain
- Device registration, prekeys, and pairwise control channels
- Nonce allocator and replay-state primitives

## Key Outcomes
1. Ghost-device injection is cryptographically blocked.
2. Channel state rollback/downgrade attempts are detectable.
3. Message/header authentication format is canonical and deterministic.
4. Nonce allocation cannot catastrophically reuse keys after crashes/races.

## Workstreams

## WS1: ARK and Device Authorization
- Implement `user_root_keys` and `device_authorizations` schema.
- Implement ARK-signed add/revoke statements.
- Enforce client rule: encrypt only to ARK-authorized active devices.
- Add monotonic device sequence/version enforcement.

## WS2: CSC Chain
- Implement `channel_state_commitments` schema and APIs.
- Bind policy + membership digest into CSC hash chain.
- Enforce monotonic epoch + prev-hash continuity.
- Add downgrade rejection path for channel encryption policy.

## WS3: Core E2EE APIs
- `e2ee.registerDevice`
- `e2ee.uploadPrekeys`
- `e2ee.claimPrekey`
- `e2ee.publishChannelEpoch`
- `e2ee.requestKeyCatchup`

## WS4: Canonical Envelope and Nonce Safety
- Implement canonical deterministic CBOR for signed/AAD payloads.
- Remove trust in transmitted `aad`; derive from canonical header only.
- Implement durable counter block reservation allocator.
- Add replay window + max-gap enforcement per sender key.

## Deliverables
- Protocol-conformant services per `docs/e2ee-v1-protocol-spec.md`.
- End-to-end integration test fixtures for device auth and CSC continuity.
- Crash/restart nonce allocator test harness.

## Dependencies
- Plan 1 complete (session and identity base).
- Finalized protocol fields from v1 spec.

## Exit Criteria
1. Server-side forged device insertion fails cryptographic validation in tests.
2. CSC rollback/equivocation tests fail closed as expected.
3. Nonce allocator passes crash and concurrency tests with no reuse.
4. Replay/duplicate/max-gap checks behave per spec.

## Risks and Mitigation
- Risk: complexity of cross-device state introduces sync bugs.
  - Mitigation: strict state-machine tests and deterministic fixtures.
- Risk: browser/storage edge cases for durable counters.
  - Mitigation: reserved block strategy and forced sender-key rotation fallback.

## Effort
- Estimated: L (4-8 weeks)

