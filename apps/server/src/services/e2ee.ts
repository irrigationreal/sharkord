import { ChannelPermission } from '@sharkord/shared';
import { and, desc, eq, gte, inArray, isNull, lte, lt } from 'drizzle-orm';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { db } from '../db';
import { publishMessage } from '../db/publishers';
import { channelUserCan } from '../db/queries/channels';
import {
  channelEpochDeviceEnvelopes,
  channelStateCommitments,
  deviceAuthorizations,
  devicePrekeys,
  e2eeDevices,
  e2eeMessageEnvelopes,
  messageFiles,
  messages,
  users,
  userRootKeys
} from '../db/schema';
import {
  canonicalizeCborBase64,
  decodeBase64,
  encodeCanonicalCbor
} from '../e2ee/canonical-cbor';
import {
  decodeArkRecord,
  decodeAuthorizationStatement,
  decodeCscPayload,
  decodeDeviceRecord,
  decodeMessageHeaderPayload,
  getUnsignedAuthorizationPayloadMap
} from '../e2ee/decoders';
import { badRequest, conflict, forbidden } from '../e2ee/errors';
import { toHex } from '../e2ee/hash';
import {
  getSha256HexFromBytes,
  verifyEd25519Signature
} from '../e2ee/verify-signatures';
import {
  reserveNonceCounterBlock,
  validateAndStoreReplayCounter
} from '../e2ee/nonce-replay';
import { fileManager } from '../utils/file-manager';

type TRegisterDeviceInput = {
  userId: number;
  arkRecordCborB64: string;
  deviceRecordCborB64: string;
  deviceAuthorizationCborB64: string;
};

type TRegisterDeviceResult = {
  arkVersion: number;
  deviceId: string;
  deviceSeq: number;
  arkHashHex: string;
  deviceRecordHashHex: string;
};

type TRevokeDeviceInput = {
  userId: number;
  deviceId: string;
  arkVersion: number;
  revokeAuthorizationCborB64: string;
};

type TPublishChannelEpochInput = {
  userId: number;
  channelId: number;
  cscPayloadCborB64: string;
  cscSignatureB64: string;
  deviceEnvelopes?: Array<{
    recipientDeviceId: string;
    envelope: string;
  }>;
};

type TPublishChannelEpochResult = {
  channelId: number;
  epoch: number;
  cscHashHex: string;
};

type TLatestChannelStateResult = {
  latestEpoch: number | null;
  latestCscHashHex: string | null;
  latestCscPayloadCborB64: string | null;
  latestCscSignatureB64: string | null;
};

type TIdentityBootstrapResult = {
  latestArkVersion: number | null;
  latestArkHashHex: string | null;
  latestDeviceSeq: number | null;
};

type TAuthorizedDevice = {
  deviceId: string;
  deviceSeq: number;
  signPubHex: string;
  kemPubHex: string;
  arkVersion: number;
  authorizedAt: number;
};

type TUploadPrekeysInput = {
  userId: number;
  deviceId: string;
  signedPrekey: {
    prekeyId: string;
    prekeyPubB64: string;
    signatureB64: string;
    createdAtMs: number;
  };
  oneTimePrekeys: Array<{
    prekeyId: string;
    prekeyPubB64: string;
    createdAtMs: number;
  }>;
};

type TClaimPrekeyInput = {
  requesterUserId: number;
  targetUserId: number;
  targetDeviceId: string;
};

type TClaimPrekeyResult = {
  deviceId: string;
  signedPrekey: {
    prekeyId: string;
    prekeyPubB64: string;
    signatureB64: string;
  };
  oneTimePrekey: {
    prekeyId: string;
    prekeyPubB64: string;
  } | null;
};

type TRequestKeyCatchupInput = {
  userId: number;
  channelId: number;
  fromEpochInclusive: number;
  toEpochInclusive: number;
  missingSenders?: Array<{
    senderDeviceId: string;
    senderKeyId: string;
  }>;
  reason:
    | 'channel_open'
    | 'scroll_backfill'
    | 'decrypt_pending'
    | 'device_restore';
};

type TRequestKeyCatchupResult = {
  cscChain: Array<{
    epoch: number;
    cscSigned: string;
    cscHashHex: string;
    signerUserId: number;
    signerDeviceId: string;
  }>;
  deviceKeyEnvelopes: Array<{
    epoch: number;
    recipientDeviceId: string;
    envelope: string;
  }>;
  historyBoundaries: Array<{
    type: 'channel_created_boundary';
    effectiveFromTs: number;
    reason: string;
  }>;
};

const getChannelViewerUserIds = async (channelId: number): Promise<number[]> => {
  const allUserIds = await db.select({ id: users.id }).from(users);
  const checks = await Promise.all(
    allUserIds.map(async ({ id }) => ({
      id,
      canView: await channelUserCan(
        channelId,
        id,
        ChannelPermission.VIEW_CHANNEL
      )
    }))
  );

  return checks.filter((entry) => entry.canView).map((entry) => entry.id);
};

type TReserveNonceBlockInput = {
  senderKeyId: string;
};

type TReserveNonceBlockResult = {
  senderKeyId: string;
  noncePrefix: number;
  startCounter: number;
  endCounter: number;
};

type TSubmitEnvelopeInput = {
  userId: number;
  channelId: number;
  headerCborB64: string;
  nonceB64: string;
  ciphertextB64: string;
  tagB64: string;
  sigB64?: string;
};

type TSubmitEnvelopeResult = {
  envelopeId: number;
  acceptedCounter: number;
  createdAt: number;
};

type TGetEnvelopesInput = {
  channelId: number;
  cursorId?: number;
  limit: number;
  fromEpochInclusive?: number;
  toEpochInclusive?: number;
};

type TGetEnvelopesResult = {
  envelopes: Array<{
    id: number;
    channelId: number;
    epoch: number;
    senderUserId: number;
    senderDeviceId: string;
    senderKeyId: string;
    counter: number;
    clientMessageId: string;
    contentType: number;
    flags: number;
    cscHashHex: string;
    headerCborB64: string;
    nonceB64: string;
    ciphertextB64: string;
    tagB64: string;
    sigB64: string | null;
    createdAt: number;
  }>;
  nextCursorId: number | null;
};

type TSendEncryptedMessageInput = TSubmitEnvelopeInput & {
  parentMessageId?: number;
  files?: string[];
};

type TSendEncryptedMessageResult = {
  messageId: number;
  envelopeId: number;
  clientMessageId: string;
  createdAt: number;
};

const isUuid = (value: string): boolean =>
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    value
  );

const assertByteLength = (
  value: Uint8Array,
  expectedLength: number,
  field: string
) => {
  if (value.length !== expectedLength) {
    badRequest(`${field} must be ${expectedLength} bytes`);
  }
};

const hashFileSha256Hex = async (filePath: string): Promise<string> => {
  const contents = await readFile(filePath);

  return createHash('sha256').update(contents).digest('hex');
};

const verifyEncryptedAttachmentBinding = async ({
  tempFileIds,
  expectedCiphertextSha256Hexes,
  userId
}: {
  tempFileIds: string[];
  expectedCiphertextSha256Hexes: string[];
  userId: number;
}): Promise<void> => {
  if (!tempFileIds.length && expectedCiphertextSha256Hexes.length === 0) {
    return;
  }

  if (tempFileIds.length !== expectedCiphertextSha256Hexes.length) {
    badRequest('Attachment hash list does not match attached files');
  }

  for (let i = 0; i < tempFileIds.length; i += 1) {
    const tempFileId = tempFileIds[i]!;
    const expectedSha256 = expectedCiphertextSha256Hexes[i]!;
    const tempFile = fileManager.getTemporaryFile(tempFileId);

    if (!tempFile) {
      badRequest('Temporary attachment not found');
    }
    const ensuredTempFile = tempFile!;

    if (ensuredTempFile.userId !== userId) {
      forbidden("You don't have permission to access this attachment");
    }

    const actualSha256 = await hashFileSha256Hex(ensuredTempFile.path);

    if (actualSha256 !== expectedSha256) {
      conflict('Attachment hash mismatch');
    }
  }
};

const registerDevice = async (
  input: TRegisterDeviceInput
): Promise<TRegisterDeviceResult> => {
  const arkRecord = canonicalizeCborBase64(input.arkRecordCborB64);
  const deviceRecord = canonicalizeCborBase64(input.deviceRecordCborB64);
  const authorizationRecord = canonicalizeCborBase64(
    input.deviceAuthorizationCborB64
  );

  const parsedArk = decodeArkRecord(arkRecord.parsed);
  const parsedDevice = decodeDeviceRecord(deviceRecord.parsed);
  const parsedAuthorization = decodeAuthorizationStatement(
    authorizationRecord.parsed
  );
  const unsignedAuthorizationMap = getUnsignedAuthorizationPayloadMap(
    authorizationRecord.parsed
  );
  const unsignedAuthorizationBytes = encodeCanonicalCbor(unsignedAuthorizationMap);

  if (parsedArk.version !== 1) badRequest('Unsupported ARK version');
  if (parsedDevice.version !== 1) badRequest('Unsupported device record version');
  if (parsedAuthorization.version !== 1) {
    badRequest('Unsupported authorization statement version');
  }

  assertByteLength(parsedArk.arkPub, 32, 'ark_pub');
  assertByteLength(parsedDevice.signPub, 32, 'device.sign_pub');
  assertByteLength(parsedDevice.kemPub, 32, 'device.kem_pub');
  assertByteLength(parsedAuthorization.deviceRecordHash, 32, 'device_record_hash');
  assertByteLength(parsedAuthorization.signature, 64, 'authorization.signature');

  if (!isUuid(parsedDevice.deviceId)) {
    badRequest('device_id must be a UUID string');
  }

  if (parsedArk.userId !== input.userId || parsedDevice.userId !== input.userId) {
    forbidden('Payload user_id must match authenticated user');
  }

  const arkHashHex = getSha256HexFromBytes(arkRecord.canonicalBytes);
  const deviceRecordHashHex = getSha256HexFromBytes(deviceRecord.canonicalBytes);
  const deviceRecordHashFromStatement = toHex(parsedAuthorization.deviceRecordHash);

  if (parsedAuthorization.action !== 1) {
    badRequest('Device registration requires action=1 authorization');
  }

  if (parsedAuthorization.userId !== input.userId) {
    forbidden('Authorization user_id must match authenticated user');
  }

  if (parsedAuthorization.arkVersion !== parsedArk.arkVersion) {
    badRequest('Authorization ark_version does not match ark record');
  }

  if (parsedAuthorization.deviceSeq !== parsedDevice.deviceSeq) {
    badRequest('Authorization device_seq does not match device record');
  }

  if (deviceRecordHashFromStatement !== deviceRecordHashHex) {
    badRequest('Authorization device_record_hash does not match device record');
  }

  const signatureValid = verifyEd25519Signature(
    parsedAuthorization.signature,
    unsignedAuthorizationBytes,
    parsedArk.arkPub
  );

  if (!signatureValid) {
    forbidden('Invalid device authorization signature');
  }

  const now = Date.now();
  const latestRootKey = await db
    .select()
    .from(userRootKeys)
    .where(eq(userRootKeys.userId, input.userId))
    .orderBy(desc(userRootKeys.arkVersion))
    .get();

  if (!latestRootKey) {
    if (parsedArk.arkVersion !== 1) {
      conflict('First ARK version must be 1');
    }

    if (parsedArk.prevArkHash !== null) {
      conflict('First ARK record must not define prev_ark_hash');
    }
  } else {
    if (parsedArk.arkVersion !== latestRootKey.arkVersion + 1) {
      conflict('ark_version must be strictly monotonic');
    }

    const prevArkHash = parsedArk.prevArkHash;

    if (!prevArkHash) {
      conflict('Rotated ARK record must include prev_ark_hash');
    }

    if (toHex(prevArkHash!) !== latestRootKey.arkHash) {
      conflict('ARK prev hash does not match latest ARK hash');
    }
  }

  const latestDevice = await db
    .select()
    .from(e2eeDevices)
    .where(eq(e2eeDevices.userId, input.userId))
    .orderBy(desc(e2eeDevices.deviceSeq))
    .get();

  if (!latestDevice) {
    if (parsedDevice.deviceSeq !== 1) {
      conflict('First device_seq must be 1');
    }
  } else if (parsedDevice.deviceSeq <= latestDevice.deviceSeq) {
    conflict('device_seq must be strictly monotonic');
  }

  await db.transaction(async (tx) => {
    await tx.insert(userRootKeys).values({
      userId: input.userId,
      arkVersion: parsedArk.arkVersion,
      arkPub: toHex(parsedArk.arkPub),
      arkRecordCbor: arkRecord.canonicalBase64,
      arkHash: arkHashHex,
      prevArkHash: parsedArk.prevArkHash ? toHex(parsedArk.prevArkHash) : null,
      createdAt: parsedArk.createdAtMs || now
    });

    await tx.insert(e2eeDevices).values({
      userId: input.userId,
      deviceId: parsedDevice.deviceId,
      deviceSeq: parsedDevice.deviceSeq,
      signPub: toHex(parsedDevice.signPub),
      kemPub: toHex(parsedDevice.kemPub),
      cryptoProfile: parsedDevice.cryptoProfile,
      capabilities: parsedDevice.capabilities,
      deviceRecordCbor: deviceRecord.canonicalBase64,
      deviceRecordHash: deviceRecordHashHex,
      createdAt: parsedDevice.createdAtMs || now,
      revokedAt: null
    });

    await tx.insert(deviceAuthorizations).values({
      userId: input.userId,
      deviceId: parsedDevice.deviceId,
      arkVersion: parsedAuthorization.arkVersion,
      deviceRecordHash: deviceRecordHashHex,
      deviceSeq: parsedAuthorization.deviceSeq,
      action: parsedAuthorization.action,
      statementCbor: authorizationRecord.canonicalBase64,
      signature: toHex(parsedAuthorization.signature),
      createdAt: parsedAuthorization.createdAtMs || now
    });
  });

  return {
    arkVersion: parsedArk.arkVersion,
    deviceId: parsedDevice.deviceId,
    deviceSeq: parsedDevice.deviceSeq,
    arkHashHex,
    deviceRecordHashHex
  };
};

const getIdentityBootstrap = async (
  userId: number
): Promise<TIdentityBootstrapResult> => {
  const [latestRootKey, latestDevice] = await Promise.all([
    db
      .select({
        arkVersion: userRootKeys.arkVersion,
        arkHash: userRootKeys.arkHash
      })
      .from(userRootKeys)
      .where(eq(userRootKeys.userId, userId))
      .orderBy(desc(userRootKeys.arkVersion))
      .get(),
    db
      .select({ deviceSeq: e2eeDevices.deviceSeq })
      .from(e2eeDevices)
      .where(eq(e2eeDevices.userId, userId))
      .orderBy(desc(e2eeDevices.deviceSeq))
      .get()
  ]);

  return {
    latestArkVersion: latestRootKey?.arkVersion ?? null,
    latestArkHashHex: latestRootKey?.arkHash ?? null,
    latestDeviceSeq: latestDevice?.deviceSeq ?? null
  };
};

const revokeDevice = async (input: TRevokeDeviceInput): Promise<void> => {
  const authorizationRecord = canonicalizeCborBase64(
    input.revokeAuthorizationCborB64
  );
  const parsedAuthorization = decodeAuthorizationStatement(
    authorizationRecord.parsed
  );
  const unsignedAuthorizationMap = getUnsignedAuthorizationPayloadMap(
    authorizationRecord.parsed
  );
  const unsignedAuthorizationBytes = encodeCanonicalCbor(unsignedAuthorizationMap);

  if (parsedAuthorization.version !== 1) {
    badRequest('Unsupported authorization statement version');
  }

  if (parsedAuthorization.action !== 2) {
    badRequest('Device revocation requires action=2 authorization');
  }

  if (parsedAuthorization.userId !== input.userId) {
    forbidden('Authorization user_id must match authenticated user');
  }

  if (parsedAuthorization.arkVersion !== input.arkVersion) {
    badRequest('Authorization ark_version mismatch');
  }

  const rootKey = await db
    .select()
    .from(userRootKeys)
    .where(
      and(
        eq(userRootKeys.userId, input.userId),
        eq(userRootKeys.arkVersion, input.arkVersion)
      )
    )
    .get();

  if (!rootKey) {
    badRequest('ARK version not found for user');
  }
  const ensuredRootKey = rootKey!;

  const device = await db
    .select()
    .from(e2eeDevices)
    .where(
      and(
        eq(e2eeDevices.userId, input.userId),
        eq(e2eeDevices.deviceId, input.deviceId)
      )
    )
    .get();

  if (!device) {
    badRequest('Device not found');
  }
  const ensuredDevice = device!;

  const deviceRecordHashFromStatement = toHex(parsedAuthorization.deviceRecordHash);

  if (parsedAuthorization.deviceSeq !== ensuredDevice.deviceSeq) {
    badRequest('Authorization device_seq does not match existing device');
  }

  if (deviceRecordHashFromStatement !== ensuredDevice.deviceRecordHash) {
    badRequest('Authorization device_record_hash does not match existing device');
  }

  const signatureValid = verifyEd25519Signature(
    parsedAuthorization.signature,
    unsignedAuthorizationBytes,
    Uint8Array.from(Buffer.from(ensuredRootKey.arkPub, 'hex'))
  );

  if (!signatureValid) {
    forbidden('Invalid revocation signature');
  }

  const now = Date.now();

  await db.transaction(async (tx) => {
    await tx
      .update(e2eeDevices)
      .set({
        revokedAt: now
      })
      .where(
        and(
          eq(e2eeDevices.userId, input.userId),
          eq(e2eeDevices.deviceId, input.deviceId),
          isNull(e2eeDevices.revokedAt)
        )
      );

    await tx.insert(deviceAuthorizations).values({
      userId: input.userId,
      deviceId: input.deviceId,
      arkVersion: parsedAuthorization.arkVersion,
      deviceRecordHash: ensuredDevice.deviceRecordHash,
      deviceSeq: parsedAuthorization.deviceSeq,
      action: 2,
      statementCbor: authorizationRecord.canonicalBase64,
      signature: toHex(parsedAuthorization.signature),
      createdAt: parsedAuthorization.createdAtMs || now
    });
  });
};

const publishChannelEpoch = async (
  input: TPublishChannelEpochInput
): Promise<TPublishChannelEpochResult> => {
  const cscPayload = canonicalizeCborBase64(input.cscPayloadCborB64);
  const parsedPayload = decodeCscPayload(cscPayload.parsed);
  const signature = decodeBase64(input.cscSignatureB64);

  if (parsedPayload.version !== 1) {
    badRequest('Unsupported CSC payload version');
  }

  assertByteLength(signature, 64, 'csc signature');
  assertByteLength(parsedPayload.membershipDigest, 32, 'membership_digest');
  assertByteLength(parsedPayload.policyDigest, 32, 'policy_digest');

  if (parsedPayload.prevCscHash) {
    assertByteLength(parsedPayload.prevCscHash, 32, 'prev_csc_hash');
  }

  if (parsedPayload.channelId !== input.channelId) {
    badRequest('channelId does not match CSC payload channel_id');
  }

  const device = await db
    .select()
    .from(e2eeDevices)
    .where(
      and(
        eq(e2eeDevices.userId, input.userId),
        eq(e2eeDevices.deviceId, parsedPayload.signerDeviceId),
        isNull(e2eeDevices.revokedAt)
      )
    )
    .get();

  if (!device) {
    forbidden('Signer device is not active');
  }
  const ensuredDevice = device!;

  const latestDeviceAuth = await db
    .select()
    .from(deviceAuthorizations)
    .where(
      and(
        eq(deviceAuthorizations.userId, input.userId),
        eq(deviceAuthorizations.deviceId, parsedPayload.signerDeviceId)
      )
    )
    .orderBy(desc(deviceAuthorizations.createdAt))
    .get();

  if (!latestDeviceAuth || latestDeviceAuth.action !== 1) {
    forbidden('Signer device is not currently authorized');
  }

  const payloadHashBytes = Uint8Array.from(
    Buffer.from(getSha256HexFromBytes(cscPayload.canonicalBytes), 'hex')
  );
  const signatureValid = verifyEd25519Signature(
    signature,
    payloadHashBytes,
    Uint8Array.from(Buffer.from(ensuredDevice.signPub, 'hex'))
  );

  if (!signatureValid) {
    forbidden('Invalid CSC signature');
  }

  const cscHashHex = getSha256HexFromBytes(cscPayload.canonicalBytes);
  const latest = await db
    .select()
    .from(channelStateCommitments)
    .where(eq(channelStateCommitments.channelId, input.channelId))
    .orderBy(desc(channelStateCommitments.epoch))
    .get();

  if (!latest) {
    if (parsedPayload.epoch !== 1) {
      conflict('First CSC epoch must be 1');
    }

    if (parsedPayload.prevCscHash !== null) {
      conflict('First CSC payload must not set prev_csc_hash');
    }
  } else {
    if (parsedPayload.epoch !== latest.epoch + 1) {
      conflict('CSC epoch must increment by exactly 1');
    }

    const prevCscHash = parsedPayload.prevCscHash;

    if (!prevCscHash) {
      conflict('CSC payload must include prev_csc_hash');
    }

    if (toHex(prevCscHash!) !== latest.cscHash) {
      conflict('CSC prev hash mismatch');
    }
  }

  await db.insert(channelStateCommitments).values({
    channelId: input.channelId,
    epoch: parsedPayload.epoch,
    cscHash: cscHashHex,
    prevCscHash: parsedPayload.prevCscHash ? toHex(parsedPayload.prevCscHash) : null,
    membershipDigest: toHex(parsedPayload.membershipDigest),
    policyDigest: toHex(parsedPayload.policyDigest),
    signerUserId: input.userId,
    signerDeviceId: parsedPayload.signerDeviceId,
    payloadCbor: cscPayload.canonicalBase64,
    signature: toHex(signature),
    createdAt: parsedPayload.createdAtMs || Date.now()
  });

  if (input.deviceEnvelopes && input.deviceEnvelopes.length > 0) {
    const viewerUserIds = await getChannelViewerUserIds(input.channelId);
    const allowedDevices = viewerUserIds.length
      ? await db
          .select({ deviceId: e2eeDevices.deviceId })
          .from(e2eeDevices)
          .where(
            and(
              inArray(e2eeDevices.userId, viewerUserIds),
              isNull(e2eeDevices.revokedAt)
            )
          )
      : [];
    const allowedDeviceIds = new Set(allowedDevices.map((row) => row.deviceId));
    const filteredEnvelopes = input.deviceEnvelopes.filter((envelope) =>
      allowedDeviceIds.has(envelope.recipientDeviceId)
    );

    if (filteredEnvelopes.length === 0) {
      return {
        channelId: input.channelId,
        epoch: parsedPayload.epoch,
        cscHashHex
      };
    }

    await db.insert(channelEpochDeviceEnvelopes).values(
      filteredEnvelopes.map((envelope) => ({
        channelId: input.channelId,
        epoch: parsedPayload.epoch,
        recipientDeviceId: envelope.recipientDeviceId,
        envelope: envelope.envelope,
        createdAt: parsedPayload.createdAtMs || Date.now()
      }))
    );
  }

  return {
    channelId: input.channelId,
    epoch: parsedPayload.epoch,
    cscHashHex
  };
};

const uploadPrekeys = async (input: TUploadPrekeysInput): Promise<{ success: true }> => {
  const device = await db
    .select()
    .from(e2eeDevices)
    .where(
      and(
        eq(e2eeDevices.userId, input.userId),
        eq(e2eeDevices.deviceId, input.deviceId),
        isNull(e2eeDevices.revokedAt)
      )
    )
    .get();

  if (!device) {
    forbidden('Device not found or revoked');
  }

  const ensuredDevice = device!;
  const signedPub = decodeBase64(input.signedPrekey.prekeyPubB64);
  const signedSig = decodeBase64(input.signedPrekey.signatureB64);

  assertByteLength(signedPub, 32, 'signed prekey pub');
  assertByteLength(signedSig, 64, 'signed prekey signature');

  const signatureValid = verifyEd25519Signature(
    signedSig,
    signedPub,
    Uint8Array.from(Buffer.from(ensuredDevice.signPub, 'hex'))
  );

  if (!signatureValid) {
    forbidden('Invalid signed prekey signature');
  }

  const oneTimeRows = input.oneTimePrekeys.map((prekey) => {
    const prekeyPub = decodeBase64(prekey.prekeyPubB64);
    assertByteLength(prekeyPub, 32, 'one-time prekey pub');

    return {
      userId: input.userId,
      deviceId: input.deviceId,
      prekeyId: prekey.prekeyId,
      prekeyPub: Buffer.from(prekeyPub).toString('base64'),
      signature: null,
      oneTime: true,
      createdAt: prekey.createdAtMs,
      usedAt: null
    };
  });

  await db.transaction(async (tx) => {
    await tx
      .insert(devicePrekeys)
      .values({
        userId: input.userId,
        deviceId: input.deviceId,
        prekeyId: input.signedPrekey.prekeyId,
        prekeyPub: Buffer.from(signedPub).toString('base64'),
        signature: Buffer.from(signedSig).toString('base64'),
        oneTime: false,
        createdAt: input.signedPrekey.createdAtMs,
        usedAt: null
      })
      .onConflictDoUpdate({
        target: [devicePrekeys.deviceId, devicePrekeys.prekeyId],
        set: {
          prekeyPub: Buffer.from(signedPub).toString('base64'),
          signature: Buffer.from(signedSig).toString('base64'),
          oneTime: false,
          createdAt: input.signedPrekey.createdAtMs,
          usedAt: null
        }
      });

    if (oneTimeRows.length > 0) {
      await tx.insert(devicePrekeys).values(oneTimeRows).onConflictDoNothing();
    }
  });

  return { success: true };
};

const claimPrekey = async (
  input: TClaimPrekeyInput
): Promise<TClaimPrekeyResult> => {
  if (input.requesterUserId === input.targetUserId) {
    badRequest('Cannot claim prekeys for own user');
  }

  const targetDevice = await db
    .select()
    .from(e2eeDevices)
    .where(
      and(
        eq(e2eeDevices.userId, input.targetUserId),
        eq(e2eeDevices.deviceId, input.targetDeviceId),
        isNull(e2eeDevices.revokedAt)
      )
    )
    .get();

  if (!targetDevice) {
    badRequest('Target device not found');
  }

  const signedPrekey = await db
    .select()
    .from(devicePrekeys)
    .where(
      and(
        eq(devicePrekeys.userId, input.targetUserId),
        eq(devicePrekeys.deviceId, input.targetDeviceId),
        eq(devicePrekeys.oneTime, false)
      )
    )
    .orderBy(desc(devicePrekeys.createdAt))
    .get();

  if (!signedPrekey) {
    badRequest('No signed prekey available for target device');
  }
  const ensuredSignedPrekey = signedPrekey!;

  const oneTimePrekey = await db.transaction(async (tx) => {
    const candidate = await tx
      .select()
      .from(devicePrekeys)
      .where(
        and(
          eq(devicePrekeys.userId, input.targetUserId),
          eq(devicePrekeys.deviceId, input.targetDeviceId),
          eq(devicePrekeys.oneTime, true),
          isNull(devicePrekeys.usedAt)
        )
      )
      .orderBy(devicePrekeys.createdAt)
      .get();

    if (!candidate) {
      return null;
    }

    const claimed = await tx
      .update(devicePrekeys)
      .set({
        usedAt: Date.now()
      })
      .where(
        and(
          eq(devicePrekeys.id, candidate.id),
          eq(devicePrekeys.userId, input.targetUserId),
          isNull(devicePrekeys.usedAt)
        )
      )
      .returning({ id: devicePrekeys.id })
      .get();

    if (!claimed) {
      return null;
    }

    return candidate;
  });

  return {
    deviceId: input.targetDeviceId,
    signedPrekey: {
      prekeyId: ensuredSignedPrekey.prekeyId,
      prekeyPubB64: ensuredSignedPrekey.prekeyPub,
      signatureB64: ensuredSignedPrekey.signature || ''
    },
    oneTimePrekey: oneTimePrekey
      ? {
          prekeyId: oneTimePrekey.prekeyId,
          prekeyPubB64: oneTimePrekey.prekeyPub
        }
      : null
  };
};

const requestKeyCatchup = async (
  input: TRequestKeyCatchupInput
): Promise<TRequestKeyCatchupResult> => {
  const maxWindow = 256;

  if (input.toEpochInclusive < input.fromEpochInclusive) {
    badRequest('Invalid epoch range');
  }

  if (input.toEpochInclusive - input.fromEpochInclusive > maxWindow) {
    badRequest(`Epoch range exceeds max window (${maxWindow})`);
  }

  const requesterDevices = await db
    .select()
    .from(e2eeDevices)
    .where(and(eq(e2eeDevices.userId, input.userId), isNull(e2eeDevices.revokedAt)))
    .all();

  const requesterDeviceIds = requesterDevices.map((device) => device.deviceId);

  const chain = await db
    .select()
    .from(channelStateCommitments)
    .where(
      and(
        eq(channelStateCommitments.channelId, input.channelId)
      )
    )
    .all();

  const inRange = chain
    .filter(
      (row) =>
        row.epoch >= input.fromEpochInclusive && row.epoch <= input.toEpochInclusive
    )
    .filter((row) => {
      if (!input.missingSenders || input.missingSenders.length === 0) {
        return true;
      }

      return input.missingSenders.some(
        (sender) => sender.senderDeviceId === row.signerDeviceId
      );
    })
    .sort((a, b) => a.epoch - b.epoch);

  const envelopes = requesterDeviceIds.length
    ? await db
        .select()
        .from(channelEpochDeviceEnvelopes)
        .where(eq(channelEpochDeviceEnvelopes.channelId, input.channelId))
        .all()
    : [];

  const filteredEnvelopes = envelopes
    .filter(
      (row) =>
        row.epoch >= input.fromEpochInclusive &&
        row.epoch <= input.toEpochInclusive &&
        requesterDeviceIds.includes(row.recipientDeviceId)
    )
    .sort((a, b) => a.epoch - b.epoch);

  return {
    cscChain: inRange.map((row) => ({
      epoch: row.epoch,
      cscSigned: row.payloadCbor,
      cscHashHex: row.cscHash,
      signerUserId: row.signerUserId,
      signerDeviceId: row.signerDeviceId
    })),
    deviceKeyEnvelopes: filteredEnvelopes.map((row) => ({
      epoch: row.epoch,
      recipientDeviceId: row.recipientDeviceId,
      envelope: row.envelope
    })),
    historyBoundaries: [
      {
        type: 'channel_created_boundary',
        effectiveFromTs: 0,
        reason: `catchup:${input.reason}`
      }
    ]
  };
};

const reserveNonceBlock = async (
  input: TReserveNonceBlockInput
): Promise<TReserveNonceBlockResult> => {
  const reservation = await reserveNonceCounterBlock(input.senderKeyId);

  return {
    senderKeyId: reservation.senderKeyId,
    noncePrefix: reservation.noncePrefix,
    startCounter: reservation.startCounter,
    endCounter: reservation.endCounter
  };
};

const submitEnvelope = async (
  input: TSubmitEnvelopeInput
): Promise<TSubmitEnvelopeResult> => {
  const header = canonicalizeCborBase64(input.headerCborB64);
  const headerPayload = decodeMessageHeaderPayload(header.parsed);
  const nonce = decodeBase64(input.nonceB64);
  const ciphertext = decodeBase64(input.ciphertextB64);
  const tag = decodeBase64(input.tagB64);
  const signature = input.sigB64 ? decodeBase64(input.sigB64) : null;

  if (headerPayload.version !== 1) {
    badRequest('Unsupported message header version');
  }

  if (headerPayload.channelId !== input.channelId) {
    badRequest('channelId does not match header channel_id');
  }

  if (headerPayload.senderUserId !== input.userId) {
    forbidden('sender_user_id must match authenticated user');
  }

  if (!isUuid(headerPayload.senderDeviceId)) {
    badRequest('sender_device_id must be a UUID string');
  }

  if (!isUuid(headerPayload.clientMessageId)) {
    badRequest('client_message_id must be a UUID string');
  }

  if (headerPayload.senderKeyId > 0xffffffff) {
    badRequest('sender_key_id must fit uint32');
  }

  assertByteLength(headerPayload.cscHash, 32, 'csc_hash');
  assertByteLength(nonce, 12, 'nonce');
  assertByteLength(tag, 16, 'tag');

  if (ciphertext.length === 0) {
    badRequest('ciphertext must not be empty');
  }

  if (signature) {
    assertByteLength(signature, 64, 'sig');
  }

  const senderDevice = await db
    .select()
    .from(e2eeDevices)
    .where(
      and(
        eq(e2eeDevices.userId, input.userId),
        eq(e2eeDevices.deviceId, headerPayload.senderDeviceId),
        isNull(e2eeDevices.revokedAt)
      )
    )
    .get();

  if (!senderDevice) {
    forbidden('Sender device is not active');
  }

  const latestDeviceAuth = await db
    .select()
    .from(deviceAuthorizations)
    .where(
      and(
        eq(deviceAuthorizations.userId, input.userId),
        eq(deviceAuthorizations.deviceId, headerPayload.senderDeviceId)
      )
    )
    .orderBy(desc(deviceAuthorizations.createdAt))
    .get();

  if (!latestDeviceAuth || latestDeviceAuth.action !== 1) {
    forbidden('Sender device is not currently authorized');
  }

  const csc = await db
    .select()
    .from(channelStateCommitments)
    .where(
      and(
        eq(channelStateCommitments.channelId, input.channelId),
        eq(channelStateCommitments.epoch, headerPayload.epoch)
      )
    )
    .get();

  if (!csc) {
    badRequest('CSC epoch not found for channel');
  }

  if (csc!.cscHash !== toHex(headerPayload.cscHash)) {
    conflict('Message csc_hash does not match channel CSC');
  }

  const existingMessage = await db
    .select({ id: e2eeMessageEnvelopes.id })
    .from(e2eeMessageEnvelopes)
    .where(eq(e2eeMessageEnvelopes.clientMessageId, headerPayload.clientMessageId))
    .get();

  if (existingMessage) {
    conflict('client_message_id already exists');
  }

  const replay = await validateAndStoreReplayCounter({
    channelId: input.channelId,
    senderDeviceId: headerPayload.senderDeviceId,
    senderKeyId: String(headerPayload.senderKeyId),
    counter: headerPayload.counter
  });

  if (!replay.accepted) {
    if (replay.reason === 'counter_gap_exceeded') {
      badRequest('counter gap exceeded');
    }

    if (replay.reason === 'too_old') {
      conflict('counter outside replay window');
    }

    conflict('duplicate counter');
  }

  const createdAt = headerPayload.createdAtMs;
  const inserted = await db
    .insert(e2eeMessageEnvelopes)
    .values({
      channelId: input.channelId,
      epoch: headerPayload.epoch,
      senderUserId: input.userId,
      senderDeviceId: headerPayload.senderDeviceId,
      senderKeyId: String(headerPayload.senderKeyId),
      counter: headerPayload.counter,
      clientMessageId: headerPayload.clientMessageId,
      contentType: headerPayload.contentType,
      flags: headerPayload.flags,
      cscHash: toHex(headerPayload.cscHash),
      headerCbor: header.canonicalBase64,
      nonceB64: Buffer.from(nonce).toString('base64'),
      ciphertextB64: Buffer.from(ciphertext).toString('base64'),
      tagB64: Buffer.from(tag).toString('base64'),
      sigB64: signature ? Buffer.from(signature).toString('base64') : null,
      createdAt
    })
    .returning({ id: e2eeMessageEnvelopes.id })
    .get();

  return {
    envelopeId: inserted.id,
    acceptedCounter: headerPayload.counter,
    createdAt
  };
};

const getEnvelopes = async (
  input: TGetEnvelopesInput
): Promise<TGetEnvelopesResult> => {
  const whereClause = and(
    eq(e2eeMessageEnvelopes.channelId, input.channelId),
    input.cursorId ? lt(e2eeMessageEnvelopes.id, input.cursorId) : undefined,
    typeof input.fromEpochInclusive === 'number'
      ? gte(e2eeMessageEnvelopes.epoch, input.fromEpochInclusive)
      : undefined,
    typeof input.toEpochInclusive === 'number'
      ? lte(e2eeMessageEnvelopes.epoch, input.toEpochInclusive)
      : undefined
  );

  const rows = await db
    .select()
    .from(e2eeMessageEnvelopes)
    .where(whereClause)
    .orderBy(desc(e2eeMessageEnvelopes.id))
    .limit(input.limit + 1)
    .all();

  const hasMore = rows.length > input.limit;
  const page = hasMore ? rows.slice(0, input.limit) : rows;
  const ordered = page.reverse();

  return {
    envelopes: ordered.map((row) => ({
      id: row.id,
      channelId: row.channelId,
      epoch: row.epoch,
      senderUserId: row.senderUserId,
      senderDeviceId: row.senderDeviceId,
      senderKeyId: row.senderKeyId,
      counter: row.counter,
      clientMessageId: row.clientMessageId,
      contentType: row.contentType,
      flags: row.flags,
      cscHashHex: row.cscHash,
      headerCborB64: row.headerCbor,
      nonceB64: row.nonceB64,
      ciphertextB64: row.ciphertextB64,
      tagB64: row.tagB64,
      sigB64: row.sigB64,
      createdAt: row.createdAt
    })),
    nextCursorId: hasMore ? page[page.length - 1]!.id : null
  };
};

const sendEncryptedMessage = async (
  input: TSendEncryptedMessageInput
): Promise<TSendEncryptedMessageResult> => {
  const header = canonicalizeCborBase64(input.headerCborB64);
  const headerPayload = decodeMessageHeaderPayload(header.parsed);
  const expectedAttachmentSha256Hexes = headerPayload.attachmentCiphertextSha256.map(
    (hashBytes, index) => {
      assertByteLength(
        hashBytes,
        32,
        `attachment_ciphertext_sha256[${index}]`
      );

      return toHex(hashBytes);
    }
  );
  await verifyEncryptedAttachmentBinding({
    tempFileIds: input.files ?? [],
    expectedCiphertextSha256Hexes: expectedAttachmentSha256Hexes,
    userId: input.userId
  });
  const submitted = await submitEnvelope(input);
  let threadRootMessageId: number | null = null;

  if (typeof input.parentMessageId === 'number') {
    const parentMessage = await db
      .select({
        id: messages.id,
        channelId: messages.channelId,
        parentMessageId: messages.parentMessageId
      })
      .from(messages)
      .where(eq(messages.id, input.parentMessageId))
      .get();

    if (!parentMessage || parentMessage.channelId !== input.channelId) {
      badRequest('Invalid parent message for thread');
    }
    const ensuredParentMessage = parentMessage!;

    const normalizedRootId =
      ensuredParentMessage.parentMessageId ?? ensuredParentMessage.id;
    const rootMessage = await db
      .select({ id: messages.id, channelId: messages.channelId })
      .from(messages)
      .where(
        and(eq(messages.id, normalizedRootId), isNull(messages.parentMessageId))
      )
      .get();

    if (!rootMessage || rootMessage.channelId !== input.channelId) {
      badRequest('Invalid thread root');
    }

    threadRootMessageId = rootMessage!.id;
  }

  const createdAt = headerPayload.createdAtMs;
  const placeholderContent = `[[e2ee:v1:${headerPayload.clientMessageId}]]`;
  const inserted = await db
    .insert(messages)
    .values({
      channelId: input.channelId,
      userId: input.userId,
      parentMessageId: threadRootMessageId,
      content: placeholderContent,
      editable: false,
      createdAt
    })
    .returning({ id: messages.id, createdAt: messages.createdAt })
    .get();

  if (input.files && input.files.length > 0) {
    for (const tempFileId of input.files) {
      const newFile = await fileManager.saveFile(tempFileId, input.userId);

      await db.insert(messageFiles).values({
        messageId: inserted.id,
        fileId: newFile.id,
        createdAt: Date.now()
      });
    }
  }

  publishMessage(inserted.id, input.channelId, 'create');
  if (threadRootMessageId) {
    publishMessage(threadRootMessageId, input.channelId, 'update');
  }

  return {
    messageId: inserted.id,
    envelopeId: submitted.envelopeId,
    clientMessageId: headerPayload.clientMessageId,
    createdAt: inserted.createdAt
  };
};

const getLatestChannelState = async (
  channelId: number
): Promise<TLatestChannelStateResult> => {
  const latest = await db
    .select()
    .from(channelStateCommitments)
    .where(eq(channelStateCommitments.channelId, channelId))
    .orderBy(desc(channelStateCommitments.epoch))
    .get();

  if (!latest) {
    return {
      latestEpoch: null,
      latestCscHashHex: null,
      latestCscPayloadCborB64: null,
      latestCscSignatureB64: null
    };
  }

  return {
    latestEpoch: latest.epoch,
    latestCscHashHex: latest.cscHash,
    latestCscPayloadCborB64: latest.payloadCbor,
    latestCscSignatureB64: Buffer.from(latest.signature, 'hex').toString('base64')
  };
};

const getUserAuthorizedDevices = async (
  userId: number
): Promise<TAuthorizedDevice[]> => {
  const devices = await db
    .select()
    .from(e2eeDevices)
    .where(and(eq(e2eeDevices.userId, userId), isNull(e2eeDevices.revokedAt)))
    .orderBy(e2eeDevices.deviceSeq);

  const result: TAuthorizedDevice[] = [];

  for (const device of devices) {
    const latestAdd = await db
      .select()
      .from(deviceAuthorizations)
      .where(
        and(
          eq(deviceAuthorizations.userId, userId),
          eq(deviceAuthorizations.deviceId, device.deviceId),
          eq(deviceAuthorizations.action, 1)
        )
      )
      .orderBy(desc(deviceAuthorizations.createdAt))
      .get();

    if (!latestAdd) {
      continue;
    }

    result.push({
      deviceId: device.deviceId,
      deviceSeq: device.deviceSeq,
      signPubHex: device.signPub,
      kemPubHex: device.kemPub,
      arkVersion: latestAdd.arkVersion,
      authorizedAt: latestAdd.createdAt
    });
  }

  return result;
};

export {
  sendEncryptedMessage,
  getEnvelopes,
  getIdentityBootstrap,
  getLatestChannelState,
  getUserAuthorizedDevices,
  claimPrekey,
  publishChannelEpoch,
  reserveNonceBlock,
  registerDevice,
  requestKeyCatchup,
  submitEnvelope,
  revokeDevice,
  uploadPrekeys
};
