import { Request, Response, NextFunction } from 'express';
import crypto from 'crypto';
import { logger } from '../utils/logger';

/**
 * CSRF Protection using the Synchronizer Token Pattern.
 *
 * - A CSRF token is generated per session and returned via a dedicated
 *   GET endpoint: GET /api/auth/csrf-token
 * - The frontend must include the token in a custom header
 *   `X-CSRF-Token` on all state-changing requests (POST, PUT, PATCH, DELETE).
 * - GET/HEAD/OPTIONS requests are exempt (safe methods).
 * - The token is bound to the session — it changes when the session rotates.
 *
 * The frontend should fetch the CSRF token on initial load and after
 * any page reload (F5), then include it in all subsequent mutating requests.
 */

const CSRF_HEADER = 'x-csrf-token';
const CSRF_SECRET = crypto.randomBytes(64);

/**
 * Generate a CSRF token bound to a session identifier.
 * Uses HMAC so the server doesn't need to store tokens — it can
 * re-derive and verify from the session ID alone.
 */
export const generateCsrfToken = (sessionInternalId: string): string => {
  const payload = crypto.randomBytes(16).toString('hex');
  const hmac = crypto.createHmac('sha256', CSRF_SECRET).update(`${sessionInternalId}:${payload}`).digest('hex');
  return `${payload}.${hmac}`;
};

/**
 * Verify a CSRF token against the session.
 */
export const verifyCsrfToken = (token: string, sessionInternalId: string): boolean => {
  if (!token || !sessionInternalId) return false;

  const dotIndex = token.indexOf('.');
  if (dotIndex === -1 || dotIndex === 0) return false;

  const payload = token.substring(0, dotIndex);
  const providedHmac = token.substring(dotIndex + 1);

  if (!payload || !providedHmac) return false;

  const expectedHmac = crypto.createHmac('sha256', CSRF_SECRET).update(`${sessionInternalId}:${payload}`).digest('hex');

  try {
    return crypto.timingSafeEqual(Buffer.from(providedHmac, 'hex'), Buffer.from(expectedHmac, 'hex'));
  } catch {
    return false;
  }
};

/**
 * Middleware that enforces CSRF token on state-changing methods.
 * Must be applied AFTER requireSession (needs req.sessionId).
 */
export const requireCsrf = (req: Request, res: Response, next: NextFunction): void => {
  const safeMethods = ['GET', 'HEAD', 'OPTIONS'];
  if (safeMethods.includes(req.method)) {
    next();
    return;
  }

  const token = req.headers[CSRF_HEADER] as string | undefined;
  if (!token) {
    res.status(403).json({ error: 'Missing CSRF token' });
    return;
  }

  const sessionId = req.sessionId;
  if (!sessionId) {
    res.status(403).json({ error: 'No session for CSRF validation' });
    return;
  }

  if (!verifyCsrfToken(token, sessionId)) {
    logger.warn('CSRF token validation failed');
    res.status(403).json({ error: 'Invalid CSRF token' });
    return;
  }

  next();
};
