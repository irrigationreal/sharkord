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
check_no_matches "html:\\s*plaintext|legacy plain payload" \
  "apps/client/src/features/e2ee/shadow.ts" \
  "Client E2EE parser must not fall back to plaintext payload rendering."
check_no_matches "\\[9,\\s*Date\\.now\\(" \
  "apps/client/src/features/e2ee/shadow.ts" \
  "Message headers must not carry raw client timestamps."
check_must_match "serializePaddedMessagePayload|E2EE_FILE_PAD_BLOCK_BYTES" \
  "apps/client/src/features/e2ee/shadow.ts" \
  "Client should pad encrypted message/file payloads to reduce metadata leakage."

# Attachment ciphertext hashes must be signed in header and verified server-side.
check_must_match "attachmentCiphertextSha256" \
  "apps/server/src/e2ee/decoders.ts apps/server/src/services/e2ee.ts" \
  "Attachment hash binding fields are missing from server header decode/verify path."
check_must_match "createHash\\('sha256'\\)" \
  "apps/server/src/services/e2ee.ts" \
  "Server-side ciphertext hash verification is missing."
check_must_match "verifyEncryptedAttachmentBinding" \
  "apps/server/src/services/e2ee.ts" \
  "Attachment hash binding verification is not wired in sendEncryptedMessage."
check_no_matches "const createdAt = headerPayload\\.createdAtMs" \
  "apps/server/src/services/e2ee.ts" \
  "Server must not trust client-provided message timestamps for persistence."

# Server-side read/publish paths must enforce E2EE-only message bodies/files.
check_must_match "enforceE2EEMessageBody|isE2EEMessageMarker" \
  "apps/server/src/routers/messages/get-messages.ts apps/server/src/db/queries/messages.ts apps/server/src/e2ee/message-content.ts" \
  "Server must enforce E2EE-only message content on message read/publish paths."

# Public file serving for E2EE message attachments must stay opaque.
check_must_match "isE2EEMessageMarker|encrypted\\.bin|application/octet-stream" \
  "apps/server/src/http/public.ts" \
  "Public file route must serve E2EE message attachments with opaque headers."

# Message metadata scraping must not be reintroduced into runtime message flow.
check_no_matches "enqueueProcessMetadata\\(" \
  "apps/server/src --glob '!**/__tests__/**' --glob '!queues/message-metadata/**'" \
  "Runtime must not enqueue plaintext message metadata scraping."

if [[ "$has_error" -ne 0 ]]; then
  exit 1
fi

echo "[e2ee-guard] OK"
