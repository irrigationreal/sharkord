# ADR 0001: Storage-Compromise Trust Boundary

Date: 2026-02-17

## Status
Accepted (initial)

## Context
Sharkord now documents storage-compromise resistance as the minimum guarantee and defers active-malicious-server guarantees to deployment-hardening (signed clients / wrapper trust models).

## Decision
- Public claims will explicitly describe:
  - **Storage-compromise resistance** (required baseline)
  - **Active-malicious-server resistance** only for deployments that add external client trust mechanisms
- Crypto and protocol milestones must not assume trusted server-side runtime for endpoint-level promises.
- Plan communications and onboarding docs must reuse this boundary wording for all security statements.

## Consequences
- Feature work for `e2ee` can proceed without pretending to solve code-delivery trust in the base web delivery model.
- Security review can distinguish what is solved by product architecture vs delivery chain hardening.
