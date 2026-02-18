import { ed25519 } from '@noble/curves/ed25519';
import { sha256 } from '@noble/hashes/sha256';
import { describe, expect, test } from 'bun:test';
import { encode } from 'cborg';
import { eq } from 'drizzle-orm';
import { getCaller } from '../../__tests__/helpers';
import { tdb } from '../../__tests__/setup';
import {
  channelEpochDeviceEnvelopes,
  channelStateCommitments,
  devicePrekeys,
  e2eeDevices,
  e2eeMessageEnvelopes,
  messages,
  userRootKeys
} from '../../db/schema';

const toBase64 = (value: Uint8Array): string =>
  Buffer.from(value).toString('base64');

const toHex = (value: Uint8Array): string => Buffer.from(value).toString('hex');

const encodeCanonical = (value: unknown): Uint8Array => encode(value);

type TRegisterFixtures = {
  input: {
    arkRecordCborB64: string;
    deviceRecordCborB64: string;
    deviceAuthorizationCborB64: string;
  };
  deviceSignSecretKey: Uint8Array;
  deviceId: string;
};

const createRegisterFixtures = ({
  userId,
  deviceId,
  arkVersion,
  deviceSeq,
  prevArkHashHex,
  timestamp
}: {
  userId: number;
  deviceId: string;
  arkVersion: number;
  deviceSeq: number;
  prevArkHashHex: string | null;
  timestamp: number;
}): TRegisterFixtures => {
  const arkSecretKey = Uint8Array.from(
    Buffer.from('11'.repeat(32), 'hex')
  );
  const deviceSignSecretKey = Uint8Array.from(
    Buffer.from('22'.repeat(32), 'hex')
  );
  const kemPub = Uint8Array.from(Buffer.from('33'.repeat(32), 'hex'));
  const arkPub = ed25519.getPublicKey(arkSecretKey);
  const signPub = ed25519.getPublicKey(deviceSignSecretKey);

  const arkPayload = new Map<number, unknown>([
    [0, 1],
    [1, userId],
    [2, arkVersion],
    [3, arkPub],
    [4, prevArkHashHex ? Uint8Array.from(Buffer.from(prevArkHashHex, 'hex')) : null],
    [5, timestamp]
  ]);

  const devicePayload = new Map<number, unknown>([
    [0, 1],
    [1, userId],
    [2, deviceId],
    [3, deviceSeq],
    [4, signPub],
    [5, kemPub],
    [6, 'e2ee-v1'],
    [7, 1],
    [8, timestamp]
  ]);

  const devicePayloadBytes = encodeCanonical(devicePayload);
  const devicePayloadHash = sha256(devicePayloadBytes);

  const authorizationUnsigned = new Map<number, unknown>([
    [0, 1],
    [1, userId],
    [2, arkVersion],
    [3, devicePayloadHash],
    [4, deviceSeq],
    [5, 1],
    [6, timestamp]
  ]);
  const authorizationUnsignedBytes = encodeCanonical(authorizationUnsigned);
  const authorizationSignature = ed25519.sign(
    authorizationUnsignedBytes,
    arkSecretKey
  );

  const authorizationPayload = new Map<number, unknown>([
    ...authorizationUnsigned.entries(),
    [7, authorizationSignature]
  ]);

  return {
    input: {
      arkRecordCborB64: toBase64(encodeCanonical(arkPayload)),
      deviceRecordCborB64: toBase64(encodeCanonical(devicePayload)),
      deviceAuthorizationCborB64: toBase64(encodeCanonical(authorizationPayload))
    },
    deviceSignSecretKey,
    deviceId
  };
};

const createCscPayload = ({
  channelId,
  epoch,
  prevCscHashHex,
  signerDeviceId,
  timestamp
}: {
  channelId: number;
  epoch: number;
  prevCscHashHex: string | null;
  signerDeviceId: string;
  timestamp: number;
}) => {
  const membershipDigest = Uint8Array.from(Buffer.from('44'.repeat(32), 'hex'));
  const policyDigest = Uint8Array.from(Buffer.from('55'.repeat(32), 'hex'));

  return new Map<number, unknown>([
    [0, 1],
    [1, channelId],
    [2, epoch],
    [3, prevCscHashHex ? Uint8Array.from(Buffer.from(prevCscHashHex, 'hex')) : null],
    [4, membershipDigest],
    [5, policyDigest],
    [6, signerDeviceId],
    [7, timestamp]
  ]);
};

const createEnvelopeHeaderPayload = ({
  channelId,
  epoch,
  cscHashHex,
  senderUserId,
  senderDeviceId,
  senderKeyId,
  counter,
  clientMessageId,
  timestamp,
  contentType = 1,
  flags = 0
}: {
  channelId: number;
  epoch: number;
  cscHashHex: string;
  senderUserId: number;
  senderDeviceId: string;
  senderKeyId: number;
  counter: number;
  clientMessageId: string;
  timestamp: number;
  contentType?: number;
  flags?: number;
}) =>
  new Map<number, unknown>([
    [0, 1],
    [1, channelId],
    [2, epoch],
    [3, Uint8Array.from(Buffer.from(cscHashHex, 'hex'))],
    [4, senderUserId],
    [5, senderDeviceId],
    [6, senderKeyId],
    [7, counter],
    [8, clientMessageId],
    [9, timestamp],
    [10, contentType],
    [11, flags]
  ]);

describe('e2ee router', () => {
  test('should register first ARK/device and persist records', async () => {
    const { caller } = await getCaller(1);
    const fixtures = createRegisterFixtures({
      userId: 1,
      deviceId: '11111111-1111-7111-8111-111111111111',
      arkVersion: 1,
      deviceSeq: 1,
      prevArkHashHex: null,
      timestamp: Date.now()
    });

    const result = await caller.e2ee.registerDevice(fixtures.input);

    expect(result.arkVersion).toBe(1);
    expect(result.deviceSeq).toBe(1);
    expect(result.deviceId).toBe(fixtures.deviceId);

    const rootKey = await tdb.select().from(userRootKeys).where(eq(userRootKeys.userId, 1)).get();
    const device = await tdb.select().from(e2eeDevices).where(eq(e2eeDevices.userId, 1)).get();

    expect(rootKey).toBeDefined();
    expect(device).toBeDefined();
  });

  test('should reject non-monotonic ARK version', async () => {
    const { caller } = await getCaller(1);
    const now = Date.now();
    const first = createRegisterFixtures({
      userId: 1,
      deviceId: '22222222-2222-7222-8222-222222222222',
      arkVersion: 1,
      deviceSeq: 1,
      prevArkHashHex: null,
      timestamp: now
    });

    await caller.e2ee.registerDevice(first.input);

    const second = createRegisterFixtures({
      userId: 1,
      deviceId: '33333333-3333-7333-8333-333333333333',
      arkVersion: 1,
      deviceSeq: 2,
      prevArkHashHex: null,
      timestamp: now + 1
    });

    await expect(caller.e2ee.registerDevice(second.input)).rejects.toThrow(
      'ark_version must be strictly monotonic'
    );
  });

  test('should publish CSC chain and reject invalid continuity', async () => {
    const { caller } = await getCaller(1);
    const now = Date.now();
    const registration = createRegisterFixtures({
      userId: 1,
      deviceId: '44444444-4444-7444-8444-444444444444',
      arkVersion: 1,
      deviceSeq: 1,
      prevArkHashHex: null,
      timestamp: now
    });

    await caller.e2ee.registerDevice(registration.input);

    const firstPayload = createCscPayload({
      channelId: 1,
      epoch: 1,
      prevCscHashHex: null,
      signerDeviceId: registration.deviceId,
      timestamp: now + 1
    });
    const firstPayloadBytes = encodeCanonical(firstPayload);
    const firstSignature = ed25519.sign(
      sha256(firstPayloadBytes),
      registration.deviceSignSecretKey
    );

    const firstResult = await caller.e2ee.publishChannelEpoch({
      channelId: 1,
      cscPayloadCborB64: toBase64(firstPayloadBytes),
      cscSignatureB64: toBase64(firstSignature)
    });

    expect(firstResult.epoch).toBe(1);

    const secondPayload = createCscPayload({
      channelId: 1,
      epoch: 2,
      prevCscHashHex: firstResult.cscHashHex,
      signerDeviceId: registration.deviceId,
      timestamp: now + 2
    });
    const secondPayloadBytes = encodeCanonical(secondPayload);
    const secondSignature = ed25519.sign(
      sha256(secondPayloadBytes),
      registration.deviceSignSecretKey
    );

    await caller.e2ee.publishChannelEpoch({
      channelId: 1,
      cscPayloadCborB64: toBase64(secondPayloadBytes),
      cscSignatureB64: toBase64(secondSignature)
    });

    const invalidPayload = createCscPayload({
      channelId: 1,
      epoch: 3,
      prevCscHashHex: toHex(Uint8Array.from(Buffer.from('66'.repeat(32), 'hex'))),
      signerDeviceId: registration.deviceId,
      timestamp: now + 3
    });
    const invalidPayloadBytes = encodeCanonical(invalidPayload);
    const invalidSignature = ed25519.sign(
      sha256(invalidPayloadBytes),
      registration.deviceSignSecretKey
    );

    await expect(
      caller.e2ee.publishChannelEpoch({
        channelId: 1,
        cscPayloadCborB64: toBase64(invalidPayloadBytes),
        cscSignatureB64: toBase64(invalidSignature)
      })
    ).rejects.toThrow('CSC prev hash mismatch');

    const persisted = await tdb
      .select()
      .from(channelStateCommitments)
      .where(eq(channelStateCommitments.channelId, 1))
      .all();

    expect(persisted).toHaveLength(2);
  });

  test('should upload and claim prekeys with one-time consumption', async () => {
    const { caller: ownerCaller } = await getCaller(1);
    const { caller: otherCaller } = await getCaller(2);
    const now = Date.now();
    const registration = createRegisterFixtures({
      userId: 1,
      deviceId: '55555555-5555-7555-8555-555555555555',
      arkVersion: 1,
      deviceSeq: 1,
      prevArkHashHex: null,
      timestamp: now
    });

    await ownerCaller.e2ee.registerDevice(registration.input);

    const signedPrekeyBytes = Uint8Array.from(Buffer.from('77'.repeat(32), 'hex'));
    const signedPrekeySignature = ed25519.sign(
      signedPrekeyBytes,
      registration.deviceSignSecretKey
    );

    await ownerCaller.e2ee.uploadPrekeys({
      deviceId: registration.deviceId,
      signedPrekey: {
        prekeyId: 'spk-1',
        prekeyPubB64: toBase64(signedPrekeyBytes),
        signatureB64: toBase64(signedPrekeySignature),
        createdAtMs: now + 1
      },
      oneTimePrekeys: [
        {
          prekeyId: 'otk-1',
          prekeyPubB64: toBase64(Uint8Array.from(Buffer.from('88'.repeat(32), 'hex'))),
          createdAtMs: now + 2
        }
      ]
    });

    const claimed = await otherCaller.e2ee.claimPrekey({
      targetUserId: 1,
      targetDeviceId: registration.deviceId
    });

    expect(claimed.deviceId).toBe(registration.deviceId);
    expect(claimed.signedPrekey.prekeyId).toBe('spk-1');
    expect(claimed.oneTimePrekey?.prekeyId).toBe('otk-1');

    const consumedOneTime = await tdb
      .select()
      .from(devicePrekeys)
      .where(eq(devicePrekeys.prekeyId, 'otk-1'))
      .get();

    expect(consumedOneTime?.usedAt).toBeDefined();
  });

  test('should scope signed prekey lookup by target user when device ids collide', async () => {
    const { caller: userOneCaller } = await getCaller(1);
    const { caller: userTwoCaller } = await getCaller(2);
    const now = Date.now();
    const sharedDeviceId = 'aaaaaaaa-aaaa-7aaa-8aaa-aaaaaaaaaaaa';

    const userOneRegistration = createRegisterFixtures({
      userId: 1,
      deviceId: sharedDeviceId,
      arkVersion: 1,
      deviceSeq: 1,
      prevArkHashHex: null,
      timestamp: now
    });
    const userTwoRegistration = createRegisterFixtures({
      userId: 2,
      deviceId: sharedDeviceId,
      arkVersion: 1,
      deviceSeq: 1,
      prevArkHashHex: null,
      timestamp: now + 1
    });

    await userOneCaller.e2ee.registerDevice(userOneRegistration.input);
    await userTwoCaller.e2ee.registerDevice(userTwoRegistration.input);

    const userOneSignedPrekeyBytes = Uint8Array.from(
      Buffer.from('99'.repeat(32), 'hex')
    );
    const userOneSignedPrekeySignature = ed25519.sign(
      userOneSignedPrekeyBytes,
      userOneRegistration.deviceSignSecretKey
    );
    const userTwoSignedPrekeyBytes = Uint8Array.from(
      Buffer.from('aa'.repeat(32), 'hex')
    );
    const userTwoSignedPrekeySignature = ed25519.sign(
      userTwoSignedPrekeyBytes,
      userTwoRegistration.deviceSignSecretKey
    );

    await userOneCaller.e2ee.uploadPrekeys({
      deviceId: sharedDeviceId,
      signedPrekey: {
        prekeyId: 'user1-spk',
        prekeyPubB64: toBase64(userOneSignedPrekeyBytes),
        signatureB64: toBase64(userOneSignedPrekeySignature),
        createdAtMs: now + 2
      },
      oneTimePrekeys: []
    });

    await userTwoCaller.e2ee.uploadPrekeys({
      deviceId: sharedDeviceId,
      signedPrekey: {
        prekeyId: 'user2-spk',
        prekeyPubB64: toBase64(userTwoSignedPrekeyBytes),
        signatureB64: toBase64(userTwoSignedPrekeySignature),
        createdAtMs: now + 3
      },
      oneTimePrekeys: []
    });

    const claimed = await userTwoCaller.e2ee.claimPrekey({
      targetUserId: 1,
      targetDeviceId: sharedDeviceId
    });

    expect(claimed.signedPrekey.prekeyId).toBe('user1-spk');
  });

  test('should return csc chain and device envelopes via key catchup', async () => {
    const { caller } = await getCaller(1);
    const now = Date.now();
    const registration = createRegisterFixtures({
      userId: 1,
      deviceId: '66666666-6666-7666-8666-666666666666',
      arkVersion: 1,
      deviceSeq: 1,
      prevArkHashHex: null,
      timestamp: now
    });

    await caller.e2ee.registerDevice(registration.input);

    const payload = createCscPayload({
      channelId: 1,
      epoch: 1,
      prevCscHashHex: null,
      signerDeviceId: registration.deviceId,
      timestamp: now + 1
    });
    const payloadBytes = encodeCanonical(payload);
    const signature = ed25519.sign(
      sha256(payloadBytes),
      registration.deviceSignSecretKey
    );

    await caller.e2ee.publishChannelEpoch({
      channelId: 1,
      cscPayloadCborB64: toBase64(payloadBytes),
      cscSignatureB64: toBase64(signature),
      deviceEnvelopes: [
        {
          recipientDeviceId: registration.deviceId,
          envelope: 'envelope-v1'
        }
      ]
    });

    const catchup = await caller.e2ee.requestKeyCatchup({
      channelId: 1,
      fromEpochInclusive: 1,
      toEpochInclusive: 1,
      missingSenders: [
        {
          senderDeviceId: registration.deviceId,
          senderKeyId: 'sender-key-1'
        }
      ],
      reason: 'channel_open'
    });

    expect(catchup.cscChain).toHaveLength(1);
    expect(catchup.deviceKeyEnvelopes).toHaveLength(1);
    expect(catchup.deviceKeyEnvelopes[0]?.envelope).toBe('envelope-v1');

    const persistedEnvelope = await tdb
      .select()
      .from(channelEpochDeviceEnvelopes)
      .where(eq(channelEpochDeviceEnvelopes.channelId, 1))
      .get();

    expect(persistedEnvelope?.recipientDeviceId).toBe(registration.deviceId);
  });

  test('should reserve nonce blocks sequentially via e2ee route', async () => {
    const { caller } = await getCaller(1);

    const first = await caller.e2ee.reserveNonceBlock({
      senderKeyId: 'sender-key-route-1'
    });
    const second = await caller.e2ee.reserveNonceBlock({
      senderKeyId: 'sender-key-route-1'
    });

    expect(first.startCounter).toBe(0);
    expect(first.endCounter).toBe(1023);
    expect(second.startCounter).toBe(1024);
    expect(second.endCounter).toBe(2047);
    expect(second.noncePrefix).toBe(first.noncePrefix);
  });

  test('should reserve nonce blocks independently per user for the same sender key id', async () => {
    const { caller: userOneCaller } = await getCaller(1);
    const { caller: userTwoCaller } = await getCaller(2);

    const senderKeyId = 'shared-sender-key-id';
    const userOneFirst = await userOneCaller.e2ee.reserveNonceBlock({
      senderKeyId
    });
    const userTwoFirst = await userTwoCaller.e2ee.reserveNonceBlock({
      senderKeyId
    });

    expect(userOneFirst.startCounter).toBe(0);
    expect(userTwoFirst.startCounter).toBe(0);
    expect(userOneFirst.noncePrefix).not.toBe(userTwoFirst.noncePrefix);
  });

  test('should submit and fetch e2ee message envelopes', async () => {
    const { caller } = await getCaller(1);
    const now = Date.now();
    const registration = createRegisterFixtures({
      userId: 1,
      deviceId: '77777777-7777-7777-8777-777777777777',
      arkVersion: 1,
      deviceSeq: 1,
      prevArkHashHex: null,
      timestamp: now
    });

    await caller.e2ee.registerDevice(registration.input);

    const cscPayload = createCscPayload({
      channelId: 1,
      epoch: 1,
      prevCscHashHex: null,
      signerDeviceId: registration.deviceId,
      timestamp: now + 1
    });
    const cscPayloadBytes = encodeCanonical(cscPayload);
    const cscSignature = ed25519.sign(
      sha256(cscPayloadBytes),
      registration.deviceSignSecretKey
    );
    const cscResult = await caller.e2ee.publishChannelEpoch({
      channelId: 1,
      cscPayloadCborB64: toBase64(cscPayloadBytes),
      cscSignatureB64: toBase64(cscSignature)
    });

    const headerPayload = createEnvelopeHeaderPayload({
      channelId: 1,
      epoch: 1,
      cscHashHex: cscResult.cscHashHex,
      senderUserId: 1,
      senderDeviceId: registration.deviceId,
      senderKeyId: 1,
      counter: 1,
      clientMessageId: '88888888-8888-7888-8888-888888888888',
      timestamp: now + 2
    });

    const submit = await caller.e2ee.submitEnvelope({
      channelId: 1,
      headerCborB64: toBase64(encodeCanonical(headerPayload)),
      nonceB64: toBase64(Uint8Array.from(Buffer.from('01'.repeat(12), 'hex'))),
      ciphertextB64: toBase64(Uint8Array.from(Buffer.from('abcd', 'hex'))),
      tagB64: toBase64(Uint8Array.from(Buffer.from('02'.repeat(16), 'hex')))
    });

    expect(submit.acceptedCounter).toBe(1);

    const page = await caller.e2ee.getEnvelopes({
      channelId: 1,
      limit: 10
    });

    expect(page.envelopes).toHaveLength(1);
    expect(page.envelopes[0]?.clientMessageId).toBe(
      '88888888-8888-7888-8888-888888888888'
    );

    const persisted = await tdb
      .select()
      .from(e2eeMessageEnvelopes)
      .where(eq(e2eeMessageEnvelopes.id, submit.envelopeId))
      .get();

    expect(persisted?.counter).toBe(1);
  });

  test('should reject duplicate sender counter on submitEnvelope', async () => {
    const { caller } = await getCaller(1);
    const now = Date.now();
    const registration = createRegisterFixtures({
      userId: 1,
      deviceId: '99999999-9999-7999-8999-999999999999',
      arkVersion: 1,
      deviceSeq: 1,
      prevArkHashHex: null,
      timestamp: now
    });

    await caller.e2ee.registerDevice(registration.input);

    const cscPayload = createCscPayload({
      channelId: 1,
      epoch: 1,
      prevCscHashHex: null,
      signerDeviceId: registration.deviceId,
      timestamp: now + 1
    });
    const cscPayloadBytes = encodeCanonical(cscPayload);
    const cscSignature = ed25519.sign(
      sha256(cscPayloadBytes),
      registration.deviceSignSecretKey
    );
    const cscResult = await caller.e2ee.publishChannelEpoch({
      channelId: 1,
      cscPayloadCborB64: toBase64(cscPayloadBytes),
      cscSignatureB64: toBase64(cscSignature)
    });

    const firstHeader = createEnvelopeHeaderPayload({
      channelId: 1,
      epoch: 1,
      cscHashHex: cscResult.cscHashHex,
      senderUserId: 1,
      senderDeviceId: registration.deviceId,
      senderKeyId: 7,
      counter: 3,
      clientMessageId: 'aaaaaaaa-aaaa-7aaa-8aaa-aaaaaaaaaaaa',
      timestamp: now + 2
    });

    await caller.e2ee.submitEnvelope({
      channelId: 1,
      headerCborB64: toBase64(encodeCanonical(firstHeader)),
      nonceB64: toBase64(Uint8Array.from(Buffer.from('03'.repeat(12), 'hex'))),
      ciphertextB64: toBase64(Uint8Array.from(Buffer.from('beef', 'hex'))),
      tagB64: toBase64(Uint8Array.from(Buffer.from('04'.repeat(16), 'hex')))
    });

    const duplicateCounterHeader = createEnvelopeHeaderPayload({
      channelId: 1,
      epoch: 1,
      cscHashHex: cscResult.cscHashHex,
      senderUserId: 1,
      senderDeviceId: registration.deviceId,
      senderKeyId: 7,
      counter: 3,
      clientMessageId: 'bbbbbbbb-bbbb-7bbb-8bbb-bbbbbbbbbbbb',
      timestamp: now + 3
    });

    await expect(
      caller.e2ee.submitEnvelope({
        channelId: 1,
        headerCborB64: toBase64(encodeCanonical(duplicateCounterHeader)),
        nonceB64: toBase64(Uint8Array.from(Buffer.from('05'.repeat(12), 'hex'))),
        ciphertextB64: toBase64(Uint8Array.from(Buffer.from('cafe', 'hex'))),
        tagB64: toBase64(Uint8Array.from(Buffer.from('06'.repeat(16), 'hex')))
      })
    ).rejects.toThrow('duplicate counter');
  });

  test('should reject counter jumps above MAX_COUNTER_GAP', async () => {
    const { caller } = await getCaller(1);
    const now = Date.now();
    const registration = createRegisterFixtures({
      userId: 1,
      deviceId: 'cccccccc-cccc-7ccc-8ccc-cccccccccccc',
      arkVersion: 1,
      deviceSeq: 1,
      prevArkHashHex: null,
      timestamp: now
    });

    await caller.e2ee.registerDevice(registration.input);

    const cscPayload = createCscPayload({
      channelId: 1,
      epoch: 1,
      prevCscHashHex: null,
      signerDeviceId: registration.deviceId,
      timestamp: now + 1
    });
    const cscPayloadBytes = encodeCanonical(cscPayload);
    const cscSignature = ed25519.sign(
      sha256(cscPayloadBytes),
      registration.deviceSignSecretKey
    );
    const cscResult = await caller.e2ee.publishChannelEpoch({
      channelId: 1,
      cscPayloadCborB64: toBase64(cscPayloadBytes),
      cscSignatureB64: toBase64(cscSignature)
    });

    const baselineHeader = createEnvelopeHeaderPayload({
      channelId: 1,
      epoch: 1,
      cscHashHex: cscResult.cscHashHex,
      senderUserId: 1,
      senderDeviceId: registration.deviceId,
      senderKeyId: 9,
      counter: 0,
      clientMessageId: 'dddddddd-dddd-7ddd-8ddd-dddddddddddd',
      timestamp: now + 2
    });

    await caller.e2ee.submitEnvelope({
      channelId: 1,
      headerCborB64: toBase64(encodeCanonical(baselineHeader)),
      nonceB64: toBase64(Uint8Array.from(Buffer.from('07'.repeat(12), 'hex'))),
      ciphertextB64: toBase64(Uint8Array.from(Buffer.from('f00d', 'hex'))),
      tagB64: toBase64(Uint8Array.from(Buffer.from('08'.repeat(16), 'hex')))
    });

    const jumpHeader = createEnvelopeHeaderPayload({
      channelId: 1,
      epoch: 1,
      cscHashHex: cscResult.cscHashHex,
      senderUserId: 1,
      senderDeviceId: registration.deviceId,
      senderKeyId: 9,
      counter: 10002,
      clientMessageId: 'eeeeeeee-eeee-7eee-8eee-eeeeeeeeeeee',
      timestamp: now + 3
    });

    await expect(
      caller.e2ee.submitEnvelope({
        channelId: 1,
        headerCborB64: toBase64(encodeCanonical(jumpHeader)),
        nonceB64: toBase64(Uint8Array.from(Buffer.from('09'.repeat(12), 'hex'))),
        ciphertextB64: toBase64(Uint8Array.from(Buffer.from('face', 'hex'))),
        tagB64: toBase64(Uint8Array.from(Buffer.from('0a'.repeat(16), 'hex')))
      })
    ).rejects.toThrow('counter gap exceeded');
  });

  test('should reject untrusted aad field in submitEnvelope input', async () => {
    const { caller } = await getCaller(1);
    const now = Date.now();
    const registration = createRegisterFixtures({
      userId: 1,
      deviceId: 'ffffffff-ffff-7fff-8fff-ffffffffffff',
      arkVersion: 1,
      deviceSeq: 1,
      prevArkHashHex: null,
      timestamp: now
    });

    await caller.e2ee.registerDevice(registration.input);

    const cscPayload = createCscPayload({
      channelId: 1,
      epoch: 1,
      prevCscHashHex: null,
      signerDeviceId: registration.deviceId,
      timestamp: now + 1
    });
    const cscPayloadBytes = encodeCanonical(cscPayload);
    const cscSignature = ed25519.sign(
      sha256(cscPayloadBytes),
      registration.deviceSignSecretKey
    );
    const cscResult = await caller.e2ee.publishChannelEpoch({
      channelId: 1,
      cscPayloadCborB64: toBase64(cscPayloadBytes),
      cscSignatureB64: toBase64(cscSignature)
    });

    const headerPayload = createEnvelopeHeaderPayload({
      channelId: 1,
      epoch: 1,
      cscHashHex: cscResult.cscHashHex,
      senderUserId: 1,
      senderDeviceId: registration.deviceId,
      senderKeyId: 11,
      counter: 1,
      clientMessageId: '10101010-1010-7010-8010-101010101010',
      timestamp: now + 2
    });

    await expect(
      caller.e2ee.submitEnvelope({
        channelId: 1,
        headerCborB64: toBase64(encodeCanonical(headerPayload)),
        nonceB64: toBase64(Uint8Array.from(Buffer.from('0b'.repeat(12), 'hex'))),
        ciphertextB64: toBase64(Uint8Array.from(Buffer.from('abab', 'hex'))),
        tagB64: toBase64(Uint8Array.from(Buffer.from('0c'.repeat(16), 'hex'))),
        aadB64: 'not-allowed'
      } as unknown as Parameters<typeof caller.e2ee.submitEnvelope>[0])
    ).rejects.toThrow(/Unrecognized key/);
  });

  test('should send encrypted message without persisting plaintext body', async () => {
    const { caller } = await getCaller(1);
    const now = Date.now();
    const registration = createRegisterFixtures({
      userId: 1,
      deviceId: '12121212-1212-7121-8121-121212121212',
      arkVersion: 1,
      deviceSeq: 1,
      prevArkHashHex: null,
      timestamp: now
    });

    await caller.e2ee.registerDevice(registration.input);

    const cscPayload = createCscPayload({
      channelId: 1,
      epoch: 1,
      prevCscHashHex: null,
      signerDeviceId: registration.deviceId,
      timestamp: now + 1
    });
    const cscPayloadBytes = encodeCanonical(cscPayload);
    const cscSignature = ed25519.sign(
      sha256(cscPayloadBytes),
      registration.deviceSignSecretKey
    );
    const cscResult = await caller.e2ee.publishChannelEpoch({
      channelId: 1,
      cscPayloadCborB64: toBase64(cscPayloadBytes),
      cscSignatureB64: toBase64(cscSignature)
    });

    const clientMessageId = '13131313-1313-7131-8131-131313131313';
    const headerPayload = createEnvelopeHeaderPayload({
      channelId: 1,
      epoch: 1,
      cscHashHex: cscResult.cscHashHex,
      senderUserId: 1,
      senderDeviceId: registration.deviceId,
      senderKeyId: 12,
      counter: 1,
      clientMessageId,
      timestamp: now + 2
    });

    const sent = await caller.e2ee.sendEncryptedMessage({
      channelId: 1,
      headerCborB64: toBase64(encodeCanonical(headerPayload)),
      nonceB64: toBase64(Uint8Array.from(Buffer.from('aa'.repeat(12), 'hex'))),
      ciphertextB64: toBase64(Uint8Array.from(Buffer.from('bead', 'hex'))),
      tagB64: toBase64(Uint8Array.from(Buffer.from('bb'.repeat(16), 'hex')))
    });

    const persistedMessage = await tdb
      .select()
      .from(messages)
      .where(eq(messages.id, sent.messageId))
      .get();

    expect(persistedMessage?.content).toBe(`[[e2ee:v1:${clientMessageId}]]`);
  });
});
