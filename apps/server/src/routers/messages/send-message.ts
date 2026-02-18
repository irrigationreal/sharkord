import { Permission } from '@sharkord/shared';
import { z } from 'zod';
import { config } from '../../config';
import { invariant } from '../../utils/invariant';
import { protectedProcedure, rateLimitedProcedure } from '../../utils/trpc';

const sendMessageRoute = rateLimitedProcedure(protectedProcedure, {
  maxRequests: config.rateLimiters.sendAndEditMessage.maxRequests,
  windowMs: config.rateLimiters.sendAndEditMessage.windowMs,
  logLabel: 'sendMessage'
})
  .input(z.unknown())
  .mutation(async ({ ctx }) => {
    await ctx.needsPermission(Permission.SEND_MESSAGES);

    invariant(false, {
      code: 'FORBIDDEN',
      message:
        'Plaintext message sending is disabled. Use e2ee.sendEncryptedMessage.'
    });
  });

export { sendMessageRoute };
