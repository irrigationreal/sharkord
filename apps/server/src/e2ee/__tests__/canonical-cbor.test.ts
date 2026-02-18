import { describe, expect, test } from 'bun:test';
import { decode, encode } from 'cborg';
import {
  canonicalizeCborBase64,
  encodeCanonicalCbor
} from '../canonical-cbor';

const toBase64 = (value: Uint8Array): string =>
  Buffer.from(value).toString('base64');

describe('canonical cbor', () => {
  test('should round-trip decoded payload and return canonical bytes', () => {
    const payload = new Map<number, unknown>([
      [2, 123],
      [0, 1],
      [1, 'abc']
    ]);
    const encoded = encode(payload);
    const canonical = canonicalizeCborBase64(toBase64(encoded));
    const reparsed = decode(canonical.canonicalBytes, {
      useMaps: true
    });

    expect(reparsed).toBeInstanceOf(Map);
  });

  test('should produce stable canonical bytes for equivalent payloads', () => {
    const first = new Map<number, unknown>([
      [0, 1],
      [1, 'hello'],
      [2, 5]
    ]);
    const second = new Map<number, unknown>([
      [2, 5],
      [1, 'hello'],
      [0, 1]
    ]);

    expect(
      Buffer.from(encodeCanonicalCbor(first)).toString('hex')
    ).toBe(Buffer.from(encodeCanonicalCbor(second)).toString('hex'));
  });
});
