declare global {
  namespace Express {
    interface Request {
      sessionId?: string;
      /** The raw session cookie token (for rotation) */
      sessionToken?: string;
    }
  }
}

export {};
