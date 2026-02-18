import { republishKnownChannelKeysForMembers } from '@/features/e2ee/shadow';
import { store } from '@/features/store';
import { getTRPCClient } from '@/lib/trpc';
import { UserStatus, type TJoinedPublicUser } from '@sharkord/shared';
import {
  addUser,
  handleUserJoin,
  reassignUser,
  updateUser,
  wipeUser
} from './actions';
import { ownUserIdSelector } from './selectors';

const republishKnownKeysForCurrentMembership = async () => {
  const state = store.getState();
  const ownUserId = ownUserIdSelector(state);

  if (!ownUserId) {
    return;
  }

  const recipientUserIds = state.server.users.map((user) => user.id);

  if (!recipientUserIds.length) {
    return;
  }

  const channelIds = state.server.channels
    .filter((channel) => {
      if (!channel.private) {
        return true;
      }

      return (
        state.server.channelPermissions[channel.id]?.permissions?.VIEW_CHANNEL === true
      );
    })
    .map((channel) => channel.id);

  if (!channelIds.length) {
    return;
  }

  await republishKnownChannelKeysForMembers({
    ownUserId,
    recipientUserIds,
    channelIds
  });
};

const subscribeToUsers = () => {
  const trpc = getTRPCClient();
  void republishKnownKeysForCurrentMembership();

  const onUserJoinSub = trpc.users.onJoin.subscribe(undefined, {
    onData: (user: TJoinedPublicUser) => {
      handleUserJoin(user);
      void republishKnownKeysForCurrentMembership();
    },
    onError: (err) => console.error('onUserJoin subscription error:', err)
  });

  const onUserCreateSub = trpc.users.onCreate.subscribe(undefined, {
    onData: (user: TJoinedPublicUser) => {
      addUser(user);
    },
    onError: (err) => console.error('onUserCreate subscription error:', err)
  });

  const onUserLeaveSub = trpc.users.onLeave.subscribe(undefined, {
    onData: (userId: number) => {
      updateUser(userId, { status: UserStatus.OFFLINE });
    },
    onError: (err) => console.error('onUserLeave subscription error:', err)
  });

  const onUserUpdateSub = trpc.users.onUpdate.subscribe(undefined, {
    onData: (user: TJoinedPublicUser) => {
      updateUser(user.id, user);
    },
    onError: (err) => console.error('onUserUpdate subscription error:', err)
  });

  const onUserDeleteSub = trpc.users.onDelete.subscribe(undefined, {
    onData: ({ isWipe, userId, deletedUserId }) => {
      console.log('User deleted:', { isWipe, userId, deletedUserId });

      if (isWipe) {
        wipeUser(userId);
      } else {
        reassignUser(userId, deletedUserId);
      }
    },
    onError: (err) => console.error('onUserDelete subscription error:', err)
  });

  return () => {
    onUserJoinSub.unsubscribe();
    onUserLeaveSub.unsubscribe();
    onUserUpdateSub.unsubscribe();
    onUserCreateSub.unsubscribe();
    onUserDeleteSub.unsubscribe();
  };
};

export { subscribeToUsers };
