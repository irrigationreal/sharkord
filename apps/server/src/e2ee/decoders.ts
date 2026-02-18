import { badRequest } from './errors';

type TArkRecord = {
  version: number;
  userId: number;
  arkVersion: number;
  arkPub: Uint8Array;
  prevArkHash: Uint8Array | null;
  createdAtMs: number;
};

type TDeviceRecord = {
  version: number;
  userId: number;
  deviceId: string;
  deviceSeq: number;
  signPub: Uint8Array;
  kemPub: Uint8Array;
  cryptoProfile: string;
  capabilities: number;
  createdAtMs: number;
};

type TAuthorizationStatement = {
  version: number;
  userId: number;
  arkVersion: number;
  deviceRecordHash: Uint8Array;
  deviceSeq: number;
  action: number;
  createdAtMs: number;
  signature: Uint8Array;
};

type TCscPayload = {
  version: number;
  channelId: number;
  epoch: number;
  prevCscHash: Uint8Array | null;
  membershipDigest: Uint8Array;
  policyDigest: Uint8Array;
  signerDeviceId: string;
  createdAtMs: number;
};

type TMessageHeaderPayload = {
  version: number;
  channelId: number;
  epoch: number;
  cscHash: Uint8Array;
  senderUserId: number;
  senderDeviceId: string;
  senderKeyId: number;
  counter: number;
  clientMessageId: string;
  createdAtMs: number;
  contentType: number;
  flags: number;
};

const isMap = (value: unknown): value is Map<unknown, unknown> =>
  value instanceof Map;

const asMap = (value: unknown): Map<unknown, unknown> => {
  if (!isMap(value)) {
    badRequest('CBOR payload must decode to a map');
  }

  return value as Map<unknown, unknown>;
};

const getMapField = <T>(value: unknown, key: number): T => {
  const map = asMap(value);

  if (!map.has(key)) {
    badRequest(`CBOR payload missing required field ${key}`);
  }

  return map.get(key) as T;
};

const asNumber = (value: unknown, field: string): number => {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    badRequest(`${field} must be a finite number`);
  }

  return value as number;
};

const asUint = (value: unknown, field: string): number => {
  const parsed = asNumber(value, field);

  if (!Number.isInteger(parsed) || parsed < 0) {
    badRequest(`${field} must be an unsigned integer`);
  }

  if (!Number.isSafeInteger(parsed)) {
    badRequest(`${field} exceeds safe integer range`);
  }

  return parsed;
};

const asString = (value: unknown, field: string): string => {
  if (typeof value !== 'string' || value.length === 0) {
    badRequest(`${field} must be a non-empty string`);
  }

  return value as string;
};

const asBytes = (value: unknown, field: string): Uint8Array => {
  if (!(value instanceof Uint8Array)) {
    badRequest(`${field} must be bytes`);
  }

  return value as Uint8Array;
};

const asOptionalBytes = (value: unknown, field: string): Uint8Array | null => {
  if (value === null) return null;

  return asBytes(value, field);
};

const decodeArkRecord = (value: unknown): TArkRecord => ({
  version: asNumber(getMapField(value, 0), 'ark.version'),
  userId: asNumber(getMapField(value, 1), 'ark.user_id'),
  arkVersion: asNumber(getMapField(value, 2), 'ark.ark_version'),
  arkPub: asBytes(getMapField(value, 3), 'ark.ark_pub'),
  prevArkHash: asOptionalBytes(getMapField(value, 4), 'ark.prev_ark_hash'),
  createdAtMs: asNumber(getMapField(value, 5), 'ark.created_at_ms')
});

const decodeDeviceRecord = (value: unknown): TDeviceRecord => ({
  version: asNumber(getMapField(value, 0), 'device.version'),
  userId: asNumber(getMapField(value, 1), 'device.user_id'),
  deviceId: asString(getMapField(value, 2), 'device.device_id'),
  deviceSeq: asNumber(getMapField(value, 3), 'device.device_seq'),
  signPub: asBytes(getMapField(value, 4), 'device.sign_pub'),
  kemPub: asBytes(getMapField(value, 5), 'device.kem_pub'),
  cryptoProfile: asString(getMapField(value, 6), 'device.crypto_profile'),
  capabilities: asNumber(getMapField(value, 7), 'device.capabilities'),
  createdAtMs: asNumber(getMapField(value, 8), 'device.created_at_ms')
});

const decodeAuthorizationStatement = (
  value: unknown
): TAuthorizationStatement => ({
  version: asNumber(getMapField(value, 0), 'authorization.version'),
  userId: asNumber(getMapField(value, 1), 'authorization.user_id'),
  arkVersion: asNumber(getMapField(value, 2), 'authorization.ark_version'),
  deviceRecordHash: asBytes(
    getMapField(value, 3),
    'authorization.device_record_hash'
  ),
  deviceSeq: asNumber(getMapField(value, 4), 'authorization.device_seq'),
  action: asNumber(getMapField(value, 5), 'authorization.action'),
  createdAtMs: asNumber(getMapField(value, 6), 'authorization.created_at_ms'),
  signature: asBytes(getMapField(value, 7), 'authorization.signature')
});

const getUnsignedAuthorizationPayloadMap = (value: unknown): Map<number, unknown> => {
  const map = asMap(value);

  const unsignedPayload = new Map<number, unknown>();

  for (const [key, fieldValue] of map.entries()) {
    if (typeof key !== 'number') {
      badRequest('authorization statement keys must be integers');
    }
    const numericKey = key as number;

    if (numericKey === 7) {
      continue;
    }

    unsignedPayload.set(numericKey, fieldValue);
  }

  return unsignedPayload;
};

const decodeCscPayload = (value: unknown): TCscPayload => ({
  version: asNumber(getMapField(value, 0), 'csc.version'),
  channelId: asNumber(getMapField(value, 1), 'csc.channel_id'),
  epoch: asNumber(getMapField(value, 2), 'csc.epoch'),
  prevCscHash: asOptionalBytes(getMapField(value, 3), 'csc.prev_csc_hash'),
  membershipDigest: asBytes(getMapField(value, 4), 'csc.membership_digest'),
  policyDigest: asBytes(getMapField(value, 5), 'csc.policy_digest'),
  signerDeviceId: asString(getMapField(value, 6), 'csc.signer_device_id'),
  createdAtMs: asNumber(getMapField(value, 7), 'csc.created_at_ms')
});

const decodeMessageHeaderPayload = (value: unknown): TMessageHeaderPayload => ({
  version: asUint(getMapField(value, 0), 'msg.version'),
  channelId: asUint(getMapField(value, 1), 'msg.channel_id'),
  epoch: asUint(getMapField(value, 2), 'msg.epoch'),
  cscHash: asBytes(getMapField(value, 3), 'msg.csc_hash'),
  senderUserId: asUint(getMapField(value, 4), 'msg.sender_user_id'),
  senderDeviceId: asString(getMapField(value, 5), 'msg.sender_device_id'),
  senderKeyId: asUint(getMapField(value, 6), 'msg.sender_key_id'),
  counter: asUint(getMapField(value, 7), 'msg.counter'),
  clientMessageId: asString(getMapField(value, 8), 'msg.client_message_id'),
  createdAtMs: asUint(getMapField(value, 9), 'msg.created_at_ms'),
  contentType: asUint(getMapField(value, 10), 'msg.content_type'),
  flags: asUint(getMapField(value, 11), 'msg.flags')
});

export {
  decodeArkRecord,
  decodeAuthorizationStatement,
  decodeCscPayload,
  decodeDeviceRecord,
  decodeMessageHeaderPayload,
  getUnsignedAuthorizationPayloadMap
};
export type {
  TArkRecord,
  TAuthorizationStatement,
  TCscPayload,
  TDeviceRecord,
  TMessageHeaderPayload
};
