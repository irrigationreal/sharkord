import { z } from 'zod';
import { rateLimitedProcedure, protectedProcedure } from '../../utils/trpc';
import { claimPrekey } from '../../services/e2ee';

const claimPrekeyRoute = rateLimitedProcedure(protectedProcedure, {
  maxRequests: 30,
  windowMs: 60_000,
  logLabel: 'e2ee.claimPrekey'
})
  .input(
    z.object({
      targetUserId: z.number().int().positive(),
      targetDeviceId: z.string().uuid()
    })
  )
  .query(async ({ ctx, input }) => {
    return claimPrekey({
      requesterUserId: ctx.userId,
      targetUserId: input.targetUserId,
      targetDeviceId: input.targetDeviceId
    });
  });

export { claimPrekeyRoute };
