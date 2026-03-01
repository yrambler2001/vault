import { useState, useEffect, useCallback } from 'react';
import { Key, Fingerprint, Plus, X, AlertTriangle } from 'lucide-react';
import * as webauthnLib from '../../lib/webauthn';
import { api } from '../../lib/api';
import type { ApiWebAuthnCredential } from '../../lib/api';
import type { Notification } from '../NotificationBanner';
import type { PublicKeyCredentialCreationOptionsJSON } from '@simplewebauthn/browser';

interface Props {
  webauthnAvailable: boolean;
  showNotification: (type: Notification['type'], msg: string) => void;
  showError: (err: unknown) => void;
}

export function ApiWebAuthnPanel({ webauthnAvailable, showNotification, showError }: Props) {
  const [credentials, setCredentials] = useState<ApiWebAuthnCredential[]>([]);
  const [maxCreds, setMaxCreds] = useState(10);
  const [loadingCreds, setLoadingCreds] = useState(false);
  const [registering, setRegistering] = useState(false);
  const [deviceNameInput, setDeviceNameInput] = useState('');
  const [showRegForm, setShowRegForm] = useState(false);

  const refresh = useCallback(async () => {
    setLoadingCreds(true);
    try {
      const { credentials: c, maxCredentials: max } = await api.listApiWebAuthnCredentials();
      setCredentials(c);
      setMaxCreds(max);
    } catch {
      // non-critical
    } finally {
      setLoadingCreds(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const handleRegister = async () => {
    if (!deviceNameInput.trim()) {
      showNotification('error', 'Please enter a device name.');
      return;
    }

    setRegistering(true);
    try {
      const { challengeId, options } = await api.getApiWebAuthnRegisterOptions();
      const response = await webauthnLib.registerApiCredential(options as PublicKeyCredentialCreationOptionsJSON);

      await api.registerApiWebAuthn({
        name: deviceNameInput.trim(),
        challengeId,
        response,
      });

      setShowRegForm(false);
      setDeviceNameInput('');
      showNotification('success', `API credential "${deviceNameInput.trim()}" registered.`);
      await refresh();
    } catch (e: unknown) {
      const err = e as Error;
      if (err.message?.includes('cancelled')) {
        showNotification('info', 'Registration was cancelled.');
      } else {
        showError(e);
      }
    } finally {
      setRegistering(false);
    }
  };

  const handleRemove = async (credentialId: string, name: string) => {
    if (!window.confirm(`Remove API credential "${name}"?`)) return;
    try {
      await api.removeApiWebAuthnCredential(credentialId);
      showNotification('success', `"${name}" removed.`);
      await refresh();
    } catch (e) {
      showError(e);
    }
  };

  return (
    <div className="mb-6 rounded-lg border border-gray-200 bg-white p-4 shadow-sm dark:border-gray-700 dark:bg-gray-800">
      <div className="mb-4 flex items-center justify-between border-b border-gray-200 pb-2 dark:border-gray-700">
        <h2 className="flex items-center gap-2 text-lg font-bold text-gray-900 dark:text-gray-100">
          <Key size={18} /> API Login Credentials
        </h2>
        <div className="flex gap-2">
          {webauthnAvailable && credentials.length < maxCreds && (
            <button
              onClick={() => {
                setDeviceNameInput('');
                setShowRegForm(true);
              }}
              disabled={registering}
              className="flex items-center gap-1 rounded bg-indigo-600 px-3 py-1 text-sm text-white hover:bg-indigo-700 disabled:opacity-50"
            >
              <Plus size={14} /> Add
            </button>
          )}
          <button
            onClick={refresh}
            disabled={loadingCreds}
            className="rounded bg-gray-200 px-3 py-1 text-sm hover:bg-gray-300 disabled:opacity-50 dark:bg-gray-600 dark:text-gray-200 dark:hover:bg-gray-500"
          >
            Refresh
          </button>
        </div>
      </div>

      <p className="mb-3 text-xs text-gray-500 dark:text-gray-400">These credentials let you log in with biometrics instead of your API key.</p>

      {!webauthnAvailable && (
        <div className="mb-3 rounded border border-yellow-200 bg-yellow-50 p-3 text-sm text-yellow-700 dark:border-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-300">
          <AlertTriangle size={14} className="mr-1 inline" /> WebAuthn not available.
        </div>
      )}

      {showRegForm && (
        <div className="mb-4 rounded-lg border border-indigo-200 bg-indigo-50 p-4 dark:border-indigo-700 dark:bg-indigo-900/20">
          <input
            type="text"
            placeholder="Device name"
            value={deviceNameInput}
            onChange={(e) => setDeviceNameInput(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleRegister()}
            className="mb-3 w-full rounded border p-2 text-sm dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100"
            disabled={registering}
          />
          <div className="flex gap-2">
            <button
              onClick={handleRegister}
              disabled={registering}
              className="flex items-center gap-1 rounded bg-indigo-600 px-4 py-2 text-sm text-white hover:bg-indigo-700 disabled:opacity-50"
            >
              <Fingerprint size={14} /> {registering ? 'Registering...' : 'Register'}
            </button>
            <button
              onClick={() => setShowRegForm(false)}
              disabled={registering}
              className="rounded bg-gray-200 px-4 py-2 text-sm hover:bg-gray-300 dark:bg-gray-600 dark:text-gray-200 dark:hover:bg-gray-500"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {credentials.length === 0 ? (
        <p className="text-gray-500 italic dark:text-gray-400">No API WebAuthn credentials registered.</p>
      ) : (
        <ul className="space-y-2">
          {credentials.map((cred) => (
            <li key={cred.credentialId} className="flex items-center justify-between border-b border-gray-200 py-2 last:border-0 dark:border-gray-700">
              <div className="flex items-center gap-3">
                <Key size={18} className="text-indigo-600 dark:text-indigo-400" />
                <div>
                  <span className="font-medium text-gray-900 dark:text-gray-100">{cred.name}</span>
                  <div className="text-xs text-gray-400">
                    Registered {new Date(cred.registeredAt).toLocaleDateString()}
                    {cred.lastUsedAt && <> · Last used {new Date(cred.lastUsedAt).toLocaleDateString()}</>}
                  </div>
                </div>
              </div>
              <button onClick={() => handleRemove(cred.credentialId, cred.name)} className="p-1 text-red-500 hover:text-red-700">
                <X size={16} />
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className="mt-3 text-xs text-gray-400">
        {credentials.length}/{maxCreds} credentials
      </div>
    </div>
  );
}
