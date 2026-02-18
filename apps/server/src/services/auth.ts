import { randomBytes } from 'node:crypto';
import type http from 'http';

type TDiscordOAuthConfig = {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
};

type TDiscordUser = {
  id: string;
  username?: string;
  globalName?: string;
};

type TDiscordOAuthTokenResponse = {
  access_token?: string;
  token_type?: string;
  error?: string;
  error_description?: string;
};

const DISCORD_AUTHORIZE_URL = 'https://discord.com/oauth2/authorize';
const DISCORD_TOKEN_URL = 'https://discord.com/api/oauth2/token';
const DISCORD_USERS_ME_URL = 'https://discord.com/api/users/@me';

const getDiscordConfig = (req: http.IncomingMessage): TDiscordOAuthConfig => {
  const clientId = process.env.DISCORD_CLIENT_ID;
  const clientSecret = process.env.DISCORD_CLIENT_SECRET;

  const redirectUri =
    process.env.DISCORD_REDIRECT_URI ??
    `http://${req.headers.host}/auth/discord/callback`;

  if (!clientId) {
    throw new Error('Missing DISCORD_CLIENT_ID');
  }

  if (!clientSecret) {
    throw new Error('Missing DISCORD_CLIENT_SECRET');
  }

  return {
    clientId,
    clientSecret,
    redirectUri
  };
};

const generateOAuthState = (): string => randomBytes(32).toString('base64url');

const getDiscordAuthorizeUrl = ({
  clientId,
  redirectUri,
  state
}: Omit<TDiscordOAuthConfig, 'clientSecret'> & {
  state: string;
}): string =>
  `${DISCORD_AUTHORIZE_URL}?${new URLSearchParams({
    client_id: clientId,
    response_type: 'code',
    redirect_uri: redirectUri,
    scope: 'identify',
    state
  }).toString()}`;

const exchangeDiscordCodeForToken = async (
  {
    code,
    redirectUri
  }: {
    code: string;
    redirectUri: string;
  },
  config: TDiscordOAuthConfig
): Promise<string> => {
  const response = await fetch(DISCORD_TOKEN_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Accept: 'application/json'
    },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: redirectUri,
      client_id: config.clientId,
      client_secret: config.clientSecret
    }).toString()
  });

  const payload = (await response.json()) as TDiscordOAuthTokenResponse;

  if (!response.ok || !payload.access_token) {
    throw new Error(
      payload.error_description ||
      payload.error ||
      'Failed to exchange Discord OAuth code'
    );
  }

  return payload.access_token;
};

const getDiscordMe = async (accessToken: string): Promise<TDiscordUser> => {
  const response = await fetch(DISCORD_USERS_ME_URL, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: 'application/json'
    }
  });

  if (!response.ok) {
    throw new Error('Failed to fetch Discord user profile');
  }

  const payload = (await response.json()) as {
    id?: string;
    username?: string;
    global_name?: string;
  };

  if (!payload.id) {
    throw new Error('Discord user payload missing identifier');
  }

  return {
    id: payload.id,
    username: payload.username,
    globalName: payload.global_name
  };
};

export {
  DISCORD_AUTHORIZE_URL,
  getDiscordConfig,
  getDiscordMe,
  getDiscordAuthorizeUrl,
  generateOAuthState,
  exchangeDiscordCodeForToken
};
export type { TDiscordOAuthConfig };
