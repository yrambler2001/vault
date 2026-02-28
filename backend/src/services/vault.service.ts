import fs from 'fs/promises';
import path from 'path';
import crypto from 'crypto';
import { atomicWrite } from '../utils/atomic-write';
import * as driveService from './drive.service';
import { logger } from '../utils/logger';
import { VaultDocument } from '../types/vault';

const DATA_DIR = path.join(__dirname, '../../data');
const VAULT_FILE = path.join(DATA_DIR, 'vault.json');
const LOCAL_VERSIONS_DIR = path.join(DATA_DIR, 'versions');

const rawMax = parseInt(process.env.MAX_LOCAL_VERSIONS || '50', 10);
const MAX_LOCAL_VERSIONS = Math.max(rawMax, 5);

if (rawMax < 5 && rawMax !== 50) {
  logger.warn(`MAX_LOCAL_VERSIONS=${rawMax} too low, using minimum of 5`);
}

let initPromise: Promise<void> | null = null;

export const ensureDirectories = async (): Promise<void> => {
  if (!initPromise) {
    initPromise = (async () => {
      await fs.mkdir(DATA_DIR, { recursive: true });
      await fs.mkdir(LOCAL_VERSIONS_DIR, { recursive: true });
    })();
  }
  return initPromise;
};

export const getVaultFilePath = () => VAULT_FILE;

export const vaultExists = async (): Promise<boolean> => {
  await ensureDirectories();
  try {
    await fs.access(VAULT_FILE);
    return true;
  } catch {
    return false;
  }
};

export const getVault = async (): Promise<VaultDocument> => {
  await ensureDirectories();
  const content = await fs.readFile(VAULT_FILE, 'utf8');
  return JSON.parse(content);
};

export const createVault = async (data: VaultDocument): Promise<void> => {
  await ensureDirectories();
  await fs.writeFile(VAULT_FILE, JSON.stringify(data, null, 2), {
    flag: 'wx',
  });
  logger.info('Vault created', { vaultId: data.meta.vaultId });
};

/**
 * Save the vault. CALLER MUST HOLD THE WRITE LOCK and release it
 * after this function returns. See withWriteLock() middleware.
 */
export const saveVault = async (
  data: VaultDocument,
): Promise<{
  version: number;
  usbResults: { succeeded: string[]; failed: string[] };
}> => {
  await ensureDirectories();

  // Deep-clone to avoid mutating caller's object
  const vaultToSave: VaultDocument = JSON.parse(JSON.stringify(data));

  // Re-read current version from disk to guarantee monotonicity
  let currentVersion = 0;
  try {
    const current = await getVault();
    currentVersion = current.meta.version;
  } catch {
    /* first write */
  }

  const version = currentVersion + 1;
  vaultToSave.meta.version = version;
  vaultToSave.meta.updatedAt = new Date().toISOString();

  const contentForHash = JSON.stringify({
    keys: vaultToSave.keys,
    data: vaultToSave.data,
  });
  const contentHash = crypto.createHash('sha256').update(contentForHash).digest('hex');
  (vaultToSave.meta as unknown as Record<string, unknown>).contentHash = contentHash;

  // 1. Write to local vault.json
  await atomicWrite(VAULT_FILE, vaultToSave);

  // 2. Write local version snapshot
  const timestamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+/, '');
  const versionFilename = `v${String(version).padStart(5, '0')}_${timestamp}.json`;
  const versionPath = path.join(LOCAL_VERSIONS_DIR, versionFilename);

  const versionContent = JSON.stringify(vaultToSave, null, 2);
  await fs.writeFile(versionPath, versionContent, 'utf8');

  const versionChecksum = crypto.createHash('sha256').update(versionContent).digest('hex');
  await fs.writeFile(`${versionPath}.sha256`, versionChecksum, 'utf8');

  logger.info(`Vault saved: version ${version}`);

  // 3. Write to USB drives (best-effort)
  let usbResults = { succeeded: [] as string[], failed: [] as string[] };
  try {
    usbResults = await driveService.writeToAllDrives(vaultToSave.meta.vaultId, version, vaultToSave);
  } catch (err) {
    logger.error('USB write failed (non-fatal)', err);
  }

  // 4. Prune old local versions
  await pruneLocalVersions(MAX_LOCAL_VERSIONS);

  return { version, usbResults };
};

const pruneLocalVersions = async (keepCount: number) => {
  try {
    const files = (await fs.readdir(LOCAL_VERSIONS_DIR)).filter((f) => f.endsWith('.json') && !f.endsWith('.sha256')).sort();

    if (files.length <= keepCount) return;

    const toDelete = files.slice(0, files.length - keepCount);
    for (const f of toDelete) {
      await fs.unlink(path.join(LOCAL_VERSIONS_DIR, f)).catch(() => {});
      await fs.unlink(path.join(LOCAL_VERSIONS_DIR, `${f}.sha256`)).catch(() => {});
    }

    logger.debug(`Pruned ${toDelete.length} old versions`);
  } catch {
    /* dir might not exist yet */
  }
};
