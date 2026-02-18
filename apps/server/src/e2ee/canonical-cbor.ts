import { decode, encode } from 'cborg';

const decodeBase64 = (value: string): Uint8Array =>
  Uint8Array.from(Buffer.from(value, 'base64'));

const encodeBase64 = (value: Uint8Array): string =>
  Buffer.from(value).toString('base64');

const decodeCanonicalCbor = (cborBase64: string): unknown => {
  const bytes = decodeBase64(cborBase64);

  return decode(bytes, {
    useMaps: true
  });
};

const encodeCanonicalCbor = (value: unknown): Uint8Array =>
  encode(value);

const canonicalizeCborBase64 = (
  cborBase64: string
): { parsed: unknown; canonicalBytes: Uint8Array; canonicalBase64: string } => {
  const parsed = decodeCanonicalCbor(cborBase64);
  const canonicalBytes = encodeCanonicalCbor(parsed);

  return {
    parsed,
    canonicalBytes,
    canonicalBase64: encodeBase64(canonicalBytes)
  };
};

export {
  canonicalizeCborBase64,
  decodeBase64,
  decodeCanonicalCbor,
  encodeBase64,
  encodeCanonicalCbor
};
