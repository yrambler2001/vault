import { useState, useEffect, useCallback, useRef } from 'react';
import * as cryptoLib from './lib/crypto';
import * as webauthnLib from './lib/webauthn';
import { api } from './lib/api';
import type { VaultMeta } from './lib/api';
import { VaultError, ErrorCodes, friendlyMessages } from './lib/errors';
import { AutoLockTimer } from './lib/secure-state';
import { Notification } from './components/NotificationBanner';
import { NotificationBanner } from './components/NotificationBanner';
import { SessionBar } from './components/SessionBar';
import { SetupApiKey } from './components/auth/SetupApiKey';
import { LoginForm } from './components/auth/LoginForm';
import { SetupVault } from './components/vault/SetupVault';
import { LockedVault } from './components/vault/LockedVault';
import type { PasswordEntry, UnlockResult } from './components/vault/LockedVault';
import { PasswordsPanel } from './components/passwords/PasswordsPanel';
import { TOTPPanel } from './components/totp/TOTPPanel';
import type { TOTPEntry } from './components/totp/TOTPPanel';
import { BiometricDevicesPanel } from './components/devices/BiometricDevicesPanel';
import { ApiWebAuthnPanel } from './components/devices/ApiWebAuthnPanel';
import { USBDrivesPanel } from './components/drives/USBDrivesPanel';
import { Unlock, Save } from 'lucide-react';

// ── Types ──

type AppState = 'loading' | 'setup_api_key' | 'enter_api_key' | 'setup_vault' | 'locked' | 'unlocked';

type ActiveTab = 'passwords' | 'totp' | 'devices' | 'drives';

const DEFAULT_AUTO_LOCK_MS = 5 * 60 * 1000;

export default function App() {
  const [appState, setAppState] = useState<AppState>('loading');
  const [notification, setNotification] = useState<Notification | null>(null);
  const [activeTab, setActiveTab] = useState<ActiveTab>('passwords');

  // API Key state
  const [hasApiWebAuthn, setHasApiWebAuthn] = useState(false);

  // Auto-lock timeout from server
  const [autoLockMs, setAutoLockMs] = useState(DEFAULT_AUTO_LOCK_MS);

  // Vault state
  const [vaultMeta, setVaultMeta] = useState<VaultMeta | null>(null);
  const [dekExtractable, setDekExtractable] = useState<CryptoKey | null>(null);
  const [vaultVersion, setVaultVersion] = useState(0);

  // Editing state
  const [editingPasswords, setEditingPasswords] = useState<PasswordEntry[]>([]);
  const [editingTotps, setEditingTotps] = useState<TOTPEntry[]>([]);

  /**
   * Dirty flag for unsaved changes detection.
   *
   * DESIGN NOTE: We use an explicit dirty flag rather than
   * `JSON.stringify(editingPasswords) !== JSON.stringify(passwords)`.
   * The JSON comparison approach runs O(n) serialization on every render,
   * which is wasteful for large vaults. The dirty flag is O(1) and is
   * set on any edit, cleared on save. This is intentional and by design.
   */
  const [isDirty, setIsDirty] = useState(false);

  // WebAuthn state
  const [webauthnAvailable, setWebauthnAvailable] = useState(false);

  // Refs
  const dekRef = useRef<CryptoKey | null>(null);
  const vaultVersionRef = useRef<number>(0);
  const autoLockTimer = useRef<AutoLockTimer | null>(null);
  const handleServerLogoutRef = useRef<() => void>(() => {});

  const setDekSafe = (key: CryptoKey | null) => {
    dekRef.current = key;
  };

  const setVaultVersionSafe = (v: number) => {
    vaultVersionRef.current = v;
    setVaultVersion(v);
  };

  // ── Notification helpers ──

  const showNotification = useCallback((type: Notification['type'], message: string) => {
    setNotification({ type, message });
    if (type !== 'error') {
      setTimeout(() => setNotification(null), 5000);
    }
  }, []);

  const showError = useCallback(
    (err: unknown) => {
      if (err instanceof VaultError) {
        console.error(`[${err.code}]`, err.debugInfo);
        showNotification('error', err.userMessage);
      } else if (err instanceof Error) {
        console.error(err);
        if (err.message === 'SESSION_EXPIRED') {
          handleServerLogoutRef.current();
          showNotification('error', friendlyMessages.SESSION_EXPIRED);
        } else if (err.message === 'NETWORK_ERROR') {
          showNotification('error', friendlyMessages.NETWORK_ERROR);
        } else if (err.message === 'CSRF_TOKEN_INVALID') {
          // Auto-refresh CSRF token and show user-friendly message
          api.fetchCsrfToken().catch(() => {});
          showNotification('warning', friendlyMessages.CSRF_INVALID);
        } else {
          showNotification('error', err.message || friendlyMessages.UNKNOWN);
        }
      } else {
        showNotification('error', friendlyMessages.UNKNOWN);
      }
    },
    [showNotification],
  );

  const dismissNotification = useCallback(() => setNotification(null), []);

  // ── Server logout ──

  const handleServerLogout = useCallback(() => {
    api.logout().catch(() => {});
    api.clearCsrfToken();
    setDekSafe(null);
    setDekExtractable(null);
    setEditingPasswords([]);
    setEditingTotps([]);
    setIsDirty(false);
    setVaultVersionSafe(0);
    setVaultMeta(null);
    autoLockTimer.current?.stop();
    setAppState('enter_api_key');
  }, []);

  // Keep ref in sync
  useEffect(() => {
    handleServerLogoutRef.current = handleServerLogout;
  }, [handleServerLogout]);

  // ── Vault lock ──

  const handleVaultLock = useCallback(() => {
    setDekSafe(null);
    setDekExtractable(null);
    setEditingPasswords([]);
    setEditingTotps([]);
    setIsDirty(false);
    setVaultVersionSafe(0);
    autoLockTimer.current?.stop();
    setAppState('locked');
  }, []);

  // ── Auto-lock timer ──

  useEffect(() => {
    if (appState === 'unlocked') {
      autoLockTimer.current = new AutoLockTimer(handleVaultLock, autoLockMs);
      autoLockTimer.current.reset();

      let lastReset = 0;
      const THROTTLE_MS = 30_000;

      const resetTimer = () => {
        const now = Date.now();
        if (now - lastReset > THROTTLE_MS) {
          lastReset = now;
          autoLockTimer.current?.reset();
        }
      };

      window.addEventListener('mousemove', resetTimer);
      window.addEventListener('keydown', resetTimer);
      window.addEventListener('click', resetTimer);

      return () => {
        window.removeEventListener('mousemove', resetTimer);
        window.removeEventListener('keydown', resetTimer);
        window.removeEventListener('click', resetTimer);
        autoLockTimer.current?.stop();
      };
    }
  }, [appState, handleVaultLock, autoLockMs]);

  // ── Unsaved changes warning ──

  useEffect(() => {
    if (isDirty) {
      const handler = (e: BeforeUnloadEvent) => {
        e.preventDefault();
        e.returnValue = '';
      };
      window.addEventListener('beforeunload', handler);
      return () => window.removeEventListener('beforeunload', handler);
    }
  }, [isDirty]);

  // ── Check WebAuthn availability ──

  useEffect(() => {
    webauthnLib.isWebAuthnAvailable().then(setWebauthnAvailable);
  }, []);

  // ── Boot ──

  useEffect(() => {
    const boot = async () => {
      try {
        const status = await api.getStatus();
        setHasApiWebAuthn(status.hasApiWebAuthn);

        if (status.autoLockMinutes) {
          setAutoLockMs(status.autoLockMinutes * 60 * 1000);
        }

        if (!status.configured) {
          setAppState('setup_api_key');
          return;
        }

        try {
          const session = await api.getSession();
          if (session.valid) {
            // Session is valid — fetch CSRF token (handles page reload / F5)
            await api.fetchCsrfToken();

            if (status.vaultCreated) {
              setAppState('locked');
            } else {
              setAppState('setup_vault');
            }
            return;
          }
        } catch {
          // No valid session
        }

        setAppState('enter_api_key');
      } catch {
        showNotification('error', friendlyMessages.NETWORK_ERROR);
        setAppState('enter_api_key');
      }
    };

    boot();
  }, [showNotification]);

  // ── Post-login navigation ──

  const handleLoginSuccess = useCallback(async () => {
    const status = await api.getStatus();
    setHasApiWebAuthn(status.hasApiWebAuthn);
    if (status.vaultCreated) {
      setAppState('locked');
    } else {
      setAppState('setup_vault');
    }
  }, []);

  // ── Unlock handler ──

  const handleUnlock = useCallback((result: UnlockResult) => {
    setDekSafe(result.dek);
    setDekExtractable(result.dekExtractable);
    setEditingPasswords(result.passwords);
    setEditingTotps(result.totps);
    setIsDirty(false);
    setVaultMeta(result.vaultMeta);
    setVaultVersionSafe(result.vaultVersion);
    setAppState('unlocked');
  }, []);

  // ── Manual Save ──

  const handleManualSave = useCallback(async () => {
    const currentDek = dekRef.current;
    const currentVersion = vaultVersionRef.current;
    if (!currentDek) return;

    try {
      const payload = {
        passwords: editingPasswords,
        totps: editingTotps,
      };
      const encrypted = await cryptoLib.encryptPayload(payload, currentDek);
      const result = await api.updateData(encrypted, currentVersion);

      setIsDirty(false);
      setVaultVersionSafe(result.version);

      if (result.usbDrives?.failed?.length > 0) {
        showNotification('warning', `${friendlyMessages.USB_WRITE_PARTIAL} Failed: ${result.usbDrives.failed.join(', ')}`);
      } else {
        showNotification('success', 'Saved.');
      }
    } catch (e: unknown) {
      const err = e as Error & { body?: { error?: string } };
      if (err?.body?.error === 'Version conflict') {
        showError(new VaultError(ErrorCodes.VERSION_CONFLICT, friendlyMessages.VERSION_CONFLICT, err.body));
      } else {
        showError(e);
      }
    }
  }, [editingPasswords, editingTotps, showNotification, showError]);

  // ── Password CRUD (local only, no auto-save) ──

  const handleAddPassword = useCallback(() => {
    const newEntry: PasswordEntry = {
      id: crypto.randomUUID(),
      service: '',
      username: '',
      password: '',
      notes: '',
      createdAt: new Date().toISOString(),
      modifiedAt: new Date().toISOString(),
    };
    setEditingPasswords((prev) => [...prev, newEntry]);
    setIsDirty(true);
  }, []);

  const handleUpdatePassword = useCallback((id: string, changes: Partial<PasswordEntry>) => {
    setEditingPasswords((prev) => prev.map((p) => (p.id === id ? { ...p, ...changes, modifiedAt: new Date().toISOString() } : p)));
    setIsDirty(true);
  }, []);

  /**
   * Delete password entry.
   *
   * DESIGN NOTE: Uses window.confirm() for confirmation dialogs.
   * This is a blocking synchronous call which is suboptimal for UI
   * responsiveness, but is acceptable here because:
   *   - Delete is an infrequent, destructive operation
   *   - The blocking nature prevents accidental double-clicks
   *   - A custom modal would add complexity for minimal benefit
   * This is by design — a React modal could be added later if needed.
   */
  const handleDeletePassword = useCallback((id: string) => {
    if (!window.confirm('Delete this password entry?')) return;
    setEditingPasswords((prev) => prev.filter((p) => p.id !== id));
    setIsDirty(true);
  }, []);

  // ── TOTP CRUD (local only, no auto-save) ──

  const handleAddTOTP = useCallback((entry: TOTPEntry) => {
    setEditingTotps((prev) => [...prev, entry]);
    setIsDirty(true);
  }, []);

  const handleUpdateTOTP = useCallback((id: string, changes: Partial<TOTPEntry>) => {
    setEditingTotps((prev) => prev.map((t) => (t.id === id ? { ...t, ...changes, modifiedAt: new Date().toISOString() } : t)));
    setIsDirty(true);
  }, []);

  const handleDeleteTOTP = useCallback((id: string) => {
    setEditingTotps((prev) => prev.filter((t) => t.id !== id));
    setIsDirty(true);
  }, []);

  // ── Render ──

  if (appState === 'loading') {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gray-50">
        <div className="text-lg text-gray-500">Loading Secure Vault...</div>
      </div>
    );
  }

  if (appState === 'setup_api_key') {
    return (
      <SetupApiKey
        onComplete={() => setAppState('setup_vault')}
        showNotification={showNotification}
        showError={showError}
        notification={notification}
        onDismissNotification={dismissNotification}
      />
    );
  }

  if (appState === 'enter_api_key') {
    return (
      <LoginForm
        hasApiWebAuthn={hasApiWebAuthn}
        webauthnAvailable={webauthnAvailable}
        onLoginSuccess={handleLoginSuccess}
        showNotification={showNotification}
        showError={showError}
        notification={notification}
        onDismissNotification={dismissNotification}
      />
    );
  }

  if (appState === 'setup_vault') {
    return (
      <SetupVault
        onComplete={() => setAppState('locked')}
        onLogout={handleServerLogout}
        showNotification={showNotification}
        showError={showError}
        notification={notification}
        onDismissNotification={dismissNotification}
      />
    );
  }

  if (appState === 'locked') {
    return (
      <LockedVault
        onUnlock={handleUnlock}
        onLogout={handleServerLogout}
        showNotification={showNotification}
        showError={showError}
        notification={notification}
        onDismissNotification={dismissNotification}
      />
    );
  }

  // ── Unlocked ──

  const tabs: { key: ActiveTab; label: string }[] = [
    { key: 'passwords', label: `Passwords (${editingPasswords.length})` },
    { key: 'totp', label: `2FA (${editingTotps.length})` },
    { key: 'devices', label: 'Devices' },
    { key: 'drives', label: 'USB Drives' },
  ];

  return (
    <>
      <SessionBar onSessionExpired={handleServerLogout} />
      <NotificationBanner notification={notification} onDismiss={dismissNotification} />
      <div className="mx-auto min-h-screen max-w-3xl bg-gray-50 p-4 pt-10 md:p-8">
        {/* Header */}
        <div className="mb-6 flex items-center justify-between">
          <h1 className="flex items-center gap-2 text-2xl font-bold">
            <Unlock className="text-green-600" /> Secure Vault
          </h1>
          <div className="flex items-center gap-3">
            <span className="text-xs text-gray-400">v{vaultVersion}</span>
            {isDirty && (
              <button
                onClick={handleManualSave}
                className="flex items-center gap-1 rounded bg-blue-600 px-3 py-1 text-sm text-white transition-colors hover:bg-blue-700"
              >
                <Save size={14} /> Save
              </button>
            )}
            {isDirty && <span className="rounded bg-yellow-100 px-2 py-0.5 text-xs text-yellow-700">unsaved</span>}
            <button onClick={handleVaultLock} className="rounded bg-amber-500 px-4 py-2 text-white transition-colors hover:bg-amber-600">
              Lock
            </button>
            <button onClick={handleServerLogout} className="rounded bg-red-500 px-4 py-2 text-white transition-colors hover:bg-red-600">
              Logout
            </button>
          </div>
        </div>

        {/* Tab Navigation */}
        <div className="mb-6 flex border-b">
          {tabs.map((tab) => (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              className={`border-b-2 px-4 py-2 text-sm font-medium transition-colors ${
                activeTab === tab.key ? 'border-blue-600 text-blue-600' : 'border-transparent text-gray-500 hover:border-gray-300 hover:text-gray-700'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* Tab Content */}
        {activeTab === 'passwords' && (
          <PasswordsPanel passwords={editingPasswords} onAdd={handleAddPassword} onUpdate={handleUpdatePassword} onDelete={handleDeletePassword} />
        )}

        {activeTab === 'totp' && <TOTPPanel totps={editingTotps} onAdd={handleAddTOTP} onUpdate={handleUpdateTOTP} onDelete={handleDeleteTOTP} />}

        {activeTab === 'devices' && (
          <>
            <BiometricDevicesPanel
              vaultMeta={vaultMeta}
              dekExtractable={dekExtractable}
              webauthnAvailable={webauthnAvailable}
              onVersionUpdate={setVaultVersionSafe}
              showNotification={showNotification}
              showError={showError}
            />
            <ApiWebAuthnPanel webauthnAvailable={webauthnAvailable} showNotification={showNotification} showError={showError} />
          </>
        )}

        {activeTab === 'drives' && <USBDrivesPanel />}
      </div>
    </>
  );
}
