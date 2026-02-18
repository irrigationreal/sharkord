import { protectedProcedure } from '../../utils/trpc';
import { revokeAuthSession } from '../../db/queries/auth-sessions';
import { invalidateWsAuthByToken } from '../../utils/wss';

const logoutRoute = protectedProcedure.mutation(async ({ ctx }) => {
  if (typeof ctx.sessionId === 'number') {
    await revokeAuthSession(ctx.sessionId, 'user_logout');
  }

  ctx.authenticated = false;
  ctx.sessionId = undefined;
  invalidateWsAuthByToken(ctx.token);

  return { success: true };
});

export { logoutRoute };
