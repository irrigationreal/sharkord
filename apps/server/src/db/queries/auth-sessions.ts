import { createHash, randomBytes } from 'node:crypto';
import { and, eq, gt, isNull } from 'drizzle-orm';
import type { TConnectionInfo } from '../../types';
import { db } from '..';
import {
  authSessionRefreshTokens,
  authSessions,
  userDevices,
  users
} from '../schema';

const ACCESS_TOKEN_TTL_MS = 15 * 60 * 1000;
const REFRESH_TOKEN_TTL_MS = 14 * 24 * 60 * 60 * 1000;
const ROTATED_TOKEN_REUSE_GRACE_MS = 5_000;

type TSessionContext = {
  userId: number;
  sessionId: number;
  userDeviceId: number | null;
  authProvider: string | null;
};

type TSessionTokens = {
  accessToken: string;
  refreshToken: string;
  accessExpiresAt: number;
  refreshExpiresAt: number;
};

const hashToken = (token: string): string => {
  return createHash('sha256').update(token).digest('hex');
};

const generateToken = (): string => {
  return randomBytes(32).toString('base64url');
};

const createFingerprint = (info?: TConnectionInfo): string => {
  const payload = [
    info?.ip || '',
    info?.userAgent || '',
    info?.os || '',
    info?.device || ''
  ].join('|');

  return hashToken(payload);
};

const getOrCreateUserDevice = async (
  userId: number,
  info?: TConnectionInfo,
  fingerprint?: string
) => {
  const computedFingerprint = fingerprint || createFingerprint(info);

  return db
    .insert(userDevices)
    .values({
      userId,
      fingerprint: computedFingerprint,
      userAgent: info?.userAgent,
      os: info?.os,
      device: info?.device,
      ip: info?.ip,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      lastSeenAt: Date.now(),
      revokedAt: null
    })
    .onConflictDoUpdate({
      target: [userDevices.userId, userDevices.fingerprint],
      set: {
        userAgent: info?.userAgent,
        os: info?.os,
        device: info?.device,
        ip: info?.ip,
        updatedAt: Date.now(),
        lastSeenAt: Date.now(),
        revokedAt: null
      }
    })
    .returning()
    .get();
};

const createSessionTokens = (): TSessionTokens => {
  const now = Date.now();

  return {
    accessToken: generateToken(),
    refreshToken: generateToken(),
    accessExpiresAt: now + ACCESS_TOKEN_TTL_MS,
    refreshExpiresAt: now + REFRESH_TOKEN_TTL_MS
  };
};

const getUserDeviceFingerprint = async (
  userDeviceId: number
): Promise<string | undefined> => {
  const userDevice = await db
    .select({
      fingerprint: userDevices.fingerprint
    })
    .from(userDevices)
    .where(eq(userDevices.id, userDeviceId))
    .get();

  return userDevice?.fingerprint;
};

const getActiveAccessSession = async (
  accessToken: string
): Promise<TSessionContext | undefined> => {
  const tokenHash = hashToken(accessToken);
  const now = Date.now();

  const session = await db
    .select({
      id: authSessions.id,
      userId: authSessions.userId,
      userDeviceId: authSessions.userDeviceId,
      authProvider: authSessions.authProvider,
      banned: users.banned
    })
    .from(authSessions)
    .innerJoin(users, eq(users.id, authSessions.userId))
    .where(
      and(
        eq(authSessions.accessTokenHash, tokenHash),
        isNull(authSessions.revokedAt),
        gt(authSessions.accessExpiresAt, now)
      )
    )
    .get();

  if (!session) {
    return undefined;
  }

  if (session.banned) {
    return undefined;
  }

  await db
    .update(authSessions)
    .set({
      lastSeenAt: now,
      updatedAt: now
    })
    .where(eq(authSessions.id, session.id))
    .run();

  if (session.userDeviceId) {
    await db
      .update(userDevices)
      .set({
        lastSeenAt: now,
        updatedAt: now
      })
      .where(eq(userDevices.id, session.userDeviceId))
      .run();
  }

  return {
    userId: session.userId,
    sessionId: session.id,
    userDeviceId: session.userDeviceId,
    authProvider: session.authProvider
  };
};

const getActiveOrHistoricalRefreshSession = async (
  refreshToken: string
): Promise<
  { sessionId: number; source: 'active' | 'historical'; reason?: string; usedAt?: number } | undefined
> => {
  const tokenHash = hashToken(refreshToken);
  const now = Date.now();

  const activeSession = await db
    .select({ id: authSessions.id })
    .from(authSessions)
    .where(
      and(
        eq(authSessions.refreshTokenHash, tokenHash),
        isNull(authSessions.revokedAt),
        gt(authSessions.refreshExpiresAt, now)
      )
    )
    .get();

  if (activeSession) {
    return { sessionId: activeSession.id, source: 'active' };
  }

  const historicalSession = await db
    .select({
      authSessionId: authSessionRefreshTokens.authSessionId,
      reason: authSessionRefreshTokens.reason,
      usedAt: authSessionRefreshTokens.usedAt
    })
    .from(authSessionRefreshTokens)
    .innerJoin(
      authSessions,
      eq(authSessions.id, authSessionRefreshTokens.authSessionId)
    )
    .where(
      and(
        eq(authSessionRefreshTokens.tokenHash, tokenHash),
        isNull(authSessions.revokedAt),
        gt(authSessions.refreshExpiresAt, now)
      )
    )
    .get();

  if (historicalSession) {
    return {
      sessionId: historicalSession.authSessionId,
      source: 'historical',
      reason: historicalSession.reason,
      usedAt: historicalSession.usedAt
    };
  }

  return undefined;
};

const createAuthSession = async (
  userId: number,
  connectionInfo?: TConnectionInfo,
  authProvider = 'local',
  deviceFingerprint?: string
): Promise<
  TSessionTokens & { sessionId: number; userDeviceId: number | null }
> => {
  const now = Date.now();
  const userDevice = await getOrCreateUserDevice(
    userId,
    connectionInfo,
    deviceFingerprint
  );
  const sessionTokens = createSessionTokens();

  const session = await db
    .insert(authSessions)
    .values({
      userId,
      userDeviceId: userDevice.id,
      authProvider,
      accessTokenHash: hashToken(sessionTokens.accessToken),
      refreshTokenHash: hashToken(sessionTokens.refreshToken),
      accessExpiresAt: sessionTokens.accessExpiresAt,
      refreshExpiresAt: sessionTokens.refreshExpiresAt,
      lastSeenAt: now,
      createdAt: now,
      updatedAt: now,
      revokedAt: null,
      revokedReason: null
    })
    .returning()
    .get();

  await db
    .insert(authSessionRefreshTokens)
    .values({
      authSessionId: session.id,
      tokenHash: hashToken(sessionTokens.refreshToken),
      reason: 'issued',
      createdAt: now,
      usedAt: now
    })
    .run();

  if (!session) {
    throw new Error('Failed to create auth session');
  }

  return {
    ...sessionTokens,
    sessionId: session.id,
    userDeviceId: userDevice.id
  };
};

const rotateRefreshToken = async (
  refreshToken: string,
  connectionInfo?: TConnectionInfo
): Promise<
  (TSessionTokens & { sessionId: number; userDeviceId: number | null }) | undefined
> => {
  const now = Date.now();
  const refreshTokenHash = hashToken(refreshToken);

  const activeSession = await db
    .select({
      id: authSessions.id,
      userId: authSessions.userId,
      userDeviceId: authSessions.userDeviceId,
      authProvider: authSessions.authProvider,
      refreshTokenHash: authSessions.refreshTokenHash,
      banned: users.banned
    })
    .from(authSessions)
    .innerJoin(users, eq(users.id, authSessions.userId))
    .where(
      and(
        eq(authSessions.refreshTokenHash, refreshTokenHash),
        isNull(authSessions.revokedAt),
        gt(authSessions.refreshExpiresAt, now)
      )
    )
    .get();

  if (!activeSession) {
    const historicalSession = await getActiveOrHistoricalRefreshSession(refreshToken);

    if (historicalSession) {
      const isRecentRotatedReuse =
        historicalSession.source === 'historical' &&
        historicalSession.reason === 'rotated' &&
        typeof historicalSession.usedAt === 'number' &&
        now - historicalSession.usedAt <= ROTATED_TOKEN_REUSE_GRACE_MS;

      if (!isRecentRotatedReuse) {
        await revokeAuthSession(
          historicalSession.sessionId,
          'refresh_token_reused'
        );
      }
    }

    return undefined;
  }

  if (activeSession.banned) {
    return undefined;
  }

  const currentFingerprint = connectionInfo
    ? createFingerprint(connectionInfo)
    : undefined;

  if (activeSession.userDeviceId && currentFingerprint) {
    const storedFingerprint = await getUserDeviceFingerprint(
      activeSession.userDeviceId
    );

    if (!storedFingerprint || storedFingerprint !== currentFingerprint) {
      return undefined;
    }
  }

  const sessionDevice =
    connectionInfo && activeSession.userDeviceId && currentFingerprint
      ? await getOrCreateUserDevice(
          activeSession.userId,
          connectionInfo,
          currentFingerprint
        )
      : undefined;

  const tokens = createSessionTokens();
  const oldRefreshTokenHash = activeSession.refreshTokenHash;

  const refreshed = await db
    .update(authSessions)
    .set({
      accessTokenHash: hashToken(tokens.accessToken),
      refreshTokenHash: hashToken(tokens.refreshToken),
      accessExpiresAt: tokens.accessExpiresAt,
      refreshExpiresAt: tokens.refreshExpiresAt,
      userDeviceId: sessionDevice?.id ?? activeSession.userDeviceId,
      lastSeenAt: now,
      updatedAt: now
    })
    .where(
      and(
        eq(authSessions.id, activeSession.id),
        eq(authSessions.refreshTokenHash, oldRefreshTokenHash),
        isNull(authSessions.revokedAt),
        gt(authSessions.refreshExpiresAt, now)
      )
    )
    .returning()
    .get();

  if (!refreshed) {
    return undefined;
  }

  await db
    .insert(authSessionRefreshTokens)
    .values({
      authSessionId: activeSession.id,
      tokenHash: oldRefreshTokenHash,
      reason: 'rotated',
      createdAt: now,
      usedAt: now
    })
    .onConflictDoUpdate({
      target: authSessionRefreshTokens.tokenHash,
      set: {
        reason: 'rotated',
        usedAt: now,
        authSessionId: activeSession.id
      }
    })
    .run();

  return {
    accessToken: tokens.accessToken,
    refreshToken: tokens.refreshToken,
    accessExpiresAt: tokens.accessExpiresAt,
    refreshExpiresAt: tokens.refreshExpiresAt,
    sessionId: refreshed.id,
    userDeviceId: refreshed.userDeviceId
  };
};

const revokeAuthSession = async (
  sessionId: number,
  reason: string
): Promise<void> => {
  await db
    .update(authSessions)
    .set({
      revokedAt: Date.now(),
      revokedReason: reason,
      updatedAt: Date.now()
    })
    .where(and(eq(authSessions.id, sessionId), isNull(authSessions.revokedAt)))
    .run();
};

const revokeAllUserSessions = async (
  userId: number,
  reason: string
): Promise<void> => {
  await db
    .update(authSessions)
    .set({
      revokedAt: Date.now(),
      revokedReason: reason,
      updatedAt: Date.now()
    })
    .where(and(eq(authSessions.userId, userId), isNull(authSessions.revokedAt)))
    .run();
};

const getSessionByAccessToken = async (
  accessToken: string
): Promise<TSessionContext | undefined> => {
  return getActiveAccessSession(accessToken);
};

export {
  ACCESS_TOKEN_TTL_MS,
  REFRESH_TOKEN_TTL_MS,
  createAuthSession,
  createFingerprint,
  createSessionTokens,
  getSessionByAccessToken,
  getOrCreateUserDevice,
  rotateRefreshToken,
  revokeAllUserSessions,
  revokeAuthSession
};
