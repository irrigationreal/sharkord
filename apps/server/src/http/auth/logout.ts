import http from 'http';
import z from 'zod';
import { getSessionByAccessToken, revokeAuthSession } from '../../db/queries/auth-sessions';
import { getJsonBody } from '../helpers';

const zBody = z.object({
  token: z.string().min(1, 'Token is required')
});

const authLogoutRouteHandler = async (
  req: http.IncomingMessage,
  res: http.ServerResponse
) => {
  const { token } = zBody.parse(await getJsonBody(req));
  const context = await getSessionByAccessToken(token);

  if (!context?.sessionId) {
    res.writeHead(401, { 'Content-Type': 'application/json' });
    res.end(
      JSON.stringify({
        error: 'Invalid or expired session token'
      })
    );
    return;
  }

  await revokeAuthSession(context.sessionId, 'user_logout');

  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(
    JSON.stringify({
      success: true
    })
  );
};

export { authLogoutRouteHandler };
