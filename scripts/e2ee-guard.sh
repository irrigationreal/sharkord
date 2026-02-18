#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(git rev-parse --show-toplevel)"
cd "$ROOT_DIR"

has_error=0

report_error() {
  echo "[e2ee-guard] $1" >&2
  has_error=1
}

check_no_matches() {
  local pattern="$1"
  local target="$2"
  local description="$3"
  local output

  output="$(rg -n "$pattern" $target || true)"

  if [[ -n "$output" ]]; then
    report_error "$description"
    echo "$output" >&2
  fi
}

check_must_match() {
  local pattern="$1"
  local target="$2"
  local description="$3"

  if ! rg -n "$pattern" $target >/dev/null 2>&1; then
    report_error "$description"
  fi
}

# No direct plaintext message send/edit mutations from client runtime code.
check_no_matches "messages\\.(send|edit)\\.mutate\\(" "apps/client/src --glob '!**/__tests__/**'" \
  "Client runtime must not call plaintext messages.send/messages.edit."

# Server runtime must only insert messages through the E2EE service.
check_no_matches "insert\\(messages\\)" \
  "apps/server/src --glob '!**/__tests__/**' --glob '!**/seed.ts' --glob '!services/e2ee.ts'" \
  "Runtime message inserts must only happen in apps/server/src/services/e2ee.ts."

# Legacy plaintext message routes must stay hard-blocked (no content payload contract).
check_no_matches "content:\\s*z\\.string\\(" \
  "apps/server/src/routers/messages/send-message.ts apps/server/src/routers/messages/edit-message.ts" \
  "Legacy plaintext message routes must not accept content payloads."

# Attachment rendering must not fall back to direct file URLs in chat.
check_no_matches "getFileUrl\\(file\\)|href=\\{.*getFileUrl\\(file\\)" \
  "apps/client/src/components/channel-view/text/renderer/index.tsx" \
  "Chat attachment renderer must not expose non-E2EE file URL fallbacks."

# Non-E2EE message bodies must remain blocked at hydration time.
check_must_match "Blocked non-E2EE message" \
  "apps/client/src/features/e2ee/shadow.ts" \
  "Expected non-E2EE message redaction is missing."

if [[ "$has_error" -ne 0 ]]; then
  exit 1
fi

echo "[e2ee-guard] OK"
