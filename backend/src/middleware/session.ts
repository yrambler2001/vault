import { Request, Response, NextFunction } from 'express';
import crypto from 'crypto';
import { logger } from '../utils/logger';

/**
 * Session Management
 *
 * IMPORTANT DESIGN DECISIONS:
 *
 * 1. Sessions are stored IN-MEMORY only. This means:
 *    - Server restart will terminate ALL active sessions.
 *    - Users will need to re-authenticate after a server restart.
 *    - This is EXPECTED and BY DESIGN — it ensures no stale session
 *      data persists on disk and reduces attack surface.
 *
 * 2. Sessions use HMAC-signed tokens with rotation:
 *    - Each session token is HMAC-signed with a server secret.
 *    - Tokens are rotated on sensitive operations (vault unlock, writes).
 *    - Rotation does NOT extend the original absolute expiration time.
 *    - The original createdAt/expiresAt are preserved across rotations.
 *
 * 3. HTTPS is REQUIRED — there is no HTTP fallback:
 *    - Session cookies are set with `secure: true` unconditionally.
 *    - If the server is not running over HTTPS, cookies will NOT be sent
 *      by browsers, and authentication will silently fail.
 *    - The server startup enforces TLS certificate configuration and will
 *      refuse to start without valid TLS_CERT_PATH and TLS_KEY_PATH.
 *    - This is a strict security requirement, not a bug.
 */

const SESSION_TIMEOUT_MS = parseInt(process.env.SESSION_TIMEOUT_MINUTES || '30', 10) * 60 * 1000;
const MAX_SESSIONS = Math.max(parseInt(process.env.MAX_SESSIONS || '5', 10), 1);

export const SESSION_COOKIE_NAME = 'vault_session';

/**
 * Server-lifetime HMAC secret. Regenerated on each restart, which
 * automatically invalidates all previous session tokens.
 * This is intentional — see design decisions above.
 */
const HMAC_SECRET = crypto.randomBytes(64);

interface SessionData {
  /** Internal session identifier (not sent to client) */
  internalId: string;
  createdAt: number;
  expiresAt: number;
  /** Current valid token hash — only the latest rotated token is accepted */
  currentTokenHash: string;
  /** Counter incremented on each rotation for replay detection */
  rotationCounter: number;
}

/** Map from internalId → SessionData */
const sessions = new Map<string, SessionData>();

/** Reverse lookup: tokenHash → internalId (for fast token validation) */
const tokenIndex = new Map<string, string>();

// Prune expired sessions every 60s
setInterval(() => {
  const now = Date.now();
  for (const [id, s] of sessions) {
    if (s.expiresAt < now) {
      tokenIndex.delete(s.currentTokenHash);
      sessions.delete(id);
    }
  }
}, 60_000);

/**
 * Generate an HMAC-signed session token.
 * Format: <random_payload_hex>.<hmac_hex>
 */
const generateSignedToken = (): string => {
  const payload = crypto.randomBytes(32).toString('hex');
  const hmac = crypto.createHmac('sha256', HMAC_SECRET).update(payload).digest('hex');
  return `${payload}.${hmac}`;
};

/**
 * Verify HMAC signature of a session token.
 * Returns the payload if valid, null if tampered.
 */
const verifyTokenSignature = (token: string): string | null => {
  const dotIndex = token.indexOf('.');
  if (dotIndex === -1 || dotIndex === 0) return null;

  const payload = token.substring(0, dotIndex);
  const providedHmac = token.substring(dotIndex + 1);

  if (!payload || !providedHmac) return null;

  const expectedHmac = crypto.createHmac('sha256', HMAC_SECRET).update(payload).digest('hex');

  try {
    const match = crypto.timingSafeEqual(Buffer.from(providedHmac, 'hex'), Buffer.from(expectedHmac, 'hex'));
    return match ? payload : null;
  } catch {
    return null;
  }
};

/**
 * Hash a token for storage/comparison. We never store the raw token.
 */
const hashToken = (token: string): string => crypto.createHash('sha256').update(token).digest('hex');

export const createSession = (): { token: string; expiresAt: number } => {
  // Enforce max sessions — evict oldest if at limit
  if (sessions.size >= MAX_SESSIONS) {
    let oldestId: string | null = null;
    let oldestCreated = Infinity;
    for (const [id, s] of sessions) {
      if (s.createdAt < oldestCreated) {
        oldestCreated = s.createdAt;
        oldestId = id;
      }
    }
    if (oldestId) {
      const evicted = sessions.get(oldestId);
      if (evicted) tokenIndex.delete(evicted.currentTokenHash);
      sessions.delete(oldestId);
      logger.debug(`Evicted oldest session (max ${MAX_SESSIONS} reached)`);
    }
  }

  const token = generateSignedToken();
  const tHash = hashToken(token);
  const internalId = crypto.randomBytes(16).toString('hex');
  const now = Date.now();
  const expiresAt = now + SESSION_TIMEOUT_MS;

  const session: SessionData = {
    internalId,
    createdAt: now,
    expiresAt,
    currentTokenHash: tHash,
    rotationCounter: 0,
  };

  sessions.set(internalId, session);
  tokenIndex.set(tHash, internalId);

  return { token, expiresAt };
};

/**
 * Rotate the session token. Issues a new token but preserves the
 * original expiration time (does NOT extend the session).
 *
 * Returns the new token, or null if the session is invalid.
 */
export const rotateSession = (currentToken: string): { newToken: string; expiresAt: number } | null => {
  const session = resolveSession(currentToken);
  if (!session) return null;

  // Remove old token from index
  tokenIndex.delete(session.currentTokenHash);

  // Generate new token
  const newToken = generateSignedToken();
  const newHash = hashToken(newToken);

  session.currentTokenHash = newHash;
  session.rotationCounter += 1;

  tokenIndex.set(newHash, session.internalId);

  logger.debug(`Session rotated (rotation #${session.rotationCounter}, ` + `expires unchanged: ${new Date(session.expiresAt).toISOString()})`);

  return { newToken, expiresAt: session.expiresAt };
};

export const destroySession = (token: string): boolean => {
  const session = resolveSession(token);
  if (!session) return false;
  tokenIndex.delete(session.currentTokenHash);
  sessions.delete(session.internalId);
  return true;
};

export const getSessionTimeoutMs = (): number => SESSION_TIMEOUT_MS;

/**
 * Resolve a token to its session data. Validates HMAC signature,
 * checks token is the current (not rotated-out) token, and checks expiry.
 */
const resolveSession = (token: string): SessionData | null => {
  if (!token) return null;

  // Step 1: Verify HMAC signature
  const payload = verifyTokenSignature(token);
  if (!payload) return null;

  // Step 2: Look up by token hash
  const tHash = hashToken(token);
  const internalId = tokenIndex.get(tHash);
  if (!internalId) return null;

  // Step 3: Get session and check expiry
  const session = sessions.get(internalId);
  if (!session) {
    tokenIndex.delete(tHash);
    return null;
  }

  if (session.expiresAt < Date.now()) {
    tokenIndex.delete(tHash);
    sessions.delete(internalId);
    return null;
  }

  // Step 4: Verify this is the current token (not a pre-rotation token)
  if (session.currentTokenHash !== tHash) {
    // This token was valid but has been rotated out — reject it
    return null;
  }

  return session;
};

export const getSessionInfo = (token: string): { valid: boolean; expiresAt: number; timeoutMs: number; remainingMs: number } => {
  const session = resolveSession(token);
  if (!session) {
    return { valid: false, expiresAt: 0, timeoutMs: SESSION_TIMEOUT_MS, remainingMs: 0 };
  }
  return {
    valid: true,
    expiresAt: session.expiresAt,
    timeoutMs: SESSION_TIMEOUT_MS,
    remainingMs: Math.max(0, session.expiresAt - Date.now()),
  };
};

export const requireSession = (req: Request, res: Response, next: NextFunction): void => {
  const token = req.cookies?.[SESSION_COOKIE_NAME];

  if (!token) {
    res.status(401).json({ error: 'No session' });
    return;
  }

  const session = resolveSession(token);
  if (!session) {
    clearSessionCookie(res);
    res.status(401).json({ error: 'Session expired or invalid' });
    return;
  }

  req.sessionToken = token;
  req.sessionId = session.internalId;
  next();
};

export const setSessionCookie = (res: Response, token: string): void => {
  const domain = process.env.COOKIE_DOMAIN || undefined;
  const sameSite = 'strict';

  res.cookie(SESSION_COOKIE_NAME, token, {
    httpOnly: true,
    secure: true,
    sameSite,
    domain,
    path: '/api',
    maxAge: SESSION_TIMEOUT_MS,
  });
};

export const clearSessionCookie = (res: Response): void => {
  const domain = process.env.COOKIE_DOMAIN || undefined;
  res.clearCookie(SESSION_COOKIE_NAME, {
    httpOnly: true,
    secure: true,
    path: '/api',
    domain,
  });
};

export const getActiveSessionCount = (): number => sessions.size;
