export class VaultError extends Error {
  public readonly userMessage: string;
  public readonly code: string;
  public readonly debugInfo: unknown;

  constructor(code: string, userMessage: string, debugInfo?: unknown) {
    super(userMessage);
    this.name = 'VaultError';
    this.code = code;
    this.userMessage = userMessage;
    this.debugInfo = debugInfo;
  }
}

export const ErrorCodes = {
  WRONG_PASSWORD: 'WRONG_PASSWORD',
  WRONG_API_KEY: 'WRONG_API_KEY',
  NETWORK_ERROR: 'NETWORK_ERROR',
  SESSION_EXPIRED: 'SESSION_EXPIRED',
  VERSION_CONFLICT: 'VERSION_CONFLICT',
  VAULT_CORRUPTED: 'VAULT_CORRUPTED',
  SETUP_FAILED: 'SETUP_FAILED',
  USB_WRITE_PARTIAL: 'USB_WRITE_PARTIAL',
  CSRF_INVALID: 'CSRF_INVALID',
  UNKNOWN: 'UNKNOWN',
} as const;

export type ErrorCode = (typeof ErrorCodes)[keyof typeof ErrorCodes];

export const friendlyMessages: Record<ErrorCode, string> = {
  WRONG_PASSWORD: 'Incorrect master password. Please try again.',
  WRONG_API_KEY: 'Invalid API key. Please check and try again.',
  NETWORK_ERROR: 'Cannot connect to the vault server. Is the backend running?',
  SESSION_EXPIRED: 'Your session has expired. Please log in again.',
  VERSION_CONFLICT: 'Someone else modified the vault. Please refresh and try again.',
  VAULT_CORRUPTED: 'Vault data appears corrupted. Try restoring from a backup version.',
  SETUP_FAILED: 'Failed to create the vault. Check server logs for details.',
  USB_WRITE_PARTIAL: 'Warning: Some USB drives could not be updated.',
  CSRF_INVALID: 'Security token expired. Please try your action again.',
  UNKNOWN: 'An unexpected error occurred.',
};
