import fs from 'fs/promises';
import path from 'path';
import { atomicWrite } from '../utils/atomic-write';
import { logger } from '../utils/logger';

const CONFIG_DIR = path.join(__dirname, '../../data/config');
const CONFIG_FILE = path.join(CONFIG_DIR, 'config.json');

export interface AppConfig {
  /**
   * Server-side Argon2id hash of the client-side Argon2id hash.
   * Double-hashing: client computes Argon2id(apiKey, salt) → sends hash →
   * server computes Argon2id(clientHash, serverSalt) → stores result.
   */
  apiKeyVerifier: string;
  /** Salt used by the CLIENT for the first Argon2id pass */
  apiKeySalt: string;
  apiKeyKdfParams: {
    algorithm: 'argon2id';
    parallelism: number;
    iterations: number;
    memorySize: number;
    hashLength: number;
  };
  createdAt: string;
}

export const ensureConfigDir = async (): Promise<void> => {
  await fs.mkdir(CONFIG_DIR, { recursive: true });
};

export const configExists = async (): Promise<boolean> => {
  try {
    await fs.access(CONFIG_FILE);
    return true;
  } catch {
    return false;
  }
};

export const getConfig = async (): Promise<AppConfig | null> => {
  try {
    const content = await fs.readFile(CONFIG_FILE, 'utf8');
    return JSON.parse(content);
  } catch {
    return null;
  }
};

export const saveConfig = async (config: AppConfig): Promise<void> => {
  await ensureConfigDir();

  const exists = await configExists();
  if (exists) {
    throw new Error('Config already exists');
  }

  await atomicWrite(CONFIG_FILE, config);
  logger.info('Config saved');
};
