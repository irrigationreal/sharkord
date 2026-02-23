import { ed25519 } from '@noble/curves/ed25519';
import { describe, expect, test } from 'bun:test';
import { verifyEd25519Signature } from '../verify-signatures';

describe('verify signatures', () => {
  test('should verify valid ed25519 signatures', () => {
    const secretKey = Uint8Array.from(Buffer.from('aa'.repeat(32), 'hex'));
    const publicKey = ed25519.getPublicKey(secretKey);
    const message = Uint8Array.from(Buffer.from('hello-world', 'utf8'));
    const signature = ed25519.sign(message, secretKey);

    expect(
      verifyEd25519Signature(signature, message, publicKey)
    ).toBe(true);
  });

  test('should reject tampered signatures', () => {
    const secretKey = Uint8Array.from(Buffer.from('bb'.repeat(32), 'hex'));
    const publicKey = ed25519.getPublicKey(secretKey);
    const message = Uint8Array.from(Buffer.from('hello-world', 'utf8'));
    const signature = ed25519.sign(message, secretKey);
    const tampered = Uint8Array.from(signature);

    tampered[0] = (tampered[0] ?? 0) ^ 0xff;

    expect(
      verifyEd25519Signature(tampered, message, publicKey)
    ).toBe(false);
  });
});
