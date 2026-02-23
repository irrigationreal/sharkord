import {
  type TActivityLogDetailsMap,
  type TMessageMetadata
} from '@sharkord/shared';
import {
  type AnySQLiteColumn,
  index,
  integer,
  primaryKey,
  sqliteTable,
  text,
  uniqueIndex
} from 'drizzle-orm/sqlite-core';

const files = sqliteTable(
  'files',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    name: text('name').notNull().unique(),
    originalName: text('original_name').notNull(),
    md5: text('md5').notNull(),
    userId: integer('user_id').notNull(),
    size: integer('size').notNull(),
    mimeType: text('mime_type').notNull(),
    extension: text('extension').notNull(),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at')
  },
  (t) => [
    index('files_user_idx').on(t.userId),
    index('files_md5_idx').on(t.md5),
    index('files_created_idx').on(t.createdAt),
    index('files_name_idx').on(t.name)
  ]
);

const settings = sqliteTable(
  'settings',
  {
    name: text('name').notNull(),
    description: text('description'),
    password: text('password'),
    serverId: text('server_id').notNull(),
    secretToken: text('secret_token'),
    logoId: integer('logo_id').references(() => files.id, {
      onDelete: 'set null'
    }),
    allowNewUsers: integer('allow_new_users', { mode: 'boolean' }).notNull(),
    storageUploadEnabled: integer('storage_uploads_enabled', {
      mode: 'boolean'
    }).notNull(),
    storageQuota: integer('storage_quota').notNull(),
    storageUploadMaxFileSize: integer('storage_upload_max_file_size').notNull(),
    storageSpaceQuotaByUser: integer('storage_space_quota_by_user').notNull(),
    storageOverflowAction: text('storage_overflow_action').notNull(),
    enablePlugins: integer('enable_plugins', { mode: 'boolean' }).notNull()
  },
  (t) => [
    index('settings_server_idx').on(t.serverId),
    uniqueIndex('settings_server_unique_idx').on(t.serverId)
  ]
);

const roles = sqliteTable(
  'roles',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    name: text('name').notNull(),
    color: text('color').notNull().default('#ffffff'),
    isPersistent: integer('is_persistent', { mode: 'boolean' }).notNull(),
    isDefault: integer('is_default', { mode: 'boolean' }).notNull(),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at')
  },
  (t) => [
    index('roles_is_default_idx').on(t.isDefault),
    index('roles_is_persistent_idx').on(t.isPersistent)
  ]
);

const categories = sqliteTable(
  'categories',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    name: text('name').notNull(),
    position: integer('position').notNull(),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at')
  },
  (t) => [index('categories_position_idx').on(t.position)]
);

const channels = sqliteTable(
  'channels',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    type: text('type').notNull(),
    name: text('name').notNull(),
    topic: text('topic'),
    fileAccessToken: text('file_access_token').notNull().unique(),
    fileAccessTokenUpdatedAt: integer('file_access_token_updated_at').notNull(),
    private: integer('private', { mode: 'boolean' }).notNull().default(false),
    position: integer('position').notNull(),
    categoryId: integer('category_id').references(() => categories.id, {
      onDelete: 'cascade'
    }),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at')
  },
  (t) => [
    index('channels_category_idx').on(t.categoryId),
    index('channels_position_idx').on(t.position),
    index('channels_type_idx').on(t.type),
    index('channels_category_position_idx').on(t.categoryId, t.position)
  ]
);

const users = sqliteTable(
  'users',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    identity: text('identity').unique().notNull(),
    password: text('password').notNull(),
    name: text('name').notNull(),
    avatarId: integer('avatar_id').references(() => files.id, {
      onDelete: 'set null'
    }),
    bannerId: integer('banner_id').references(() => files.id, {
      onDelete: 'set null'
    }),
    bio: text('bio'),
    banned: integer('banned', { mode: 'boolean' }).notNull().default(false),
    banReason: text('ban_reason'),
    bannedAt: integer('banned_at'),
    bannerColor: text('banner_color'),
    lastLoginAt: integer('last_login_at')
      .notNull()
      .$defaultFn(() => Date.now()),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at')
  },
  (t) => [
    uniqueIndex('users_identity_idx').on(t.identity),
    index('users_name_idx').on(t.name),
    index('users_banned_idx').on(t.banned),
    index('users_last_login_idx').on(t.lastLoginAt)
  ]
);

const userRoles = sqliteTable(
  'user_roles',
  {
    userId: integer('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    roleId: integer('role_id')
      .notNull()
      .references(() => roles.id, { onDelete: 'cascade' }),
    createdAt: integer('created_at').notNull()
  },
  (t) => [
    primaryKey({ columns: [t.userId, t.roleId] }),
    index('user_roles_user_idx').on(t.userId),
    index('user_roles_role_idx').on(t.roleId)
  ]
);

const logins = sqliteTable(
  'logins',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    userId: integer('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    userAgent: text('user_agent'),
    os: text('os'),
    device: text('device'),
    ip: text('ip'),
    hostname: text('hostname'),
    city: text('city'),
    region: text('region'),
    country: text('country'),
    loc: text('loc'),
    org: text('org'),
    postal: text('postal'),
    timezone: text('timezone'),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at')
  },
  (t) => [
    index('logins_user_idx').on(t.userId),
    index('logins_ip_idx').on(t.ip),
    index('logins_created_idx').on(t.createdAt),
    index('logins_user_created_idx').on(t.userId, t.createdAt)
  ]
);

const userDevices = sqliteTable(
  'user_devices',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    userId: integer('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    fingerprint: text('fingerprint').notNull(),
    userAgent: text('user_agent'),
    os: text('os'),
    device: text('device'),
    ip: text('ip'),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at'),
    lastSeenAt: integer('last_seen_at'),
    revokedAt: integer('revoked_at')
  },
  (t) => [
    index('user_devices_user_idx').on(t.userId),
    index('user_devices_fingerprint_idx').on(t.fingerprint),
    uniqueIndex('user_devices_user_fingerprint_idx').on(
      t.userId,
      t.fingerprint
    ),
    index('user_devices_user_last_seen_idx').on(t.userId, t.lastSeenAt)
  ]
);

const authSessions = sqliteTable(
  'auth_sessions',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    userId: integer('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    userDeviceId: integer('user_device_id').references(() => userDevices.id, {
      onDelete: 'set null'
    }),
    authProvider: text('auth_provider'),
    accessTokenHash: text('access_token_hash').notNull().unique(),
    refreshTokenHash: text('refresh_token_hash').notNull().unique(),
    accessExpiresAt: integer('access_expires_at').notNull(),
    refreshExpiresAt: integer('refresh_expires_at').notNull(),
    revokedAt: integer('revoked_at'),
    revokedReason: text('revoked_reason'),
    lastSeenAt: integer('last_seen_at'),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at')
  },
  (t) => [
    index('auth_sessions_user_idx').on(t.userId),
    index('auth_sessions_device_idx').on(t.userDeviceId),
    index('auth_sessions_access_expires_idx').on(t.accessExpiresAt),
    index('auth_sessions_refresh_expires_idx').on(t.refreshExpiresAt),
    index('auth_sessions_revoked_idx').on(t.revokedAt)
  ]
);

const authSessionRefreshTokens = sqliteTable(
  'auth_session_refresh_tokens',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    authSessionId: integer('auth_session_id')
      .notNull()
      .references(() => authSessions.id, {
        onDelete: 'cascade'
      }),
    tokenHash: text('token_hash').notNull().unique(),
    reason: text('reason').notNull().default('rotated'),
    createdAt: integer('created_at').notNull(),
    usedAt: integer('used_at').notNull()
  },
  (t) => [
    index('auth_session_refresh_tokens_session_idx').on(t.authSessionId),
    index('auth_session_refresh_tokens_reason_idx').on(t.reason)
  ]
);

const authIdentities = sqliteTable(
  'auth_identities',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    userId: integer('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    provider: text('provider').notNull(),
    providerSubject: text('provider_subject').notNull(),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at'),
    lastLoginAt: integer('last_login_at')
  },
  (t) => [
    index('auth_identities_user_idx').on(t.userId),
    uniqueIndex('auth_identities_provider_subject_idx').on(
      t.provider,
      t.providerSubject
    )
  ]
);

const oauthStates = sqliteTable(
  'oauth_states',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    stateHash: text('state_hash').notNull().unique(),
    provider: text('provider').notNull(),
    deviceId: text('device_id'),
    inviteCode: text('invite_code'),
    redirectPath: text('redirect_path'),
    createdAt: integer('created_at').notNull(),
    expiresAt: integer('expires_at').notNull(),
    consumedAt: integer('consumed_at')
  },
  (t) => [index('oauth_states_provider_idx').on(t.provider, t.expiresAt)]
);

const userRootKeys = sqliteTable(
  'user_root_keys',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    userId: integer('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    arkVersion: integer('ark_version').notNull(),
    arkPub: text('ark_pub').notNull(),
    arkRecordCbor: text('ark_record_cbor').notNull(),
    arkHash: text('ark_hash').notNull(),
    prevArkHash: text('prev_ark_hash'),
    createdAt: integer('created_at').notNull()
  },
  (t) => [
    uniqueIndex('user_root_keys_user_version_idx').on(t.userId, t.arkVersion),
    index('user_root_keys_user_created_idx').on(t.userId, t.createdAt)
  ]
);

const e2eeDevices = sqliteTable(
  'e2ee_devices',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    userId: integer('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    deviceId: text('device_id').notNull(),
    deviceSeq: integer('device_seq').notNull(),
    signPub: text('sign_pub').notNull(),
    kemPub: text('kem_pub').notNull(),
    cryptoProfile: text('crypto_profile').notNull(),
    capabilities: integer('capabilities').notNull(),
    deviceRecordCbor: text('device_record_cbor').notNull(),
    deviceRecordHash: text('device_record_hash').notNull(),
    createdAt: integer('created_at').notNull(),
    revokedAt: integer('revoked_at')
  },
  (t) => [
    uniqueIndex('e2ee_devices_user_device_id_idx').on(t.userId, t.deviceId),
    uniqueIndex('e2ee_devices_user_device_seq_idx').on(t.userId, t.deviceSeq),
    index('e2ee_devices_user_revoked_idx').on(t.userId, t.revokedAt)
  ]
);

const deviceAuthorizations = sqliteTable(
  'device_authorizations',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    userId: integer('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    deviceId: text('device_id').notNull(),
    arkVersion: integer('ark_version').notNull(),
    deviceRecordHash: text('device_record_hash').notNull(),
    deviceSeq: integer('device_seq').notNull(),
    action: integer('action').notNull(),
    statementCbor: text('statement_cbor').notNull(),
    signature: text('signature').notNull(),
    createdAt: integer('created_at').notNull()
  },
  (t) => [
    index('device_auth_user_device_created_idx').on(
      t.userId,
      t.deviceId,
      t.createdAt
    ),
    index('device_auth_user_device_action_idx').on(t.userId, t.deviceId, t.action)
  ]
);

const channelStateCommitments = sqliteTable(
  'channel_state_commitments',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    channelId: integer('channel_id')
      .notNull()
      .references(() => channels.id, { onDelete: 'cascade' }),
    epoch: integer('epoch').notNull(),
    cscHash: text('csc_hash').notNull(),
    prevCscHash: text('prev_csc_hash'),
    membershipDigest: text('membership_digest').notNull(),
    policyDigest: text('policy_digest').notNull(),
    signerUserId: integer('signer_user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    signerDeviceId: text('signer_device_id').notNull(),
    payloadCbor: text('payload_cbor').notNull(),
    signature: text('signature').notNull(),
    createdAt: integer('created_at').notNull()
  },
  (t) => [
    uniqueIndex('channel_state_commitments_channel_epoch_idx').on(
      t.channelId,
      t.epoch
    ),
    uniqueIndex('channel_state_commitments_channel_hash_idx').on(
      t.channelId,
      t.cscHash
    ),
    index('channel_state_commitments_channel_created_idx').on(
      t.channelId,
      t.createdAt
    )
  ]
);

const devicePrekeys = sqliteTable(
  'device_prekeys',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    userId: integer('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    deviceId: text('device_id').notNull(),
    prekeyId: text('prekey_id').notNull(),
    prekeyPub: text('prekey_pub').notNull(),
    signature: text('signature'),
    oneTime: integer('one_time', { mode: 'boolean' }).notNull(),
    createdAt: integer('created_at').notNull(),
    usedAt: integer('used_at')
  },
  (t) => [
    uniqueIndex('device_prekeys_device_prekey_idx').on(t.deviceId, t.prekeyId),
    index('device_prekeys_user_device_idx').on(t.userId, t.deviceId),
    index('device_prekeys_device_one_time_used_idx').on(
      t.deviceId,
      t.oneTime,
      t.usedAt
    )
  ]
);

const channelEpochDeviceEnvelopes = sqliteTable(
  'channel_epoch_device_envelopes',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    channelId: integer('channel_id')
      .notNull()
      .references(() => channels.id, { onDelete: 'cascade' }),
    epoch: integer('epoch').notNull(),
    recipientDeviceId: text('recipient_device_id').notNull(),
    envelope: text('envelope').notNull(),
    createdAt: integer('created_at').notNull()
  },
  (t) => [
    uniqueIndex('channel_epoch_device_envelopes_unique_idx').on(
      t.channelId,
      t.epoch,
      t.recipientDeviceId
    ),
    index('channel_epoch_device_envelopes_channel_epoch_idx').on(
      t.channelId,
      t.epoch
    ),
    index('channel_epoch_device_envelopes_recipient_idx').on(t.recipientDeviceId)
  ]
);

const senderNonceAllocators = sqliteTable(
  'sender_nonce_allocators',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    senderKeyId: text('sender_key_id').notNull().unique(),
    noncePrefix: integer('nonce_prefix').notNull(),
    nextCounter: integer('next_counter').notNull(),
    updatedAt: integer('updated_at').notNull()
  },
  (t) => [
    uniqueIndex('sender_nonce_allocators_sender_key_idx').on(t.senderKeyId),
    index('sender_nonce_allocators_updated_idx').on(t.updatedAt)
  ]
);

const replayWindows = sqliteTable(
  'replay_windows',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    channelId: integer('channel_id')
      .notNull()
      .references(() => channels.id, { onDelete: 'cascade' }),
    senderDeviceId: text('sender_device_id').notNull(),
    senderKeyId: text('sender_key_id').notNull(),
    maxCounter: integer('max_counter').notNull(),
    bitmapBase64: text('bitmap_base64').notNull(),
    updatedAt: integer('updated_at').notNull()
  },
  (t) => [
    uniqueIndex('replay_windows_unique_idx').on(
      t.channelId,
      t.senderDeviceId,
      t.senderKeyId
    ),
    index('replay_windows_updated_idx').on(t.updatedAt)
  ]
);

const e2eeMessageEnvelopes = sqliteTable(
  'e2ee_message_envelopes',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    channelId: integer('channel_id')
      .notNull()
      .references(() => channels.id, { onDelete: 'cascade' }),
    epoch: integer('epoch').notNull(),
    senderUserId: integer('sender_user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    senderDeviceId: text('sender_device_id').notNull(),
    senderKeyId: text('sender_key_id').notNull(),
    counter: integer('counter').notNull(),
    clientMessageId: text('client_message_id').notNull(),
    contentType: integer('content_type').notNull(),
    flags: integer('flags').notNull(),
    cscHash: text('csc_hash').notNull(),
    headerCbor: text('header_cbor').notNull(),
    nonceB64: text('nonce_b64').notNull(),
    ciphertextB64: text('ciphertext_b64').notNull(),
    tagB64: text('tag_b64').notNull(),
    sigB64: text('sig_b64'),
    createdAt: integer('created_at').notNull()
  },
  (t) => [
    uniqueIndex('e2ee_message_envelopes_message_idx').on(t.clientMessageId),
    uniqueIndex('e2ee_message_envelopes_sender_counter_idx').on(
      t.channelId,
      t.senderDeviceId,
      t.senderKeyId,
      t.counter
    ),
    index('e2ee_message_envelopes_channel_epoch_idx').on(t.channelId, t.epoch),
    index('e2ee_message_envelopes_channel_created_idx').on(t.channelId, t.createdAt)
  ]
);

const messages = sqliteTable(
  'messages',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    content: text('content'),
    userId: integer('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    channelId: integer('channel_id')
      .notNull()
      .references(() => channels.id, { onDelete: 'cascade' }),
    parentMessageId: integer('parent_message_id').references(
      (): AnySQLiteColumn => messages.id,
      { onDelete: 'set null' }
    ),
    editable: integer('editable', { mode: 'boolean' }).default(true),
    metadata: text('metadata', { mode: 'json' }).$type<TMessageMetadata[]>(),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at')
  },
  (t) => [
    index('messages_user_idx').on(t.userId),
    index('messages_channel_idx').on(t.channelId),
    index('messages_parent_idx').on(t.parentMessageId),
    index('messages_created_idx').on(t.createdAt),
    index('messages_parent_created_idx').on(t.parentMessageId, t.createdAt),
    index('messages_channel_created_idx').on(t.channelId, t.createdAt)
  ]
);

const messageFiles = sqliteTable(
  'message_files',
  {
    messageId: integer('message_id')
      .notNull()
      .references(() => messages.id, { onDelete: 'cascade' }),
    fileId: integer('file_id')
      .notNull()
      .references(() => files.id, { onDelete: 'cascade' }),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at')
  },
  (t) => [
    primaryKey({ columns: [t.messageId, t.fileId] }),
    index('message_files_msg_idx').on(t.messageId),
    index('message_files_file_idx').on(t.fileId)
  ]
);

const rolePermissions = sqliteTable(
  'role_permissions',
  {
    roleId: integer('role_id')
      .notNull()
      .references(() => roles.id, { onDelete: 'cascade' }),
    permission: text('permission').notNull(),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at')
  },
  (t) => [
    primaryKey({ columns: [t.roleId, t.permission] }),
    index('role_permissions_role_idx').on(t.roleId),
    index('role_permissions_permission_idx').on(t.permission)
  ]
);

const emojis = sqliteTable(
  'emojis',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    name: text('name').notNull().unique(),
    fileId: integer('file_id')
      .notNull()
      .references(() => files.id, { onDelete: 'cascade' }),
    userId: integer('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at')
  },
  (t) => [
    index('emojis_user_idx').on(t.userId),
    index('emojis_file_idx').on(t.fileId),
    uniqueIndex('emojis_name_idx').on(t.name)
  ]
);

const messageReactions = sqliteTable(
  'message_reactions',
  {
    messageId: integer('message_id')
      .notNull()
      .references(() => messages.id, { onDelete: 'cascade' }),
    userId: integer('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    emoji: text('emoji').notNull(),
    fileId: integer('file_id').references(() => files.id, {
      onDelete: 'set null'
    }),
    createdAt: integer('created_at').notNull()
  },
  (t) => [
    primaryKey({ columns: [t.messageId, t.userId, t.emoji] }),
    index('reaction_msg_idx').on(t.messageId),
    index('reaction_emoji_idx').on(t.emoji),
    index('reaction_user_idx').on(t.userId),
    index('reaction_msg_emoji_idx').on(t.messageId, t.emoji)
  ]
);

const invites = sqliteTable(
  'invites',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    code: text('code').notNull().unique(),
    creatorId: integer('creator_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    maxUses: integer('max_uses'),
    uses: integer('uses').notNull().default(0),
    expiresAt: integer('expires_at'),
    createdAt: integer('created_at').notNull()
  },
  (t) => [
    uniqueIndex('invites_code_idx').on(t.code),
    index('invites_creator_idx').on(t.creatorId),
    index('invites_expires_idx').on(t.expiresAt),
    index('invites_uses_idx').on(t.uses)
  ]
);

const activityLog = sqliteTable(
  'activity_log',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    userId: integer('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    type: text('type').notNull(),
    details: text('details', { mode: 'json' }).$type<
      TActivityLogDetailsMap[keyof TActivityLogDetailsMap]
    >(),
    ip: text('ip'),
    createdAt: integer('created_at').notNull()
  },
  (t) => [
    index('activity_log_user_idx').on(t.userId),
    index('activity_log_type_idx').on(t.type),
    index('activity_log_created_idx').on(t.createdAt),
    index('activity_log_user_created_idx').on(t.userId, t.createdAt),
    index('activity_log_type_created_idx').on(t.type, t.createdAt)
  ]
);

const channelRolePermissions = sqliteTable(
  'channel_role_permissions',
  {
    channelId: integer('channel_id')
      .notNull()
      .references(() => channels.id, { onDelete: 'cascade' }),
    roleId: integer('role_id')
      .notNull()
      .references(() => roles.id, { onDelete: 'cascade' }),
    permission: text('permission').notNull(),
    allow: integer('allow', { mode: 'boolean' }).notNull(),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at')
  },
  (t) => [
    primaryKey({ columns: [t.channelId, t.roleId, t.permission] }),
    index('channel_role_permissions_channel_idx').on(t.channelId),
    index('channel_role_permissions_role_idx').on(t.roleId),
    index('channel_role_permissions_channel_perm_idx').on(
      t.channelId,
      t.permission
    ),
    index('channel_role_permissions_role_perm_idx').on(t.roleId, t.permission),
    index('channel_role_permissions_allow_idx').on(t.allow)
  ]
);

const channelUserPermissions = sqliteTable(
  'channel_user_permissions',
  {
    channelId: integer('channel_id')
      .notNull()
      .references(() => channels.id, { onDelete: 'cascade' }),
    userId: integer('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    permission: text('permission').notNull(),
    allow: integer('allow', { mode: 'boolean' }).notNull(),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at')
  },
  (t) => [
    primaryKey({ columns: [t.channelId, t.userId, t.permission] }),
    index('channel_user_permissions_channel_idx').on(t.channelId),
    index('channel_user_permissions_user_idx').on(t.userId),
    index('channel_user_permissions_channel_perm_idx').on(
      t.channelId,
      t.permission
    ),
    index('channel_user_permissions_user_perm_idx').on(t.userId, t.permission),
    index('channel_user_permissions_allow_idx').on(t.allow)
  ]
);

const channelReadStates = sqliteTable(
  'channel_read_states',
  {
    userId: integer('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    channelId: integer('channel_id')
      .notNull()
      .references(() => channels.id, { onDelete: 'cascade' }),
    lastReadMessageId: integer('last_read_message_id').references(
      () => messages.id,
      { onDelete: 'set null' }
    ),
    lastReadAt: integer('last_read_at').notNull()
  },
  (t) => [
    primaryKey({ columns: [t.userId, t.channelId] }),
    index('channel_read_states_user_idx').on(t.userId),
    index('channel_read_states_channel_idx').on(t.channelId),
    index('channel_read_states_last_read_idx').on(t.lastReadMessageId)
  ]
);

const pluginData = sqliteTable('plugin_data', {
  pluginId: text('plugin_id').notNull().primaryKey(),
  enabled: integer('enabled', { mode: 'boolean' }).notNull().default(false),
  settings: text('settings', { mode: 'json' })
    .$type<Record<string, unknown>>()
    .notNull()
    .default({})
});

export {
  activityLog,
  categories,
  channelReadStates,
  channelRolePermissions,
  channels,
  channelUserPermissions,
  emojis,
  files,
  invites,
  logins,
  messageFiles,
  messageReactions,
  messages,
  authSessionRefreshTokens,
  authSessions,
  authIdentities,
  channelEpochDeviceEnvelopes,
  channelStateCommitments,
  deviceAuthorizations,
  devicePrekeys,
  e2eeDevices,
  e2eeMessageEnvelopes,
  replayWindows,
  oauthStates,
  senderNonceAllocators,
  userRootKeys,
  userDevices,
  pluginData,
  rolePermissions,
  roles,
  settings,
  userRoles,
  users
};
