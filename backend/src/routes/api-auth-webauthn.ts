/**
 * API-level WebAuthn authentication routes.
 *
 * These credentials protect SERVER ACCESS (like the API key).
 * They are completely separate from vault WebAuthn devices
 * (which protect vault encryption).
 *
 * Flow:
 *   1. User must first be authenticated (via API key session)
 *   2. User registers a WebAuthn credential for API auth
 *   3. On future logins, user can authenticate with WebAuthn instead of API key
 */

import { Router, Request, Response } from 'express';
import crypto from 'crypto';
import { z } from 'zod';
import { generateRegistrationOptions, verifyRegistrationResponse, generateAuthenticationOptions, verifyAuthenticationResponse } from '@simplewebauthn/server';
import type { RegistrationResponseJSON, AuthenticationResponseJSON } from '@simplewebauthn/server';
import { validate } from '../middleware/validate';
import { withWriteLock } from '../middleware/concurrency';
import { writeLimiter } from '../middleware/rate-limiters';
import * as apiAuthService from '../services/api-auth.service';
import { logger } from '../utils/logger';

export const apiAuthWebauthnRouter = Router();

const getRP = () => ({
  id: process.env.WEBAUTHN_RP_ID || 'localhost',
  name: process.env.WEBAUTHN_RP_NAME || 'Secure Vault',
  origin: process.env.WEBAUTHN_ORIGIN || 'https://localhost:5173',
});

// ── Challenge stores ──

const regChallenges = new Map<string, { challenge: string; expiresAt: number }>();
const authChallenges = new Map<string, { challenge: string; expiresAt: number }>();

setInterval(() => {
  const now = Date.now();
  for (const [k, v] of regChallenges) if (v.expiresAt < now) regChallenges.delete(k);
  for (const [k, v] of authChallenges) if (v.expiresAt < now) authChallenges.delete(k);
}, 60_000);

// ── Schemas ──

const RegisterResponseSchema = z.object({
  name: z.string().min(1).max(100),
  challengeId: z.string().min(1),
  response: z.any(),
});

const AuthResponseSchema = z.object({
  challengeId: z.string().min(1),
  response: z.any(),
});

const RemoveSchema = z.object({
  credentialId: z.string().min(1),
});

// ── Registration Options (requires active session) ──

apiAuthWebauthnRouter.get('/register-options', async (_req: Request, res: Response): Promise<void> => {
  try {
    const rp = getRP();
    const existing = await apiAuthService.listCredentials();

    if (existing.length >= 10) {
      res.status(400).json({ error: 'Maximum credential limit reached (10)' });
      return;
    }

    const options = await generateRegistrationOptions({
      rpName: rp.name,
      rpID: rp.id,
      userName: 'vault-admin',
      userDisplayName: 'Vault Admin',
      attestationType: 'none',
      excludeCredentials: existing.map((c) => ({
        id: c.credentialId,
        transports: (c.transports || ['internal']) as AuthenticatorTransport[],
      })),
      authenticatorSelection: {
        authenticatorAttachment: 'platform',
        userVerification: 'required',
        residentKey: 'preferred',
      },
    });

    const challengeId = crypto.randomBytes(16).toString('hex');
    regChallenges.set(challengeId, {
      challenge: options.challenge,
      expiresAt: Date.now() + 5 * 60 * 1000,
    });

    res.json({ challengeId, options });
  } catch (err) {
    logger.error('Failed to generate API WebAuthn register options', err);
    res.status(500).json({ error: 'Failed to generate options' });
  }
});

// ── Register (requires active session) ──

apiAuthWebauthnRouter.post('/register', writeLimiter, validate(RegisterResponseSchema), withWriteLock(), async (req: Request, res: Response): Promise<void> => {
  const release = res.locals.releaseWriteLock as () => void;
  try {
    const { name, challengeId, response } = req.body;
    const rp = getRP();

    const stored = regChallenges.get(challengeId);
    if (!stored || stored.expiresAt < Date.now()) {
      regChallenges.delete(challengeId);
      res.status(400).json({ error: 'Challenge expired or invalid' });
      return;
    }
    regChallenges.delete(challengeId);

    const verification = await verifyRegistrationResponse({
      response: response as RegistrationResponseJSON,
      expectedChallenge: stored.challenge,
      expectedOrigin: rp.origin,
      expectedRPID: rp.id,
      requireUserVerification: true,
    });

    if (!verification.verified || !verification.registrationInfo) {
      res.status(400).json({ error: 'Verification failed' });
      return;
    }

    const { credential } = verification.registrationInfo;

    const credId = `api_webauthn_${crypto.randomBytes(8).toString('hex')}`;

    await apiAuthService.addCredential(credId, {
      credentialId: credential.id,
      credentialPublicKey: Buffer.from(credential.publicKey).toString('base64'),
      counter: credential.counter,
      transports: (response as RegistrationResponseJSON).response.transports || [],
      name,
      registeredAt: new Date().toISOString(),
      lastUsedAt: null,
    });

    logger.info(`API WebAuthn credential registered: ${name}`);
    res.json({ success: true, credentialId: credId });
  } catch (err: unknown) {
    logger.error('API WebAuthn registration failed', err);
    res.status(500).json({ error: 'Registration failed' });
  } finally {
    release();
  }
});

// ── Authentication Options (public — no session required) ──

apiAuthWebauthnRouter.get('/auth-options', async (_req: Request, res: Response): Promise<void> => {
  try {
    const rp = getRP();
    const credentials = await apiAuthService.listCredentials();

    if (credentials.length === 0) {
      res.status(404).json({ error: 'No API WebAuthn credentials registered' });
      return;
    }

    const options = await generateAuthenticationOptions({
      rpID: rp.id,
      userVerification: 'required',
      allowCredentials: credentials.map((c) => ({
        id: c.credentialId,
        transports: (c.transports || ['internal']) as AuthenticatorTransport[],
      })),
    });

    const challengeId = crypto.randomBytes(16).toString('hex');
    authChallenges.set(challengeId, {
      challenge: options.challenge,
      expiresAt: Date.now() + 5 * 60 * 1000,
    });

    res.json({ challengeId, options });
  } catch (err) {
    logger.error('Failed to generate API auth options', err);
    res.status(500).json({ error: 'Failed to generate options' });
  }
});

// ── Authenticate (public — returns session) ──

apiAuthWebauthnRouter.post('/authenticate', validate(AuthResponseSchema), async (req: Request, res: Response): Promise<void> => {
  try {
    const { challengeId, response } = req.body;
    const rp = getRP();

    const stored = authChallenges.get(challengeId);
    if (!stored || stored.expiresAt < Date.now()) {
      authChallenges.delete(challengeId);
      res.status(400).json({ error: 'Challenge expired or invalid' });
      return;
    }
    authChallenges.delete(challengeId);

    const authResponse = response as AuthenticationResponseJSON;

    const credential = await apiAuthService.getCredential(authResponse.id);
    if (!credential) {
      res.status(401).json({ error: 'Unknown credential' });
      return;
    }

    const verification = await verifyAuthenticationResponse({
      response: authResponse,
      expectedChallenge: stored.challenge,
      expectedOrigin: rp.origin,
      expectedRPID: rp.id,
      requireUserVerification: true,
      credential: {
        id: credential.credentialId,
        publicKey: new Uint8Array(Buffer.from(credential.credentialPublicKey, 'base64')),
        counter: credential.counter,
        transports: (credential.transports || []) as AuthenticatorTransport[],
      },
    });

    if (!verification.verified) {
      res.status(401).json({ error: 'Authentication failed' });
      return;
    }

    await apiAuthService.updateCounter(credential.credentialId, verification.authenticationInfo.newCounter);

    // Import session management here to avoid circular deps
    const { createSession, setSessionCookie, getSessionTimeoutMs } = await import('../middleware/session');

    const { token, expiresAt } = createSession();
    setSessionCookie(res, token);

    logger.info(`API WebAuthn login successful: ${credential.name}`);
    res.json({
      success: true,
      expiresAt,
      timeoutMs: getSessionTimeoutMs(),
    });
  } catch (err) {
    logger.error('API WebAuthn authentication failed', err);
    res.status(401).json({ error: 'Authentication failed' });
  }
});

// ── List Credentials (requires session) ──

apiAuthWebauthnRouter.get('/credentials', async (_req: Request, res: Response): Promise<void> => {
  try {
    const credentials = await apiAuthService.listCredentials();

    const safe = credentials.map((c) => ({
      credentialId: c.credentialId,
      name: c.name,
      registeredAt: c.registeredAt,
      lastUsedAt: c.lastUsedAt,
    }));

    res.json({ credentials: safe, maxCredentials: 10 });
  } catch (err) {
    logger.error('Failed to list API WebAuthn credentials', err);
    res.status(500).json({ error: 'Failed to list credentials' });
  }
});

// ── Remove Credential (requires session) ──

apiAuthWebauthnRouter.post('/remove', writeLimiter, validate(RemoveSchema), withWriteLock(), async (req: Request, res: Response): Promise<void> => {
  const release = res.locals.releaseWriteLock as () => void;
  try {
    const { credentialId } = req.body;

    const credential = await apiAuthService.getCredential(credentialId);
    if (!credential) {
      res.status(404).json({ error: 'Credential not found' });
      return;
    }

    await apiAuthService.removeCredential(credential.storeKey);
    logger.info(`API WebAuthn credential removed: ${credential.name}`);
    res.json({ success: true });
  } catch (err: unknown) {
    logger.error('Failed to remove API WebAuthn credential', err);
    res.status(500).json({ error: 'Failed to remove credential' });
  } finally {
    release();
  }
});
