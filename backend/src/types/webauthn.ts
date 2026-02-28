export interface DeviceRegistration {
  slotId: string;
  name: string;
  credentialId: string;
  credentialPublicKey: string;
  prfSalt: string;
  counter: number;
  transports?: string[];
  registeredAt: string;
  lastUsedAt: string | null;
}

export interface WebAuthnStore {
  vaultId: string;
  devices: Record<string, DeviceRegistration>;
  maxDevices: number;
  createdAt: string;
  updatedAt: string;
}
