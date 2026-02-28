export interface Logger {
  info: (msg: string, data?: unknown) => void;
  warn: (msg: string, data?: unknown) => void;
  error: (msg: string, data?: unknown) => void;
  debug: (msg: string, data?: unknown) => void;
}

const sanitize = (data: unknown): unknown => {
  if (data instanceof Error) {
    return { name: data.name, message: data.message, stack: data.stack };
  }
  if (typeof data === 'object' && data !== null) {
    return '[object redacted — use DEBUG=true for details]';
  }
  return data;
};

export const createLogger = (): Logger => {
  const isDev = process.env.NODE_ENV !== 'production';
  const isDebug = process.env.DEBUG === 'true';
  const verbose = isDev || isDebug;

  const timestamp = () => new Date().toISOString();

  return {
    info: (msg: string, data?: unknown) => {
      console.log(`[${timestamp()}] [INFO] ${msg}`, data !== undefined ? (verbose ? data : sanitize(data)) : '');
    },
    warn: (msg: string, data?: unknown) => {
      console.warn(`[${timestamp()}] [WARN] ${msg}`, data !== undefined ? (verbose ? data : sanitize(data)) : '');
    },
    error: (msg: string, data?: unknown) => {
      console.error(`[${timestamp()}] [ERROR] ${msg}`, data !== undefined ? sanitize(data) : '');
    },
    debug: (msg: string, data?: unknown) => {
      if (verbose) {
        console.log(`[${timestamp()}] [DEBUG] ${msg}`, data !== undefined ? data : '');
      }
    },
  };
};

export const logger = createLogger();
