import { tryHydrateMessagesWithEnvelopeDecrypt } from '@/features/e2ee/shadow';
import { store } from '@/features/store';
import { getTRPCClient } from '@/lib/trpc';
import type { TJoinedMessage } from '@sharkord/shared';
import { ownUserIdSelector } from '../users/selectors';
import {
  addMessages,
  addTypingUser,
  deleteMessage,
  upsertThreadMessage,
  updateMessage
} from './actions';
import { primeEncryptedNotifications } from './notifications';

const subscribeToMessages = () => {
  const trpc = getTRPCClient();
  const getOwnUserId = () => ownUserIdSelector(store.getState());
  primeEncryptedNotifications();

  const onMessageSub = trpc.messages.onNew.subscribe(undefined, {
    onData: async (message: TJoinedMessage) => {
      const hydrated = await tryHydrateMessagesWithEnvelopeDecrypt(
        message.channelId,
        [message],
        getOwnUserId()
      );
      const target = hydrated[0];

      if (!target) return;

      if (typeof target.parentMessageId === 'number') {
        upsertThreadMessage(message.channelId, target);
      } else {
        addMessages(message.channelId, hydrated, {}, true);
      }
    },
    onError: (err) => console.error('onMessage subscription error:', err)
  });

  const onMessageUpdateSub = trpc.messages.onUpdate.subscribe(undefined, {
    onData: async (message: TJoinedMessage) => {
      const hydrated = await tryHydrateMessagesWithEnvelopeDecrypt(
        message.channelId,
        [message],
        getOwnUserId()
      );
      const target = hydrated[0];

      if (!target) return;

      if (typeof target.parentMessageId === 'number') {
        upsertThreadMessage(message.channelId, target);
      } else {
        updateMessage(message.channelId, target);
      }
    },
    onError: (err) => console.error('onMessageUpdate subscription error:', err)
  });

  const onMessageDeleteSub = trpc.messages.onDelete.subscribe(undefined, {
    onData: ({ messageId, channelId }) => deleteMessage(channelId, messageId),
    onError: (err) => console.error('onMessageDelete subscription error:', err)
  });

  const onMessageTypingSub = trpc.messages.onTyping.subscribe(undefined, {
    onData: ({ userId, channelId }) => {
      addTypingUser(channelId, userId);
    },
    onError: (err) => console.error('onMessageTyping subscription error:', err)
  });

  return () => {
    onMessageSub.unsubscribe();
    onMessageUpdateSub.unsubscribe();
    onMessageDeleteSub.unsubscribe();
    onMessageTypingSub.unsubscribe();
  };
};

export { subscribeToMessages };
