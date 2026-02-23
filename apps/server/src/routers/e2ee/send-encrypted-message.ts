import { ChannelPermission, Permission } from '@sharkord/shared';
import { z } from 'zod';
import { rateLimitedProcedure, protectedProcedure } from '../../utils/trpc';
import { sendEncryptedMessage } from '../../services/e2ee';

const sendEncryptedMessageRoute = rateLimitedProcedure(protectedProcedure, {
  maxRequests: 120,
  windowMs: 60_000,
  logLabel: 'e2ee.sendEncryptedMessage'
})
  .input(
    z
      .object({
        channelId: z.number().int().positive(),
        parentMessageId: z.number().int().positive().optional(),
        headerCborB64: z.string().min(1),
        nonceB64: z.string().min(1),
        ciphertextB64: z.string().min(1),
        tagB64: z.string().min(1),
        sigB64: z.string().min(1).optional(),
        files: z.array(z.string().min(1)).optional()
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

    return sendEncryptedMessage({
      userId: ctx.userId,
      channelId: input.channelId,
      parentMessageId: input.parentMessageId,
      headerCborB64: input.headerCborB64,
      nonceB64: input.nonceB64,
      ciphertextB64: input.ciphertextB64,
      tagB64: input.tagB64,
      sigB64: input.sigB64,
      files: input.files
    });
  });

export { sendEncryptedMessageRoute };
