import { ChannelPermission } from '@sharkord/shared';
import { z } from 'zod';
import { protectedProcedure } from '../../utils/trpc';
import { requestKeyCatchup } from '../../services/e2ee';

const requestKeyCatchupRoute = protectedProcedure
  .input(
    z.object({
      channelId: z.number().int().positive(),
      fromEpochInclusive: z.number().int().positive(),
      toEpochInclusive: z.number().int().positive(),
      missingSenders: z
        .array(
          z.object({
            senderDeviceId: z.string().uuid(),
            senderKeyId: z.string().min(1).max(128)
          })
        )
        .optional(),
      reason: z.enum([
        'channel_open',
        'scroll_backfill',
        'decrypt_pending',
        'device_restore'
      ])
    })
  )
  .query(async ({ ctx, input }) => {
    await ctx.needsChannelPermission(
      input.channelId,
      ChannelPermission.VIEW_CHANNEL
    );

    return requestKeyCatchup({
      userId: ctx.userId,
      channelId: input.channelId,
      fromEpochInclusive: input.fromEpochInclusive,
      toEpochInclusive: input.toEpochInclusive,
      missingSenders: input.missingSenders,
      reason: input.reason
    });
  });

export { requestKeyCatchupRoute };
