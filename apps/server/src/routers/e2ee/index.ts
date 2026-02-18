import { t } from '../../utils/trpc';
import { claimPrekeyRoute } from './claim-prekey';
import { getEnvelopesRoute } from './get-envelopes';
import { getIdentityBootstrapRoute } from './get-identity-bootstrap';
import { getLatestChannelStateRoute } from './get-latest-channel-state';
import { getUserAuthorizedDevicesRoute } from './get-user-authorized-devices';
import { publishChannelEpochRoute } from './publish-channel-epoch';
import { registerDeviceRoute } from './register-device';
import { requestKeyCatchupRoute } from './request-key-catchup';
import { reserveNonceBlockRoute } from './reserve-nonce-block';
import { revokeDeviceRoute } from './revoke-device';
import { sendEncryptedMessageRoute } from './send-encrypted-message';
import { submitEnvelopeRoute } from './submit-envelope';
import { uploadPrekeysRoute } from './upload-prekeys';

export const e2eeRouter = t.router({
  registerDevice: registerDeviceRoute,
  uploadPrekeys: uploadPrekeysRoute,
  claimPrekey: claimPrekeyRoute,
  reserveNonceBlock: reserveNonceBlockRoute,
  submitEnvelope: submitEnvelopeRoute,
  sendEncryptedMessage: sendEncryptedMessageRoute,
  revokeDevice: revokeDeviceRoute,
  publishChannelEpoch: publishChannelEpochRoute,
  requestKeyCatchup: requestKeyCatchupRoute,
  getEnvelopes: getEnvelopesRoute,
  getIdentityBootstrap: getIdentityBootstrapRoute,
  getLatestChannelState: getLatestChannelStateRoute,
  getUserAuthorizedDevices: getUserAuthorizedDevicesRoute
});
