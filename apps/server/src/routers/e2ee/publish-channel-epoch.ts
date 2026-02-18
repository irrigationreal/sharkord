import { ChannelPermission, Permission } from '@sharkord/shared';
import { z } from 'zod';
import { rateLimitedProcedure, protectedProcedure } from '../../utils/trpc';
import { publishChannelEpoch } from '../../services/e2ee';

const publishChannelEpochRoute = rateLimitedProcedure(protectedProcedure, {
  maxRequests: 20,
  windowMs: 60_000,
  logLabel: 'e2ee.publishChannelEpoch'
})
  .input(
    z.object({
      channelId: z.number().int().positive(),
      cscPayloadCborB64: z.string().min(1),
      cscSignatureB64: z.string().min(1),
      deviceEnvelopes: z
        .array(
          z.object({
            recipientDeviceId: z.string().uuid(),
            envelope: z.string().min(1)
          })
        )
        .optional()
    })
  )
  .mutation(async ({ ctx, input }) => {
    await Promise.all([
      ctx.needsPermission(Permission.SEND_MESSAGES),
      ctx.needsChannelPermission(
        input.channelId,
        ChannelPermission.SEND_MESSAGES
      )
    ]);

    return publishChannelEpoch({
      userId: ctx.userId,
      channelId: input.channelId,
      cscPayloadCborB64: input.cscPayloadCborB64,
      cscSignatureB64: input.cscSignatureB64,
      deviceEnvelopes: input.deviceEnvelopes
    });
  });

export { publishChannelEpochRoute };
