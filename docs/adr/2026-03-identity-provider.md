# ADR 0003: OAuth-first Identity Model

Date: 2026-02-17

## Status
Proposed (implementation queue for Plan 1 WS3)

## Context
The next architecture phase introduces Discord-first identity with explicit local fallback.

## Decision
- Introduce `auth_identities` with provider + subject mapping and canonicalize session bootstrap around provider identity.
- Keep local identity/password flow as legacy fallback until migration windows are complete.
- Default rollout uses Discord-first resolution but does not block existing local users.

## Consequences
- Existing authentication endpoints remain operational while new provider flows are added.
- Schema migration must include explicit migration windows and compatibility behavior for pre-existing users.
