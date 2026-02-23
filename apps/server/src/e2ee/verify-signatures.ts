import { ed25519 } from '@noble/curves/ed25519';
import { hashSha256Hex } from './hash';

const verifyEd25519Signature = (
  signature: Uint8Array,
  message: Uint8Array,
  publicKey: Uint8Array
): boolean => {
  return ed25519.verify(signature, message, publicKey);
};

const getSha256HexFromBytes = (value: Uint8Array): string => hashSha256Hex(value);

export { getSha256HexFromBytes, verifyEd25519Signature };
