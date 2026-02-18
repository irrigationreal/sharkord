import { and, eq } from 'drizzle-orm';
import { db } from '..';
import { authIdentities } from '../schema';

type TAuthIdentity = typeof authIdentities.$inferSelect;

type TAuthIdentityInput = {
  userId: number;
  provider: string;
  providerSubject: string;
};

const getAuthIdentity = async (
  provider: string,
  providerSubject: string
): Promise<TAuthIdentity | undefined> => {
  return db
    .select()
    .from(authIdentities)
    .where(
      and(
        eq(authIdentities.provider, provider),
        eq(authIdentities.providerSubject, providerSubject)
      )
    )
    .get();
};

const createAuthIdentity = async ({
  userId,
  provider,
  providerSubject
}: TAuthIdentityInput): Promise<TAuthIdentity> => {
  const now = Date.now();

  return db
    .insert(authIdentities)
    .values({
      userId,
      provider,
      providerSubject,
      createdAt: now,
      updatedAt: now,
      lastLoginAt: now
    })
    .returning()
    .get();
};

const touchAuthIdentityLastLogin = async (
  provider: string,
  providerSubject: string
): Promise<void> => {
  const now = Date.now();

  await db
    .update(authIdentities)
    .set({
      lastLoginAt: now,
      updatedAt: now
    })
    .where(
      and(
        eq(authIdentities.provider, provider),
        eq(authIdentities.providerSubject, providerSubject)
      )
    )
    .run();
};

export { createAuthIdentity, getAuthIdentity, touchAuthIdentityLastLogin };
