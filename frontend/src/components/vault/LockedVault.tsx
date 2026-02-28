import { useState, useEffect, useCallback } from 'react';
import { Lock, Fingerprint } from 'lucide-react';
import * as cryptoLib from '../../lib/crypto';
import * as webauthnLib from '../../lib/webauthn';
import { api } from '../../lib/api';
import { VaultError, ErrorCodes, friendlyMessages } from '../../lib/errors';
import { SessionBar } from '../SessionBar';
import { NotificationBanner, Notification } from '../NotificationBanner';
import type { VaultMeta } from '../../lib/api';

export interface UnlockResult {
  /** Non-extractable DEK for encrypt/decrypt operations */
  dek: CryptoKey;
  /** Extractable DEK for wrapping with new KEKs (device registration) */
  dekExtractable: CryptoKey;
  passwords: PasswordEntry[];
  vaultMeta: VaultMeta & { createdAt: string; updatedAt: string };
  vaultVersion: number;
}

export interface PasswordEntry {
  id: string;
  service: string;
  username: string;
  password: string;
  notes: string;
  createdAt: string;
  modifiedAt: string;
}

interface Props {
  onUnlock: (result: UnlockResult) => void;
  onLogout: () => void;
  showNotification: (type: Notification['type'], message: string) => void;
  showError: (err: unknown) => void;
  notification: Notification | null;
  onDismissNotification: () => void;
}

export function LockedVault({ onUnlock, onLogout, showNotification, showError, notification, onDismissNotification }: Props) {
  const [masterPasswordInput, setMasterPasswordInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [hasBiometrics, setHasBiometrics] = useState(false);

  const checkBiometricDevices = useCallback(async () => {
    try {
      const { credentials } = await api.getWebAuthnAuthOptions();
      setHasBiometrics(credentials.length > 0);
    } catch {
      setHasBiometrics(false);
    }
  }, []);

  useEffect(() => {
    checkBiometricDevices();
  }, [checkBiometricDevices]);

  const handleUnlock = async (method: 'password' | 'biometric') => {
    if (method === 'password' && !masterPasswordInput) {
      showNotification('error', 'Please enter your master password.');
      return;
    }

    setLoading(true);
    try {
      const vaultData = await api.getVaultData();

      let kek: CryptoKey;
      let slotId: string;

      if (method === 'password') {
        kek = await cryptoLib.deriveKEK(masterPasswordInput, vaultData.meta.passwordSalt, vaultData.meta.kdfParams);
        slotId = 'master_password';
      } else {
        const authOptions = await api.getWebAuthnAuthOptions();
        const result = await webauthnLib.authenticateWithPRF(authOptions.rpId, authOptions.credentials);
        kek = result.kek;
        slotId = result.slotId;
        api.touchWebAuthnDevice(slotId).catch(() => {});
      }

      const wrappedKey = vaultData.keys[slotId];
      if (!wrappedKey) {
        throw new VaultError(ErrorCodes.VAULT_CORRUPTED, `Key slot "${slotId}" not found in vault.`);
      }

      // Unwrap DEK as non-extractable for normal use
      let dekNonExtractable: CryptoKey;
      try {
        dekNonExtractable = await cryptoLib.unwrapDEK(wrappedKey.wrappedDEK, wrappedKey.iv, kek, false);
      } catch {
        if (method === 'biometric') {
          throw new VaultError(ErrorCodes.WRONG_PASSWORD, 'Biometric unlock failed. Try your master password instead.');
        }
        throw new VaultError(ErrorCodes.WRONG_PASSWORD, friendlyMessages.WRONG_PASSWORD);
      }

      // Also unwrap as extractable for device registration
      let dekExtractable: CryptoKey;
      try {
        dekExtractable = await cryptoLib.unwrapDEK(wrappedKey.wrappedDEK, wrappedKey.iv, kek, true);
      } catch {
        // If this fails, use the non-extractable one and device registration
        // simply won't work. This shouldn't normally happen.
        dekExtractable = dekNonExtractable;
      }

      let decryptedData: PasswordEntry[];
      try {
        decryptedData = (await cryptoLib.decryptPayload(vaultData.data.ciphertext, vaultData.data.iv, dekNonExtractable)) as PasswordEntry[];
      } catch {
        throw new VaultError(ErrorCodes.VAULT_CORRUPTED, friendlyMessages.VAULT_CORRUPTED);
      }

      setMasterPasswordInput('');

      onUnlock({
        dek: dekNonExtractable,
        dekExtractable,
        passwords: decryptedData,
        vaultMeta: vaultData.meta,
        vaultVersion: vaultData.meta.version,
      });

      showNotification('success', method === 'biometric' ? 'Vault unlocked with biometrics.' : 'Vault unlocked.');
    } catch (e) {
      showError(e);
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      <SessionBar onSessionExpired={onLogout} />
      <NotificationBanner notification={notification} onDismiss={onDismissNotification} />
      <div className="flex min-h-screen items-center justify-center bg-gray-50 pt-8">
        <div className="w-full max-w-md rounded-lg border bg-white p-8 shadow">
          <h1 className="mb-6 flex items-center gap-2 text-2xl font-bold">
            <Lock className="text-amber-600" /> Vault Locked
          </h1>

          {hasBiometrics && (
            <button
              onClick={() => handleUnlock('biometric')}
              disabled={loading}
              className="mb-4 flex w-full items-center justify-center gap-2 rounded-lg bg-gray-800 py-3 text-white transition-colors hover:bg-gray-900 disabled:opacity-50"
            >
              <Fingerprint size={20} />
              {loading ? 'Authenticating...' : 'Unlock with Biometrics'}
            </button>
          )}

          {hasBiometrics && (
            <div className="my-4 flex items-center gap-3">
              <div className="flex-1 border-t border-gray-200" />
              <span className="text-xs text-gray-400 uppercase">or use password</span>
              <div className="flex-1 border-t border-gray-200" />
            </div>
          )}

          <input
            type="password"
            placeholder="Master Password"
            value={masterPasswordInput}
            onChange={(e) => setMasterPasswordInput(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleUnlock('password')}
            className="mb-4 w-full rounded border p-2"
            disabled={loading}
          />
          <button
            onClick={() => handleUnlock('password')}
            disabled={loading}
            className="w-full rounded bg-amber-600 py-2 text-white transition-colors hover:bg-amber-700 disabled:opacity-50"
          >
            {loading ? 'Unlocking...' : 'Unlock with Password'}
          </button>
          <button onClick={onLogout} className="mt-4 w-full text-sm text-gray-500 transition-colors hover:text-gray-700">
            ← Disconnect from server
          </button>
        </div>
      </div>
    </>
  );
}
