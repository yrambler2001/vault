/**
 * API-level WebAuthn authentication.
 *
 * This is SEPARATE from vault WebAuthn (which handles vault encryption keys).
 * API WebAuthn protects server access — it's an alternative to the API key.
 *
 * Storage: data/config/api-webauthn.json
 */

import fs from 'fs/promises';
import path from 'path';
import { atomicWrite } from '../utils/atomic-write';
import { logger } from '../utils/logger';
import { ApiAuthStore, ApiWebAuthnCredential } from '../types/api-auth';

const CONFIG_DIR = path.join(__dirname, '../../data/config');
const API_WEBAUTHN_FILE = path.join(CONFIG_DIR, 'api-webauthn.json');

const MAX_CREDENTIALS = 10;

const ensureDir = async (): Promise<void> => {
  await fs.mkdir(CONFIG_DIR, { recursive: true });
};

export const storeExists = async (): Promise<boolean> => {
  try {
    await fs.access(API_WEBAUTHN_FILE);
    return true;
  } catch {
    return false;
  }
};

export const getStore = async (): Promise<ApiAuthStore | null> => {
  try {
    const content = await fs.readFile(API_WEBAUTHN_FILE, 'utf8');
    return JSON.parse(content);
  } catch {
    return null;
  }
};

const saveStore = async (store: ApiAuthStore): Promise<void> => {
  await ensureDir();
  store.updatedAt = new Date().toISOString();
  await atomicWrite(API_WEBAUTHN_FILE, store);
};

export const initStore = async (): Promise<ApiAuthStore> => {
  const existing = await getStore();
  if (existing) return existing;

  const store: ApiAuthStore = {
    credentials: {},
    maxCredentials: MAX_CREDENTIALS,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  await saveStore(store);
  logger.info('API WebAuthn store initialized');
  return store;
};

export const addCredential = async (id: string, credential: ApiWebAuthnCredential): Promise<void> => {
  let store = await getStore();
  if (!store) {
    store = await initStore();
  }

  const count = Object.keys(store.credentials).length;
  if (count >= store.maxCredentials) {
    throw new Error(`Maximum API credential limit reached (${store.maxCredentials})`);
  }

  for (const existing of Object.values(store.credentials)) {
    if (existing.credentialId === credential.credentialId) {
      throw new Error('This credential is already registered');
    }
  }

  store.credentials[id] = credential;
  await saveStore(store);
  logger.info(`API WebAuthn credential added: ${credential.name} (${id})`);
};

export const removeCredential = async (id: string): Promise<void> => {
  const store = await getStore();
  if (!store) throw new Error('API WebAuthn store not found');
  if (!store.credentials[id]) throw new Error('Credential not found');

  delete store.credentials[id];
  await saveStore(store);
  logger.info(`API WebAuthn credential removed: ${id}`);
};

export const getCredential = async (credentialId: string): Promise<(ApiWebAuthnCredential & { storeKey: string }) | null> => {
  const store = await getStore();
  if (!store) return null;

  for (const [key, cred] of Object.entries(store.credentials)) {
    if (cred.credentialId === credentialId) {
      return { ...cred, storeKey: key };
    }
  }
  return null;
};

export const updateCounter = async (credentialId: string, newCounter: number): Promise<void> => {
  const store = await getStore();
  if (!store) return;

  for (const cred of Object.values(store.credentials)) {
    if (cred.credentialId === credentialId) {
      cred.counter = newCounter;
      cred.lastUsedAt = new Date().toISOString();
      break;
    }
  }

  await saveStore(store);
};

export const listCredentials = async (): Promise<ApiWebAuthnCredential[]> => {
  const store = await getStore();
  if (!store) return [];
  return Object.values(store.credentials);
};
