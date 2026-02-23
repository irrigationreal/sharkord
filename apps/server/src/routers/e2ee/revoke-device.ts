import { z } from 'zod';
import { rateLimitedProcedure, protectedProcedure } from '../../utils/trpc';
import { revokeDevice } from '../../services/e2ee';

const revokeDeviceRoute = rateLimitedProcedure(protectedProcedure, {
  maxRequests: 10,
  windowMs: 60_000,
  logLabel: 'e2ee.revokeDevice'
})
  .input(
    z.object({
      deviceId: z.string().uuid(),
      arkVersion: z.number().int().positive(),
      revokeAuthorizationCborB64: z.string().min(1)
    })
  )
  .mutation(async ({ ctx, input }) => {
    await revokeDevice({
      userId: ctx.userId,
      deviceId: input.deviceId,
      arkVersion: input.arkVersion,
      revokeAuthorizationCborB64: input.revokeAuthorizationCborB64
    });

    return { success: true as const };
  });

export { revokeDeviceRoute };
