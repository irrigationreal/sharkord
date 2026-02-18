type TE2EEDeviceState = {
  deviceId: string | null;
  deviceSeq: number | null;
  arkVersion: number | null;
  registeredAt: number | null;
  revokedAt: number | null;
};

const initialE2EEDeviceState: TE2EEDeviceState = {
  deviceId: null,
  deviceSeq: null,
  arkVersion: null,
  registeredAt: null,
  revokedAt: null
};

export { initialE2EEDeviceState };
export type { TE2EEDeviceState };
