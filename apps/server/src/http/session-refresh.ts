import http from 'http';
import z from 'zod';
import { rotateRefreshToken } from '../db/queries/auth-sessions';
import { getWsInfo } from '../helpers/get-ws-info';
import { getJsonBody } from './helpers';

const zBody = z.object({
  refreshToken: z.string().min(1, 'Refresh token is required')
});

const sessionRefreshRouteHandler = async (
  req: http.IncomingMessage,
  res: http.ServerResponse
) => {
  const { refreshToken } = zBody.parse(await getJsonBody(req));
  const connectionInfo = getWsInfo(undefined, req);
  const result = await rotateRefreshToken(refreshToken, connectionInfo);

  if (!result) {
    res.writeHead(401, { 'Content-Type': 'application/json' });
    res.end(
      JSON.stringify({
        error: 'Invalid or expired refresh token'
      })
    );

    return;
  }

  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(
    JSON.stringify({
      success: true,
      token: result.accessToken,
      refreshToken: result.refreshToken,
      accessExpiresAt: result.accessExpiresAt,
      refreshExpiresAt: result.refreshExpiresAt
    })
  );
};

export { sessionRefreshRouteHandler };
