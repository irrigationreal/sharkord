import type {
  TE2EEAuthorizedDevice,
  TE2EEGetEnvelopesInput,
  TE2EEGetEnvelopesResult,
  TE2EEClaimPrekeyInput,
  TE2EEClaimPrekeyResult,
  TE2EEIdentityBootstrapResult,
  TE2EELatestChannelState,
  TE2EEPublishChannelEpochInput,
  TE2EEPublishChannelEpochResult,
  TE2EEReserveNonceBlockInput,
  TE2EEReserveNonceBlockResult,
  TE2EERequestKeyCatchupInput,
  TE2EERequestKeyCatchupResult,
  TE2EERegisterDeviceInput,
  TE2EERegisterDeviceResult,
  TE2EERevokeDeviceInput,
  TE2EESendEncryptedMessageInput,
  TE2EESendEncryptedMessageResult,
  TE2EESubmitEnvelopeInput,
  TE2EESubmitEnvelopeResult,
  TE2EEUploadPrekeysInput
} from '@sharkord/shared';
import { getTRPCClient } from '@/lib/trpc';

const registerE2EEDevice = async (
  input: TE2EERegisterDeviceInput
): Promise<TE2EERegisterDeviceResult> => {
  return getTRPCClient().e2ee.registerDevice.mutate(input);
};

const revokeE2EEDevice = async (
  input: TE2EERevokeDeviceInput
): Promise<{ success: true }> => {
  return getTRPCClient().e2ee.revokeDevice.mutate(input);
};

const uploadE2EEPrekeys = async (
  input: TE2EEUploadPrekeysInput
): Promise<{ success: true }> => {
  return getTRPCClient().e2ee.uploadPrekeys.mutate(input);
};

const claimE2EEPrekey = async (
  input: TE2EEClaimPrekeyInput
): Promise<TE2EEClaimPrekeyResult> => {
  return getTRPCClient().e2ee.claimPrekey.query(input);
};

const getE2EEIdentityBootstrap = async (): Promise<TE2EEIdentityBootstrapResult> => {
  return getTRPCClient().e2ee.getIdentityBootstrap.query();
};

const publishE2EEChannelEpoch = async (
  input: TE2EEPublishChannelEpochInput
): Promise<TE2EEPublishChannelEpochResult> => {
  return getTRPCClient().e2ee.publishChannelEpoch.mutate(input);
};

const getLatestE2EEChannelState = async (
  channelId: number
): Promise<TE2EELatestChannelState> => {
  return getTRPCClient().e2ee.getLatestChannelState.query({ channelId });
};

const getAuthorizedE2EEDevices = async (
  userId?: number
): Promise<TE2EEAuthorizedDevice[]> => {
  return getTRPCClient().e2ee.getUserAuthorizedDevices.query({ userId });
};

const requestE2EEKeyCatchup = async (
  input: TE2EERequestKeyCatchupInput
): Promise<TE2EERequestKeyCatchupResult> => {
  return getTRPCClient().e2ee.requestKeyCatchup.query(input);
};

const reserveE2EENonceBlock = async (
  input: TE2EEReserveNonceBlockInput
): Promise<TE2EEReserveNonceBlockResult> => {
  return getTRPCClient().e2ee.reserveNonceBlock.mutate(input);
};

const submitE2EEEnvelope = async (
  input: TE2EESubmitEnvelopeInput
): Promise<TE2EESubmitEnvelopeResult> => {
  return getTRPCClient().e2ee.submitEnvelope.mutate(input);
};

const sendE2EEEncryptedMessage = async (
  input: TE2EESendEncryptedMessageInput
): Promise<TE2EESendEncryptedMessageResult> => {
  return getTRPCClient().e2ee.sendEncryptedMessage.mutate(input);
};

const getE2EEEnvelopes = async (
  input: TE2EEGetEnvelopesInput
): Promise<TE2EEGetEnvelopesResult> => {
  return getTRPCClient().e2ee.getEnvelopes.query(input);
};

export {
  claimE2EEPrekey,
  getE2EEEnvelopes,
  getE2EEIdentityBootstrap,
  getAuthorizedE2EEDevices,
  getLatestE2EEChannelState,
  publishE2EEChannelEpoch,
  reserveE2EENonceBlock,
  requestE2EEKeyCatchup,
  registerE2EEDevice,
  revokeE2EEDevice,
  sendE2EEEncryptedMessage,
  submitE2EEEnvelope,
  uploadE2EEPrekeys
};
