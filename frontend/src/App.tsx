import { useState, useEffect, useCallback, useRef } from 'react';
import * as cryptoLib from './lib/crypto';
import * as webauthnLib from './lib/webauthn';
import { api } from './lib/api';
import type { VaultMeta } from './lib/api';
import type { VaultEntry, VaultPayload } from './lib/types';
import { VaultError, ErrorCodes, friendlyMessages } from './lib/errors';
import { AutoLockTimer } from './lib/secure-state';
import { getStoredTheme, setStoredTheme, applyTheme } from './lib/theme';
import type { Theme } from './lib/theme';
import { Notification } from './components/NotificationBanner';
import { NotificationBanner } from './components/NotificationBanner';
import { SessionBar } from './components/SessionBar';
import { ThemeToggle } from './components/ui/ThemeToggle';
import { PasswordGenerator } from './components/ui/PasswordGenerator';
import { SetupApiKey } from './components/auth/SetupApiKey';
import { LoginForm } from './components/auth/LoginForm';
import { SetupVault } from './components/vault/SetupVault';
import { LockedVault } from './components/vault/LockedVault';
import type { UnlockResult } from './components/vault/LockedVault';
import { VaultBrowser } from './components/vault/VaultBrowser';
import { BiometricDevicesPanel } from './components/devices/BiometricDevicesPanel';
import { ApiWebAuthnPanel } from './components/devices/ApiWebAuthnPanel';
import { USBDrivesPanel } from './components/drives/USBDrivesPanel';
import { Unlock, Save } from 'lucide-react';
// ── Types ──

type AppState = 'loading' | 'setup_api_key' | 'enter_api_key' | 'setup_vault' | 'locked' | 'unlocked';

type ActiveTab = 'vault' | 'devices' | 'drives';

const DEFAULT_AUTO_LOCK_MS = 5 * 60 * 1000;

export default function App() {
  const [appState, setAppState] = useState<AppState>('loading');
  const [notification, setNotification] = useState<Notification | null>(null);
  const [activeTab, setActiveTab] = useState<ActiveTab>('vault');
  const [theme, setTheme] = useState<Theme>(() => getStoredTheme());

  // API Key state
  const [hasApiWebAuthn, setHasApiWebAuthn] = useState(false);

  // Auto-lock timeout from server
  const [autoLockMs, setAutoLockMs] = useState(DEFAULT_AUTO_LOCK_MS);

  // Vault state
  const [vaultMeta, setVaultMeta] = useState<VaultMeta | null>(null);
  const [dekExtractable, setDekExtractable] = useState<CryptoKey | null>(null);
  const [vaultVersion, setVaultVersion] = useState(0);
  const [isSaving, setIsSaving] = useState(false);

  // Editing state
  const [editingEntries, setEditingEntries] = useState<VaultEntry[]>([]);
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
  // eslint-disable-next-line react-hooks/purity
  const lastActiveRef = useRef<number>(Date.now());

  // ── Theme ──

  useEffect(() => {
    applyTheme(theme);
    setStoredTheme(theme);
  }, [theme]);

  const toggleTheme = useCallback(() => {
    setTheme((t) => (t === 'light' ? 'dark' : 'light'));
  }, []);

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
    if (type !== 'error') setTimeout(() => setNotification(null), 5000);
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
    setEditingEntries([]);
    setIsDirty(false);
    setVaultVersionSafe(0);
    setVaultMeta(null);
    autoLockTimer.current?.stop();
    setAppState('enter_api_key');
  }, []);

  useEffect(() => {
    handleServerLogoutRef.current = handleServerLogout;
  }, [handleServerLogout]);

  // ── Vault lock ──

  const handleVaultLock = useCallback(() => {
    setDekSafe(null);
    setDekExtractable(null);
    setEditingEntries([]);
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
      lastActiveRef.current = Date.now();

      let lastReset = 0;
      const THROTTLE_MS = 30_000;

      const resetTimer = () => {
        const now = Date.now();
        lastActiveRef.current = now;
        if (now - lastReset > THROTTLE_MS) {
          lastReset = now;
          autoLockTimer.current?.reset();
        }
      };

      window.addEventListener('mousemove', resetTimer);
      window.addEventListener('keydown', resetTimer);
      window.addEventListener('click', resetTimer);
      window.addEventListener('touchstart', resetTimer);
      return () => {
        window.removeEventListener('mousemove', resetTimer);
        window.removeEventListener('keydown', resetTimer);
        window.removeEventListener('click', resetTimer);
        window.removeEventListener('touchstart', resetTimer);
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

  // ── WebAuthn check ──

  useEffect(() => {
    webauthnLib.isWebAuthnAvailable().then(setWebauthnAvailable);
  }, []);

  // ── Boot ──

  useEffect(() => {
    const boot = async () => {
      try {
        const status = await api.getStatus();
        setHasApiWebAuthn(status.hasApiWebAuthn);
        if (status.autoLockMinutes) setAutoLockMs(status.autoLockMinutes * 60 * 1000);
        if (!status.configured) {
          setAppState('setup_api_key');
          return;
        }
        try {
          const session = await api.getSession();
          if (session.valid) {
            // Session is valid — fetch CSRF token (handles page reload / F5)
            await api.fetchCsrfToken();
            setAppState(status.vaultCreated ? 'locked' : 'setup_vault');
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
    setAppState(status.vaultCreated ? 'locked' : 'setup_vault');
  }, []);

  // ── Unlock handler ──

  const handleUnlock = useCallback((result: UnlockResult) => {
    setDekSafe(result.dek);
    setDekExtractable(result.dekExtractable);
    setEditingEntries(result.entries);
    setIsDirty(false);
    setVaultMeta(result.vaultMeta);
    setVaultVersionSafe(result.vaultVersion);
    setAppState('unlocked');
  }, []);

  // ── Manual Save ──

  const handleManualSave = useCallback(async () => {
    if (isSaving) return;

    const currentDek = dekRef.current;
    const currentVersion = vaultVersionRef.current;
    if (!currentDek) return;

    setIsSaving(true);

    try {
      const payload: VaultPayload = { entries: editingEntries };
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
    } finally {
      setIsSaving(false);
    }
  }, [editingEntries, showNotification, showError, isSaving]);

  // ── Entry CRUD ──

  const handleAddEntry = useCallback((entry: VaultEntry) => {
    setEditingEntries((prev) => [...prev, entry]);
    setIsDirty(true);
  }, []);

  const handleUpdateEntry = useCallback((id: string, changes: Partial<VaultEntry>) => {
    setEditingEntries((prev) => prev.map((e) => (e.id === id ? { ...e, ...changes, modifiedAt: new Date().toISOString() } : e)));
    setIsDirty(true);
  }, []);

  const handleDeleteEntry = useCallback((id: string) => {
    setEditingEntries((prev) => prev.filter((e) => e.id !== id));
    setIsDirty(true);
  }, []);

  // ── Render ──

  if (appState === 'loading') {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gray-50 dark:bg-gray-900">
        <div className="text-lg text-gray-500 dark:text-gray-400">Loading Secure Vault...</div>
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
    { key: 'vault', label: `Vault (${editingEntries.length})` },
    { key: 'devices', label: 'Devices' },
    { key: 'drives', label: 'USB Drives' },
  ];

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900">
      <SessionBar onSessionExpired={handleServerLogout} autoLockMs={autoLockMs} lastActiveRef={lastActiveRef} />
      <NotificationBanner notification={notification} onDismiss={dismissNotification} />
      <div className="mx-auto min-h-screen max-w-3xl bg-gray-50 px-4 pt-10 pb-8 dark:bg-gray-900">
        {/* Header */}
        <div className="mb-4 flex items-center justify-between">
          <h1 className="flex items-center gap-2 text-xl font-bold text-gray-900 sm:text-2xl dark:text-gray-100">
            <Unlock className="text-green-600" /> Secure Vault
          </h1>
          <div className="flex items-center gap-2">
            <ThemeToggle theme={theme} onToggle={toggleTheme} />
            <span className="text-xs text-gray-400">v{vaultVersion}</span>
            {isDirty && (
              <button
                onClick={handleManualSave}
                disabled={isSaving}
                className="flex items-center gap-1 rounded bg-blue-600 px-3 py-1 text-sm text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
              >
                <Save size={14} /> {isSaving ? 'Saving...' : 'Save'}
              </button>
            )}
            {isDirty && <span className="rounded bg-yellow-100 px-2 py-0.5 text-xs text-yellow-700 dark:bg-yellow-900/40 dark:text-yellow-300">unsaved</span>}
            <button onClick={handleVaultLock} className="rounded bg-amber-500 px-3 py-1.5 text-sm text-white hover:bg-amber-600">
              Lock
            </button>
            <button onClick={handleServerLogout} className="rounded bg-red-500 px-3 py-1.5 text-sm text-white hover:bg-red-600">
              Logout
            </button>
          </div>
        </div>

        {/* Password Generator */}
        <PasswordGenerator />

        {/* Tab Navigation */}
        <div className="mb-4 flex overflow-x-auto border-b border-gray-200 dark:border-gray-700">
          {tabs.map((tab) => (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              className={`border-b-2 px-4 py-2 text-sm font-medium whitespace-nowrap transition-colors ${
                activeTab === tab.key
                  ? 'border-blue-600 text-blue-600 dark:border-blue-400 dark:text-blue-400'
                  : 'border-transparent text-gray-500 hover:border-gray-300 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* Tab Content */}
        {activeTab === 'vault' && (
          <VaultBrowser entries={editingEntries} onAddEntry={handleAddEntry} onUpdateEntry={handleUpdateEntry} onDeleteEntry={handleDeleteEntry} />
        )}

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
    </div>
  );
}
