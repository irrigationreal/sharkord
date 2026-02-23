# Plan 4: Search, Plugin Capability Model, and Voice/External E2EE (Phase 4)

## Objective
Preserve Discord-like advanced functionality under E2EE with explicit security modes and controlled tradeoffs.

## Scope
- Large-history search architecture
- E2EE-safe plugin command model
- Delegated plugin read-key mode
- Voice/video/screen E2EE via encoded transforms
- External-origin stream publisher-device model

## Key Outcomes
1. Search works at large history scale without defaulting to plaintext server indexing.
2. Plugin commands work in E2EE channels via explicit command envelopes.
3. Delegated plugin content access is scoped and auditable.
4. Voice/media payloads remain opaque to SFU in strict mode.
5. External server-origin streams can participate in E2EE with clear trust policy.

## Workstreams

## WS1: Search
- Build local encrypted inverted index in client.
- Add encrypted index segment sync for multi-device continuity.
- Add optional cold-tier modes:
  - local-only (strict)
  - DSSE (performance mode with leakage labeling)
  - two-server/TEE (advanced privacy mode)
- Add result-to-timeline consistency requirement.

## WS2: Plugin Commands and Delegated Read
- Replace message-text parsing with explicit command envelopes.
- Introduce plugin execution classes:
  - `LOCAL_ONLY`
  - `CONFIDENTIAL_REMOTE`
  - `PLAINTEXT_LEGACY`
- Add channel mode `delegated_plugin_read`.
- Derive plugin-scoped read keys per channel/plugin/epoch.
- Add admin warnings/audit for delegated access grants.

## WS3: Voice E2EE
- Implement RTCRtpScriptTransform-based frame encryption/decryption.
- Add room epoch key lifecycle and rekey policy.
- Add per-room policy: `off`, `preferred`, `required`.
- Add browser capability gating and telemetry.

## WS4: External-Origin Streams
- Implement publisher-device abstraction for external sources.
- Ingest via WebRTC/WHIP adapters where practical.
- Encrypt before SFU forwarding.
- Add strict mode policy for attested vs non-attested publishers.

## Deliverables
- Search subsystem shipped with selectable privacy modes.
- Plugin envelope execution path and delegated-read policy shipped.
- Voice E2EE and external publisher path shipped behind progressive rollout flags.

## Dependencies
- Plans 1-3 complete and stable.
- Protocol support for plugin envelopes and voice epoch metadata.

## Exit Criteria
1. Search supports large channels with acceptable latency under chosen mode.
2. No server-side plaintext parsing required for E2EE plugin commands.
3. Delegated plugin read grants are channel-scoped, epoch-scoped, and revocable.
4. SFU plaintext visibility blocked in strict voice mode.
5. External publisher revocation and rekey path verified.

## Risks and Mitigation
- Risk: plugin ecosystem breakage.
  - Mitigation: capability classes + transition support for legacy plugins.
- Risk: browser transform compatibility variance.
  - Mitigation: capability detection + policy fallback + staged rollout.
- Risk: search privacy confusion.
  - Mitigation: explicit mode labels and admin/user policy docs.

## Effort
- Estimated: XL (8-14 weeks)

