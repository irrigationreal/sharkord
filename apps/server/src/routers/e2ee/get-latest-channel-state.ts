import { ChannelPermission } from '@sharkord/shared';
import { z } from 'zod';
import { protectedProcedure } from '../../utils/trpc';
import { getLatestChannelState } from '../../services/e2ee';

const getLatestChannelStateRoute = protectedProcedure
  .input(
    z.object({
      channelId: z.number().int().positive()
    })
  )
  .query(async ({ ctx, input }) => {
    await ctx.needsChannelPermission(
      input.channelId,
      ChannelPermission.VIEW_CHANNEL
    );

    return getLatestChannelState(input.channelId);
  });

export { getLatestChannelStateRoute };
