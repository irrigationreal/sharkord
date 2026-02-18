import { z } from 'zod';
import { rateLimitedProcedure, protectedProcedure } from '../../utils/trpc';
import { uploadPrekeys } from '../../services/e2ee';

const uploadPrekeysRoute = rateLimitedProcedure(protectedProcedure, {
  maxRequests: 20,
  windowMs: 60_000,
  logLabel: 'e2ee.uploadPrekeys'
})
  .input(
    z.object({
      deviceId: z.string().uuid(),
      signedPrekey: z.object({
        prekeyId: z.string().min(1),
        prekeyPubB64: z.string().min(1),
        signatureB64: z.string().min(1),
        createdAtMs: z.number().int().positive()
      }),
      oneTimePrekeys: z.array(
        z.object({
          prekeyId: z.string().min(1),
          prekeyPubB64: z.string().min(1),
          createdAtMs: z.number().int().positive()
        })
      )
    })
  )
  .mutation(async ({ ctx, input }) => {
    return uploadPrekeys({
      userId: ctx.userId,
      deviceId: input.deviceId,
      signedPrekey: input.signedPrekey,
      oneTimePrekeys: input.oneTimePrekeys
    });
  });

export { uploadPrekeysRoute };
