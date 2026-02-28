const API_URL = import.meta.env.VITE_API_URL || '/api';

export interface AuthMeta {
  salt: string;
  kdfParams: {
    algorithm: 'argon2id';
    parallelism: number;
    iterations: number;
    memorySize: number;
    hashLength: number;
  };
}

export interface SessionInfo {
  valid: boolean;
  expiresAt: number;
  timeoutMs: number;
  remainingMs: number;
}

export interface VaultMeta {
  vaultId: string;
  passwordSalt: string;
  kdfParams: {
    algorithm: 'argon2id';
    parallelism: number;
    iterations: number;
    memorySize: number;
    hashLength: number;
  };
  version: number;
}

export interface VaultDataResponse {
  meta: VaultMeta & { createdAt: string; updatedAt: string };
  keys: Record<string, { iv: string; wrappedDEK: string }>;
  data: { iv: string; ciphertext: string };
  keySlots: string[];
}

export interface DriveInfo {
  label: string;
  configuredPath: string;
  vaultId: string | null;
  healthy: boolean;
  accessible: boolean;
  lastSync: string | null;
  versionCount: number;
}

export interface WebAuthnDevice {
  slotId: string;
  name: string;
  credentialId: string;
  registeredAt: string;
  lastUsedAt: string | null;
}

export interface WebAuthnAuthOptions {
  rpId: string;
  credentials: {
    slotId: string;
    credentialId: string;
    prfSalt: string;
  }[];
}

export interface ApiWebAuthnCredential {
  credentialId: string;
  name: string;
  registeredAt: string;
  lastUsedAt: string | null;
}

class VaultAPI {
  private csrfToken: string | null = null;

  private headers(extra: Record<string, string> = {}): Record<string, string> {
    const h: Record<string, string> = {
      'Content-Type': 'application/json',
      ...extra,
    };
    if (this.csrfToken) {
      h['X-CSRF-Token'] = this.csrfToken;
    }
    return h;
  }

  private async request<T>(method: string, path: string, body?: unknown, extraHeaders: Record<string, string> = {}): Promise<T> {
    let res: Response;

    try {
      res = await fetch(`${API_URL}${path}`, {
        method,
        headers: this.headers(extraHeaders),
        body: body ? JSON.stringify(body) : undefined,
        credentials: 'include',
      });
    } catch {
      throw new Error('NETWORK_ERROR');
    }

    if (res.status === 401) {
      throw new Error('SESSION_EXPIRED');
    }

    if (res.status === 403) {
      const errBody = await res.json().catch(() => ({ error: 'Forbidden' }));
      if (errBody.error?.includes('CSRF')) {
        // CSRF token might be stale — try refreshing once
        this.csrfToken = null;
        throw new Error('CSRF_TOKEN_INVALID');
      }
      const error = new Error(errBody.error || 'Forbidden');
      (error as Record<string, unknown>).status = 403;
      throw error;
    }

    if (!res.ok) {
      const errBody = await res.json().catch(() => ({ error: 'Unknown error' }));
      const error = new Error(errBody.error || `HTTP ${res.status}`);
      (error as Record<string, unknown>).status = res.status;
      (error as Record<string, unknown>).body = errBody;
      throw error;
    }

    try {
      return await res.json();
    } catch {
      throw new Error('Invalid response from server');
    }
  }

  // ── CSRF Token Management ──

  async fetchCsrfToken(): Promise<void> {
    try {
      const result = await this.request<{ csrfToken: string }>('GET', '/auth/csrf-token');
      this.csrfToken = result.csrfToken;
    } catch {
      // If no session, CSRF token can't be fetched — that's fine,
      // it will be fetched after login
      this.csrfToken = null;
    }
  }

  clearCsrfToken(): void {
    this.csrfToken = null;
  }

  hasCsrfToken(): boolean {
    return this.csrfToken !== null;
  }

  // ── Public (no session required) ──

  getStatus(): Promise<{
    configured: boolean;
    vaultCreated: boolean;
    hasApiWebAuthn: boolean;
    autoLockMinutes: number;
  }> {
    return this.request('GET', '/status');
  }

  getAuthMeta(): Promise<AuthMeta> {
    return this.request('GET', '/auth/meta');
  }

  setupApiKey(data: { argonHash: string; salt: string; kdfParams: unknown }): Promise<{ success: boolean }> {
    return this.request('POST', '/auth/setup', data);
  }

  getAuthChallenge(): Promise<{ challengeId: string; nonce: string }> {
    return this.request('GET', '/auth/challenge');
  }

  async login(data: { challengeId: string; response: string }): Promise<{
    success: boolean;
    expiresAt: number;
    timeoutMs: number;
  }> {
    const result = await this.request<{
      success: boolean;
      expiresAt: number;
      timeoutMs: number;
    }>('POST', '/auth/login', data);

    // Fetch CSRF token immediately after login
    await this.fetchCsrfToken();

    return result;
  }

  async logout(): Promise<{ success: boolean }> {
    const result = await this.request<{ success: boolean }>('POST', '/auth/logout');
    this.csrfToken = null;
    return result;
  }

  // ── Session ──

  getSession(): Promise<SessionInfo> {
    return this.request('GET', '/auth/session');
  }

  // ── API-Level WebAuthn ──

  getApiWebAuthnAuthOptions(): Promise<{
    challengeId: string;
    options: unknown;
  }> {
    return this.request('GET', '/auth/webauthn/auth-options');
  }

  async apiWebAuthnAuthenticate(data: { challengeId: string; response: unknown }): Promise<{
    success: boolean;
    expiresAt: number;
    timeoutMs: number;
  }> {
    const result = await this.request<{
      success: boolean;
      expiresAt: number;
      timeoutMs: number;
    }>('POST', '/auth/webauthn/authenticate', data);

    // Fetch CSRF token after WebAuthn login
    await this.fetchCsrfToken();

    return result;
  }

  getApiWebAuthnRegisterOptions(): Promise<{
    challengeId: string;
    options: unknown;
  }> {
    return this.request('GET', '/auth/webauthn/register-options');
  }

  registerApiWebAuthn(data: { name: string; challengeId: string; response: unknown }): Promise<{ success: boolean; credentialId: string }> {
    return this.request('POST', '/auth/webauthn/register', data);
  }

  listApiWebAuthnCredentials(): Promise<{
    credentials: ApiWebAuthnCredential[];
    maxCredentials: number;
  }> {
    return this.request('GET', '/auth/webauthn/credentials');
  }

  removeApiWebAuthnCredential(credentialId: string): Promise<{ success: boolean }> {
    return this.request('POST', '/auth/webauthn/remove', { credentialId });
  }

  // ── Vault ──

  getVaultMeta(): Promise<VaultMeta> {
    return this.request('GET', '/vault/meta');
  }

  setupVault(vault: unknown): Promise<{ success: boolean }> {
    return this.request('POST', '/vault/setup', vault);
  }

  getVaultData(): Promise<VaultDataResponse> {
    return this.request('GET', '/vault/data');
  }

  async updateData(
    data: { iv: string; ciphertext: string },
    version: number,
  ): Promise<{
    success: boolean;
    version: number;
    usbDrives: { succeeded: string[]; failed: string[] };
    sessionRotated?: boolean;
  }> {
    const result = await this.request<{
      success: boolean;
      version: number;
      usbDrives: { succeeded: string[]; failed: string[] };
      sessionRotated?: boolean;
    }>('PUT', '/vault/data', data, {
      'X-Vault-Version': String(version),
    });

    // If session was rotated, fetch new CSRF token
    if (result.sessionRotated) {
      await this.fetchCsrfToken();
    }

    return result;
  }

  // ── Drives ──

  getDriveStatus(): Promise<{ drives: DriveInfo[] }> {
    return this.request('GET', '/drives/status');
  }

  initDrive(label: string): Promise<{ success: boolean; drive: string }> {
    return this.request('POST', `/drives/init/${encodeURIComponent(label)}`);
  }

  syncDrives(): Promise<{ message: string; totalSynced?: number }> {
    return this.request('POST', '/drives/sync');
  }

  verifyDrive(label: string): Promise<{
    total: number;
    valid: number;
    corrupted: string[];
    noSidecar: string[];
  }> {
    return this.request('GET', `/drives/verify/${encodeURIComponent(label)}`);
  }

  // ── Vault WebAuthn ──

  getWebAuthnRegisterOptions(): Promise<{
    challengeId: string;
    options: unknown;
  }> {
    return this.request('GET', '/webauthn/register-options');
  }

  registerWebAuthnDevice(data: {
    name: string;
    challengeId: string;
    attestationResponse: unknown;
    prfSalt: string;
    wrappedDEK: { iv: string; wrappedDEK: string };
  }): Promise<{ success: boolean; slotId: string; vaultVersion: number }> {
    return this.request('POST', '/webauthn/register', data);
  }

  removeWebAuthnDevice(slotId: string): Promise<{ success: boolean; vaultVersion: number }> {
    return this.request('POST', '/webauthn/remove', { slotId });
  }

  listWebAuthnDevices(): Promise<{
    devices: WebAuthnDevice[];
    maxDevices: number;
  }> {
    return this.request('GET', '/webauthn/devices');
  }

  getWebAuthnAuthOptions(): Promise<WebAuthnAuthOptions> {
    return this.request('GET', '/webauthn/auth-options');
  }

  touchWebAuthnDevice(slotId: string): Promise<{ success: boolean }> {
    return this.request('POST', '/webauthn/touch', { slotId });
  }
}

export const api = new VaultAPI();
