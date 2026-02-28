/**
 * Vault-level WebAuthn device management.
 *
 * These devices are used for vault ENCRYPTION key derivation via PRF.
 * They are separate from API-level WebAuthn (which handles server access).
 *
 * SECURITY NOTE: Master password verification during device registration
 * is performed client-side. The client derives the KEK, unwraps the DEK,
 * and wraps the DEK with the new PRF-derived key. The server trusts the
 * client's attestation that the master password was verified, because:
 *
 *   1. The user already holds a valid authenticated session
 *   2. If the wrong master password was used, the wrapped DEK would be
 *      invalid and biometric unlock would simply fail
 *   3. Server-side verification would require the server to learn
 *      information about the master password, violating the zero-knowledge
 *      architecture
 *
 * The worst case of a "fake" registration is a non-functional biometric
 * device that cannot unlock the vault.
 */

import { Router, Request, Response } from 'express';
import crypto from 'crypto';
import { z } from 'zod';
import { generateRegistrationOptions, verifyRegistrationResponse } from '@simplewebauthn/server';
import type { RegistrationResponseJSON } from '@simplewebauthn/server';
import { validate } from '../middleware/validate';
import { withWriteLock } from '../middleware/concurrency';
import { writeLimiter } from '../middleware/rate-limiters';
import * as webauthnService from '../services/webauthn.service';
import * as vaultService from '../services/vault.service';
import { logger } from '../utils/logger';

export const webauthnRouter = Router();

const getRP = () => ({
  id: process.env.WEBAUTHN_RP_ID || 'localhost',
  name: process.env.WEBAUTHN_RP_NAME || 'Secure Vault',
  origin: process.env.WEBAUTHN_ORIGIN || 'https://localhost:5173',
});

// ── Schemas ──

const RegisterDeviceSchema = z.object({
  name: z.string().min(1).max(100),
  challengeId: z.string().min(1),
  attestationResponse: z.any(),
  prfSalt: z.string().min(1),
  wrappedDEK: z.object({
    iv: z.string().min(1),
    wrappedDEK: z.string().min(1),
  }),
});

const RemoveDeviceSchema = z.object({
  slotId: z.string().min(1),
});

// ── Challenge store ──

const registerChallenges = new Map<string, { challenge: string; vaultId: string; expiresAt: number }>();

setInterval(() => {
  const now = Date.now();
  for (const [key, val] of registerChallenges) {
    if (val.expiresAt < now) registerChallenges.delete(key);
  }
}, 60_000);

// ── Registration Options ──

webauthnRouter.get('/register-options', async (_req: Request, res: Response): Promise<void> => {
  try {
    const vault = await vaultService.getVault();
    const devices = await webauthnService.listDevices(vault.meta.vaultId);
    const rp = getRP();

    if (devices.length >= 10) {
      res.status(400).json({ error: 'Maximum device limit reached (10)' });
      return;
    }

    const options = await generateRegistrationOptions({
      rpName: rp.name,
      rpID: rp.id,
      userName: 'vault-user',
      userDisplayName: 'Vault User',
      attestationType: 'none',
      excludeCredentials: devices.map((d) => ({
        id: d.credentialId,
        transports: (d.transports || ['internal']) as AuthenticatorTransport[],
      })),
      authenticatorSelection: {
        authenticatorAttachment: 'platform',
        userVerification: 'required',
        residentKey: 'preferred',
      },
      extensions: {} as Record<string, unknown>,
    });

    const challengeId = crypto.randomBytes(16).toString('hex');
    registerChallenges.set(challengeId, {
      challenge: options.challenge,
      vaultId: vault.meta.vaultId,
      expiresAt: Date.now() + 5 * 60 * 1000,
    });

    res.json({ challengeId, options });
  } catch (err) {
    logger.error('Failed to generate register options', err);
    res.status(500).json({ error: 'Failed to generate registration options' });
  }
});

// ── Register Device ──

webauthnRouter.post('/register', writeLimiter, validate(RegisterDeviceSchema), withWriteLock(), async (req: Request, res: Response): Promise<void> => {
  const release = res.locals.releaseWriteLock as () => void;
  try {
    const vault = await vaultService.getVault();
    const { name, challengeId, attestationResponse, prfSalt, wrappedDEK } = req.body;
    const rp = getRP();

    // Verify challenge
    const stored = registerChallenges.get(challengeId);
    if (!stored || stored.expiresAt < Date.now()) {
      registerChallenges.delete(challengeId);
      res.status(400).json({ error: 'Challenge expired or invalid' });
      return;
    }
    if (stored.vaultId !== vault.meta.vaultId) {
      res.status(400).json({ error: 'Vault ID mismatch' });
      return;
    }
    registerChallenges.delete(challengeId);

    const verification = await verifyRegistrationResponse({
      response: attestationResponse as RegistrationResponseJSON,
      expectedChallenge: stored.challenge,
      expectedOrigin: rp.origin,
      expectedRPID: rp.id,
      requireUserVerification: true,
    });

    if (!verification.verified || !verification.registrationInfo) {
      res.status(400).json({ error: 'WebAuthn verification failed' });
      return;
    }

    const { credential } = verification.registrationInfo;
    const slotId = `prf_${crypto.randomBytes(8).toString('hex')}`;

    const device = {
      slotId,
      name,
      credentialId: credential.id,
      credentialPublicKey: Buffer.from(credential.publicKey).toString('base64'),
      prfSalt,
      counter: credential.counter,
      transports: (attestationResponse as RegistrationResponseJSON).response.transports || [],
      registeredAt: new Date().toISOString(),
      lastUsedAt: null,
    };

    await webauthnService.addDevice(vault.meta.vaultId, device);

    vault.keys[slotId] = wrappedDEK;
    const result = await vaultService.saveVault(vault);

    logger.info(`WebAuthn device registered: ${name} (${slotId})`);

    res.json({
      success: true,
      slotId,
      vaultVersion: result.version,
    });
  } catch (err: unknown) {
    logger.error('WebAuthn registration failed', err);
    const message = err instanceof Error ? err.message : 'unknown';
    if (message.includes('Maximum device limit')) {
      res.status(400).json({ error: 'Maximum device limit reached' });
      return;
    }
    if (message.includes('already registered')) {
      res.status(409).json({ error: 'Credential already registered' });
      return;
    }
    res.status(500).json({ error: 'Registration failed' });
  } finally {
    release();
  }
});

// ── Remove Device ──

webauthnRouter.post('/remove', writeLimiter, validate(RemoveDeviceSchema), withWriteLock(), async (req: Request, res: Response): Promise<void> => {
  const release = res.locals.releaseWriteLock as () => void;
  try {
    const vault = await vaultService.getVault();
    const { slotId } = req.body;

    if (slotId === 'master_password') {
      res.status(400).json({ error: 'Cannot remove master password key slot' });
      return;
    }

    await webauthnService.removeDevice(vault.meta.vaultId, slotId);

    delete vault.keys[slotId];
    const result = await vaultService.saveVault(vault);

    logger.info(`WebAuthn device removed: ${slotId}`);

    res.json({
      success: true,
      vaultVersion: result.version,
    });
  } catch (err: unknown) {
    logger.error('WebAuthn device removal failed', err);
    res.status(500).json({ error: 'Device removal failed' });
  } finally {
    release();
  }
});

// ── List Devices ──

webauthnRouter.get('/devices', async (_req: Request, res: Response): Promise<void> => {
  try {
    const vault = await vaultService.getVault();
    const devices = await webauthnService.listDevices(vault.meta.vaultId);

    const safeDevices = devices.map((d) => ({
      slotId: d.slotId,
      name: d.name,
      credentialId: d.credentialId,
      registeredAt: d.registeredAt,
      lastUsedAt: d.lastUsedAt,
    }));

    res.json({ devices: safeDevices, maxDevices: 10 });
  } catch (err) {
    logger.error('Failed to list WebAuthn devices', err);
    res.status(500).json({ error: 'Failed to list devices' });
  }
});

// ── Auth Options (for unlock — returns credential IDs and PRF salts) ──

webauthnRouter.get('/auth-options', async (_req: Request, res: Response): Promise<void> => {
  try {
    const vault = await vaultService.getVault();
    const devices = await webauthnService.listDevices(vault.meta.vaultId);
    const rp = getRP();

    if (devices.length === 0) {
      res.status(404).json({ error: 'No biometric devices registered' });
      return;
    }

    const credentials = devices.map((d) => ({
      slotId: d.slotId,
      credentialId: d.credentialId,
      prfSalt: d.prfSalt,
    }));

    res.json({
      rpId: rp.id,
      credentials,
    });
  } catch (err) {
    logger.error('Failed to get auth options', err);
    res.status(500).json({ error: 'Failed to get auth options' });
  }
});

// ── Touch (update last used) ──

webauthnRouter.post('/touch', async (req: Request, res: Response): Promise<void> => {
  try {
    const { slotId } = req.body;
    if (!slotId) {
      res.status(400).json({ error: 'Missing slotId' });
      return;
    }

    const vault = await vaultService.getVault();
    await webauthnService.updateLastUsed(vault.meta.vaultId, slotId);
    res.json({ success: true });
  } catch {
    res.status(500).json({ error: 'Failed to update' });
  }
});
