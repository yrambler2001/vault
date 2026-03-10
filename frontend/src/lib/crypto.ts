import { argon2id } from 'hash-wasm';

const ALG = { name: 'AES-GCM', length: 256 } as const;

// ── Helpers ──

export const toBase64 = (buf: ArrayBuffer | Uint8Array): string => btoa(String.fromCharCode(...new Uint8Array(buf)));

export const fromBase64 = (b64: string): Uint8Array => Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));

export const toHex = (buf: ArrayBuffer): string =>
  Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');

/**
 * Best-effort buffer clear. NOT cryptographically guaranteed in JS
 * due to GC, V8 optimizations, etc. Defense-in-depth only.
 *
 * KNOWN LIMITATION: JavaScript strings are immutable and cannot be
 * zeroed. ArrayBuffer/Uint8Array clearing is best-effort because:
 *   - V8 may have optimized copies in JIT-compiled code
 *   - The GC may have moved the buffer, leaving old copies in memory
 *   - Intermediate values (e.g., from btoa/atob) create string copies
 *
 * This function zeros the buffer in-place, which helps in the common
 * case but cannot guarantee cryptographic erasure. This is a fundamental
 * limitation of all JavaScript runtimes, not specific to this application.
 */
const clearArrayBuffer = (buf: ArrayBuffer): void => {
  new Uint8Array(buf).fill(0);
};

// ── KDF Parameters ──

export interface KdfParams {
  algorithm: 'argon2id';
  parallelism: number;
  iterations: number;
  memorySize: number;
  hashLength: number;
}

export const DEFAULT_KDF_PARAMS: KdfParams = {
  algorithm: 'argon2id',
  parallelism: 4,
  iterations: 3,
  memorySize: 65536,
  hashLength: 32,
};

// ── Password Strength ──

export interface PasswordStrength {
  score: 0 | 1 | 2 | 3 | 4;
  label: string;
  color: string;
  suggestions: string[];
}

/**
 * Simple password strength estimator.
 * Evaluates length, character variety, and common patterns.
 */
export const estimatePasswordStrength = (password: string): PasswordStrength => {
  const suggestions: string[] = [];
  let score = 0;

  // Length scoring
  if (password.length >= 8) score++;
  if (password.length >= 12) score++;
  if (password.length >= 16) score++;
  if (password.length >= 20) score++;

  // Character variety
  const hasLower = /[a-z]/.test(password);
  const hasUpper = /[A-Z]/.test(password);
  const hasDigit = /\d/.test(password);
  const hasSpecial = /[^a-zA-Z0-9]/.test(password);
  const charTypes = [hasLower, hasUpper, hasDigit, hasSpecial].filter(Boolean).length;

  if (charTypes >= 3) score++;
  if (charTypes >= 4) score++;

  // Deductions for patterns
  if (/^[a-zA-Z]+$/.test(password)) {
    score = Math.max(0, score - 1);
    suggestions.push('Add numbers or special characters');
  }
  if (/^[0-9]+$/.test(password)) {
    score = Math.max(0, score - 2);
    suggestions.push('Add letters and special characters');
  }
  if (/(.)\1{2,}/.test(password)) {
    score = Math.max(0, score - 1);
    suggestions.push('Avoid repeated characters');
  }
  if (/^(123|abc|qwerty|password|admin)/i.test(password)) {
    score = Math.max(0, score - 2);
    suggestions.push('Avoid common patterns');
  }

  if (password.length < 12) suggestions.push('Use at least 12 characters');
  if (!hasSpecial) suggestions.push('Add special characters (!@#$%...)');
  if (!hasUpper) suggestions.push('Add uppercase letters');

  // Clamp to 0-4
  const clamped = Math.min(4, Math.max(0, score)) as 0 | 1 | 2 | 3 | 4;

  const labels: Record<number, string> = {
    0: 'Very Weak',
    1: 'Weak',
    2: 'Fair',
    3: 'Strong',
    4: 'Very Strong',
  };

  const colors: Record<number, string> = {
    0: 'bg-red-500',
    1: 'bg-orange-500',
    2: 'bg-yellow-500',
    3: 'bg-green-500',
    4: 'bg-green-700',
  };

  return {
    score: clamped,
    label: labels[clamped],
    color: colors[clamped],
    suggestions: suggestions.slice(0, 3),
  };
};

// ── API Key Auth ──

export const deriveApiKeyHash = async (apiKey: string, saltBase64: string, params: KdfParams = DEFAULT_KDF_PARAMS): Promise<string> => {
  const result = await argon2id({
    password: apiKey,
    salt: fromBase64(saltBase64),
    parallelism: params.parallelism,
    iterations: params.iterations,
    memorySize: params.memorySize,
    hashLength: params.hashLength,
    outputType: 'hex',
  });
  return result;
};

// ── Vault KEK Derivation ──

export const deriveKEK = async (password: string, passwordSaltBase64: string, params: KdfParams = DEFAULT_KDF_PARAMS): Promise<CryptoKey> => {
  const baseKeyBytes = await argon2id({
    password,
    salt: fromBase64(passwordSaltBase64),
    parallelism: params.parallelism,
    iterations: params.iterations,
    memorySize: params.memorySize,
    hashLength: params.hashLength,
    outputType: 'binary',
  });

  return crypto.subtle.importKey('raw', baseKeyBytes, ALG, false, ['encrypt', 'decrypt']);
};

// ── Core Encryption ──

/**
 * Generate a new Data Encryption Key.
 *
 * Two keys are returned:
 *   - extractable: can be exported for wrapping with new KEKs
 *     (used only during device registration, then discarded)
 *   - nonExtractable: cannot be exported, used for ongoing encrypt/decrypt
 *     (more resistant to XSS — attacker cannot call exportKey on it)
 */
export const generateDEK = async (): Promise<{
  extractable: CryptoKey;
  nonExtractable: CryptoKey;
}> => {
  const extractable = await crypto.subtle.generateKey(ALG, true, ['encrypt', 'decrypt']);
  const raw = await crypto.subtle.exportKey('raw', extractable);
  const nonExtractable = await crypto.subtle.importKey('raw', raw, ALG, false, ['encrypt', 'decrypt']);
  clearArrayBuffer(raw);
  return { extractable, nonExtractable };
};

/**
 * Generate a simple DEK (extractable). Used when both wrapping and
 * encrypting are needed in the same flow (e.g., vault setup).
 */
export const generateDEKSimple = async (): Promise<CryptoKey> => crypto.subtle.generateKey(ALG, true, ['encrypt', 'decrypt']);

export const wrapDEK = async (dek: CryptoKey, kek: CryptoKey): Promise<{ iv: string; wrappedDEK: string }> => {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const rawDEK = await crypto.subtle.exportKey('raw', dek);
  try {
    const wrapped = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, kek, rawDEK);
    return { iv: toBase64(iv), wrappedDEK: toBase64(wrapped) };
  } finally {
    clearArrayBuffer(rawDEK);
  }
};

/**
 * Unwrap (decrypt) a DEK.
 * @param extractable If true, the returned key can be re-exported for wrapping.
 *                    Default false (more secure for normal operations).
 */
export const unwrapDEK = async (wrappedBase64: string, ivBase64: string, kek: CryptoKey, extractable: boolean = false): Promise<CryptoKey> => {
  const rawDEK = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: fromBase64(ivBase64) }, kek, fromBase64(wrappedBase64));
  try {
    return await crypto.subtle.importKey('raw', rawDEK, ALG, extractable, ['encrypt', 'decrypt']);
  } finally {
    clearArrayBuffer(rawDEK);
  }
};

export const encryptPayload = async (data: unknown, dek: CryptoKey): Promise<{ iv: string; ciphertext: string }> => {
  const iv = crypto.getRandomValues(new Uint8Array(12));

  const jsonBytes = new TextEncoder().encode(JSON.stringify(data));

  const compressedStream = new Response(jsonBytes).body!.pipeThrough(new CompressionStream('gzip'));
  const compressedBytes = await new Response(compressedStream).arrayBuffer();

  const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, dek, compressedBytes);

  return { iv: toBase64(iv), ciphertext: toBase64(ciphertext) };
};

export const decryptPayload = async (ciphertextBase64: string, ivBase64: string, dek: CryptoKey): Promise<unknown> => {
  const decryptedBuffer = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: fromBase64(ivBase64) }, dek, fromBase64(ciphertextBase64));

  const decompressedStream = new Response(decryptedBuffer).body!.pipeThrough(new DecompressionStream('gzip'));
  const decompressedBuffer = await new Response(decompressedStream).arrayBuffer();

  return JSON.parse(new TextDecoder().decode(decompressedBuffer));
};

/**
 * Compute the verifier from the argonHash (same as server stores).
 * verifier = SHA-256(argonHash)
 */
export const computeApiKeyVerifier = async (argonHash: string): Promise<string> => {
  const encoder = new TextEncoder();
  const data = encoder.encode(argonHash);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  return toHex(hashBuffer);
};

/**
 * Compute the challenge-response: HMAC-SHA256(verifier, nonce)
 * This is what gets sent to the server during login.
 */
export const computeAuthResponse = async (verifier: string, nonce: string): Promise<string> => {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey('raw', encoder.encode(verifier), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const signature = await crypto.subtle.sign('HMAC', key, encoder.encode(nonce));
  return toHex(signature);
};
