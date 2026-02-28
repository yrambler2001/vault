import { useState } from 'react';
import { Shield } from 'lucide-react';
import * as cryptoLib from '../../lib/crypto';
import { api } from '../../lib/api';
import { VaultError, ErrorCodes } from '../../lib/errors';
import { NotificationBanner, Notification } from '../NotificationBanner';

interface Props {
  onComplete: () => void;
  showNotification: (type: Notification['type'], message: string) => void;
  showError: (err: unknown) => void;
  notification: Notification | null;
  onDismissNotification: () => void;
}

export function SetupApiKey({ onComplete, showNotification, showError, notification, onDismissNotification }: Props) {
  const [apiKeyInput, setApiKeyInput] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSetup = async () => {
    if (!apiKeyInput || apiKeyInput.length < 8) {
      showNotification('error', 'API key must be at least 8 characters.');
      return;
    }

    setLoading(true);
    try {
      const salt = crypto.getRandomValues(new Uint8Array(16));
      const saltB64 = cryptoLib.toBase64(salt);
      const kdfParams = cryptoLib.DEFAULT_KDF_PARAMS;

      const argonHash = await cryptoLib.deriveApiKeyHash(apiKeyInput, saltB64, kdfParams);

      await api.setupApiKey({ argonHash, salt: saltB64, kdfParams });

      // Automatically log in
      const verifier = await cryptoLib.computeApiKeyVerifier(argonHash);
      const { challengeId, nonce } = await api.getAuthChallenge();
      const response = await cryptoLib.computeAuthResponse(verifier, nonce);

      await api.login({ challengeId, response });

      setApiKeyInput('');
      showNotification('success', 'API key configured! Now create your vault.');
      onComplete();
    } catch (e) {
      showError(new VaultError(ErrorCodes.SETUP_FAILED, 'Failed to configure API key.', e));
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      <NotificationBanner notification={notification} onDismiss={onDismissNotification} />
      <div className="flex min-h-screen items-center justify-center bg-gray-50">
        <div className="w-full max-w-md rounded-lg border bg-white p-8 shadow">
          <h1 className="mb-2 flex items-center gap-2 text-2xl font-bold">
            <Shield className="text-blue-600" /> Configure Server Access
          </h1>
          <p className="mb-6 text-sm text-gray-600">Set an API key to protect access to this vault server.</p>
          <label className="mb-1 block text-sm font-medium text-gray-700">API Key</label>
          <input
            type="password"
            placeholder="Choose an API key (min 8 chars)"
            value={apiKeyInput}
            onChange={(e) => setApiKeyInput(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleSetup()}
            className="mb-4 w-full rounded border p-2"
            disabled={loading}
          />
          <button
            onClick={handleSetup}
            disabled={loading}
            className="w-full rounded bg-blue-600 py-2 text-white transition-colors hover:bg-blue-700 disabled:opacity-50"
          >
            {loading ? 'Configuring...' : 'Set API Key'}
          </button>
        </div>
      </div>
    </>
  );
}
