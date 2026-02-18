import { and, eq } from 'drizzle-orm';
import { db } from '../db';
import { replayWindows, senderNonceAllocators } from '../db/schema';

const COUNTER_BLOCK_SIZE = 1024;
const REPLAY_WINDOW = 4096;
const MAX_COUNTER_GAP = 10000;

type TNonceReservation = {
  senderKeyId: string;
  noncePrefix: number;
  startCounter: number;
  endCounter: number;
};

type TReplayAcceptResult =
  | { accepted: true; reason: 'ok' }
  | { accepted: false; reason: 'counter_gap_exceeded' | 'too_old' | 'duplicate' };

const createEmptyBitmap = (): Uint8Array => new Uint8Array(REPLAY_WINDOW / 8);

const isBitSet = (bitmap: Uint8Array, offset: number): boolean => {
  const byteIndex = Math.floor(offset / 8);
  const bitIndex = offset % 8;

  return ((bitmap[byteIndex] ?? 0) & (1 << bitIndex)) !== 0;
};

const setBit = (bitmap: Uint8Array, offset: number): void => {
  const byteIndex = Math.floor(offset / 8);
  const bitIndex = offset % 8;
  bitmap[byteIndex] = (bitmap[byteIndex] ?? 0) | (1 << bitIndex);
};

const shiftRight = (bitmap: Uint8Array, delta: number): Uint8Array => {
  if (delta >= REPLAY_WINDOW) {
    return createEmptyBitmap();
  }

  const shifted = createEmptyBitmap();

  for (let oldOffset = 0; oldOffset < REPLAY_WINDOW - delta; oldOffset += 1) {
    if (isBitSet(bitmap, oldOffset)) {
      setBit(shifted, oldOffset + delta);
    }
  }

  return shifted;
};

const reserveNonceCounterBlock = async (
  senderKeyId: string
): Promise<TNonceReservation> => {
  return db.transaction(async (tx) => {
    const existing = await tx
      .select()
      .from(senderNonceAllocators)
      .where(eq(senderNonceAllocators.senderKeyId, senderKeyId))
      .get();

    const now = Date.now();

    if (!existing) {
      const noncePrefix = Math.floor(Math.random() * 0xffffffff);
      const startCounter = 0;
      const endCounter = COUNTER_BLOCK_SIZE - 1;

      await tx.insert(senderNonceAllocators).values({
        senderKeyId,
        noncePrefix,
        nextCounter: endCounter + 1,
        updatedAt: now
      });

      return {
        senderKeyId,
        noncePrefix,
        startCounter,
        endCounter
      };
    }

    const startCounter = existing.nextCounter;
    const endCounter = startCounter + COUNTER_BLOCK_SIZE - 1;

    await tx
      .update(senderNonceAllocators)
      .set({
        nextCounter: endCounter + 1,
        updatedAt: now
      })
      .where(eq(senderNonceAllocators.id, existing.id));

    return {
      senderKeyId,
      noncePrefix: existing.noncePrefix,
      startCounter,
      endCounter
    };
  });
};

const validateAndStoreReplayCounter = async ({
  channelId,
  senderDeviceId,
  senderKeyId,
  counter
}: {
  channelId: number;
  senderDeviceId: string;
  senderKeyId: string;
  counter: number;
}): Promise<TReplayAcceptResult> => {
  return db.transaction(async (tx) => {
    const now = Date.now();
    const existing = await tx
      .select()
      .from(replayWindows)
      .where(
        and(
          eq(replayWindows.channelId, channelId),
          eq(replayWindows.senderDeviceId, senderDeviceId),
          eq(replayWindows.senderKeyId, senderKeyId)
        )
      )
      .get();

    if (!existing) {
      const bitmap = createEmptyBitmap();
      setBit(bitmap, 0);

      await tx.insert(replayWindows).values({
        channelId,
        senderDeviceId,
        senderKeyId,
        maxCounter: counter,
        bitmapBase64: Buffer.from(bitmap).toString('base64'),
        updatedAt: now
      });

      return { accepted: true, reason: 'ok' };
    }

    if (counter > existing.maxCounter + MAX_COUNTER_GAP) {
      return { accepted: false, reason: 'counter_gap_exceeded' };
    }

    let bitmap: Uint8Array = Uint8Array.from(
      Buffer.from(existing.bitmapBase64, 'base64')
    );
    let maxCounter = existing.maxCounter;

    if (counter > maxCounter) {
      const delta = counter - maxCounter;
      bitmap = shiftRight(bitmap, delta) as Uint8Array;
      maxCounter = counter;
      setBit(bitmap, 0);

      await tx
        .update(replayWindows)
        .set({
          maxCounter,
          bitmapBase64: Buffer.from(bitmap).toString('base64'),
          updatedAt: now
        })
        .where(eq(replayWindows.id, existing.id));

      return { accepted: true, reason: 'ok' };
    }

    const offset = maxCounter - counter;

    if (offset >= REPLAY_WINDOW) {
      return { accepted: false, reason: 'too_old' };
    }

    if (isBitSet(bitmap, offset)) {
      return { accepted: false, reason: 'duplicate' };
    }

    setBit(bitmap, offset);

    await tx
      .update(replayWindows)
      .set({
        maxCounter,
        bitmapBase64: Buffer.from(bitmap).toString('base64'),
        updatedAt: now
      })
      .where(eq(replayWindows.id, existing.id));

    return { accepted: true, reason: 'ok' };
  });
};

export {
  COUNTER_BLOCK_SIZE,
  MAX_COUNTER_GAP,
  REPLAY_WINDOW,
  reserveNonceCounterBlock,
  validateAndStoreReplayCounter
};
export type { TNonceReservation, TReplayAcceptResult };
