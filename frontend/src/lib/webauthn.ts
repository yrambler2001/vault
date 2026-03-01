import { startRegistration, startAuthentication } from '@simplewebauthn/browser';
import type { PublicKeyCredentialCreationOptionsJSON, PublicKeyCredentialRequestOptionsJSON } from '@simplewebauthn/browser';
import { toBase64, fromBase64 } from './crypto';

const ALG = { name: 'AES-GCM', length: 256 } as const;

// ── Feature Detection ──

export const isWebAuthnAvailable = async (): Promise<boolean> => {
  try {
    // 1. Basic WebAuthn Support
    if (!window.PublicKeyCredential) return false;

    // 2. Advanced Capability Check (Chrome 133+)
    if (PublicKeyCredential.getClientCapabilities) {
      const capabilities = await PublicKeyCredential.getClientCapabilities();
      // Return true if it can handle passkeys at all (local or hybrid)
      return capabilities.passkeyPlatformAuthenticator === true;
    }

    // 3. Fallback for older browsers
    return await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable();
  } catch {
    return false;
  }
};

// ── PRF Helpers ──

const buildPrfExtension = (saltBase64: string): { prf: { eval: { first: ArrayBuffer } } } => {
  return {
    prf: {
      eval: {
        first: fromBase64(saltBase64).buffer as ArrayBuffer,
      },
    },
  };
};

const extractPrfResult = (extensions: AuthenticationExtensionsClientOutputs): ArrayBuffer | null => {
  const prf = (extensions as Record<string, unknown>)?.prf as { results?: { first?: ArrayBuffer } } | undefined;
  return prf?.results?.first || null;
};

const prfOutputToKEK = async (prfOutput: ArrayBuffer): Promise<CryptoKey> => {
  return crypto.subtle.importKey('raw', prfOutput, ALG, false, ['encrypt', 'decrypt']);
};

// ── Registration (Vault-level — for PRF key derivation) ──

export interface VaultWebAuthnRegistrationResult {
  attestationResponse: unknown;
  prfSalt: string;
  kek: CryptoKey;
}

export const registerVaultDevice = async (options: PublicKeyCredentialCreationOptionsJSON): Promise<VaultWebAuthnRegistrationResult> => {
  const prfSalt = crypto.getRandomValues(new Uint8Array(32));
  const prfSaltBase64 = toBase64(prfSalt);

  const optionsWithPrf = {
    ...options,
    extensions: {
      ...(options.extensions || {}),
      ...buildPrfExtension(prfSaltBase64),
    },
  };

  const result = await startRegistration({
    optionsJSON: optionsWithPrf as PublicKeyCredentialCreationOptionsJSON,
  });

  const clientExtResults = result.clientExtensionResults;
  const prfOutput = extractPrfResult(clientExtResults as AuthenticationExtensionsClientOutputs);

  if (!prfOutput) {
    throw new Error(
      'Your device does not support the PRF extension needed for biometric vault unlock. ' +
        'This requires a compatible platform authenticator with PRF support.',
    );
  }

  const kek = await prfOutputToKEK(prfOutput);

  return {
    attestationResponse: result,
    prfSalt: prfSaltBase64,
    kek,
  };
};

// ── Authentication (Vault-level — for PRF key derivation) ──

export interface PrfCredentialHint {
  slotId: string;
  credentialId: string;
  prfSalt: string;
}

export interface VaultWebAuthnAssertionResult {
  slotId: string;
  kek: CryptoKey;
}

function bufferToBase64url(buffer: Uint8Array | ArrayBuffer): string {
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  let binary = '';
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export const authenticateWithPRF = async (rpId: string, credentials: PrfCredentialHint[]): Promise<VaultWebAuthnAssertionResult> => {
  if (credentials.length === 0) {
    throw new Error('No biometric devices registered');
  }

  const evalByCredential: Record<string, { first: ArrayBuffer }> = {};
  const allowCredentials: { id: string; type: 'public-key'; transports?: string[] }[] = [];

  for (const cred of credentials) {
    const credIdBytes = fromBase64url(cred.credentialId);
    const credIdBase64url = bufferToBase64url(credIdBytes);

    evalByCredential[credIdBase64url] = {
      first: fromBase64(cred.prfSalt).buffer as ArrayBuffer,
    };

    allowCredentials.push({
      id: cred.credentialId,
      type: 'public-key',
      transports: ['internal'],
    });
  }

  const challenge = bufferToBase64url(crypto.getRandomValues(new Uint8Array(32)));

  const assertion = (await navigator.credentials.get({
    publicKey: {
      challenge: fromBase64url(challenge),
      rpId,
      allowCredentials: allowCredentials.map((c) => ({
        id: fromBase64url(c.id),
        type: c.type as PublicKeyCredentialType,
        transports: (c.transports || ['internal']) as AuthenticatorTransport[],
      })),
      userVerification: 'required',
      extensions: {
        prf: {
          evalByCredential,
        },
      } as AuthenticationExtensionsClientInputs,
    },
  })) as PublicKeyCredential | null;

  if (!assertion) {
    throw new Error('Biometric authentication was cancelled');
  }

  const prfOutput = extractPrfResult(assertion.getClientExtensionResults());
  if (!prfOutput) {
    throw new Error('PRF extension did not return a result. Authentication failed.');
  }

  const usedCredentialId = bufferToBase64url(assertion.rawId);
  const matchedCred = credentials.find((c) => {
    const credBase64url = bufferToBase64url(fromBase64url(c.credentialId));
    return credBase64url === usedCredentialId;
  });

  if (!matchedCred) {
    throw new Error('Authenticated with an unknown credential');
  }

  const kek = await prfOutputToKEK(prfOutput);

  return {
    slotId: matchedCred.slotId,
    kek,
  };
};

// ── API-Level WebAuthn (standard, no PRF) ──

export const registerApiCredential = async (options: PublicKeyCredentialCreationOptionsJSON): Promise<unknown> => {
  return startRegistration({ optionsJSON: options });
};

export const authenticateApiCredential = async (options: PublicKeyCredentialRequestOptionsJSON): Promise<unknown> => {
  return startAuthentication({ optionsJSON: options });
};

// ── Utility ──

function fromBase64url(base64url: string): Uint8Array {
  const base64 = base64url
    .replace(/-/g, '+')
    .replace(/_/g, '/')
    .padEnd(base64url.length + ((4 - (base64url.length % 4)) % 4), '=');
  return Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
}
