import { createHmac } from 'node:crypto';
import { getServerTokenSync } from '../db/queries/server';

const FILE_TOKEN_LABEL = 'sharkord-file-token-v1';
const OWNER_BOOTSTRAP_LABEL = 'sharkord-owner-bootstrap-v1';

const derivePurposeSecret = (label: string, masterSecret: string): string => {
  const hmac = createHmac('sha256', masterSecret);

  hmac.update(label);

  return hmac.digest('hex');
};

const getFileTokenSecret = (): string =>
  derivePurposeSecret(FILE_TOKEN_LABEL, getServerTokenSync());

const getOwnerBootstrapTokenHash = (rawToken: string): string => {
  const hmac = createHmac('sha256', OWNER_BOOTSTRAP_LABEL);
  hmac.update(rawToken);

  return hmac.digest('hex');
};

export {
  FILE_TOKEN_LABEL,
  OWNER_BOOTSTRAP_LABEL,
  getFileTokenSecret,
  getOwnerBootstrapTokenHash
};
