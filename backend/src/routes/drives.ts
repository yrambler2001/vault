import { Router, Request, Response } from 'express';
import * as driveService from '../services/drive.service';
import * as vaultService from '../services/vault.service';
import { logger } from '../utils/logger';

export const drivesRouter = Router();

/**
 * Resolve the vault ID. Returns null if vault doesn't exist yet.
 * Drive operations require an existing vault — we no longer fall back
 * to a 'default' ID which could cause vault ID mismatches.
 */
const getVaultId = async (): Promise<string | null> => {
  try {
    const vault = await vaultService.getVault();
    return vault.meta.vaultId;
  } catch {
    return null;
  }
};

/**
 * Resolve a label from the request to a configured drive path.
 * Returns null if not found.
 */
const resolveDrivePath = (label: string): string | null => {
  const configured = driveService.getConfiguredDrives();
  const drive = configured.find((d) => d.label.toLowerCase() === label.toLowerCase());
  return drive ? drive.path : null;
};

drivesRouter.get('/status', async (_req: Request, res: Response) => {
  try {
    const vaultId = await getVaultId();
    if (!vaultId) {
      res.status(400).json({ error: 'Vault must be created before checking drive status' });
      return;
    }
    const drives = await driveService.getVaultDrives(vaultId);
    res.json({ drives });
  } catch (err) {
    logger.error('Failed to get drive status', err);
    res.status(500).json({ error: 'Failed to detect drives' });
  }
});

drivesRouter.post('/init/:label', async (req: Request, res: Response): Promise<void> => {
  const label = req.params.label;

  if (typeof label !== 'string') {
    res.status(400).json({ error: 'Invalid drive label parameter' });
    return;
  }

  const drivePath = resolveDrivePath(label);

  if (!drivePath) {
    res.status(400).json({
      error: `Drive label "${label}" is not in the configured VAULT_DRIVES list.`,
    });
    return;
  }

  const vaultId = await getVaultId();
  if (!vaultId) {
    res.status(400).json({ error: 'Vault must be created before initializing drives' });
    return;
  }

  try {
    await driveService.initializeDrive(drivePath, vaultId);
    res.json({ success: true, drive: label });
  } catch (err) {
    logger.error(`Failed to initialize drive ${label}`, err);
    res.status(500).json({ error: `Failed to initialize drive` });
  }
});

drivesRouter.post('/sync', async (_req: Request, res: Response): Promise<void> => {
  const vaultId = await getVaultId();
  if (!vaultId) {
    res.status(400).json({ error: 'Vault must be created before syncing drives' });
    return;
  }

  try {
    const drives = await driveService.getVaultDrives(vaultId);
    const healthy = drives.filter((d) => d.healthy);

    if (healthy.length < 2) {
      res.json({
        message: 'Need at least 2 healthy drives to sync',
        synced: 0,
      });
      return;
    }

    const drivesWithLatest = await Promise.all(
      healthy.map(async (drive) => {
        const versions = await driveService.listVersions(drive.configuredPath);
        const maxVersion = versions.length > 0 ? Math.max(...versions.map((v) => v.version)) : 0;
        return { ...drive, maxVersion };
      }),
    );

    const source = drivesWithLatest.sort((a, b) => b.maxVersion - a.maxVersion)[0];
    let totalSynced = 0;

    for (const target of drivesWithLatest.filter((d) => d.configuredPath !== source.configuredPath)) {
      const count = await driveService.syncDrive(source.configuredPath, target.configuredPath);
      totalSynced += count;
    }

    res.json({
      message: `Synced ${totalSynced} versions`,
      source: source.label,
      totalSynced,
    });
  } catch (err) {
    logger.error('Drive sync failed', err);
    res.status(500).json({ error: 'Sync failed' });
  }
});

drivesRouter.get('/verify/:label', async (req: Request, res: Response): Promise<void> => {
  const label = req.params.label;

  if (typeof label !== 'string') {
    res.status(400).json({ error: 'Invalid drive label parameter' });
    return;
  }

  const drivePath = resolveDrivePath(label);

  if (!drivePath) {
    res.status(400).json({
      error: `Drive label "${label}" is not in the configured VAULT_DRIVES list.`,
    });
    return;
  }

  try {
    const result = await driveService.verifyDriveIntegrity(drivePath);
    res.json(result);
  } catch (err) {
    logger.error(`Drive integrity check failed for ${label}`, err);
    res.status(500).json({ error: 'Integrity check failed' });
  }
});
