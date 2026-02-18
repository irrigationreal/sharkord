# ADR 0002: Session Strategy (Phase-1 Baseline)

Date: 2026-02-17

## Status
Implemented

## Context
Baseline authentication currently issues non-revocable opaque bearer tokens. For a full v1 rollout we need explicit revocation and rotation.

## Decision
- Replace JWT session validation with table-backed revocable sessions.
- Use short-lived opaque access tokens plus rotating refresh tokens.
- Add session table-backed revocation for `revoke`, `logout`, and `logout all` flows.

## Consequences
- Existing users retain working login behavior after migration.
- Legacy password hashes and owner bootstrap token formats are migrated as part of session hardening.
