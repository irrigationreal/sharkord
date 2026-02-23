# Plan 3: E2EE Text, Files, and History Integrity (Phases 2-3)

## Objective
Ship strict E2EE text and file paths with history completeness guarantees so users can enter channels and reliably see all accessible history.

## Scope
- Encrypted message envelope send/fetch
- Encrypted file chunk/manifest pipeline
- Channel entry key-catchup and history boundary semantics
- Mixed-mode migration support

## Key Outcomes
1. Server stores opaque text/file payloads for E2EE channels.
2. Channel entry shows complete accessible history or explicit boundaries.
3. Missing keys trigger automatic recovery; no silent timeline gaps.
4. Mixed-mode channels migrate safely without data loss.

## Workstreams

## WS1: Message Pipeline
- Implement encrypted send path in client workers.
- Implement encrypted fetch path and background decrypt queue.
- Support edits/deletes via encrypted envelope mutations/tombstones.
- Bind envelopes to CSC hash and replay controls.

## WS2: File Pipeline
- Encrypt file chunks client-side.
- Upload ciphertext chunks and encrypted manifest/DEK envelopes.
- Serve opaque ciphertext object endpoints.
- Decrypt on read client-side with progressive rendering.

## WS3: History Contract Implementation
- Implement `channel_history_boundaries` and fetch API.
- Implement automatic `requestKeyCatchup` on channel open/backfill.
- Implement explicit states only:
  - `retention_boundary`
  - `channel_created_boundary`
  - `access_boundary`
  - `temporary_decrypt_pending`
  - `irrecoverable_decrypt_failure`
- Prohibit silent gaps in timeline merge logic.

## WS4: Migration and Compatibility
- Keep `plaintext` and `mixed` channel modes during migration.
- Merge legacy + encrypted timeline entries deterministically.
- Provide admin migration controls and visibility.

## Deliverables
- E2EE text and file functionality behind feature flags.
- History integrity UX and APIs shipped.
- Migration tooling for channel mode transitions.

## Dependencies
- Plan 2 complete (ARK/CSC/envelope safety).
- Worker and storage substrate in client.

## Exit Criteria
1. Server cannot decrypt text/file content in strict E2EE channels.
2. History no-gap tests pass for channel entry and deep backfill.
3. New device can recover full non-ephemeral channel history automatically.
4. File upload/download UX remains near-baseline performance targets.

## Risks and Mitigation
- Risk: decrypt backlog causes perceived missing history.
  - Mitigation: staged rendering + pending markers + prioritized key catchup.
- Risk: large files stress browser memory.
  - Mitigation: chunk-size tuning and streaming decrypt path.

## Effort
- Estimated: L (6-10 weeks)

