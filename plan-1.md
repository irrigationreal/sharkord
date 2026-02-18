# Plan 1: Program Foundation and Phase 0 Hardening

## Objective
Establish the security and delivery foundation required before strict E2EE features ship, while keeping current Sharkord usable.

## Scope
- Phase 0 from `docs/e2ee-full-plan.md`
- Program-level controls needed to prevent rework in later phases

## Key Outcomes
1. Auth and credential baseline hardened.
2. Clear trust boundary language for storage-compromise vs active-malicious-server resistance.
3. Stable migration rails for Discord-first identity and device-aware sessions.
4. Security regression harness in CI.

## Workstreams

## WS1: Security Baseline Hardening
- Replace fast SHA-256 password hashing with Argon2id.
- Remove plaintext localStorage password persistence in client flows.
- Split secrets by function:
  - auth/session signing secret
  - file-token secret
  - owner-bootstrap secret material
- Tighten CORS defaults and trusted-proxy handling.
- Add CSP and dependency hygiene checks for XSS risk reduction.

## WS2: Session and Token Hardening
- Move from JWT-only stateless trust to revocable session records.
- Introduce short-lived access + rotating refresh with reuse detection.
- Bind session to `user_device` context.
- Add logout/revoke-all endpoints.

## WS3: Discord-First Identity Foundation
- Add provider identity schema (`auth_identities`) and oauth-state storage.
- Add Discord auth start/callback routes.
- Preserve optional local login fallback behind explicit path.
- Respect invite and `allowNewUsers` behavior on first OAuth provisioning.

## WS4: Program and Delivery Controls
- Define security acceptance gates per phase.
- Define protocol compatibility policy (`v`, migration windows, fail-closed behavior).
- Add architecture decision records for trust scope and plugin policy.

## Deliverables
- Hardened auth/session implementation merged.
- Discord auth scaffold merged and feature-flagged.
- Security baseline test suite in CI.
- ADRs:
  - trust boundary
  - session strategy
  - identity provider model

## Dependencies
- Existing server auth routes and DB migration pipeline.
- Agreement on Discord-primary, local-fallback policy.

## Exit Criteria
1. No plaintext credential storage paths in production client.
2. Argon2id active for new credentials and migration path for old records.
3. Session revocation tested and working for WS + upload paths.
4. Discord OAuth flow works in staging with invite/new-user policies.
5. CI includes security baseline checks with zero critical findings.

## Risks and Mitigation
- Risk: migration breaks existing auth clients.
  - Mitigation: dual-path validation window and feature flag rollback.
- Risk: OAuth outage impacts login.
  - Mitigation: maintain local fallback and existing active sessions.

## Effort
- Estimated: M (2-4 weeks)

