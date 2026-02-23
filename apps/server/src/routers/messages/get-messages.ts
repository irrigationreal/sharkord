import {
  ChannelPermission,
  DEFAULT_MESSAGES_LIMIT,
  ServerEvents,
  type TFile,
  type TJoinedMessage,
  type TJoinedMessageReaction,
  type TMessage
} from '@sharkord/shared';
import { and, desc, eq, inArray, isNull, lt, sql } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '../../db';
import { getChannelsReadStatesForUser } from '../../db/queries/channels';
import {
  channelReadStates,
  channels,
  files,
  messageFiles,
  messageReactions,
  messages
} from '../../db/schema';
import {
  enforceE2EEMessageBody,
  isE2EEMessageMarker,
} from '../../e2ee/message-content';
import { generateFileToken } from '../../helpers/files-crypto';
import { invariant } from '../../utils/invariant';
import { pubsub } from '../../utils/pubsub';
import { protectedProcedure } from '../../utils/trpc';

const getMessagesRoute = protectedProcedure
  .input(
    z.object({
      channelId: z.number(),
      cursor: z.number().nullish(),
      parentMessageId: z.number().int().positive().nullable().optional(),
      limit: z.number().default(DEFAULT_MESSAGES_LIMIT)
    })
  )
  .meta({ infinite: true })
  .query(async ({ ctx, input }) => {
    await ctx.needsChannelPermission(
      input.channelId,
      ChannelPermission.VIEW_CHANNEL
    );

    const { channelId, cursor, limit } = input;
    let targetParentMessageId = input.parentMessageId ?? null;

    if (typeof targetParentMessageId === 'number') {
      const parentMessage = await db
        .select({
          id: messages.id,
          channelId: messages.channelId,
          parentMessageId: messages.parentMessageId
        })
        .from(messages)
        .where(eq(messages.id, targetParentMessageId))
        .get();

      invariant(parentMessage && parentMessage.channelId === channelId, {
        code: 'BAD_REQUEST',
        message: 'Invalid parent message for thread'
      });

      targetParentMessageId = parentMessage.parentMessageId ?? parentMessage.id;
    }

    const channel = await db
      .select({
        private: channels.private,
        fileAccessToken: channels.fileAccessToken
      })
      .from(channels)
      .where(eq(channels.id, channelId))
      .get();

    invariant(channel, {
      code: 'NOT_FOUND',
      message: 'Channel not found'
    });

    const rows: TMessage[] = await db
      .select()
      .from(messages)
      .where(
        cursor
          ? and(
              eq(messages.channelId, channelId),
              targetParentMessageId === null
                ? isNull(messages.parentMessageId)
                : eq(messages.parentMessageId, targetParentMessageId),
              lt(messages.createdAt, cursor)
            )
          : and(
              eq(messages.channelId, channelId),
              targetParentMessageId === null
                ? isNull(messages.parentMessageId)
                : eq(messages.parentMessageId, targetParentMessageId)
            )
      )
      .orderBy(desc(messages.createdAt))
      .limit(limit + 1);

    let nextCursor: number | null = null;

    if (rows.length > limit) {
      const next = rows.pop();

      nextCursor = next ? next.createdAt : null;
    }

    if (rows.length === 0) {
      return { messages: [], nextCursor };
    }

    const messageIds = rows.map((m) => m.id);

    const [fileRows, reactionRows, replyCountRows] = await Promise.all([
      db
        .select({
          messageId: messageFiles.messageId,
          file: files
        })
        .from(messageFiles)
        .innerJoin(files, eq(messageFiles.fileId, files.id))
        .where(inArray(messageFiles.messageId, messageIds)),
      db
        .select({
          messageId: messageReactions.messageId,
          userId: messageReactions.userId,
          emoji: messageReactions.emoji,
          createdAt: messageReactions.createdAt,
          fileId: messageReactions.fileId,
          file: files
        })
        .from(messageReactions)
        .leftJoin(files, eq(messageReactions.fileId, files.id))
        .where(inArray(messageReactions.messageId, messageIds)),
      db
        .select({
          parentMessageId: messages.parentMessageId,
          count: sql<number>`count(*)`
        })
        .from(messages)
        .where(inArray(messages.parentMessageId, messageIds))
        .groupBy(messages.parentMessageId)
    ]);

    const filesByMessage = fileRows.reduce<Record<number, TFile[]>>(
      (acc, row) => {
        if (!acc[row.messageId]) {
          acc[row.messageId] = [];
        }

        const rowCopy: TFile = { ...row.file };

        if (channel.private) {
          // when a channel is private, we need to generate access tokens for each file
          // this allows files to be accessed only by users who have access to the channel
          // however, if a user decides to share the file link, they can do so and anyone with the link can access it
          // this is by design
          // the access token is generated using the channel's file access token
          // so if an admin wants to invalidate all file links, they can simply regenerate the channel's file access token

          rowCopy._accessToken = generateFileToken(
            row.file.id,
            channel.fileAccessToken
          );
        }

        acc[row.messageId]!.push(rowCopy);

        return acc;
      },
      {}
    );

    const reactionsByMessage = reactionRows.reduce<
      Record<number, TJoinedMessageReaction[]>
    >((acc, r) => {
      const reaction: TJoinedMessageReaction = {
        messageId: r.messageId,
        userId: r.userId,
        emoji: r.emoji,
        createdAt: r.createdAt,
        fileId: r.fileId,
        file: r.file
      };

      if (!acc[r.messageId]) {
        acc[r.messageId] = [];
      }

      acc[r.messageId]!.push(reaction);

      return acc;
    }, {});
    const replyCountByMessage = replyCountRows.reduce<Record<number, number>>(
      (acc, row) => {
        if (typeof row.parentMessageId === 'number') {
          acc[row.parentMessageId] = Number(row.count || 0);
        }

        return acc;
      },
      {}
    );

    // Combine messages with files and reactions
    const messagesWithFiles: TJoinedMessage[] = rows.map((msg) => {
      const isE2EE = isE2EEMessageMarker(msg.content);

      return {
        ...msg,
        content: enforceE2EEMessageBody(msg.content),
        files: isE2EE ? (filesByMessage[msg.id] ?? []) : [],
        reactions: reactionsByMessage[msg.id] ?? [],
        threadReplyCount: replyCountByMessage[msg.id] ?? 0
      };
    });

    // always update read state to the absolute latest message in the channel
    // (not just the newest in this batch, in case user is scrolling back through history)
    // this is not ideal, but it's good enough for now
    if (targetParentMessageId !== null) {
      return { messages: messagesWithFiles, nextCursor };
    }

    const [, , latestMessage] = await Promise.all([
      Promise.resolve(fileRows),
      Promise.resolve(reactionRows),
      db
        .select()
        .from(messages)
        .where(eq(messages.channelId, channelId))
        .orderBy(desc(messages.createdAt))
        .limit(1)
        .get()
    ]);

    if (latestMessage) {
      await db
        .insert(channelReadStates)
        .values({
          channelId,
          userId: ctx.userId,
          lastReadMessageId: latestMessage.id,
          lastReadAt: Date.now()
        })
        .onConflictDoUpdate({
          target: [channelReadStates.channelId, channelReadStates.userId],
          set: {
            lastReadMessageId: latestMessage.id,
            lastReadAt: Date.now()
          }
        });

      const updatedReadStates = await getChannelsReadStatesForUser(
        ctx.userId,
        channelId
      );

      pubsub.publishFor(ctx.userId, ServerEvents.CHANNEL_READ_STATES_UPDATE, {
        channelId,
        count: updatedReadStates[channelId] ?? 0
      });
    }

    return { messages: messagesWithFiles, nextCursor };
  });

export { getMessagesRoute };
