import { ed25519, x25519 } from '@noble/curves/ed25519.js';
import { sha256 } from '@noble/hashes/sha2.js';
import type { TE2EEAuthorizedDevice, TFile, TJoinedMessage } from '@sharkord/shared';
import { decode, encode } from 'cborg';
import { getFileUrl } from '@/helpers/get-file-url';
import {
  getAuthorizedE2EEDevices,
  getE2EEEnvelopes,
  getE2EEIdentityBootstrap,
  getLatestE2EEChannelState,
  publishE2EEChannelEpoch,
  reserveE2EENonceBlock,
  registerE2EEDevice,
  requestE2EEKeyCatchup,
  sendE2EEEncryptedMessage
} from './api';

type TLocalIdentity = {
  userId: number;
  arkSecretKeyB64: string;
  deviceSignSecretKeyB64: string;
  deviceKemSecretKeyB64: string;
  deviceId: string;
  arkVersion: number;
  deviceSeq: number;
};

type TCounterReservation = {
  senderKeyId: string;
  noncePrefix: number;
  current: number;
  end: number;
};

type TEncryptedFileMeta = {
  v: 1;
  originalName: string;
  originalMimeType: string;
  originalSize: number;
  keyB64: string;
  nonceB64: string;
};

type TE2EEMessagePayload = {
  v: 1;
  html: string;
  files: TEncryptedFileMeta[];
};

type TWrappedChannelKeyEnvelope = {
  v: 2;
  channelId: number;
  epoch: number;
  cscHashHex: string;
  recipientDeviceId: string;
  epkB64: string;
  nonceB64: string;
  ciphertextB64: string;
  sigB64: string;
};

type TPreparedEnvelope = {
  headerCborB64: string;
  nonceB64: string;
  ciphertextB64: string;
  tagB64: string;
  clientMessageId: string;
};

const E2EE_IDENTITY_PREFIX = 'sharkord.e2ee.shadow.identity.v1.';
const E2EE_CHANNEL_KEY_PREFIX = 'sharkord.e2ee.shadow.channel-key.v1.';
const E2EE_COUNTER_RESERVATIONS = new Map<string, TCounterReservation>();
const E2EE_DECRYPTED_CACHE = new Map<string, string>();
const E2EE_TEMP_FILE_META = new Map<string, TEncryptedFileMeta>();
const E2EE_TEMP_FILE_SHA256 = new Map<string, string>();
const E2EE_FILE_META_BY_MESSAGE = new Map<number, Map<number, TEncryptedFileMeta>>();
const E2EE_RESHARE_COOLDOWN_BY_CHANNEL = new Map<number, number>();
const E2EE_RESHARE_IN_FLIGHT = new Map<number, Promise<boolean>>();
const E2EE_MARKER_RE = /^\[\[e2ee:v1:([0-9a-fA-F-]{36})\]\]$/;
const E2EE_RESHARE_COOLDOWN_MS = 60_000;

const toBase64 = (value: Uint8Array): string =>
  btoa(String.fromCharCode(...value));

const fromBase64 = (value: string): Uint8Array => {
  const raw = atob(value);
  const bytes = new Uint8Array(raw.length);

  for (let i = 0; i < raw.length; i += 1) {
    bytes[i] = raw.charCodeAt(i);
  }

  return bytes;
};

const fromHex = (value: string): Uint8Array => {
  const out = new Uint8Array(value.length / 2);

  for (let i = 0; i < out.length; i += 1) {
    out[i] = Number.parseInt(value.slice(i * 2, i * 2 + 2), 16);
  }

  return out;
};

const toHex = (value: Uint8Array): string =>
  Array.from(value, (byte) => byte.toString(16).padStart(2, '0')).join('');

const equalBytes = (left: Uint8Array, right: Uint8Array): boolean => {
  if (left.length !== right.length) {
    return false;
  }

  for (let i = 0; i < left.length; i += 1) {
    if (left[i] !== right[i]) {
      return false;
    }
  }

  return true;
};

const encodeCanonical = (value: unknown): Uint8Array => encode(value);
const POLICY_DIGEST_V1 = sha256(
  new TextEncoder().encode('sharkord-e2ee-policy-v1')
);

const computeMembershipDigest = (deviceIds: string[]): Uint8Array =>
  sha256(new TextEncoder().encode([...deviceIds].sort().join(',')));

const isStrictE2EEEnabled = (): boolean => true;

const getIdentityStorageKey = (userId: number): string =>
  `${E2EE_IDENTITY_PREFIX}${userId}`;

const getDecryptedCacheKey = (channelId: number, clientMessageId: string): string =>
  `${channelId}:${clientMessageId}`;

const readIdentity = (userId: number): TLocalIdentity | null => {
  const raw = localStorage.getItem(getIdentityStorageKey(userId));

  if (!raw) return null;

  try {
    const parsed = JSON.parse(raw) as TLocalIdentity;

    if (
      parsed.userId !== userId ||
      !parsed.deviceId ||
      !parsed.deviceKemSecretKeyB64
    ) {
      return null;
    }

    return parsed;
  } catch {
    return null;
  }
};

const writeIdentity = (identity: TLocalIdentity) => {
  localStorage.setItem(getIdentityStorageKey(identity.userId), JSON.stringify(identity));
};

const getOrCreateChannelKeyMaterial = (channelId: number): Uint8Array => {
  const storageKey = `${E2EE_CHANNEL_KEY_PREFIX}${channelId}`;
  const existing = localStorage.getItem(storageKey);
  const keyBytes = existing
    ? fromBase64(existing)
    : crypto.getRandomValues(new Uint8Array(32));

  if (!existing) {
    localStorage.setItem(storageKey, toBase64(keyBytes));
  }

  return keyBytes;
};

const getChannelKeyMaterial = (channelId: number): Uint8Array | null => {
  const storageKey = `${E2EE_CHANNEL_KEY_PREFIX}${channelId}`;
  const existing = localStorage.getItem(storageKey);

  return existing ? fromBase64(existing) : null;
};

const setChannelKeyMaterial = (channelId: number, keyBytes: Uint8Array) => {
  const storageKey = `${E2EE_CHANNEL_KEY_PREFIX}${channelId}`;
  localStorage.setItem(storageKey, toBase64(keyBytes));
};

const getOrCreateChannelEncryptKey = async (channelId: number): Promise<CryptoKey> =>
  crypto.subtle.importKey(
    'raw',
    getOrCreateChannelKeyMaterial(channelId),
    { name: 'AES-GCM' },
    false,
    ['encrypt']
  );

const wrapChannelKeyForRecipient = async (
  recipientKemPubHex: string,
  recipientDeviceId: string,
  channelKeyBytes: Uint8Array,
  signerDeviceSignSecretKey: Uint8Array,
  channelId: number,
  epoch: number,
  cscHashHex: string
): Promise<string> => {
  const recipientPub = fromHex(recipientKemPubHex);
  const ephemeral = x25519.keygen();
  const shared = x25519.getSharedSecret(ephemeral.secretKey, recipientPub);
  const wrappingKey = sha256(shared).slice(0, 32);
  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    wrappingKey,
    { name: 'AES-GCM' },
    false,
    ['encrypt']
  );
  const nonce = crypto.getRandomValues(new Uint8Array(12));
  const encrypted = await crypto.subtle.encrypt(
    {
      name: 'AES-GCM',
      iv: nonce,
      tagLength: 128
    },
    cryptoKey,
    channelKeyBytes
  );
  const ciphertextBytes = new Uint8Array(encrypted);
  const envelopeUnsigned = new Map<number, unknown>([
    [0, 2],
    [1, channelId],
    [2, epoch],
    [3, fromHex(cscHashHex)],
    [4, recipientDeviceId],
    [5, ephemeral.publicKey],
    [6, nonce],
    [7, ciphertextBytes]
  ]);
  const envelopeSig = ed25519.sign(
    sha256(encodeCanonical(envelopeUnsigned)),
    signerDeviceSignSecretKey
  );

  const envelope: TWrappedChannelKeyEnvelope = {
    v: 2,
    channelId,
    epoch,
    cscHashHex,
    recipientDeviceId,
    epkB64: toBase64(ephemeral.publicKey),
    nonceB64: toBase64(nonce),
    ciphertextB64: toBase64(ciphertextBytes),
    sigB64: toBase64(envelopeSig)
  };

  return JSON.stringify(envelope);
};

const unwrapChannelKeyEnvelope = async (
  envelopeText: string,
  ownKemSecretKey: Uint8Array,
  ownDeviceId: string,
  expected: {
    channelId: number;
    epoch: number;
    cscHashHex: string;
  },
  signerDeviceSignPubHex: string
): Promise<Uint8Array | null> => {
  try {
    const parsed = JSON.parse(envelopeText) as TWrappedChannelKeyEnvelope;

    if (
      parsed.v !== 2 ||
      parsed.channelId !== expected.channelId ||
      parsed.epoch !== expected.epoch ||
      parsed.cscHashHex !== expected.cscHashHex ||
      parsed.recipientDeviceId !== ownDeviceId ||
      typeof parsed.epkB64 !== 'string' ||
      typeof parsed.nonceB64 !== 'string' ||
      typeof parsed.ciphertextB64 !== 'string' ||
      typeof parsed.sigB64 !== 'string'
    ) {
      return null;
    }

    const epk = fromBase64(parsed.epkB64);
    const nonce = fromBase64(parsed.nonceB64);
    const ciphertext = fromBase64(parsed.ciphertextB64);
    const envelopeUnsigned = new Map<number, unknown>([
      [0, 2],
      [1, parsed.channelId],
      [2, parsed.epoch],
      [3, fromHex(parsed.cscHashHex)],
      [4, parsed.recipientDeviceId],
      [5, epk],
      [6, nonce],
      [7, ciphertext]
    ]);
    const verified = ed25519.verify(
      fromBase64(parsed.sigB64),
      sha256(encodeCanonical(envelopeUnsigned)),
      fromHex(signerDeviceSignPubHex)
    );

    if (!verified) {
      return null;
    }

    const shared = x25519.getSharedSecret(ownKemSecretKey, epk);
    const wrappingKey = sha256(shared).slice(0, 32);
    const cryptoKey = await crypto.subtle.importKey(
      'raw',
      wrappingKey,
      { name: 'AES-GCM' },
      false,
      ['decrypt']
    );
    const decrypted = await crypto.subtle.decrypt(
      {
        name: 'AES-GCM',
        iv: nonce,
        tagLength: 128
      },
      cryptoKey,
      ciphertext
    );

    return new Uint8Array(decrypted);
  } catch {
    return null;
  }
};

const getSenderKeyIdU32 = (deviceId: string, channelId: number): number => {
  let hash = 2166136261;
  const input = `${deviceId}:${channelId}:sender-key-v1`;

  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }

  return hash >>> 0;
};

const getOrReserveCounter = async (
  senderKeyId: string
): Promise<TCounterReservation> => {
  const existing = E2EE_COUNTER_RESERVATIONS.get(senderKeyId);

  if (existing && existing.current <= existing.end) return existing;

  const reserved = await reserveE2EENonceBlock({ senderKeyId });
  const reservation: TCounterReservation = {
    senderKeyId,
    noncePrefix: reserved.noncePrefix,
    current: reserved.startCounter,
    end: reserved.endCounter
  };
  E2EE_COUNTER_RESERVATIONS.set(senderKeyId, reservation);

  return reservation;
};

const ensureRegisteredIdentity = async (
  userId: number
): Promise<TLocalIdentity | null> => {
  const existingIdentity = readIdentity(userId);

  if (existingIdentity) return existingIdentity;
  const bootstrap = await getE2EEIdentityBootstrap();
  const nextArkVersion = (bootstrap.latestArkVersion || 0) + 1;
  const nextDeviceSeq = (bootstrap.latestDeviceSeq || 0) + 1;

  const arkSecretKey = crypto.getRandomValues(new Uint8Array(32));
  const deviceSignSecretKey = crypto.getRandomValues(new Uint8Array(32));
  const deviceKemSecretKey = x25519.keygen().secretKey;
  const kemPub = x25519.getPublicKey(deviceKemSecretKey);
  const now = Date.now();
  const deviceId = crypto.randomUUID();
  const arkPub = ed25519.getPublicKey(arkSecretKey);
  const signPub = ed25519.getPublicKey(deviceSignSecretKey);

  const arkPayload = new Map<number, unknown>([
    [0, 1],
    [1, userId],
    [2, nextArkVersion],
    [3, arkPub],
    [4, bootstrap.latestArkHashHex ? fromHex(bootstrap.latestArkHashHex) : null],
    [5, now]
  ]);
  const devicePayload = new Map<number, unknown>([
    [0, 1],
    [1, userId],
    [2, deviceId],
    [3, nextDeviceSeq],
    [4, signPub],
    [5, kemPub],
    [6, 'e2ee-v1'],
    [7, 1],
    [8, now]
  ]);
  const deviceBytes = encodeCanonical(devicePayload);
  const deviceHash = sha256(deviceBytes);

  const authUnsigned = new Map<number, unknown>([
    [0, 1],
    [1, userId],
    [2, nextArkVersion],
    [3, deviceHash],
    [4, nextDeviceSeq],
    [5, 1],
    [6, now]
  ]);
  const authSignature = ed25519.sign(encodeCanonical(authUnsigned), arkSecretKey);
  const authPayload = new Map<number, unknown>([
    ...authUnsigned.entries(),
    [7, authSignature]
  ]);

  await registerE2EEDevice({
    arkRecordCborB64: toBase64(encodeCanonical(arkPayload)),
    deviceRecordCborB64: toBase64(deviceBytes),
    deviceAuthorizationCborB64: toBase64(encodeCanonical(authPayload))
  });

  const identity: TLocalIdentity = {
    userId,
    arkSecretKeyB64: toBase64(arkSecretKey),
    deviceSignSecretKeyB64: toBase64(deviceSignSecretKey),
    deviceKemSecretKeyB64: toBase64(deviceKemSecretKey),
    deviceId,
    arkVersion: nextArkVersion,
    deviceSeq: nextDeviceSeq
  };
  writeIdentity(identity);

  return identity;
};

const ensureCscExists = async (
  channelId: number,
  identity: TLocalIdentity
): Promise<{ epoch: number; cscHashHex: string } | null> => {
  const latest = await getLatestE2EEChannelState(channelId);

  if (latest.latestEpoch && latest.latestCscHashHex) {
    return {
      epoch: latest.latestEpoch,
      cscHashHex: latest.latestCscHashHex
    };
  }

  const now = Date.now();
  const ownDevices = await getAuthorizedE2EEDevices(identity.userId);
  const membershipDigest = computeMembershipDigest(
    ownDevices.map((device) => device.deviceId)
  );
  const payload = new Map<number, unknown>([
    [0, 1],
    [1, channelId],
    [2, 1],
    [3, null],
    [4, membershipDigest],
    [5, POLICY_DIGEST_V1],
    [6, identity.deviceId],
    [7, now]
  ]);
  const payloadBytes = encodeCanonical(payload);
  const signSecret = fromBase64(identity.deviceSignSecretKeyB64);
  const signature = ed25519.sign(sha256(payloadBytes), signSecret);

  try {
    const created = await publishE2EEChannelEpoch({
      channelId,
      cscPayloadCborB64: toBase64(payloadBytes),
      cscSignatureB64: toBase64(signature)
    });

    return {
      epoch: created.epoch,
      cscHashHex: created.cscHashHex
    };
  } catch {
    return null;
  }
};

const extractMembershipDigestFromCscPayload = (
  payloadCborB64: string | null
): Uint8Array | null => {
  if (!payloadCborB64) {
    return null;
  }

  try {
    const decoded = decode(fromBase64(payloadCborB64), { useMaps: true });

    if (!(decoded instanceof Map)) {
      return null;
    }

    const digest = decoded.get(4);
    return digest instanceof Uint8Array ? digest : null;
  } catch {
    return null;
  }
};

const publishEpochWithDeviceKeyEnvelopes = async ({
  channelId,
  identity,
  recipientUserIds,
  channelKeyMaterial,
  preloadedRecipientDevices,
  skipIfMembershipDigestMatches
}: {
  channelId: number;
  identity: TLocalIdentity;
  recipientUserIds: number[];
  channelKeyMaterial?: Uint8Array;
  preloadedRecipientDevices?: TE2EEAuthorizedDevice[];
  skipIfMembershipDigestMatches?: boolean;
}): Promise<{ epoch: number; cscHashHex: string } | null> => {
  const latest = await getLatestE2EEChannelState(channelId);
  const currentEpoch = latest.latestEpoch || 0;
  const nextEpoch = currentEpoch + 1;
  const channelKey = channelKeyMaterial || getOrCreateChannelKeyMaterial(channelId);
  const recipientDevices =
    preloadedRecipientDevices ||
    (
      await Promise.all(
        recipientUserIds.map((userId) => getAuthorizedE2EEDevices(userId))
      )
    ).flat();

  const now = Date.now();
  const membershipDigest = computeMembershipDigest(
    recipientDevices.map((device) => device.deviceId)
  );
  const latestMembershipDigest = extractMembershipDigestFromCscPayload(
    latest.latestCscPayloadCborB64
  );

  if (
    skipIfMembershipDigestMatches &&
    latest.latestEpoch &&
    latest.latestCscHashHex &&
    latestMembershipDigest &&
    equalBytes(latestMembershipDigest, membershipDigest)
  ) {
    return {
      epoch: latest.latestEpoch,
      cscHashHex: latest.latestCscHashHex
    };
  }

  const payload = new Map<number, unknown>([
    [0, 1],
    [1, channelId],
    [2, nextEpoch],
    [3, latest.latestCscHashHex ? fromHex(latest.latestCscHashHex) : null],
    [4, membershipDigest],
    [5, POLICY_DIGEST_V1],
    [6, identity.deviceId],
    [7, now]
  ]);
  const payloadBytes = encodeCanonical(payload);
  const payloadHashHex = toHex(sha256(payloadBytes));
  const signSecret = fromBase64(identity.deviceSignSecretKeyB64);
  const signature = ed25519.sign(sha256(payloadBytes), signSecret);
  const deviceEnvelopes = await Promise.all(
    recipientDevices.map(async (device) => ({
      recipientDeviceId: device.deviceId,
      envelope: await wrapChannelKeyForRecipient(
        device.kemPubHex,
        device.deviceId,
        channelKey,
        signSecret,
        channelId,
        nextEpoch,
        payloadHashHex
      )
    }))
  );

  try {
    const created = await publishE2EEChannelEpoch({
      channelId,
      cscPayloadCborB64: toBase64(payloadBytes),
      cscSignatureB64: toBase64(signature),
      deviceEnvelopes
    });

    return {
      epoch: created.epoch,
      cscHashHex: created.cscHashHex
    };
  } catch {
    return ensureCscExists(channelId, identity);
  }
};

const encryptForEnvelope = async ({
  channelId,
  epoch,
  plaintext,
  senderUserId,
  senderDeviceId,
  senderKeyIdU32,
  noncePrefix,
  counter,
  cscHashHex,
  clientMessageId,
  attachmentCiphertextSha256Hexes
}: {
  channelId: number;
  epoch: number;
  plaintext: string;
  senderUserId: number;
  senderDeviceId: string;
  senderKeyIdU32: number;
  noncePrefix: number;
  counter: number;
  cscHashHex: string;
  clientMessageId: string;
  attachmentCiphertextSha256Hexes?: string[];
}): Promise<TPreparedEnvelope> => {
  const header = new Map<number, unknown>([
    [0, 1],
    [1, channelId],
    [2, epoch],
    [3, fromHex(cscHashHex)],
    [4, senderUserId],
    [5, senderDeviceId],
    [6, senderKeyIdU32],
    [7, counter],
    [8, clientMessageId],
    [9, Date.now()],
    [10, 1],
    [11, 0]
  ]);

  if (
    attachmentCiphertextSha256Hexes &&
    attachmentCiphertextSha256Hexes.length > 0
  ) {
    header.set(
      12,
      attachmentCiphertextSha256Hexes.map((hashHex) => fromHex(hashHex))
    );
  }

  const headerBytes = encodeCanonical(header);
  const key = await getOrCreateChannelEncryptKey(channelId);
  const nonce = new Uint8Array(12);
  const nonceView = new DataView(nonce.buffer);
  nonceView.setUint32(0, noncePrefix, false);
  nonceView.setBigUint64(4, BigInt(counter), false);
  const plaintextBytes = new TextEncoder().encode(plaintext);
  const encrypted = await crypto.subtle.encrypt(
    {
      name: 'AES-GCM',
      iv: nonce,
      additionalData: headerBytes,
      tagLength: 128
    },
    key,
    plaintextBytes
  );
  const encryptedBytes = new Uint8Array(encrypted);
  const tag = encryptedBytes.slice(encryptedBytes.length - 16);
  const ciphertext = encryptedBytes.slice(0, encryptedBytes.length - 16);

  return {
    clientMessageId,
    headerCborB64: toBase64(headerBytes),
    nonceB64: toBase64(nonce),
    ciphertextB64: toBase64(ciphertext),
    tagB64: toBase64(tag)
  };
};

const saveDecryptedToCache = (
  channelId: number,
  clientMessageId: string,
  content: string
) => {
  E2EE_DECRYPTED_CACHE.set(getDecryptedCacheKey(channelId, clientMessageId), content);
};

const getCachedDecrypted = (
  channelId: number,
  clientMessageId: string
): string | null =>
  E2EE_DECRYPTED_CACHE.get(getDecryptedCacheKey(channelId, clientMessageId)) || null;

const parseClientMessageIdMarker = (message: TJoinedMessage): string | null => {
  if (!message.content) return null;
  const match = message.content.trim().match(E2EE_MARKER_RE);

  return match?.[1] || null;
};

const parseE2EEPayload = (plaintext: string): TE2EEMessagePayload => {
  try {
    const parsed = JSON.parse(plaintext) as Partial<TE2EEMessagePayload>;

    if (parsed.v === 1 && typeof parsed.html === 'string') {
      return {
        v: 1,
        html: parsed.html,
        files: Array.isArray(parsed.files)
          ? parsed.files.filter(
              (file): file is TEncryptedFileMeta =>
                Boolean(
                  file &&
                    file.v === 1 &&
                    typeof file.originalName === 'string' &&
                    typeof file.originalMimeType === 'string' &&
                    typeof file.originalSize === 'number' &&
                    typeof file.keyB64 === 'string' &&
                    typeof file.nonceB64 === 'string'
                )
            )
          : []
      };
    }
  } catch {
    // legacy plain payload
  }

  return {
    v: 1,
    html: plaintext,
    files: []
  };
};

const recoverChannelKeyFromCatchup = async (
  channelId: number,
  userId: number
): Promise<boolean> => {
  const latest = await getLatestE2EEChannelState(channelId);

  if (!latest.latestEpoch) {
    return false;
  }

  const localIdentity = readIdentity(userId);

  if (!localIdentity) {
    return false;
  }

  const catchup = await requestE2EEKeyCatchup({
    channelId,
    fromEpochInclusive: Math.max(1, latest.latestEpoch - 256),
    toEpochInclusive: latest.latestEpoch,
    reason: 'decrypt_pending'
  });
  const ownKemSecret = fromBase64(localIdentity.deviceKemSecretKeyB64);
  const signerDevicesByUser = new Map<number, Awaited<ReturnType<typeof getAuthorizedE2EEDevices>>>();
  const cscByEpoch = new Map(
    catchup.cscChain.map((entry) => [
      entry.epoch,
      {
        cscHashHex: entry.cscHashHex,
        signerUserId: entry.signerUserId,
        signerDeviceId: entry.signerDeviceId
      }
    ])
  );

  for (let i = catchup.deviceKeyEnvelopes.length - 1; i >= 0; i -= 1) {
    const envelope = catchup.deviceKeyEnvelopes[i];
    const csc = cscByEpoch.get(envelope.epoch);

    if (!csc) {
      continue;
    }

    let signerDevices = signerDevicesByUser.get(csc.signerUserId);

    if (!signerDevices) {
      signerDevices = await getAuthorizedE2EEDevices(csc.signerUserId);
      signerDevicesByUser.set(csc.signerUserId, signerDevices);
    }

    const signerDevice = signerDevices.find(
      (device) => device.deviceId === csc.signerDeviceId
    );

    if (!signerDevice) {
      continue;
    }

    const unwrapped = await unwrapChannelKeyEnvelope(
      envelope.envelope,
      ownKemSecret,
      localIdentity.deviceId,
      {
        channelId,
        epoch: envelope.epoch,
        cscHashHex: csc.cscHashHex
      },
      signerDevice.signPubHex
    );

    if (unwrapped) {
      setChannelKeyMaterial(channelId, unwrapped);
      return true;
    }
  }

  return false;
};

const registerMessageFileMeta = (
  message: TJoinedMessage,
  fileMetas: TEncryptedFileMeta[]
) => {
  if (!fileMetas.length || !message.files.length) {
    return;
  }

  const map = new Map<number, TEncryptedFileMeta>();

  for (let i = 0; i < message.files.length; i += 1) {
    const file = message.files[i];
    const meta = fileMetas[i];

    if (file && meta) {
      map.set(file.id, meta);
    }
  }

  if (map.size > 0) {
    E2EE_FILE_META_BY_MESSAGE.set(message.id, map);
  }
};

const hydrateMessagesWithCachedE2EE = (
  channelId: number,
  messages: TJoinedMessage[]
): TJoinedMessage[] =>
  messages.map((message) => {
    const clientMessageId = parseClientMessageIdMarker(message);

    if (!clientMessageId) {
      return {
        ...message,
        content: '<p><em>Blocked non-E2EE message</em></p>',
        files: []
      };
    }

    const cached = getCachedDecrypted(channelId, clientMessageId);

    if (!cached) {
      return {
        ...message,
        content: '<p><em>Encrypted message</em></p>',
        files: []
      };
    }

    const payload = parseE2EEPayload(cached);
    registerMessageFileMeta(message, payload.files);

    return {
      ...message,
      content: payload.html
    };
  });

const prepareStrictE2EEFileForUpload = async (
  file: File
): Promise<{
  uploadFile: File;
  envelope: TEncryptedFileMeta;
  ciphertextSha256Hex: string;
}> => {
  const key = crypto.getRandomValues(new Uint8Array(32));
  const nonce = crypto.getRandomValues(new Uint8Array(12));
  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    key,
    { name: 'AES-GCM' },
    false,
    ['encrypt']
  );
  const plainBytes = new Uint8Array(await file.arrayBuffer());
  const encrypted = await crypto.subtle.encrypt(
    {
      name: 'AES-GCM',
      iv: nonce,
      tagLength: 128
    },
    cryptoKey,
    plainBytes
  );

  const encryptedBytes = new Uint8Array(encrypted);
  const ciphertextSha256Hex = toHex(sha256(encryptedBytes));
  const uploadFile = new File(
    [encryptedBytes],
    `e2ee-${crypto.randomUUID()}.bin`,
    { type: 'application/octet-stream' }
  );

  return {
    uploadFile,
    envelope: {
      v: 1,
      originalName: file.name,
      originalMimeType: file.type || 'application/octet-stream',
      originalSize: file.size,
      keyB64: toBase64(key),
      nonceB64: toBase64(nonce)
    },
    ciphertextSha256Hex
  };
};

const registerStrictTempFileEnvelope = (
  tempFileId: string,
  envelope: TEncryptedFileMeta,
  ciphertextSha256Hex: string
) => {
  E2EE_TEMP_FILE_META.set(tempFileId, envelope);
  E2EE_TEMP_FILE_SHA256.set(tempFileId, ciphertextSha256Hex);
};

const removeStrictTempFileEnvelope = (tempFileId: string) => {
  E2EE_TEMP_FILE_META.delete(tempFileId);
  E2EE_TEMP_FILE_SHA256.delete(tempFileId);
};

const resolveStrictFileEnvelopes = (
  tempFileIds: string[]
): TEncryptedFileMeta[] | null => {
  const resolved: TEncryptedFileMeta[] = [];

  for (const tempFileId of tempFileIds) {
    const meta = E2EE_TEMP_FILE_META.get(tempFileId);

    if (!meta) {
      return null;
    }

    resolved.push(meta);
  }

  return resolved;
};

const resolveStrictFileSha256Hexes = (
  tempFileIds: string[]
): string[] | null => {
  const resolved: string[] = [];

  for (const tempFileId of tempFileIds) {
    const hashHex = E2EE_TEMP_FILE_SHA256.get(tempFileId);

    if (!hashHex) {
      return null;
    }

    resolved.push(hashHex);
  }

  return resolved;
};

const sendStrictE2EEMessage = async ({
  channelId,
  userId,
  content,
  tempFileIds,
  parentMessageId,
  recipientUserIds
}: {
  channelId: number;
  userId: number;
  content: string;
  tempFileIds?: string[];
  parentMessageId?: number;
  recipientUserIds: number[];
}): Promise<{ messageId: number } | null> => {
  if (!content.trim() && !(tempFileIds && tempFileIds.length > 0)) return null;

  const identity = await ensureRegisteredIdentity(userId);

  if (!identity) return null;

  const uniqueRecipients = Array.from(new Set([userId, ...recipientUserIds]));
  const csc = await publishEpochWithDeviceKeyEnvelopes({
    channelId,
    identity,
    recipientUserIds: uniqueRecipients
  });

  if (!csc) return null;

  const senderKeyIdU32 = getSenderKeyIdU32(identity.deviceId, channelId);
  const senderKeyId = String(senderKeyIdU32);
  const reservation = await getOrReserveCounter(senderKeyId);
  const counter = reservation.current;
  reservation.current += 1;
  const clientMessageId = crypto.randomUUID();
  const fileMetas =
    tempFileIds && tempFileIds.length > 0
      ? resolveStrictFileEnvelopes(tempFileIds)
      : [];
  const fileCiphertextSha256Hexes =
    tempFileIds && tempFileIds.length > 0
      ? resolveStrictFileSha256Hexes(tempFileIds)
      : [];

  if (
    tempFileIds &&
    tempFileIds.length > 0 &&
    (!fileMetas || !fileCiphertextSha256Hexes)
  ) {
    return null;
  }

  const payload: TE2EEMessagePayload = {
    v: 1,
    html: content || '',
    files: fileMetas || []
  };
  const plaintext = JSON.stringify(payload);

  const envelope = await encryptForEnvelope({
    channelId,
    epoch: csc.epoch,
    plaintext,
    senderUserId: userId,
    senderDeviceId: identity.deviceId,
    senderKeyIdU32,
    noncePrefix: reservation.noncePrefix,
    counter,
    cscHashHex: csc.cscHashHex,
    clientMessageId,
    attachmentCiphertextSha256Hexes: fileCiphertextSha256Hexes || []
  });

  const created = await sendE2EEEncryptedMessage({
    channelId,
    parentMessageId,
    headerCborB64: envelope.headerCborB64,
    nonceB64: envelope.nonceB64,
    ciphertextB64: envelope.ciphertextB64,
    tagB64: envelope.tagB64,
    files: tempFileIds
  });

  saveDecryptedToCache(channelId, created.clientMessageId, plaintext);

  if (tempFileIds && tempFileIds.length > 0) {
    for (const tempFileId of tempFileIds) {
      E2EE_TEMP_FILE_META.delete(tempFileId);
      E2EE_TEMP_FILE_SHA256.delete(tempFileId);
    }
  }

  return { messageId: created.messageId };
};

const republishKnownChannelKeysForMembers = async ({
  ownUserId,
  recipientUserIds,
  channelIds
}: {
  ownUserId: number;
  recipientUserIds: number[];
  channelIds: number[];
}): Promise<void> => {
  if (!channelIds.length || !recipientUserIds.length) {
    return;
  }

  const knownChannelIds = channelIds.filter((channelId) =>
    Boolean(getChannelKeyMaterial(channelId))
  );

  if (!knownChannelIds.length) {
    return;
  }

  const identity = await ensureRegisteredIdentity(ownUserId);

  if (!identity) {
    return;
  }

  const uniqueRecipients = Array.from(new Set([ownUserId, ...recipientUserIds]));
  const recipientDevices = (
    await Promise.all(
      uniqueRecipients.map((userId) => getAuthorizedE2EEDevices(userId))
    )
  ).flat();
  const now = Date.now();

  await Promise.allSettled(
    knownChannelIds.map(async (channelId) => {
      const knownChannelKey = getChannelKeyMaterial(channelId);

      if (!knownChannelKey) {
        return;
      }

      const lastRepublishAt = E2EE_RESHARE_COOLDOWN_BY_CHANNEL.get(channelId) || 0;

      if (now - lastRepublishAt < E2EE_RESHARE_COOLDOWN_MS) {
        return;
      }

      const existingInFlight = E2EE_RESHARE_IN_FLIGHT.get(channelId);

      if (existingInFlight) {
        await existingInFlight;
        return;
      }

      const task = (async () => {
        try {
          await publishEpochWithDeviceKeyEnvelopes({
            channelId,
            identity,
            recipientUserIds: uniqueRecipients,
            channelKeyMaterial: knownChannelKey,
            preloadedRecipientDevices: recipientDevices,
            skipIfMembershipDigestMatches: true
          });
          E2EE_RESHARE_COOLDOWN_BY_CHANNEL.set(channelId, Date.now());
          return true;
        } catch {
          return false;
        } finally {
          E2EE_RESHARE_IN_FLIGHT.delete(channelId);
        }
      })();

      E2EE_RESHARE_IN_FLIGHT.set(channelId, task);
      await task;
    })
  );
};

const tryHydrateMessagesWithEnvelopeDecrypt = async (
  channelId: number,
  messages: TJoinedMessage[],
  ownUserId?: number
): Promise<TJoinedMessage[]> => {
  const unresolvedClientMessageIds = messages
    .map((message) => parseClientMessageIdMarker(message))
    .filter((value): value is string => Boolean(value))
    .filter((id) => !getCachedDecrypted(channelId, id));

  if (!unresolvedClientMessageIds.length) {
    return hydrateMessagesWithCachedE2EE(channelId, messages);
  }

  try {
    const envelopePage = await getE2EEEnvelopes({ channelId, limit: 200 });
    let channelKey = getChannelKeyMaterial(channelId);

    if (!channelKey) {
      const recovered =
        typeof ownUserId === 'number'
          ? await recoverChannelKeyFromCatchup(channelId, ownUserId)
          : false;

      if (recovered) {
        channelKey = getChannelKeyMaterial(channelId);
      }
    }

    if (!channelKey) {
      return hydrateMessagesWithCachedE2EE(channelId, messages);
    }

    const decryptKey = await crypto.subtle.importKey(
      'raw',
      channelKey,
      { name: 'AES-GCM' },
      false,
      ['decrypt']
    );

    for (const envelope of envelopePage.envelopes) {
      try {
        const decoded = decode(fromBase64(envelope.headerCborB64), {
          useMaps: true
        });

        if (!(decoded instanceof Map)) continue;

        const clientMessageId = decoded.get(8);

        if (typeof clientMessageId !== 'string') continue;
        if (!unresolvedClientMessageIds.includes(clientMessageId)) continue;

        const headerBytes = fromBase64(envelope.headerCborB64);
        const nonce = fromBase64(envelope.nonceB64);
        const ciphertext = fromBase64(envelope.ciphertextB64);
        const tag = fromBase64(envelope.tagB64);
        const combined = new Uint8Array(ciphertext.length + tag.length);
        combined.set(ciphertext, 0);
        combined.set(tag, ciphertext.length);

        const decrypted = await crypto.subtle.decrypt(
          {
            name: 'AES-GCM',
            iv: nonce,
            additionalData: headerBytes,
            tagLength: 128
          },
          decryptKey,
          combined
        );

        const content = new TextDecoder().decode(decrypted);
        saveDecryptedToCache(channelId, clientMessageId, content);
      } catch {
        // continue
      }
    }
  } catch {
    // best effort
  }

  return hydrateMessagesWithCachedE2EE(channelId, messages);
};

const getStrictE2EEFileMeta = (
  messageId: number,
  fileId: number
): TEncryptedFileMeta | null =>
  E2EE_FILE_META_BY_MESSAGE.get(messageId)?.get(fileId) || null;

const openStrictE2EEFile = async ({
  messageId,
  file
}: {
  messageId: number;
  file: TFile;
}): Promise<void> => {
  const meta = getStrictE2EEFileMeta(messageId, file.id);

  if (!meta) {
    throw new Error('Encrypted metadata missing for attachment');
  }

  const encryptedRes = await fetch(getFileUrl(file));

  if (!encryptedRes.ok) {
    throw new Error('Failed to fetch encrypted file');
  }

  const encryptedBytes = new Uint8Array(await encryptedRes.arrayBuffer());
  const key = await crypto.subtle.importKey(
    'raw',
    fromBase64(meta.keyB64),
    { name: 'AES-GCM' },
    false,
    ['decrypt']
  );
  const decrypted = await crypto.subtle.decrypt(
    {
      name: 'AES-GCM',
      iv: fromBase64(meta.nonceB64),
      tagLength: 128
    },
    key,
    encryptedBytes
  );

  const blob = new Blob([decrypted], { type: meta.originalMimeType });
  const blobUrl = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = blobUrl;
  anchor.download = meta.originalName;
  anchor.rel = 'noopener';
  anchor.click();

  setTimeout(() => {
    URL.revokeObjectURL(blobUrl);
  }, 10_000);
};

export {
  getStrictE2EEFileMeta,
  isStrictE2EEEnabled,
  openStrictE2EEFile,
  prepareStrictE2EEFileForUpload,
  registerStrictTempFileEnvelope,
  removeStrictTempFileEnvelope,
  republishKnownChannelKeysForMembers,
  sendStrictE2EEMessage,
  tryHydrateMessagesWithEnvelopeDecrypt
};
