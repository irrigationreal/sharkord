import { protectedProcedure } from '../../utils/trpc';
import { getIdentityBootstrap } from '../../services/e2ee';

const getIdentityBootstrapRoute = protectedProcedure.query(async ({ ctx }) => {
  return getIdentityBootstrap(ctx.userId);
});

export { getIdentityBootstrapRoute };
