import { protectedProcedure } from '../../utils/trpc';
import { revokeAllUserSessions } from '../../db/queries/auth-sessions';
import { invalidateWsAuthByUserId } from '../../utils/wss';

const logoutAllRoute = protectedProcedure.mutation(async ({ ctx }) => {
  await revokeAllUserSessions(ctx.userId, 'user_logout_all');
  ctx.authenticated = false;
  ctx.sessionId = undefined;
  invalidateWsAuthByUserId(ctx.userId);

  return { success: true };
});

export { logoutAllRoute };
