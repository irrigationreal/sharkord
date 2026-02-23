import { z } from 'zod';
import { rateLimitedProcedure, protectedProcedure } from '../../utils/trpc';
import { registerDevice } from '../../services/e2ee';

const registerDeviceRoute = rateLimitedProcedure(protectedProcedure, {
  maxRequests: 10,
  windowMs: 60_000,
  logLabel: 'e2ee.registerDevice'
})
  .input(
    z.object({
      arkRecordCborB64: z.string().min(1),
      deviceRecordCborB64: z.string().min(1),
      deviceAuthorizationCborB64: z.string().min(1)
    })
  )
  .mutation(async ({ ctx, input }) => {
    return registerDevice({
      userId: ctx.userId,
      arkRecordCborB64: input.arkRecordCborB64,
      deviceRecordCborB64: input.deviceRecordCborB64,
      deviceAuthorizationCborB64: input.deviceAuthorizationCborB64
    });
  });

export { registerDeviceRoute };
