import { useState, useEffect, useCallback } from 'react';
import { Fingerprint, Smartphone, Plus, X, AlertTriangle } from 'lucide-react';
import type { PublicKeyCredentialCreationOptionsJSON } from '@simplewebauthn/browser';
import * as cryptoLib from '../../lib/crypto';
import * as webauthnLib from '../../lib/webauthn';
import { api } from '../../lib/api';
import type { VaultMeta, WebAuthnDevice } from '../../lib/api';
import type { Notification } from '../NotificationBanner';

interface Props {
  vaultMeta: VaultMeta | null;
  /** Extractable DEK for wrapping with new biometric KEKs */
  dekExtractable: CryptoKey | null;
  webauthnAvailable: boolean;
  onVersionUpdate: (v: number) => void;
  showNotification: (type: Notification['type'], msg: string) => void;
  showError: (err: unknown) => void;
}

export function BiometricDevicesPanel({ vaultMeta, dekExtractable, webauthnAvailable, onVersionUpdate, showNotification, showError }: Props) {
  const [devices, setDevices] = useState<WebAuthnDevice[]>([]);
  const [maxDevices, setMaxDevices] = useState(10);
  const [loadingDevices, setLoadingDevices] = useState(false);
  const [registering, setRegistering] = useState(false);
  const [showRegForm, setShowRegForm] = useState(false);
  const [masterPasswordForReg, setMasterPasswordForReg] = useState('');
  const [deviceNameInput, setDeviceNameInput] = useState('');

  const refreshDevices = useCallback(async () => {
    setLoadingDevices(true);
    try {
      const { devices: d, maxDevices: max } = await api.listWebAuthnDevices();
      setDevices(d);
      setMaxDevices(max);
    } catch {
      // non-critical
    } finally {
      setLoadingDevices(false);
    }
  }, []);

  useEffect(() => {
    refreshDevices();
  }, [refreshDevices]);

  const handleRegisterDevice = async () => {
    if (!deviceNameInput.trim()) {
      showNotification('error', 'Please enter a device name.');
      return;
    }
    if (!masterPasswordForReg) {
      showNotification('error', 'Master password is required.');
      return;
    }
    if (!vaultMeta || !dekExtractable) {
      showNotification('error', 'Vault must be unlocked.');
      return;
    }

    setRegistering(true);
    try {
      const kek = await cryptoLib.deriveKEK(masterPasswordForReg, vaultMeta.passwordSalt, vaultMeta.kdfParams);

      const vaultData = await api.getVaultData();
      const masterWrappedKey = vaultData.keys.master_password;
      if (!masterWrappedKey) {
        throw new Error('Master password key slot not found');
      }

      try {
        await cryptoLib.unwrapDEK(masterWrappedKey.wrappedDEK, masterWrappedKey.iv, kek);
      } catch {
        showNotification('error', 'Incorrect master password.');
        setRegistering(false);
        return;
      }

      const { challengeId, options } = await api.getWebAuthnRegisterOptions();

      const regResult = await webauthnLib.registerVaultDevice(options as PublicKeyCredentialCreationOptionsJSON);

      // Use the extractable DEK for wrapping
      const wrappedDEK = await cryptoLib.wrapDEK(dekExtractable, regResult.kek);

      const serverResult = await api.registerWebAuthnDevice({
        name: deviceNameInput.trim(),
        challengeId,
        attestationResponse: regResult.attestationResponse,
        prfSalt: regResult.prfSalt,
        wrappedDEK,
      });

      onVersionUpdate(serverResult.vaultVersion);
      setShowRegForm(false);
      setMasterPasswordForReg('');
      setDeviceNameInput('');

      showNotification('success', `Device "${deviceNameInput.trim()}" registered.`);
      await refreshDevices();
    } catch (e: unknown) {
      const err = e as Error;
      if (err.message?.includes('cancelled')) {
        showNotification('info', 'Registration was cancelled.');
      } else if (err.message?.includes('PRF')) {
        showNotification('error', 'Your device does not support biometric vault unlock (PRF extension required).');
      } else {
        showError(e);
      }
    } finally {
      setRegistering(false);
    }
  };

  const handleRemoveDevice = async (slotId: string, name: string) => {
    if (!window.confirm(`Remove "${name}"?`)) return;
    try {
      const result = await api.removeWebAuthnDevice(slotId);
      onVersionUpdate(result.vaultVersion);
      showNotification('success', `Device "${name}" removed.`);
      await refreshDevices();
    } catch (e) {
      showError(e);
    }
  };

  return (
    <div className="mb-6 rounded-lg border border-gray-200 bg-white p-4 shadow-sm dark:border-gray-700 dark:bg-gray-800">
      <div className="mb-4 flex items-center justify-between border-b border-gray-200 pb-2 dark:border-gray-700">
        <h2 className="flex items-center gap-2 text-lg font-bold text-gray-900 dark:text-gray-100">
          <Fingerprint size={18} /> Vault Biometric Devices
        </h2>
        <div className="flex gap-2">
          {webauthnAvailable && devices.length < maxDevices && (
            <button
              onClick={() => {
                setDeviceNameInput('');
                setMasterPasswordForReg('');
                setShowRegForm(true);
              }}
              disabled={registering}
              className="flex items-center gap-1 rounded bg-purple-600 px-3 py-1 text-sm text-white hover:bg-purple-700 disabled:opacity-50"
            >
              <Plus size={14} /> Add
            </button>
          )}
          <button
            onClick={refreshDevices}
            disabled={loadingDevices}
            className="rounded bg-gray-200 px-3 py-1 text-sm hover:bg-gray-300 disabled:opacity-50 dark:bg-gray-600 dark:text-gray-200 dark:hover:bg-gray-500"
          >
            Refresh
          </button>
        </div>
      </div>

      {!webauthnAvailable && (
        <div className="mb-3 rounded border border-yellow-200 bg-yellow-50 p-3 text-sm text-yellow-700 dark:border-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-300">
          <AlertTriangle size={14} className="mr-1 inline" /> WebAuthn not available.
        </div>
      )}

      {showRegForm && (
        <div className="mb-4 rounded-lg border border-purple-200 bg-purple-50 p-4 dark:border-purple-700 dark:bg-purple-900/20">
          <div className="space-y-3">
            <input
              type="text"
              placeholder="Device name"
              value={deviceNameInput}
              onChange={(e) => setDeviceNameInput(e.target.value)}
              className="w-full rounded border p-2 text-sm dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100"
              disabled={registering}
            />
            <input
              type="password"
              placeholder="Master password"
              value={masterPasswordForReg}
              onChange={(e) => setMasterPasswordForReg(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleRegisterDevice()}
              className="w-full rounded border p-2 text-sm dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100"
              disabled={registering}
            />
            <div className="flex gap-2">
              <button
                onClick={handleRegisterDevice}
                disabled={registering}
                className="flex items-center gap-1 rounded bg-purple-600 px-4 py-2 text-sm text-white hover:bg-purple-700 disabled:opacity-50"
              >
                <Fingerprint size={14} /> {registering ? 'Registering...' : 'Register'}
              </button>
              <button
                onClick={() => {
                  setShowRegForm(false);
                  setMasterPasswordForReg('');
                }}
                disabled={registering}
                className="rounded bg-gray-200 px-4 py-2 text-sm hover:bg-gray-300 dark:bg-gray-600 dark:text-gray-200 dark:hover:bg-gray-500"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {devices.length === 0 ? (
        <p className="text-gray-500 italic dark:text-gray-400">No biometric devices registered.</p>
      ) : (
        <ul className="space-y-2">
          {devices.map((device) => (
            <li key={device.slotId} className="flex items-center justify-between border-b border-gray-200 py-2 last:border-0 dark:border-gray-700">
              <div className="flex items-center gap-3">
                <Smartphone size={18} className="text-purple-600 dark:text-purple-400" />
                <div>
                  <span className="font-medium text-gray-900 dark:text-gray-100">{device.name}</span>
                  <div className="text-xs text-gray-400">
                    Registered {new Date(device.registeredAt).toLocaleDateString()}
                    {device.lastUsedAt && <> · Last used {new Date(device.lastUsedAt).toLocaleDateString()}</>}
                  </div>
                </div>
              </div>
              <button onClick={() => handleRemoveDevice(device.slotId, device.name)} className="p-1 text-red-500 hover:text-red-700">
                <X size={16} />
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className="mt-3 text-xs text-gray-400">
        {devices.length}/{maxDevices} devices
      </div>
    </div>
  );
}
