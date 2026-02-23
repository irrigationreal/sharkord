import http from 'http';
import { createOAuthState } from '../../db/queries/oauth-states';
import {
  generateOAuthState,
  getDiscordConfig,
  getDiscordAuthorizeUrl
} from '../../services/auth';

const OAUTH_PROVIDER = 'discord';

const sanitizeRedirectPath = (rawPath: string | null): string => {
  if (!rawPath) {
    return '/';
  }

  if (!rawPath.startsWith('/') || rawPath.startsWith('//')) {
    return '/';
  }

  return rawPath;
};

const discordStartRouteHandler = async (
  req: http.IncomingMessage,
  res: http.ServerResponse
) => {
  const url = new URL(req.url!, `http://${req.headers.host}`);
  const inviteCode = url.searchParams.get('invite') || undefined;
  const redirectPath = sanitizeRedirectPath(url.searchParams.get('redirectPath'));
  const deviceId = url.searchParams.get('deviceId') || undefined;

  const { clientId, redirectUri } = getDiscordConfig(req);
  const state = generateOAuthState();

  await createOAuthState({
    provider: OAUTH_PROVIDER,
    state,
    deviceId,
    inviteCode,
    redirectPath
  });

  const location = getDiscordAuthorizeUrl({
    clientId,
    redirectUri,
    state
  });

  res.writeHead(302, { Location: location });
  res.end();
};

export { discordStartRouteHandler };
