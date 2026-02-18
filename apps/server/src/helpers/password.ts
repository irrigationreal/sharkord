import { sha256 } from '@sharkord/shared';

const ARGON2_PREFIX = '$argon2';
const LEGACY_SHA256_LENGTH = 64;

const isArgon2Hash = (value: string): boolean => value.startsWith(ARGON2_PREFIX);

const isLegacySha256Hash = (value: string): boolean =>
  /^[0-9a-f]{64}$/i.test(value) && value.length === LEGACY_SHA256_LENGTH;

const hashPassword = async (password: string): Promise<string> =>
  Bun.password.hash(password, {
    algorithm: 'argon2id',
    memoryCost: 65536,
    timeCost: 3
  });

const verifyPassword = async (
  password: string,
  storedPassword: string
): Promise<boolean> => {
  if (isArgon2Hash(storedPassword)) {
    return Bun.password.verify(password, storedPassword);
  }

  if (isLegacySha256Hash(storedPassword)) {
    return (await sha256(password)) === storedPassword;
  }

  // fallback to plain text compatibility for legacy seed data
  return password === storedPassword;
};

const passwordNeedsRehash = (storedPassword: string): boolean => {
  return !isArgon2Hash(storedPassword);
};

export { hashPassword, passwordNeedsRehash, verifyPassword };
