import rateLimit from 'express-rate-limit';
import { GLOBAL_RATE_LIMIT_PER_SECOND, TRUST_PROXY } from '../utils/constants';

/**
 * Rate limiting configuration.
 *
 * IMPORTANT: If this server is behind a reverse proxy (nginx, Cloudflare,
 * Tailscale, etc.), you MUST set TRUST_PROXY in .env so that the real
 * client IP is used for rate limiting instead of the proxy IP.
 *
 * See .env.example for configuration details.
 */

/**
 * Global rate limiter applied to ALL endpoints.
 * Limits each IP to N requests per second.
 */
export const globalLimiter = rateLimit({
  windowMs: 1_000,
  max: GLOBAL_RATE_LIMIT_PER_SECOND,
  message: { error: 'Too many requests. Slow down.' },
  standardHeaders: true,
  legacyHeaders: false,
});

export const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  message: { error: 'Too many authentication attempts. Try again in 15 minutes.' },
  standardHeaders: true,
  legacyHeaders: false,
});

export const readLimiter = rateLimit({
  windowMs: 1 * 60 * 1000,
  max: 60,
  message: { error: 'Too many requests.' },
  standardHeaders: true,
  legacyHeaders: false,
});

export const writeLimiter = rateLimit({
  windowMs: 1 * 60 * 1000,
  max: 30,
  message: { error: 'Too many write requests.' },
  standardHeaders: true,
  legacyHeaders: false,
});

export const setupLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 3,
  message: { error: 'Too many setup attempts.' },
  standardHeaders: true,
  legacyHeaders: false,
});

export { TRUST_PROXY };
