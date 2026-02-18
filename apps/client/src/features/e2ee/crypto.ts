const toBase64 = (value: Uint8Array): string =>
  btoa(String.fromCharCode(...value));

const fromBase64 = (value: string): Uint8Array => {
  const raw = atob(value);
  const result = new Uint8Array(raw.length);

  for (let i = 0; i < raw.length; i += 1) {
    result[i] = raw.charCodeAt(i);
  }

  return result;
};

const sha256Hex = async (value: Uint8Array): Promise<string> => {
  const digest = await crypto.subtle.digest('SHA-256', value);

  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
};

export { fromBase64, sha256Hex, toBase64 };
