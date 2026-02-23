import { z } from 'zod';
import { rateLimitedProcedure, protectedProcedure } from '../../utils/trpc';
import { reserveNonceBlock } from '../../services/e2ee';

const reserveNonceBlockRoute = rateLimitedProcedure(protectedProcedure, {
  maxRequests: 60,
  windowMs: 60_000,
  logLabel: 'e2ee.reserveNonceBlock'
})
  .input(
    z.object({
      senderKeyId: z.string().min(1).max(128)
    })
  )
  .mutation(async ({ ctx, input }) => {
    const reserved = await reserveNonceBlock({
      senderKeyId: `${ctx.userId}:${input.senderKeyId}`
    });

    return {
      ...reserved,
      senderKeyId: input.senderKeyId
    };
  });

export { reserveNonceBlockRoute };
