import { useCan } from '@/features/server/hooks';
import { useIsOwnUser } from '@/features/server/users/hooks';
import { Permission, type TJoinedMessage } from '@sharkord/shared';
import { memo, useMemo } from 'react';
import { MessageActions } from './message-actions';
import { MessageRenderer } from './renderer';

type TMessageProps = {
  message: TJoinedMessage;
  onOpenThread?: (message: TJoinedMessage) => void;
};

const Message = memo(({ message, onOpenThread }: TMessageProps) => {
  const isFromOwnUser = useIsOwnUser(message.userId);
  const can = useCan();

  const canManage = useMemo(
    () => can(Permission.MANAGE_MESSAGES) || isFromOwnUser,
    [can, isFromOwnUser]
  );

  return (
    <div className="min-w-0 flex-1 ml-1 relative hover:bg-secondary/50 rounded-md px-1 py-0.5 group">
      <>
        <MessageRenderer message={message} />
        <MessageActions
          canManage={canManage}
          messageId={message.id}
          onOpenThread={
            onOpenThread && !message.parentMessageId
              ? () => onOpenThread(message)
              : undefined
          }
          showThreadAction={!message.parentMessageId}
        />
      </>
    </div>
  );
});

export { Message };
