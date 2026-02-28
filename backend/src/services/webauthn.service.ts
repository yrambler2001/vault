import fs from 'fs/promises';
import path from 'path';
import { atomicWrite } from '../utils/atomic-write';
import { logger } from '../utils/logger';
import { WebAuthnStore, DeviceRegistration } from '../types/webauthn';

const CONFIG_DIR = path.join(__dirname, '../../data/config');
const WEBAUTHN_FILE = path.join(CONFIG_DIR, 'webauthn-devices.json');

const MAX_DEVICES = 10;

const ensureDir = async (): Promise<void> => {
  await fs.mkdir(CONFIG_DIR, { recursive: true });
};

export const webauthnStoreExists = async (): Promise<boolean> => {
  try {
    await fs.access(WEBAUTHN_FILE);
    return true;
  } catch {
    return false;
  }
};

export const getStore = async (): Promise<WebAuthnStore | null> => {
  try {
    const content = await fs.readFile(WEBAUTHN_FILE, 'utf8');
    return JSON.parse(content);
  } catch {
    return null;
  }
};

const saveStore = async (store: WebAuthnStore): Promise<void> => {
  await ensureDir();
  store.updatedAt = new Date().toISOString();
  await atomicWrite(WEBAUTHN_FILE, store);
};

export const initStore = async (vaultId: string): Promise<WebAuthnStore> => {
  const existing = await getStore();
  if (existing && existing.vaultId === vaultId) return existing;

  const store: WebAuthnStore = {
    vaultId,
    devices: {},
    maxDevices: MAX_DEVICES,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  await saveStore(store);
  logger.info('WebAuthn store initialized');
  return store;
};

export const addDevice = async (vaultId: string, device: DeviceRegistration): Promise<void> => {
  let store = await getStore();
  if (!store) {
    store = await initStore(vaultId);
  }

  if (store.vaultId !== vaultId) {
    throw new Error('Vault ID mismatch');
  }

  const deviceCount = Object.keys(store.devices).length;
  if (deviceCount >= store.maxDevices) {
    throw new Error(`Maximum device limit reached (${store.maxDevices})`);
  }

  for (const existing of Object.values(store.devices)) {
    if (existing.credentialId === device.credentialId) {
      throw new Error('This credential is already registered');
    }
  }

  store.devices[device.slotId] = device;
  await saveStore(store);
  logger.info(`WebAuthn device added: ${device.name} (${device.slotId})`);
};

export const removeDevice = async (vaultId: string, slotId: string): Promise<void> => {
  const store = await getStore();
  if (!store || store.vaultId !== vaultId) {
    throw new Error('WebAuthn store not found or vault mismatch');
  }

  if (!store.devices[slotId]) {
    throw new Error('Device not found');
  }

  delete store.devices[slotId];
  await saveStore(store);
  logger.info(`WebAuthn device removed: ${slotId}`);
};

export const getDevice = async (vaultId: string, slotId: string): Promise<DeviceRegistration | null> => {
  const store = await getStore();
  if (!store || store.vaultId !== vaultId) return null;
  return store.devices[slotId] || null;
};

export const getDeviceByCredentialId = async (vaultId: string, credentialId: string): Promise<DeviceRegistration | null> => {
  const store = await getStore();
  if (!store || store.vaultId !== vaultId) return null;

  for (const device of Object.values(store.devices)) {
    if (device.credentialId === credentialId) {
      return device;
    }
  }
  return null;
};

export const listDevices = async (vaultId: string): Promise<DeviceRegistration[]> => {
  const store = await getStore();
  if (!store || store.vaultId !== vaultId) return [];
  return Object.values(store.devices);
};

export const updateLastUsed = async (vaultId: string, slotId: string): Promise<void> => {
  const store = await getStore();
  if (!store || store.vaultId !== vaultId) return;

  const device = store.devices[slotId];
  if (!device) return;

  device.lastUsedAt = new Date().toISOString();
  await saveStore(store);
};

export const updateCounter = async (vaultId: string, credentialId: string, newCounter: number): Promise<void> => {
  const store = await getStore();
  if (!store || store.vaultId !== vaultId) return;

  for (const device of Object.values(store.devices)) {
    if (device.credentialId === credentialId) {
      device.counter = newCounter;
      device.lastUsedAt = new Date().toISOString();
      break;
    }
  }

  await saveStore(store);
};
