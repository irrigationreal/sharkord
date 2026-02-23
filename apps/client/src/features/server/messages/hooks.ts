import type { IRootState } from '@/features/store';
import { tryHydrateMessagesWithEnvelopeDecrypt } from '@/features/e2ee/shadow';
import { getTRPCClient } from '@/lib/trpc';
import { DEFAULT_MESSAGES_LIMIT, type TJoinedMessage } from '@sharkord/shared';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSelector } from 'react-redux';
import { addMessages, addThreadMessages } from './actions';
import {
  messagesByChannelIdSelector,
  threadMessagesByChannelAndRootSelector
} from './selectors';
import { ownUserIdSelector } from '../users/selectors';

export const useMessagesByChannelId = (channelId: number) =>
  useSelector((state: IRootState) =>
    messagesByChannelIdSelector(state, channelId)
  );

export const useMessages = (channelId: number) => {
  const messages = useMessagesByChannelId(channelId);
  const ownUserId = useSelector(ownUserIdSelector);
  const inited = useRef(false);
  const [fetching, setFetching] = useState(false);
  const [loading, setLoading] = useState(messages.length === 0);
  const [cursor, setCursor] = useState<number | null>(null);
  const [hasMore, setHasMore] = useState(true);

  const fetchMessages = useCallback(
    async (cursorToFetch: number | null) => {
      const trpcClient = getTRPCClient();

      setFetching(true);

      try {
        const { messages: rawPage, nextCursor } =
          await trpcClient.messages.get.query({
            channelId,
            cursor: cursorToFetch,
            parentMessageId: null,
            limit: DEFAULT_MESSAGES_LIMIT
          });

        const hydrated = await tryHydrateMessagesWithEnvelopeDecrypt(
          channelId,
          rawPage,
          ownUserId
        );
        const page = [...hydrated].reverse();
        const existingIds = new Set(messages.map((m) => m.id));
        const filtered = page.filter((m) => !existingIds.has(m.id));

        if (cursorToFetch === null) {
          // initial load (latest page) — append (or replace if you prefer)
          addMessages(channelId, filtered);
        } else {
          // loading older messages -> they must go *before* current list
          addMessages(channelId, filtered, { prepend: true });
        }

        setCursor(nextCursor);
        setHasMore(
          nextCursor !== null && filtered.length === DEFAULT_MESSAGES_LIMIT
        );

        return { success: true };
      } finally {
        setFetching(false);
        setLoading(false);
      }
    },
    [channelId, messages, ownUserId]
  );

  const loadMore = useCallback(async () => {
    if (fetching || !hasMore) return;

    await fetchMessages(cursor);
  }, [fetching, hasMore, cursor, fetchMessages]);

  useEffect(() => {
    if (inited.current) return;

    fetchMessages(null);

    inited.current = true;
  }, [fetchMessages]);

  const isEmpty = useMemo(
    () => !messages.length && !fetching,
    [messages.length, fetching]
  );

  const groupedMessages = useMemo(() => {
    const grouped = messages.reduce((acc, message) => {
      const last = acc[acc.length - 1];

      if (!last) return [[message]];

      const lastMessage = last[last.length - 1];

      if (lastMessage.userId === message.userId) {
        const lastDate = lastMessage.createdAt;
        const currentDate = message.createdAt;
        const timeDifference = Math.abs(currentDate - lastDate) / 1000 / 60;

        if (timeDifference < 1) {
          last.push(message);
          return acc;
        }
      }

      return [...acc, [message]];
    }, [] as TJoinedMessage[][]);

    return grouped;
  }, [messages]);

  return {
    fetching,
    loading, // for initial load
    hasMore,
    messages,
    loadMore,
    cursor,
    groupedMessages,
    isEmpty
  };
};

export const useThreadMessages = (
  channelId: number,
  threadRootMessageId?: number
) => {
  const messages = useSelector((state: IRootState) =>
    threadMessagesByChannelAndRootSelector(
      state,
      channelId,
      threadRootMessageId ?? -1
    )
  );
  const ownUserId = useSelector(ownUserIdSelector);
  const inited = useRef(false);
  const [fetching, setFetching] = useState(false);
  const [loading, setLoading] = useState(messages.length === 0);
  const [cursor, setCursor] = useState<number | null>(null);
  const [hasMore, setHasMore] = useState(true);

  const fetchMessages = useCallback(
    async (cursorToFetch: number | null) => {
      const trpcClient = getTRPCClient();
      if (typeof threadRootMessageId !== 'number') return { success: true };

      setFetching(true);

      try {
        const { messages: rawPage, nextCursor } =
          await trpcClient.messages.get.query({
            channelId,
            cursor: cursorToFetch,
            parentMessageId: threadRootMessageId,
            limit: DEFAULT_MESSAGES_LIMIT
          });

        const hydrated = await tryHydrateMessagesWithEnvelopeDecrypt(
          channelId,
          rawPage,
          ownUserId
        );
        const page = [...hydrated].reverse();
        const existingIds = new Set(messages.map((m) => m.id));
        const filtered = page.filter((m) => !existingIds.has(m.id));

        if (cursorToFetch === null) {
          addThreadMessages(channelId, threadRootMessageId, filtered);
        } else {
          addThreadMessages(channelId, threadRootMessageId, filtered, {
            prepend: true
          });
        }

        setCursor(nextCursor);
        setHasMore(
          nextCursor !== null && filtered.length === DEFAULT_MESSAGES_LIMIT
        );

        return { success: true };
      } finally {
        setFetching(false);
        setLoading(false);
      }
    },
    [channelId, threadRootMessageId, messages, ownUserId]
  );

  const loadMore = useCallback(async () => {
    if (fetching || !hasMore) return;

    await fetchMessages(cursor);
  }, [fetching, hasMore, cursor, fetchMessages]);

  const reloadLatest = useCallback(async () => {
    setCursor(null);
    setHasMore(true);
    await fetchMessages(null);
  }, [fetchMessages]);

  useEffect(() => {
    inited.current = false;
  }, [channelId, threadRootMessageId]);

  useEffect(() => {
    if (typeof threadRootMessageId !== 'number') return;
    if (inited.current) return;

    fetchMessages(null);

    inited.current = true;
  }, [fetchMessages, threadRootMessageId]);

  return {
    fetching,
    loading,
    hasMore,
    cursor,
    messages,
    loadMore,
    reloadLatest
  };
};
