import { ChannelPermission, type TFile, type TSettings, type TUser } from '.';

export enum ChannelType {
  TEXT = 'TEXT',
  VOICE = 'VOICE'
}

export enum StreamKind {
  AUDIO = 'audio',
  VIDEO = 'video',
  SCREEN = 'screen',
  SCREEN_AUDIO = 'screen_audio',
  EXTERNAL_VIDEO = 'external_video',
  EXTERNAL_AUDIO = 'external_audio'
}

export type TExternalStreamTrackKind = 'audio' | 'video';

export type TExternalStreamTracks = {
  audio?: boolean;
  video?: boolean;
};

export type TRemoteProducerIds = {
  remoteVideoIds: number[];
  remoteAudioIds: number[];
  remoteScreenIds: number[];
  remoteScreenAudioIds: number[];
  remoteExternalStreamIds: number[];
};

export type TPublicServerSettings = Pick<
  TSettings,
  | 'name'
  | 'description'
  | 'serverId'
  | 'storageUploadEnabled'
  | 'storageQuota'
  | 'storageUploadMaxFileSize'
  | 'storageSpaceQuotaByUser'
  | 'storageOverflowAction'
  | 'enablePlugins'
>;

export type TGenericObject = {
  [key: string]: any;
};

export type TGenericFunction = {
  (...args: any[]): any;
};

export type TMessageMetadata = {
  url: string;
  title?: string;
  siteName?: string;
  description?: string;
  mediaType: string;
  images?: string[];
  videos?: string[];
  favicons?: string[];
};

export type WithOptional<T, K extends keyof T> = Omit<T, K> &
  Partial<Pick<T, K>>;

export enum UserStatus {
  ONLINE = 'online',
  IDLE = 'idle',
  OFFLINE = 'offline'
}

export type TOwnUser = WithOptional<TUser, 'identity'>;

export type TConnectionParams = {
  token: string;
};

export type TTempFile = {
  id: string;
  originalName: string;
  size: number;
  md5: string;
  path: string;
  extension: string;
  userId: number;
};

export type TServerInfo = Pick<
  TSettings,
  'serverId' | 'name' | 'description' | 'allowNewUsers'
> & {
  logo: TFile | null;
  version: string;
};

export type TArtifact = {
  name: string;
  target: string;
  size: number;
  checksum: string;
};

export type TVersionInfo = {
  version: string;
  releaseDate: string;
  artifacts: TArtifact[];
};

export type TIpInfo = {
  ip: string;
  hostname: string;
  city: string;
  region: string;
  country: string;
  loc: string;
  org: string;
  postal: string;
  timezone: string;
};

export type TChannelPermissionsMap = Record<ChannelPermission, boolean>;

export type TChannelUserPermissionsMap = Record<
  number,
  { channelId: number; permissions: TChannelPermissionsMap }
>;

export type TReadStateMap = Record<number, number>;

export type TE2EERegisterDeviceInput = {
  arkRecordCborB64: string;
  deviceRecordCborB64: string;
  deviceAuthorizationCborB64: string;
};

export type TE2EERegisterDeviceResult = {
  arkVersion: number;
  deviceId: string;
  deviceSeq: number;
  arkHashHex: string;
  deviceRecordHashHex: string;
};

export type TE2EERevokeDeviceInput = {
  deviceId: string;
  arkVersion: number;
  revokeAuthorizationCborB64: string;
};

export type TE2EEIdentityBootstrapResult = {
  latestArkVersion: number | null;
  latestArkHashHex: string | null;
  latestDeviceSeq: number | null;
};

export type TE2EEPublishChannelEpochInput = {
  channelId: number;
  cscPayloadCborB64: string;
  cscSignatureB64: string;
  deviceEnvelopes?: Array<{
    recipientDeviceId: string;
    envelope: string;
  }>;
};

export type TE2EEPublishChannelEpochResult = {
  channelId: number;
  epoch: number;
  cscHashHex: string;
};

export type TE2EELatestChannelState = {
  latestEpoch: number | null;
  latestCscHashHex: string | null;
  latestCscPayloadCborB64: string | null;
  latestCscSignatureB64: string | null;
};

export type TE2EEAuthorizedDevice = {
  deviceId: string;
  deviceSeq: number;
  signPubHex: string;
  kemPubHex: string;
  arkVersion: number;
  authorizedAt: number;
};

export type TE2EEUploadPrekeysInput = {
  deviceId: string;
  signedPrekey: {
    prekeyId: string;
    prekeyPubB64: string;
    signatureB64: string;
    createdAtMs: number;
  };
  oneTimePrekeys: Array<{
    prekeyId: string;
    prekeyPubB64: string;
    createdAtMs: number;
  }>;
};

export type TE2EEClaimPrekeyInput = {
  targetUserId: number;
  targetDeviceId: string;
};

export type TE2EEClaimPrekeyResult = {
  deviceId: string;
  signedPrekey: {
    prekeyId: string;
    prekeyPubB64: string;
    signatureB64: string;
  };
  oneTimePrekey: {
    prekeyId: string;
    prekeyPubB64: string;
  } | null;
};

export type TE2EERequestKeyCatchupInput = {
  channelId: number;
  fromEpochInclusive: number;
  toEpochInclusive: number;
  missingSenders?: Array<{
    senderDeviceId: string;
    senderKeyId: string;
  }>;
  reason:
    | 'channel_open'
    | 'scroll_backfill'
    | 'decrypt_pending'
    | 'device_restore';
};

export type TE2EEReserveNonceBlockInput = {
  senderKeyId: string;
};

export type TE2EEReserveNonceBlockResult = {
  senderKeyId: string;
  noncePrefix: number;
  startCounter: number;
  endCounter: number;
};

export type TE2EESubmitEnvelopeInput = {
  channelId: number;
  headerCborB64: string;
  nonceB64: string;
  ciphertextB64: string;
  tagB64: string;
  sigB64?: string;
};

export type TE2EESubmitEnvelopeResult = {
  envelopeId: number;
  acceptedCounter: number;
  createdAt: number;
};

export type TE2EEGetEnvelopesInput = {
  channelId: number;
  cursorId?: number;
  limit?: number;
  fromEpochInclusive?: number;
  toEpochInclusive?: number;
};

export type TE2EEGetEnvelopesResult = {
  envelopes: Array<{
    id: number;
    channelId: number;
    epoch: number;
    senderUserId: number;
    senderDeviceId: string;
    senderKeyId: string;
    counter: number;
    clientMessageId: string;
    contentType: number;
    flags: number;
    cscHashHex: string;
    headerCborB64: string;
    nonceB64: string;
    ciphertextB64: string;
    tagB64: string;
    sigB64: string | null;
    createdAt: number;
  }>;
  nextCursorId: number | null;
};

export type TE2EESendEncryptedMessageInput = {
  channelId: number;
  parentMessageId?: number;
  headerCborB64: string;
  nonceB64: string;
  ciphertextB64: string;
  tagB64: string;
  sigB64?: string;
  files?: string[];
};

export type TE2EESendEncryptedMessageResult = {
  messageId: number;
  envelopeId: number;
  clientMessageId: string;
  createdAt: number;
};

export type TE2EERequestKeyCatchupResult = {
  cscChain: Array<{
    epoch: number;
    cscSigned: string;
    cscHashHex: string;
    signerUserId: number;
    signerDeviceId: string;
  }>;
  deviceKeyEnvelopes: Array<{
    epoch: number;
    recipientDeviceId: string;
    envelope: string;
  }>;
  historyBoundaries: Array<{
    type: 'channel_created_boundary';
    effectiveFromTs: number;
    reason: string;
  }>;
};
