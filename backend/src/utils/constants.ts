/**
 * Shared application constants derived from environment variables.
 */

export const AUTO_LOCK_MINUTES = Math.max(parseInt(process.env.AUTO_LOCK_MINUTES || '5', 10), 1);

export const GLOBAL_RATE_LIMIT_PER_SECOND = Math.max(parseInt(process.env.GLOBAL_RATE_LIMIT_PER_SECOND || '10', 10), 1);

/**
 * Reverse proxy trust configuration.
 *
 * Set to the number of trusted proxies between the client and this server:
 *   - 0 or false: no proxy (direct connection) — DEFAULT
 *   - 1: one proxy (e.g., nginx on same host)
 *   - 2: two proxies (e.g., Cloudflare → nginx)
 *   - 'loopback': trust loopback addresses only
 *
 * IMPORTANT: If behind a proxy and this is not set, rate limiting will
 * treat all requests as coming from the proxy IP, making rate limits
 * ineffective and potentially locking out all users simultaneously.
 */
export const TRUST_PROXY: boolean | number | string = (() => {
  const raw = process.env.TRUST_PROXY || '0';
  if (raw === 'false' || raw === '0') return false;
  if (raw === 'true') return true;
  if (raw === 'loopback') return 'loopback';
  const num = parseInt(raw, 10);
  return isNaN(num) ? false : num;
})();
