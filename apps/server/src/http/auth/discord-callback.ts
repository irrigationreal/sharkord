import { and, eq, sql } from 'drizzle-orm';
import { randomBytes } from 'node:crypto';
import http from 'http';
import { getSettings } from '../../db/queries/server';
import { getDefaultRole } from '../../db/queries/roles';
import { isInviteValid } from '../../db/queries/invites';
import { getUserById } from '../../db/queries/users';
import { createAuthSession } from '../../db/queries/auth-sessions';
import {
  createAuthIdentity,
  getAuthIdentity,
  touchAuthIdentityLastLogin
} from '../../db/queries/auth-identities';
import { consumeOAuthState } from '../../db/queries/oauth-states';
import { db } from '../../db';
import { invites, users, userRoles } from '../../db/schema';
import { publishUser } from '../../db/publishers';
import { hashPassword } from '../../helpers/password';
import { getWsInfo } from '../../helpers/get-ws-info';
import {
  exchangeDiscordCodeForToken,
  getDiscordConfig,
  getDiscordMe
} from '../../services/auth';

type TOauthDiscordUser = {
  id: string;
  username?: string;
  globalName?: string;
};

const OAUTH_PROVIDER = 'discord';

const sanitizeRedirectPath = (rawPath: string | null): string => {
  if (!rawPath || !rawPath.startsWith('/') || rawPath.startsWith('//')) {
    return '/';
  }

  return rawPath;
};

const getDisplayName = (user: TOauthDiscordUser): string =>
  user.globalName || user.username || `Discord User ${user.id}`;

const buildRedirectWithTokens = (
  redirectPath: string,
  tokens: {
    accessToken: string;
    refreshToken: string;
    accessExpiresAt: number;
    refreshExpiresAt: number;
    sessionId: number;
  }
): string => {
  const fragment = new URLSearchParams({
    token: tokens.accessToken,
    refreshToken: tokens.refreshToken,
    accessExpiresAt: String(tokens.accessExpiresAt),
    refreshExpiresAt: String(tokens.refreshExpiresAt),
    sessionId: String(tokens.sessionId)
  });

  return `${redirectPath}#${fragment.toString()}`;
};

const createDiscordUserFromIdentity = async (
  user: TOauthDiscordUser
): Promise<number> => {
  const now = Date.now();
  const defaultRole = await getDefaultRole();

  if (!defaultRole) {
    throw new Error('No default role configured');
  }

  const createdUsers = await db
    .insert(users)
    .values({
      identity: `discord:${user.id}`,
      password: await hashPassword(randomBytes(32).toString('base64url')),
      name: getDisplayName(user),
      createdAt: now
    })
    .returning({ id: users.id });

  const createdUser = createdUsers[0];

  if (!createdUser?.id) {
    throw new Error('Failed to create OAuth user');
  }

  await db.insert(userRoles).values({
    userId: createdUser.id,
    roleId: defaultRole.id,
    createdAt: now
  });

  await publishUser(createdUser.id, 'create');

  return createdUser.id;
};

const incrementInviteUses = async (inviteCode: string) => {
  await db
    .update(invites)
    .set({
      uses: sql`${invites.uses} + 1`
    })
    .where(and(eq(invites.code, inviteCode)));
};

const discordCallbackRouteHandler = async (
  req: http.IncomingMessage,
  res: http.ServerResponse
) => {
  const url = new URL(req.url!, `http://${req.headers.host}`);
  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');
  const mode = url.searchParams.get('mode');
  if (!code || !state) {
    res.writeHead(400, { 'Content-Type': 'application/json' });
    res.end(
      JSON.stringify({
        error: 'invalid_request',
        details: 'Missing code or state'
      })
    );
    return;
  }

  const stateRow = await consumeOAuthState(OAUTH_PROVIDER, state);

  if (!stateRow) {
    res.writeHead(400, { 'Content-Type': 'application/json' });
    res.end(
      JSON.stringify({
        error: 'invalid_state',
        details: 'OAuth state is invalid, expired, or already used'
      })
    );
    return;
  }

  const oauthState = stateRow;
  const responseMode = mode === 'json' ? 'json' : 'redirect';
  const requestedRedirect = sanitizeRedirectPath(oauthState.redirectPath);

  try {
    const config = getDiscordConfig(req);
    const accessToken = await exchangeDiscordCodeForToken(
      {
        code,
        redirectUri: config.redirectUri
      },
      config
    );

    const discordUser = await getDiscordMe(accessToken);
    const existingIdentity = await getAuthIdentity(OAUTH_PROVIDER, discordUser.id);

    if (!existingIdentity) {
      const settings = await getSettings();

      if (!settings.allowNewUsers) {
        const inviteError = await isInviteValid(oauthState.inviteCode || undefined);
        if (inviteError) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(
            JSON.stringify({
              error: 'invite_required',
              details: inviteError
            })
          );
          return;
        }

        if (oauthState.inviteCode) {
          await incrementInviteUses(oauthState.inviteCode);
        }
      }

      const userId = await createDiscordUserFromIdentity(discordUser);

      await createAuthIdentity({
        userId,
        provider: OAUTH_PROVIDER,
        providerSubject: discordUser.id
      });

      const connectionInfo = getWsInfo(undefined, req);
      const tokens = await createAuthSession(
        userId,
        connectionInfo,
        OAUTH_PROVIDER
      );

      if (responseMode === 'json') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(
          JSON.stringify({
            success: true,
            token: tokens.accessToken,
            refreshToken: tokens.refreshToken,
            accessExpiresAt: tokens.accessExpiresAt,
            refreshExpiresAt: tokens.refreshExpiresAt,
            sessionId: tokens.sessionId
          })
        );
        return;
      }

      res.writeHead(302, {
        Location: buildRedirectWithTokens(requestedRedirect, tokens)
      });
      res.end();
      return;
    }

    await touchAuthIdentityLastLogin(OAUTH_PROVIDER, discordUser.id);

    const user = await getUserById(existingIdentity.userId);

    if (!user) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          error: 'account_not_found',
          details: 'Linked OAuth identity has no local user'
        })
      );
      return;
    }

    if (user.banned) {
      res.writeHead(403, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          error: 'forbidden',
          details: `User ${user.identity} is banned`
        })
      );
      return;
    }

    const connectionInfo = getWsInfo(undefined, req);
    const tokens = await createAuthSession(
      user.id,
      connectionInfo,
      OAUTH_PROVIDER
    );

    if (responseMode === 'json') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          success: true,
          token: tokens.accessToken,
          refreshToken: tokens.refreshToken,
          accessExpiresAt: tokens.accessExpiresAt,
          refreshExpiresAt: tokens.refreshExpiresAt,
          sessionId: tokens.sessionId
        })
      );
      return;
    }

    res.writeHead(302, {
      Location: buildRedirectWithTokens(requestedRedirect, tokens)
    });
    res.end();
  } catch (error) {
    const message =
      error instanceof Error ? error.message : 'OAuth callback failed';

    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(
      JSON.stringify({
        error: 'oauth_callback_failed',
        details: message
      })
    );
  }
};

export { discordCallbackRouteHandler };
