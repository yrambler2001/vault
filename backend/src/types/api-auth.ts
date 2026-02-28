/**
 * API-level authentication credentials.
 * Separate from vault WebAuthn devices — these protect server access,
 * not vault encryption.
 */

export interface ApiWebAuthnCredential {
  credentialId: string;
  credentialPublicKey: string;
  counter: number;
  transports?: string[];
  name: string;
  registeredAt: string;
  lastUsedAt: string | null;
}

export interface ApiAuthStore {
  credentials: Record<string, ApiWebAuthnCredential>;
  maxCredentials: number;
  createdAt: string;
  updatedAt: string;
}
