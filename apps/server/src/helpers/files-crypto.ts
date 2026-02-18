import { createHmac } from 'node:crypto';
import { getFileTokenSecret } from './server-secrets';

const generateFileToken = (
  fileId: number,
  channelAccessToken: string
): string => {
  const hmac = createHmac('sha256', getFileTokenSecret());

  hmac.update(`${fileId}:${channelAccessToken}`);

  return hmac.digest('hex');
};

const verifyFileToken = (
  fileId: number,
  channelAccessToken: string,
  providedToken: string
): boolean => {
  const expectedToken = generateFileToken(fileId, channelAccessToken);

  if (expectedToken.length !== providedToken.length) {
    return false;
  }

  return crypto.timingSafeEqual(
    Buffer.from(expectedToken),
    Buffer.from(providedToken)
  );
};

export { generateFileToken, verifyFileToken };
