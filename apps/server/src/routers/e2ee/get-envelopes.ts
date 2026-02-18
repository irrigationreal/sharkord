import { ChannelPermission } from '@sharkord/shared';
import { z } from 'zod';
import { protectedProcedure } from '../../utils/trpc';
import { getEnvelopes } from '../../services/e2ee';

const getEnvelopesRoute = protectedProcedure
  .input(
    z
      .object({
        channelId: z.number().int().positive(),
        cursorId: z.number().int().positive().optional(),
        limit: z.number().int().min(1).max(200).optional(),
        fromEpochInclusive: z.number().int().positive().optional(),
        toEpochInclusive: z.number().int().positive().optional()
      })
      .refine(
        (value) =>
          value.fromEpochInclusive === undefined ||
          value.toEpochInclusive === undefined ||
          value.toEpochInclusive >= value.fromEpochInclusive,
        {
          message: 'toEpochInclusive must be >= fromEpochInclusive',
          path: ['toEpochInclusive']
        }
      )
  )
  .query(async ({ ctx, input }) => {
    await ctx.needsChannelPermission(
      input.channelId,
      ChannelPermission.VIEW_CHANNEL
    );

    return getEnvelopes({
      channelId: input.channelId,
      cursorId: input.cursorId,
      limit: input.limit ?? 50,
      fromEpochInclusive: input.fromEpochInclusive,
      toEpochInclusive: input.toEpochInclusive
    });
  });

export { getEnvelopesRoute };
