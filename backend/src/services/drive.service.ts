import fs from 'fs/promises';
import path from 'path';
import crypto from 'crypto';
import { logger } from '../utils/logger';

/**
 * USB Drive Backup Service
 *
 * DESIGN DECISIONS:
 *
 * 1. Vault data written to USB drives includes the full VaultDocument:
 *    metadata (vaultId, passwordSalt, kdfParams) + wrapped keys + encrypted data.
 *    This is BY DESIGN — the USB drives serve as complete backup replicas
 *    that can restore the vault independently. The actual password entries
 *    are encrypted with AES-256-GCM inside `data.ciphertext`. The metadata
 *    and wrapped keys are necessary for decryption and cannot be omitted.
 *    These USB drives are intended to be used as fixed backup storage
 *    (like internal hard drives), NOT as removable media carried around.
 *
 * 2. Version pruning on USB drives is NOT performed automatically.
 *    USB drives are intended as long-term archival storage. The 64GB capacity
 *    is more than sufficient for vault version history (each version is
 *    typically a few KB). Manual cleanup can be done if needed.
 *    This is BY DESIGN — preserving full history on USB provides recovery
 *    options that pruning would eliminate.
 *
 * 3. Sync does NOT verify cross-drive checksum consistency for same versions.
 *    If two drives have the same version number, sync assumes they are
 *    identical and skips. This is BY DESIGN for simplicity — the integrity
 *    verification endpoint (`/drives/verify/:label`) can be used manually
 *    to detect corruption. Automatic cross-drive verification would add
 *    significant complexity for a rare edge case.
 *
 * 4. Drive paths are pre-configured via VAULT_DRIVES environment variable.
 *    The application does NOT auto-detect or scan for drives.
 */

const VAULT_MARKER = '.vault-id';

export interface DriveConfig {
  label: string;
  path: string;
}

export interface DriveInfo {
  label: string;
  configuredPath: string;
  vaultId: string | null;
  healthy: boolean;
  accessible: boolean;
  lastSync: string | null;
  versionCount: number;
}

export interface VaultVersion {
  filename: string;
  version: number;
  timestamp: string;
  checksum: string;
  checksumSource: 'sidecar' | 'computed';
}

/**
 * Parse VAULT_DRIVES env var.
 * Format: "Label1:/path/to/folder1,Label2:/path/to/folder2"
 *
 * Windows example: "USB1:E:\secure-vault,USB2:F:\secure-vault"
 * Linux example:   "USB1:/mnt/usb1/secure-vault,USB2:/mnt/usb2/secure-vault"
 *
 * Strategy: label is everything before the first ':', path is the rest.
 * This correctly handles Windows paths (e.g., "USB1:E:\foo" → label="USB1", path="E:\foo").
 */
export const getConfiguredDrives = (): DriveConfig[] => {
  const raw = process.env.VAULT_DRIVES || '';
  if (!raw.trim()) return [];

  return raw
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => {
      const colonIdx = entry.indexOf(':');
      if (colonIdx <= 0) {
        logger.warn(`Invalid VAULT_DRIVES entry (no label): "${entry}"`);
        return null;
      }
      const label = entry.substring(0, colonIdx).trim();
      const drivePath = entry.substring(colonIdx + 1).trim();
      if (!drivePath) {
        logger.warn(`Invalid VAULT_DRIVES entry (no path): "${entry}"`);
        return null;
      }
      return { label, path: drivePath };
    })
    .filter((d): d is DriveConfig => d !== null);
};

/**
 * Validate configured drive paths at startup.
 * Rejects paths that point to filesystem roots or contain traversal components.
 */
export const validateDrivePaths = (): void => {
  const drives = getConfiguredDrives();
  const seen = new Set<string>();

  for (const d of drives) {
    const resolved = path.resolve(d.path);
    const root = path.parse(resolved).root;

    // Reject filesystem root
    if (resolved === root) {
      throw new Error(`VAULT_DRIVES: "${d.label}" path "${d.path}" resolves to filesystem root "${root}". ` + `This is not allowed — use a subdirectory.`);
    }

    // Reject paths containing .. after resolution (double-check)
    if (d.path.includes('..')) {
      throw new Error(`VAULT_DRIVES: "${d.label}" path "${d.path}" contains ".." — use an absolute path.`);
    }

    // Reject duplicate paths
    if (seen.has(resolved)) {
      throw new Error(`VAULT_DRIVES: "${d.label}" path "${d.path}" resolves to "${resolved}" ` + `which is already configured for another drive.`);
    }
    seen.add(resolved);
  }

  if (drives.length > 0) {
    logger.info(`Validated ${drives.length} configured drive paths`);
  }
};

const assertConfiguredPath = (targetPath: string): void => {
  const configured = getConfiguredDrives();
  const normalized = path.resolve(targetPath);
  const isConfigured = configured.some((d) => path.resolve(d.path) === normalized);
  if (!isConfigured) {
    throw new Error(`Path "${targetPath}" is not in the configured VAULT_DRIVES list.`);
  }
};

const isDriveAccessible = async (drivePath: string): Promise<boolean> => {
  try {
    await fs.access(drivePath);
    return true;
  } catch {
    return false;
  }
};

export const initializeDrive = async (drivePath: string, vaultId: string): Promise<void> => {
  assertConfiguredPath(drivePath);

  const versionsDir = path.join(drivePath, 'versions');

  await fs.mkdir(versionsDir, { recursive: true });
  await fs.writeFile(
    path.join(drivePath, VAULT_MARKER),
    JSON.stringify(
      {
        vaultId,
        initializedAt: new Date().toISOString(),
      },
      null,
      2,
    ),
  );

  logger.info(`Initialized drive ${drivePath} for vault ${vaultId}`);
};

export const listVersions = async (drivePath: string): Promise<VaultVersion[]> => {
  const versionsDir = path.join(drivePath, 'versions');

  try {
    const files = await fs.readdir(versionsDir);
    const versions: VaultVersion[] = [];

    for (const file of files.filter((f) => f.endsWith('.json') && !f.endsWith('.sha256'))) {
      const match = file.match(/^v(\d+)_(.+)\.json$/);
      if (match) {
        let checksum = '';
        let checksumSource: 'sidecar' | 'computed' = 'computed';

        try {
          checksum = (await fs.readFile(path.join(versionsDir, `${file}.sha256`), 'utf8')).trim();
          checksumSource = 'sidecar';
        } catch {
          const content = await fs.readFile(path.join(versionsDir, file), 'utf8');
          checksum = crypto.createHash('sha256').update(content).digest('hex');
          checksumSource = 'computed';
        }

        versions.push({
          filename: file,
          version: parseInt(match[1]),
          timestamp: match[2],
          checksum,
          checksumSource,
        });
      }
    }

    return versions.sort((a, b) => a.version - b.version);
  } catch {
    return [];
  }
};

export const getVaultDrives = async (expectedVaultId: string): Promise<DriveInfo[]> => {
  const configured = getConfiguredDrives();
  const results: DriveInfo[] = [];

  for (const drive of configured) {
    const drivePath = drive.path;
    const accessible = await isDriveAccessible(drivePath);

    if (!accessible) {
      results.push({
        label: drive.label,
        configuredPath: drivePath,
        vaultId: null,
        healthy: false,
        accessible: false,
        lastSync: null,
        versionCount: 0,
      });
      continue;
    }

    const markerPath = path.join(drivePath, VAULT_MARKER);

    try {
      const raw = await fs.readFile(markerPath, 'utf8');
      const marker = JSON.parse(raw);

      const versions = await listVersions(drivePath);

      results.push({
        label: drive.label,
        configuredPath: drivePath,
        vaultId: marker.vaultId,
        healthy: marker.vaultId === expectedVaultId,
        accessible: true,
        lastSync: versions.length > 0 ? versions[versions.length - 1].timestamp : null,
        versionCount: versions.length,
      });
    } catch {
      results.push({
        label: drive.label,
        configuredPath: drivePath,
        vaultId: null,
        healthy: false,
        accessible: true,
        lastSync: null,
        versionCount: 0,
      });
    }
  }

  return results;
};

export const writeVersionToDrive = async (drivePath: string, version: number, data: object): Promise<string> => {
  assertConfiguredPath(drivePath);

  const versionsDir = path.join(drivePath, 'versions');
  const timestamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+/, '');
  const filename = `v${String(version).padStart(5, '0')}_${timestamp}.json`;
  const filePath = path.join(versionsDir, filename);

  const content = JSON.stringify(data, null, 2);
  const checksum = crypto.createHash('sha256').update(content).digest('hex');

  await fs.mkdir(versionsDir, { recursive: true });
  await fs.writeFile(filePath, content, 'utf8');
  await fs.writeFile(`${filePath}.sha256`, checksum, 'utf8');

  // Verify the written data
  const written = await fs.readFile(filePath, 'utf8');
  const writtenChecksum = crypto.createHash('sha256').update(written).digest('hex');

  if (writtenChecksum !== checksum) {
    logger.error(`Write verification failed for ${filePath}: ` + `expected ${checksum}, got ${writtenChecksum}`);
    // Attempt to clean up the corrupt file
    await fs.unlink(filePath).catch(() => {});
    await fs.unlink(`${filePath}.sha256`).catch(() => {});
    throw new Error(`Write verification failed for drive at ${drivePath}`);
  }

  logger.debug(`Wrote version ${version} to ${drivePath} (verified)`);
  return filename;
};

export const writeToAllDrives = async (expectedVaultId: string, version: number, data: object): Promise<{ succeeded: string[]; failed: string[] }> => {
  const drives = await getVaultDrives(expectedVaultId);
  const healthyDrives = drives.filter((d) => d.healthy);

  if (healthyDrives.length === 0) {
    logger.warn('No healthy USB drives connected — skipping USB write');
    return { succeeded: [], failed: [] };
  }

  const succeeded: string[] = [];
  const failed: string[] = [];

  await Promise.allSettled(
    healthyDrives.map(async (drive) => {
      try {
        await writeVersionToDrive(drive.configuredPath, version, data);
        succeeded.push(drive.label);
      } catch (err) {
        logger.error(`Failed to write to ${drive.label}`, err);
        failed.push(drive.label);
      }
    }),
  );

  logger.info(`USB write complete: ${succeeded.length} ok, ${failed.length} failed`, { succeeded, failed });

  return { succeeded, failed };
};

export const readLatestFromAnyDrive = async (expectedVaultId: string): Promise<{ data: unknown; version: number; source: string } | null> => {
  const drives = await getVaultDrives(expectedVaultId);
  const healthyDrives = drives.filter((d) => d.healthy).sort((a, b) => b.versionCount - a.versionCount);

  for (const drive of healthyDrives) {
    try {
      const versions = await listVersions(drive.configuredPath);
      if (versions.length === 0) continue;

      const latest = versions[versions.length - 1];
      const filePath = path.join(drive.configuredPath, 'versions', latest.filename);
      const content = await fs.readFile(filePath, 'utf8');

      if (latest.checksumSource === 'sidecar') {
        const actualChecksum = crypto.createHash('sha256').update(content).digest('hex');
        if (actualChecksum !== latest.checksum) {
          logger.error(`Checksum mismatch on ${drive.label}/${latest.filename}`);
          continue;
        }
      } else {
        logger.warn(`No sidecar checksum for ${drive.label}/${latest.filename} — accepting with computed hash`);
      }

      return {
        data: JSON.parse(content),
        version: latest.version,
        source: drive.label,
      };
    } catch (err) {
      logger.error(`Failed to read from ${drive.label}`, err);
      continue;
    }
  }

  return null;
};

export const syncDrive = async (sourcePath: string, targetPath: string): Promise<number> => {
  assertConfiguredPath(sourcePath);
  assertConfiguredPath(targetPath);

  const sourceVersions = await listVersions(sourcePath);
  const targetVersions = await listVersions(targetPath);
  const targetVersionSet = new Set(targetVersions.map((v) => v.version));

  const missing = sourceVersions.filter((v) => !targetVersionSet.has(v.version));

  for (const ver of missing) {
    const sourceFilePath = path.join(sourcePath, 'versions', ver.filename);
    const targetDir = path.join(targetPath, 'versions');
    const targetFilePath = path.join(targetDir, ver.filename);

    await fs.mkdir(targetDir, { recursive: true });
    await fs.copyFile(sourceFilePath, targetFilePath);

    try {
      await fs.copyFile(`${sourceFilePath}.sha256`, `${targetFilePath}.sha256`);
    } catch {
      /* sidecar might not exist */
    }
  }

  if (missing.length > 0) {
    logger.info(`Synced ${missing.length} versions from source to target`);
  }
  return missing.length;
};

export const verifyDriveIntegrity = async (
  drivePath: string,
): Promise<{
  total: number;
  valid: number;
  corrupted: string[];
  noSidecar: string[];
}> => {
  assertConfiguredPath(drivePath);

  const versions = await listVersions(drivePath);
  const corrupted: string[] = [];
  const noSidecar: string[] = [];

  for (const ver of versions) {
    if (ver.checksumSource !== 'sidecar') {
      noSidecar.push(ver.filename);
      continue;
    }

    const filePath = path.join(drivePath, 'versions', ver.filename);
    try {
      const content = await fs.readFile(filePath, 'utf8');
      const actualChecksum = crypto.createHash('sha256').update(content).digest('hex');
      if (actualChecksum !== ver.checksum) {
        corrupted.push(ver.filename);
      }
    } catch {
      corrupted.push(ver.filename);
    }
  }

  return {
    total: versions.length,
    valid: versions.length - corrupted.length - noSidecar.length,
    corrupted,
    noSidecar,
  };
};
