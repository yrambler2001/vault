import { useState, useRef } from 'react';
import { Key, Fingerprint, Upload } from 'lucide-react';
import type { PublicKeyCredentialRequestOptionsJSON } from '@simplewebauthn/browser';
import * as cryptoLib from '../../lib/crypto';
import * as webauthnLib from '../../lib/webauthn';
import { api } from '../../lib/api';
import { VaultError, ErrorCodes, friendlyMessages } from '../../lib/errors';
import { NotificationBanner, Notification } from '../NotificationBanner';
import type { VaultDataResponse } from '../../lib/api';

interface Props {
  hasApiWebAuthn: boolean;
  webauthnAvailable: boolean;
  onLoginSuccess: () => void;
  onOfflineLoad: (vaultData: VaultDataResponse) => void;
  showNotification: (type: Notification['type'], message: string) => void;
  showError: (err: unknown) => void;
  notification: Notification | null;
  onDismissNotification: () => void;
}

/**
 * Validate that a parsed JSON object has the shape of a VaultDocument.
 * Returns a VaultDataResponse-compatible object or null if invalid.
 */
function validateVaultJson(data: unknown): VaultDataResponse | null {
  if (!data || typeof data !== 'object') return null;

  const doc = data as Record<string, unknown>;

  // Validate meta
  const meta = doc.meta as Record<string, unknown> | undefined;
  if (!meta || typeof meta !== 'object') return null;
  if (typeof meta.vaultId !== 'string' || !meta.vaultId) return null;
  if (typeof meta.passwordSalt !== 'string' || !meta.passwordSalt) return null;
  if (typeof meta.version !== 'number') return null;

  const kdfParams = meta.kdfParams as Record<string, unknown> | undefined;
  if (!kdfParams || typeof kdfParams !== 'object') return null;
  if (kdfParams.algorithm !== 'argon2id') return null;
  if (typeof kdfParams.parallelism !== 'number') return null;
  if (typeof kdfParams.iterations !== 'number') return null;
  if (typeof kdfParams.memorySize !== 'number') return null;
  if (typeof kdfParams.hashLength !== 'number') return null;

  // Validate keys
  const keys = doc.keys as Record<string, unknown> | undefined;
  if (!keys || typeof keys !== 'object') return null;
  const masterKey = keys.master_password as Record<string, unknown> | undefined;
  if (!masterKey || typeof masterKey !== 'object') return null;
  if (typeof masterKey.iv !== 'string' || !masterKey.iv) return null;
  if (typeof masterKey.wrappedDEK !== 'string' || !masterKey.wrappedDEK) return null;

  // Validate data
  const encData = doc.data as Record<string, unknown> | undefined;
  if (!encData || typeof encData !== 'object') return null;
  if (typeof encData.iv !== 'string' || !encData.iv) return null;
  if (typeof encData.ciphertext !== 'string' || !encData.ciphertext) return null;

  // Build the VaultDataResponse shape
  const typedKeys: Record<string, { iv: string; wrappedDEK: string }> = {};
  for (const [slotId, slotValue] of Object.entries(keys)) {
    const slot = slotValue as Record<string, unknown>;
    if (typeof slot?.iv === 'string' && typeof slot?.wrappedDEK === 'string') {
      typedKeys[slotId] = { iv: slot.iv, wrappedDEK: slot.wrappedDEK };
    }
  }

  return {
    meta: {
      vaultId: meta.vaultId as string,
      passwordSalt: meta.passwordSalt as string,
      kdfParams: {
        algorithm: 'argon2id',
        parallelism: kdfParams.parallelism as number,
        iterations: kdfParams.iterations as number,
        memorySize: kdfParams.memorySize as number,
        hashLength: kdfParams.hashLength as number,
      },
      version: meta.version as number,
      createdAt: (meta.createdAt as string) || '',
      updatedAt: (meta.updatedAt as string) || '',
    },
    keys: typedKeys,
    data: {
      iv: encData.iv as string,
      ciphertext: encData.ciphertext as string,
    },
    keySlots: Object.keys(typedKeys),
  };
}

export function LoginForm({
  hasApiWebAuthn,
  webauthnAvailable,
  onLoginSuccess,
  onOfflineLoad,
  showNotification,
  showError,
  notification,
  onDismissNotification,
}: Props) {
  const [apiKeyInput, setApiKeyInput] = useState('');
  const [loading, setLoading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleApiKeyLogin = async () => {
    if (!apiKeyInput) {
      showNotification('error', 'Please enter your API key.');
      return;
    }

    setLoading(true);
    try {
      const authMeta = await api.getAuthMeta();
      const argonHash = await cryptoLib.deriveApiKeyHash(apiKeyInput, authMeta.salt, authMeta.kdfParams);

      const verifier = await cryptoLib.computeApiKeyVerifier(argonHash);
      const { challengeId, nonce } = await api.getAuthChallenge();
      const response = await cryptoLib.computeAuthResponse(verifier, nonce);

      await api.login({ challengeId, response });

      setApiKeyInput('');
      onLoginSuccess();
    } catch (e: unknown) {
      const err = e as Error & { status?: number };
      if (err?.status === 401 || err.message?.includes('Invalid')) {
        showError(new VaultError(ErrorCodes.WRONG_API_KEY, friendlyMessages.WRONG_API_KEY, e));
      } else {
        showError(e);
      }
    } finally {
      setLoading(false);
    }
  };

  const handleApiWebAuthnLogin = async () => {
    setLoading(true);
    try {
      const { challengeId, options } = await api.getApiWebAuthnAuthOptions();
      const response = await webauthnLib.authenticateApiCredential(options as PublicKeyCredentialRequestOptionsJSON);
      await api.apiWebAuthnAuthenticate({ challengeId, response });
      onLoginSuccess();
    } catch (e: unknown) {
      const err = e as Error;
      if (err.message?.includes('cancelled') || err.message?.includes('NotAllowedError')) {
        showNotification('info', 'Authentication was cancelled.');
      } else {
        showError(e);
      }
    } finally {
      setLoading(false);
    }
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    // Reset the input so the same file can be re-selected
    if (fileInputRef.current) fileInputRef.current.value = '';

    try {
      const text = await file.text();
      let parsed: unknown;
      try {
        parsed = JSON.parse(text);
      } catch {
        showNotification('error', 'Invalid JSON file. Please upload a valid vault backup.');
        return;
      }

      const validated = validateVaultJson(parsed);
      if (!validated) {
        showNotification(
          'error',
          'Invalid vault file structure. The file must contain meta (with vaultId, passwordSalt, kdfParams), keys (with master_password), and encrypted data.',
        );
        return;
      }

      onOfflineLoad(validated);
    } catch {
      showNotification('error', 'Failed to read the file.');
    }
  };

  return (
    <>
      <NotificationBanner notification={notification} onDismiss={onDismissNotification} />
      <div className="flex min-h-screen items-center justify-center bg-gray-50 dark:bg-gray-900">
        <div className="w-full max-w-md rounded-lg border border-gray-200 bg-white p-8 shadow dark:border-gray-700 dark:bg-gray-800">
          <h1 className="mb-2 flex items-center gap-2 text-2xl font-bold text-gray-900 dark:text-gray-100">
            <Key className="text-blue-600" /> Server Authentication
          </h1>
          <p className="mb-6 text-sm text-gray-600 dark:text-gray-400">Enter your API key to access the vault server.</p>

          {hasApiWebAuthn && webauthnAvailable && (
            <>
              <button
                onClick={handleApiWebAuthnLogin}
                disabled={loading}
                className="mb-4 flex w-full items-center justify-center gap-2 rounded-lg bg-gray-800 py-3 text-white transition-colors hover:bg-gray-900 disabled:opacity-50 dark:bg-gray-700 dark:hover:bg-gray-600"
              >
                <Fingerprint size={20} />
                {loading ? 'Authenticating...' : 'Login with Biometrics'}
              </button>
              <div className="my-4 flex items-center gap-3">
                <div className="flex-1 border-t border-gray-200 dark:border-gray-600" />
                <span className="text-xs text-gray-400 uppercase">or use API key</span>
                <div className="flex-1 border-t border-gray-200 dark:border-gray-600" />
              </div>
            </>
          )}

          <input
            type="password"
            placeholder="API Key"
            value={apiKeyInput}
            onChange={(e) => setApiKeyInput(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleApiKeyLogin()}
            className="mb-4 w-full rounded border border-gray-300 bg-white p-2 focus:border-blue-500 focus:ring-1 focus:ring-blue-500 focus:outline-none dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100 dark:focus:border-blue-400 dark:focus:ring-blue-400"
            disabled={loading}
          />
          <button
            onClick={handleApiKeyLogin}
            disabled={loading}
            className="w-full rounded bg-blue-600 py-2 text-white transition-colors hover:bg-blue-700 disabled:opacity-50"
          >
            {loading ? 'Authenticating...' : 'Connect'}
          </button>

          {/* Offline mode */}
          <div className="my-6 flex items-center gap-3">
            <div className="flex-1 border-t border-gray-200 dark:border-gray-600" />
            <span className="text-xs text-gray-400 uppercase">or work offline</span>
            <div className="flex-1 border-t border-gray-200 dark:border-gray-600" />
          </div>

          <label className="flex w-full cursor-pointer items-center justify-center gap-2 rounded-lg border-2 border-dashed border-gray-300 py-3 text-sm text-gray-600 transition-colors hover:border-blue-400 hover:bg-blue-50 hover:text-blue-700 dark:border-gray-600 dark:text-gray-400 dark:hover:border-blue-500 dark:hover:bg-blue-900/20 dark:hover:text-blue-300">
            <Upload size={18} />
            Upload Vault JSON File
            <input ref={fileInputRef} type="file" accept=".json,application/json" onChange={handleFileUpload} className="hidden" />
          </label>
          <p className="mt-2 text-center text-xs text-gray-400 dark:text-gray-500">
            Load a previously downloaded vault backup to browse offline. Saving to server will be disabled.
          </p>
        </div>
      </div>
    </>
  );
}
