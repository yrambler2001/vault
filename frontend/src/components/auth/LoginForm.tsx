import { useState } from 'react';
import { Key, Fingerprint } from 'lucide-react';
import * as cryptoLib from '../../lib/crypto';
import * as webauthnLib from '../../lib/webauthn';
import { api } from '../../lib/api';
import { VaultError, ErrorCodes, friendlyMessages } from '../../lib/errors';
import { NotificationBanner, Notification } from '../NotificationBanner';
import type { PublicKeyCredentialRequestOptionsJSON } from '@simplewebauthn/browser';

interface Props {
  hasApiWebAuthn: boolean;
  webauthnAvailable: boolean;
  onLoginSuccess: () => void;
  showNotification: (type: Notification['type'], message: string) => void;
  showError: (err: unknown) => void;
  notification: Notification | null;
  onDismissNotification: () => void;
}

export function LoginForm({ hasApiWebAuthn, webauthnAvailable, onLoginSuccess, showNotification, showError, notification, onDismissNotification }: Props) {
  const [apiKeyInput, setApiKeyInput] = useState('');
  const [loading, setLoading] = useState(false);

  const handleApiKeyLogin = async () => {
    if (!apiKeyInput) {
      showNotification('error', 'Please enter your API key.');
      return;
    }

    setLoading(true);
    try {
      const authMeta = await api.getAuthMeta();
      const argonHash = await cryptoLib.deriveApiKeyHash(apiKeyInput, authMeta.salt, authMeta.kdfParams);

      // 1. Compute verifier = SHA-256(argonHash)
      const verifier = await cryptoLib.computeApiKeyVerifier(argonHash);

      // 2. Get a single-use challenge from server
      const { challengeId, nonce } = await api.getAuthChallenge();

      // 3. Compute response = HMAC-SHA256(verifier, nonce)
      const response = await cryptoLib.computeAuthResponse(verifier, nonce);

      // 4. Send challenge-response
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
        </div>
      </div>
    </>
  );
}
