import { Permission } from '@sharkord/shared';
import { z } from 'zod';
import { config } from '../../config';
import { invariant } from '../../utils/invariant';
import { protectedProcedure, rateLimitedProcedure } from '../../utils/trpc';

const editMessageRoute = rateLimitedProcedure(protectedProcedure, {
  maxRequests: config.rateLimiters.sendAndEditMessage.maxRequests,
  windowMs: config.rateLimiters.sendAndEditMessage.windowMs,
  logLabel: 'editMessage'
})
  .input(z.unknown())
  .mutation(async ({ ctx }) => {
    await ctx.needsPermission(Permission.SEND_MESSAGES);

    invariant(false, {
      code: 'FORBIDDEN',
      message:
        'Message editing is disabled in mandatory E2EE mode.'
    });
  });

export { editMessageRoute };
