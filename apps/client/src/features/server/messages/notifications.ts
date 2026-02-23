import { getFileUrl } from '@/helpers/get-file-url';
import type { TJoinedMessage } from '@sharkord/shared';
import { store } from '../../store';
import { setSelectedChannelId } from '../channels/actions';
import { ownUserIdSelector } from '../users/selectors';

let permissionRequested = false;

const notificationSupported = (): boolean =>
  typeof window !== 'undefined' && 'Notification' in window;

const ensureNotificationPermission = async (): Promise<boolean> => {
  if (!notificationSupported()) {
    return false;
  }

  const currentPermission = Notification.permission;

  if (currentPermission === 'granted') {
    return true;
  }

  if (currentPermission === 'denied') {
    return false;
  }

  if (permissionRequested) {
    return false;
  }

  permissionRequested = true;

  try {
    const permission = await Notification.requestPermission();
    return permission === 'granted';
  } catch {
    return false;
  }
};

const primeEncryptedNotifications = () => {
  void ensureNotificationPermission();
};

const textFromHtml = (html: string): string => {
  if (typeof document === 'undefined') {
    return html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
  }

  const container = document.createElement('div');
  container.innerHTML = html;
  const text = container.textContent || '';

  return text.replace(/\s+/g, ' ').trim();
};

const normalizePreview = (message: TJoinedMessage): string => {
  const raw = (message.content || '').trim();

  if (
    raw.startsWith('[[e2ee:v1:') ||
    raw.includes('Encrypted message') ||
    raw.includes('Blocked non-E2EE message')
  ) {
    return message.files.length > 0
      ? 'New encrypted attachment'
      : 'New encrypted message';
  }

  const text = textFromHtml(raw);

  if (!text && message.files.length > 0) {
    return 'New encrypted attachment';
  }

  if (!text) {
    return 'New encrypted message';
  }

  return text.length > 180 ? `${text.slice(0, 177)}...` : text;
};

const shouldDisplayNotification = (channelId: number): boolean => {
  const state = store.getState();
  const ownUserId = ownUserIdSelector(state);
  const selectedChannelId = state.server.selectedChannelId;

  if (!ownUserId) {
    return false;
  }

  const isFocused =
    typeof document !== 'undefined' &&
    document.visibilityState === 'visible' &&
    typeof window !== 'undefined' &&
    window.document.hasFocus();

  if (isFocused && selectedChannelId === channelId) {
    return false;
  }

  return true;
};

const notifyEncryptedMessage = async (message: TJoinedMessage) => {
  if (!notificationSupported()) {
    return;
  }

  if (!shouldDisplayNotification(message.channelId)) {
    return;
  }

  const hasPermission = await ensureNotificationPermission();

  if (!hasPermission) {
    return;
  }

  const state = store.getState();
  const sender = state.server.users.find((user) => user.id === message.userId);
  const channel = state.server.channels.find(
    (candidate) => candidate.id === message.channelId
  );
  const title =
    sender && channel ? `${sender.name} in #${channel.name}` : 'New encrypted message';
  const body = normalizePreview(message);
  const icon = sender?.avatar ? getFileUrl(sender.avatar) : undefined;

  const notification = new Notification(title, {
    body,
    icon,
    tag: `msg-${message.channelId}-${message.id}`
  });

  notification.onclick = () => {
    try {
      window.focus();
    } catch {}

    setSelectedChannelId(message.channelId);
    notification.close();
  };
};

export { notifyEncryptedMessage, primeEncryptedNotifications };
