import 'dotenv/config';
import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import https from 'https';
import fs from 'fs/promises';
import crypto from 'crypto';
import { z } from 'zod';

import { logger } from './utils/logger';
import { validate } from './middleware/validate';
import { authLimiter, readLimiter, writeLimiter, setupLimiter, globalLimiter, TRUST_PROXY } from './middleware/rate-limiters';
import { withWriteLock } from './middleware/concurrency';
import {
  requireSession,
  createSession,
  destroySession,
  rotateSession,
  setSessionCookie,
  clearSessionCookie,
  getSessionInfo,
  getSessionTimeoutMs,
  SESSION_COOKIE_NAME,
} from './middleware/session';
import { requireCsrf, generateCsrfToken } from './middleware/csrf';
import * as vaultService from './services/vault.service';
import * as configService from './services/config.service';
import * as driveService from './services/drive.service';
import { drivesRouter } from './routes/drives';
import { webauthnRouter } from './routes/webauthn';
import { apiAuthWebauthnRouter } from './routes/api-auth-webauthn';
import { VaultDocument } from './types/vault';
import { AUTO_LOCK_MINUTES } from './utils/constants';

const app = express();
const PORT = parseInt(process.env.PORT || '3000', 10);

const apiAuthChallenges = new Map<string, { nonce: string; expiresAt: number }>();

setInterval(() => {
  const now = Date.now();
  for (const [k, v] of apiAuthChallenges) {
    if (v.expiresAt < now) apiAuthChallenges.delete(k);
  }
}, 60_000);

// ── Update Schemas ──
const ApiKeyLoginSchema = z.object({
  challengeId: z.string().min(1),
  response: z.string().min(1),
});

// ── Schemas ──

const WrappedKeySchema = z.object({
  iv: z.string().min(1),
  wrappedDEK: z.string().min(1),
});

const EncryptedDataSchema = z.object({
  iv: z.string().min(1),
  ciphertext: z.string().min(1),
});

const KdfParamsSchema = z.object({
  algorithm: z.literal('argon2id'),
  parallelism: z.number().int().min(1).max(16),
  iterations: z.number().int().min(1).max(100),
  memorySize: z.number().int().min(1024).max(1048576),
  hashLength: z.number().int().min(16).max(64),
});

const VaultSetupSchema = z.object({
  meta: z.object({
    vaultId: z.string().min(1),
    passwordSalt: z.string().min(1),
    kdfParams: KdfParamsSchema,
  }),
  keys: z.record(WrappedKeySchema).refine((k) => 'master_password' in k, {
    message: 'Setup must include a master_password key',
  }),
  data: EncryptedDataSchema,
});

const ApiKeySetupSchema = z.object({
  argonHash: z.string().min(1),
  salt: z.string().min(1),
  kdfParams: KdfParamsSchema,
});

// ── Proxy Trust ──

if (TRUST_PROXY !== false) {
  app.set('trust proxy', TRUST_PROXY);
  logger.info(`Trust proxy set to: ${TRUST_PROXY}`);
}

// ── Middleware ──

// Global rate limiter — applied to ALL routes
app.use(globalLimiter);

const frontendUrl = process.env.FRONTEND_URL || 'https://localhost:5173';

app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        connectSrc: ["'self'", frontendUrl],
        imgSrc: ["'self'", 'data:'],
        fontSrc: ["'self'"],
        frameSrc: ["'none'"],
        objectSrc: ["'none'"],
        baseUri: ["'self'"],
        formAction: ["'self'"],
      },
    },
  }),
);

app.use(
  cors({
    origin: frontendUrl,
    credentials: true,
  }),
);

app.use(cookieParser());

// Anti-caching headers for all API responses
app.use('/api', (_req: Request, res: Response, next: NextFunction) => {
  res.set({
    'Cache-Control': 'no-store, no-cache, must-revalidate, private',
    Pragma: 'no-cache',
    Expires: '0',
  });
  next();
});

// Enforce JSON content-type on POST/PUT/PATCH
app.use((req: Request, res: Response, next: NextFunction) => {
  if (['POST', 'PUT', 'PATCH'].includes(req.method)) {
    const contentType = req.headers['content-type'];
    if (!contentType || !contentType.includes('application/json')) {
      res.status(415).json({
        error: 'Unsupported Media Type. Content-Type must be application/json.',
      });
      return;
    }
  }
  next();
});

app.use(express.json({ limit: '10mb' }));

if (process.env.DEBUG === 'true') {
  app.use((req: Request, _res: Response, next: NextFunction) => {
    logger.debug(`${req.method} ${req.path}`);
    next();
  });
}

// ── Status Endpoint ──

app.get('/api/status', readLimiter, async (_req: Request, res: Response) => {
  const configured = await configService.configExists();
  const vaultCreated = await vaultService.vaultExists();

  let hasApiWebAuthn = false;
  try {
    const apiAuthService = await import('./services/api-auth.service');
    const creds = await apiAuthService.listCredentials();
    hasApiWebAuthn = creds.length > 0;
  } catch {
    /* not available yet */
  }

  res.json({
    configured,
    vaultCreated,
    hasApiWebAuthn,
    autoLockMinutes: AUTO_LOCK_MINUTES,
  });
});

// ── CSRF Token Endpoint ──

app.get('/api/auth/csrf-token', requireSession, (req: Request, res: Response) => {
  const csrfToken = generateCsrfToken(req.sessionId!);
  res.json({ csrfToken });
});

// ── API Key Setup ──

app.post('/api/auth/setup', setupLimiter, validate(ApiKeySetupSchema), async (req: Request, res: Response): Promise<void> => {
  const exists = await configService.configExists();
  if (exists) {
    res.status(400).json({ error: 'API key already configured' });
    return;
  }

  const { argonHash, salt, kdfParams } = req.body;

  // Server-side SHA-256 verifier of the client-sent hash
  const verifier = crypto.createHash('sha256').update(argonHash).digest('hex');

  await configService.saveConfig({
    apiKeyVerifier: verifier,
    apiKeySalt: salt,
    apiKeyKdfParams: kdfParams,
    createdAt: new Date().toISOString(),
  });

  logger.info('API key configured');
  res.json({ success: true });
});

// ── API Key Auth Meta ──

app.get('/api/auth/meta', readLimiter, async (_req: Request, res: Response): Promise<void> => {
  const config = await configService.getConfig();
  if (!config) {
    res.status(404).json({ error: 'Not configured' });
    return;
  }

  res.json({
    salt: config.apiKeySalt,
    kdfParams: config.apiKeyKdfParams,
  });
});

// ── API Key Login ──

app.post('/api/auth/login', authLimiter, validate(ApiKeyLoginSchema), async (req: Request, res: Response): Promise<void> => {
  const config = await configService.getConfig();
  if (!config) {
    res.status(404).json({ error: 'Not configured' });
    return;
  }

  const { challengeId, response } = req.body;

  const stored = apiAuthChallenges.get(challengeId);
  if (!stored || stored.expiresAt < Date.now()) {
    apiAuthChallenges.delete(challengeId);
    res.status(400).json({ error: 'Challenge expired or invalid' });
    return;
  }
  apiAuthChallenges.delete(challengeId);

  // Compute expected response: HMAC-SHA256(verifier, nonce)
  const expected = crypto.createHmac('sha256', config.apiKeyVerifier).update(stored.nonce).digest('hex');

  if (response.length !== expected.length) {
    res.status(401).json({ error: 'Invalid API key' });
    return;
  }

  try {
    const match = crypto.timingSafeEqual(Buffer.from(response, 'hex'), Buffer.from(expected, 'hex'));
    if (!match) {
      res.status(401).json({ error: 'Invalid API key' });
      return;
    }
  } catch {
    res.status(401).json({ error: 'Invalid API key' });
    return;
  }

  const { token, expiresAt } = createSession();
  setSessionCookie(res, token);

  logger.info('API key login successful');
  res.json({
    success: true,
    expiresAt,
    timeoutMs: getSessionTimeoutMs(),
  });
});

app.get('/api/auth/challenge', authLimiter, (_req: Request, res: Response): void => {
  const challengeId = crypto.randomBytes(16).toString('hex');
  const nonce = crypto.randomBytes(32).toString('hex');

  apiAuthChallenges.set(challengeId, {
    nonce,
    expiresAt: Date.now() + 5 * 60 * 1000, // 5 min expiry
  });

  res.json({ challengeId, nonce });
});

// ── Logout ──

app.post('/api/auth/logout', requireSession, (req: Request, res: Response) => {
  const token = req.cookies?.[SESSION_COOKIE_NAME];
  if (token) {
    destroySession(token);
    logger.debug('Session destroyed');
  }
  clearSessionCookie(res);
  res.json({ success: true });
});

// ── Session Info / Verify ──

app.get('/api/auth/session', requireSession, (req: Request, res: Response) => {
  const token = req.cookies?.[SESSION_COOKIE_NAME];
  if (!token) {
    res.status(401).json({ error: 'No session' });
    return;
  }
  const info = getSessionInfo(token);
  res.json(info);
});

// ── API-Level WebAuthn ──

app.use(
  '/api/auth/webauthn',
  readLimiter,
  (req: Request, res: Response, next: NextFunction) => {
    const publicPaths = ['/auth-options', '/authenticate'];
    if (publicPaths.some((p) => req.path === p)) {
      return next();
    }
    return requireSession(req, res, next);
  },
  // CSRF on mutating WebAuthn endpoints (register, remove) — but NOT on public auth endpoints
  (req: Request, res: Response, next: NextFunction) => {
    const publicPaths = ['/auth-options', '/authenticate'];
    if (publicPaths.some((p) => req.path === p)) {
      return next();
    }
    return requireCsrf(req, res, next);
  },
  apiAuthWebauthnRouter,
);

// ── Vault Endpoints ──

app.get('/api/vault/meta', readLimiter, requireSession, async (_req: Request, res: Response): Promise<void> => {
  try {
    const vault = await vaultService.getVault();
    res.json({
      vaultId: vault.meta.vaultId,
      passwordSalt: vault.meta.passwordSalt,
      kdfParams: vault.meta.kdfParams,
      version: vault.meta.version,
    });
  } catch {
    res.status(404).json({ error: 'Vault not initialized' });
  }
});

app.post(
  '/api/vault/setup',
  setupLimiter,
  requireSession,
  requireCsrf,
  validate(VaultSetupSchema),
  withWriteLock(),
  async (req: Request, res: Response): Promise<void> => {
    const release = res.locals.releaseWriteLock as () => void;
    try {
      const data = req.body as VaultDocument;
      data.meta.version = 1;
      data.meta.createdAt = new Date().toISOString();
      data.meta.updatedAt = new Date().toISOString();

      await vaultService.createVault(data);
      res.json({ success: true });
    } catch (err: unknown) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code === 'EEXIST') {
        res.status(400).json({ error: 'Vault already exists' });
        return;
      }
      logger.error('Setup failed', err);
      res.status(500).json({ error: 'Failed to create vault' });
    } finally {
      release();
    }
  },
);

app.get('/api/vault/data', readLimiter, requireSession, async (_req: Request, res: Response): Promise<void> => {
  try {
    const vault = await vaultService.getVault();
    res.json({
      meta: {
        vaultId: vault.meta.vaultId,
        passwordSalt: vault.meta.passwordSalt,
        kdfParams: vault.meta.kdfParams,
        version: vault.meta.version,
        createdAt: vault.meta.createdAt,
        updatedAt: vault.meta.updatedAt,
      },
      keys: vault.keys,
      data: vault.data,
      keySlots: Object.keys(vault.keys),
    });
  } catch {
    res.status(404).json({ error: 'Vault not initialized' });
  }
});

app.put(
  '/api/vault/data',
  writeLimiter,
  requireSession,
  requireCsrf,
  withWriteLock(),
  validate(EncryptedDataSchema),
  async (req: Request, res: Response): Promise<void> => {
    const release = res.locals.releaseWriteLock as () => void;
    try {
      const expectedVersion = parseInt(req.headers['x-vault-version'] as string);

      if (isNaN(expectedVersion)) {
        res.status(400).json({ error: 'Missing X-Vault-Version header' });
        return;
      }

      let vault: VaultDocument;
      try {
        vault = await vaultService.getVault();
      } catch {
        res.status(404).json({ error: 'Vault not initialized' });
        return;
      }

      if (vault.meta.version !== expectedVersion) {
        res.status(409).json({
          error: 'Version conflict',
          serverVersion: vault.meta.version,
          yourVersion: expectedVersion,
        });
        return;
      }

      vault.data = req.body;
      const result = await vaultService.saveVault(vault);

      // Rotate session token on vault write (does not extend expiration)
      const currentToken = req.sessionToken;
      let rotationApplied = false;
      if (currentToken) {
        const rotated = rotateSession(currentToken);
        if (rotated) {
          setSessionCookie(res, rotated.newToken);
          rotationApplied = true;
        }
      }

      res.json({
        success: true,
        version: result.version,
        usbDrives: result.usbResults,
        sessionRotated: rotationApplied,
      });
    } catch (err) {
      logger.error('Vault data update failed', err);
      res.status(500).json({ error: 'Failed to update vault data' });
    } finally {
      release();
    }
  },
);

// USB drive management
app.use('/api/drives', readLimiter, requireSession, requireCsrf, drivesRouter);

// Vault-level WebAuthn management
app.use('/api/webauthn', requireSession, requireCsrf, webauthnRouter);

// ── Global Error Handler ──

app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
  logger.error('Unhandled error', err);
  res.status(500).json({ error: 'Internal server error' });
});

// ── Server Startup ──

const startServer = async () => {
  // Validate drive paths before starting
  try {
    driveService.validateDrivePaths();
  } catch (err) {
    logger.error('Drive path validation failed', err);
    process.exit(1);
  }

  await configService.ensureConfigDir();
  await vaultService.ensureDirectories();

  const certPath = process.env.TLS_CERT_PATH;
  const keyPath = process.env.TLS_KEY_PATH;

  if (!certPath || !keyPath) {
    logger.error(
      'TLS_CERT_PATH and TLS_KEY_PATH must be set.\n' +
        '  This application REQUIRES HTTPS — plain HTTP is NOT supported.\n' +
        '  Session cookies use secure:true, WebAuthn requires a secure context,\n' +
        '  and Web Crypto API is unavailable over HTTP.\n' +
        '  For development, generate self-signed certs:\n' +
        '    openssl req -x509 -newkey rsa:2048 -keyout certs/key.pem \\\n' +
        '      -out certs/cert.pem -days 365 -nodes -subj "/CN=localhost"',
    );
    process.exit(1);
  }

  let cert: string;
  let key: string;
  try {
    cert = await fs.readFile(certPath, 'utf8');
    key = await fs.readFile(keyPath, 'utf8');
  } catch (err) {
    logger.error(`Failed to read TLS certificates: ${certPath}, ${keyPath}`, err);
    process.exit(1);
  }

  const server = https.createServer({ cert, key }, app);

  // Request timeout protection against slowloris attacks
  server.timeout = 30_000; // 30s total request timeout
  server.headersTimeout = 10_000; // 10s to receive headers
  server.keepAliveTimeout = 5_000; // 5s keep-alive

  server.listen(PORT, () => {
    logger.info(`Vault Backend running on https://0.0.0.0:${PORT}`);
    logger.info(`CORS origin: ${frontendUrl}`);
    logger.info(`Session timeout: ${process.env.SESSION_TIMEOUT_MINUTES || '30'} minutes`);
    logger.info(`Auto-lock: ${AUTO_LOCK_MINUTES} minutes`);
    if (TRUST_PROXY !== false) {
      logger.info(`Trust proxy: ${TRUST_PROXY}`);
    }
  });
};

startServer();
