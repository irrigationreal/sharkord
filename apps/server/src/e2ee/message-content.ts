const E2EE_MARKER_RE = /^\[\[e2ee:v1:([0-9a-fA-F-]{36})\]\]$/;
const BLOCKED_NON_E2EE_MESSAGE_HTML = '<p><em>Blocked non-E2EE message</em></p>';

const isE2EEMessageMarker = (content: string | null | undefined): boolean => {
  if (typeof content !== 'string') {
    return false;
  }

  return E2EE_MARKER_RE.test(content.trim());
};

const enforceE2EEMessageBody = (
  content: string | null | undefined
): string => {
  if (typeof content === 'string' && isE2EEMessageMarker(content)) {
    return content.trim();
  }

  return BLOCKED_NON_E2EE_MESSAGE_HTML;
};

export { enforceE2EEMessageBody, isE2EEMessageMarker };
