import { and, eq, gt, isNull } from 'drizzle-orm';
import { createHash } from 'node:crypto';
import { db } from '..';
import { oauthStates } from '../schema';

type TOAuthStateInput = {
  provider: string;
  state: string;
  deviceId?: string;
  inviteCode?: string;
  redirectPath?: string;
  expiresInMs?: number;
};

const OAUTH_STATE_TTL_MS = 5 * 60 * 1000;

type TOAuthState = typeof oauthStates.$inferSelect;

const hashState = (state: string): string =>
  createHash('sha256').update(state).digest('hex');

const createOAuthState = async ({
  provider,
  state,
  deviceId,
  inviteCode,
  redirectPath,
  expiresInMs = OAUTH_STATE_TTL_MS
}: TOAuthStateInput): Promise<string> => {
  const now = Date.now();
  const stateHash = hashState(state);

  await db
    .insert(oauthStates)
    .values({
      stateHash,
      provider,
      deviceId,
      inviteCode,
      redirectPath,
      createdAt: now,
      expiresAt: now + expiresInMs
    })
    .run();

  return stateHash;
};

const consumeOAuthState = async (
  provider: string,
  state: string
): Promise<TOAuthState | undefined> => {
  const now = Date.now();
  const stateHash = hashState(state);

  return db
    .update(oauthStates)
    .set({
      consumedAt: now
    })
    .where(
      and(
        eq(oauthStates.provider, provider),
        eq(oauthStates.stateHash, stateHash),
        isNull(oauthStates.consumedAt),
        gt(oauthStates.expiresAt, now)
      )
    )
    .returning()
    .get();
};

export { OAUTH_STATE_TTL_MS, createOAuthState, consumeOAuthState };
