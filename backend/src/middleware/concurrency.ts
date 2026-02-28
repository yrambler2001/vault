import { Request, Response, NextFunction } from 'express';
import { Mutex } from 'async-mutex';

const writeMutex = new Mutex();

/**
 * Acquire the global write mutex and attach release to res.locals
 * so the actual async handler can hold the lock for the entire operation.
 *
 * The handler MUST call res.locals.releaseWriteLock() in a finally block,
 * or it will be auto-released on response finish / timeout.
 *
 * Usage in route handlers:
 *   const release = res.locals.releaseWriteLock as () => void;
 *   try {
 *     // ... mutating work ...
 *     res.json({ success: true });
 *   } finally {
 *     release();
 *   }
 */
export const withWriteLock = () => {
  return async (_req: Request, res: Response, next: NextFunction) => {
    let release: (() => void) | null = null;

    try {
      release = await writeMutex.acquire();
    } catch (err) {
      next(err);
      return;
    }

    const LOCK_TIMEOUT_MS = 30_000;
    let released = false;

    const safeRelease = () => {
      if (!released && release) {
        released = true;
        release();
      }
    };

    // Attach the release function so the handler can call it explicitly
    res.locals.releaseWriteLock = safeRelease;

    // Safety nets: release on response completion or timeout
    res.on('finish', safeRelease);
    res.on('close', safeRelease);
    res.on('error', safeRelease);

    const timeout = setTimeout(safeRelease, LOCK_TIMEOUT_MS);

    const clearSafetyTimeout = () => clearTimeout(timeout);
    res.on('finish', clearSafetyTimeout);
    res.on('close', clearSafetyTimeout);

    try {
      next();
    } catch (err) {
      safeRelease();
      clearTimeout(timeout);
      throw err;
    }
  };
};
