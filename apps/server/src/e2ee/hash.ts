import { sha256 } from '@noble/hashes/sha256';

const toHex = (bytes: Uint8Array): string =>
  Buffer.from(bytes).toString('hex');

const hashSha256Hex = (bytes: Uint8Array): string => toHex(sha256(bytes));

const hashSha256HexFromUtf8 = (value: string): string =>
  hashSha256Hex(Buffer.from(value, 'utf8'));

export { hashSha256Hex, hashSha256HexFromUtf8, toHex };
