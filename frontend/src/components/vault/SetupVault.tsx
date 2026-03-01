import { useState } from 'react';
import { Lock } from 'lucide-react';
import * as cryptoLib from '../../lib/crypto';
import { api } from '../../lib/api';
import { VaultError, ErrorCodes, friendlyMessages } from '../../lib/errors';
import { SessionBar } from '../SessionBar';
import { NotificationBanner, Notification } from '../NotificationBanner';

interface Props {
  onComplete: () => void;
  onLogout: () => void;
  showNotification: (type: Notification['type'], message: string) => void;
  showError: (err: unknown) => void;
  notification: Notification | null;
  onDismissNotification: () => void;
}

export function SetupVault({ onComplete, onLogout, showNotification, showError, notification, onDismissNotification }: Props) {
  const [masterPasswordInput, setMasterPasswordInput] = useState('');
  const [loading, setLoading] = useState(false);

  const strength = masterPasswordInput ? cryptoLib.estimatePasswordStrength(masterPasswordInput) : null;

  const handleSetup = async () => {
    if (!masterPasswordInput || masterPasswordInput.length < 8) {
      showNotification('error', 'Master password must be at least 8 characters.');
      return;
    }

    setLoading(true);
    try {
      const vaultId = crypto.randomUUID();
      const passwordSalt = crypto.getRandomValues(new Uint8Array(16));
      const passwordSaltB64 = cryptoLib.toBase64(passwordSalt);
      const kdfParams = cryptoLib.DEFAULT_KDF_PARAMS;

      const kek = await cryptoLib.deriveKEK(masterPasswordInput, passwordSaltB64, kdfParams);

      const newDek = await cryptoLib.generateDEKSimple();
      const wrappedDEK = await cryptoLib.wrapDEK(newDek, kek);
      const initialData = await cryptoLib.encryptPayload({ entries: [] }, newDek);

      const payload = {
        meta: {
          vaultId,
          passwordSalt: passwordSaltB64,
          kdfParams,
        },
        keys: { master_password: wrappedDEK },
        data: initialData,
      };

      await api.setupVault(payload);
      setMasterPasswordInput('');
      showNotification('success', 'Vault created! You can now unlock it.');
      onComplete();
    } catch (e) {
      showError(new VaultError(ErrorCodes.SETUP_FAILED, friendlyMessages.SETUP_FAILED, e));
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      <SessionBar onSessionExpired={onLogout} />
      <NotificationBanner notification={notification} onDismiss={onDismissNotification} />
      <div className="flex min-h-screen items-center justify-center bg-gray-50 pt-8 dark:bg-gray-900">
        <div className="w-full max-w-md rounded-lg border border-gray-200 bg-white p-8 shadow dark:border-gray-700 dark:bg-gray-800">
          <h1 className="mb-2 flex items-center gap-2 text-2xl font-bold text-gray-900 dark:text-gray-100">
            <Lock className="text-green-600 dark:text-green-400" /> Create Vault
          </h1>
          <p className="mb-6 text-sm text-gray-600 dark:text-gray-400">
            Set your master password. This encrypts your vault — it <b>cannot</b> be recovered.
          </p>
          <label className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300">Master Password</label>
          <input
            type="password"
            placeholder="Master password (min 8 chars)"
            value={masterPasswordInput}
            onChange={(e) => setMasterPasswordInput(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleSetup()}
            className="mb-2 w-full rounded border border-gray-300 bg-white p-2 focus:border-blue-500 focus:ring-1 focus:ring-blue-500 focus:outline-none dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100 dark:focus:border-blue-400 dark:focus:ring-blue-400"
            disabled={loading}
          />

          {strength && (
            <div className="mb-4">
              <div className="mb-1 flex gap-1">
                {[0, 1, 2, 3, 4].map((i) => (
                  <div
                    key={i}
                    className={`h-1.5 flex-1 rounded-full transition-colors ${i <= strength.score ? strength.color : 'bg-gray-200 dark:bg-gray-600'}`}
                  />
                ))}
              </div>
              <div className="flex items-start justify-between">
                <span className="text-xs text-gray-500 dark:text-gray-400">{strength.label}</span>
                {strength.suggestions.length > 0 && <span className="text-xs text-gray-400">{strength.suggestions[0]}</span>}
              </div>
            </div>
          )}

          <button
            onClick={handleSetup}
            disabled={loading}
            className="w-full rounded bg-green-600 py-2 text-white transition-colors hover:bg-green-700 disabled:opacity-50"
          >
            {loading ? 'Creating Vault...' : 'Create Vault'}
          </button>
          <button
            onClick={onLogout}
            className="mt-4 w-full text-sm text-gray-500 transition-colors hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200"
          >
            ← Change API key
          </button>
        </div>
      </div>
    </>
  );
}
