import {
  getStrictE2EEFileMeta,
  openStrictE2EEFile
} from '@/features/e2ee/shadow';
import { requestConfirmation } from '@/features/dialogs/actions';
import { useOwnUserId } from '@/features/server/users/hooks';
import { getTRPCClient } from '@/lib/trpc';
import { type TJoinedMessage } from '@sharkord/shared';
import parse from 'html-react-parser';
import { memo, useCallback, useMemo } from 'react';
import { toast } from 'sonner';
import { FileCard } from '../file-card';
import { MessageReactions } from '../message-reactions';
import { serializer } from './serializer';

type TMessageRendererProps = {
  message: TJoinedMessage;
};

const MessageRenderer = memo(({ message }: TMessageRendererProps) => {
  const ownUserId = useOwnUserId();
  const isOwnMessage = useMemo(
    () => message.userId === ownUserId,
    [message.userId, ownUserId]
  );

  const messageHtml = useMemo(() => {
    const messageHtml = parse(message.content ?? '', {
      replace: (domNode) => serializer(domNode, () => undefined, message.id)
    });

    return messageHtml;
  }, [message.content, message.id]);

  const onRemoveFileClick = useCallback(async (fileId: number) => {
    if (!fileId) return;

    const choice = await requestConfirmation({
      title: 'Delete file',
      message: 'Are you sure you want to delete this file?',
      confirmLabel: 'Delete'
    });

    if (!choice) return;

    const trpc = getTRPCClient();

    try {
      await trpc.files.delete.mutate({
        fileId
      });

      toast.success('File deleted');
    } catch {
      toast.error('Failed to delete file');
    }
  }, []);

  return (
    <div className="flex flex-col gap-1">
      <div className="prose max-w-full break-words msg-content">
        {messageHtml}
      </div>

      <MessageReactions reactions={message.reactions} messageId={message.id} />

      {message.files.length > 0 && (
        <div className="flex gap-1 flex-wrap">
          {message.files.map((file) => {
            const strictMeta = getStrictE2EEFileMeta(message.id, file.id);

            if (!strictMeta) {
              return null;
            }

            return (
              <FileCard
                key={file.id}
                name={strictMeta.originalName}
                extension={file.extension}
                size={strictMeta.originalSize}
                onRemove={
                  isOwnMessage ? () => onRemoveFileClick(file.id) : undefined
                }
                href={undefined}
                onOpen={
                  () =>
                    openStrictE2EEFile({
                      messageId: message.id,
                      file
                    }).catch(() => {
                      toast.error('Failed to open encrypted attachment');
                    })
                }
              />
            );
          })}
        </div>
      )}
    </div>
  );
});

export { MessageRenderer };
