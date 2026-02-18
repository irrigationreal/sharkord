import { ChannelPermission, Permission } from '@sharkord/shared';
import { z } from 'zod';
import { config } from '../../config';
import { invariant } from '../../utils/invariant';
import { protectedProcedure, rateLimitedProcedure } from '../../utils/trpc';

const sendMessageRoute = rateLimitedProcedure(protectedProcedure, {
  maxRequests: config.rateLimiters.sendAndEditMessage.maxRequests,
  windowMs: config.rateLimiters.sendAndEditMessage.windowMs,
  logLabel: 'sendMessage'
})
  .input(
    z.object({
      content: z.string(),
      channelId: z.number(),
      parentMessageId: z.number().int().positive().optional(),
      files: z.array(z.string()).optional()
    })
  )
  .mutation(async ({ input, ctx }) => {
    await Promise.all([
      ctx.needsPermission(Permission.SEND_MESSAGES),
      ctx.needsChannelPermission(
        input.channelId,
        ChannelPermission.SEND_MESSAGES
      )
    ]);

    invariant(false, {
      code: 'FORBIDDEN',
      message:
        'Plaintext message sending is disabled. Use e2ee.sendEncryptedMessage.'
    });
  });

export { sendMessageRoute };
