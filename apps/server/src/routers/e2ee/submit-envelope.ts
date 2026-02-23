import { ChannelPermission, Permission } from '@sharkord/shared';
import { z } from 'zod';
import { rateLimitedProcedure, protectedProcedure } from '../../utils/trpc';
import { submitEnvelope } from '../../services/e2ee';

const submitEnvelopeRoute = rateLimitedProcedure(protectedProcedure, {
  maxRequests: 120,
  windowMs: 60_000,
  logLabel: 'e2ee.submitEnvelope'
})
  .input(
    z
      .object({
        channelId: z.number().int().positive(),
        headerCborB64: z.string().min(1),
        nonceB64: z.string().min(1),
        ciphertextB64: z.string().min(1),
        tagB64: z.string().min(1),
        sigB64: z.string().min(1).optional()
      })
      .strict()
  )
  .mutation(async ({ ctx, input }) => {
    await Promise.all([
      ctx.needsPermission(Permission.SEND_MESSAGES),
      ctx.needsChannelPermission(
        input.channelId,
        ChannelPermission.SEND_MESSAGES
      )
    ]);

    return submitEnvelope({
      userId: ctx.userId,
      channelId: input.channelId,
      headerCborB64: input.headerCborB64,
      nonceB64: input.nonceB64,
      ciphertextB64: input.ciphertextB64,
      tagB64: input.tagB64,
      sigB64: input.sigB64
    });
  });

export { submitEnvelopeRoute };
