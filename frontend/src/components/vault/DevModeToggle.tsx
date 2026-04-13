import { useState, useEffect, useCallback } from 'react';
import { Code, AlertTriangle } from 'lucide-react';
import { isDevModeActive, activateDevMode, deactivateDevMode, registerDevModeCallbacks, unregisterDevModeCallbacks } from '../../lib/dev-vault';
import type { VaultEntry } from '../../lib/types';

interface Props {
  entries: VaultEntry[];
  vaultVersion: number;
  onDevModeCommit: (entries: VaultEntry[]) => void;
}

export function DevModeToggle({ entries, vaultVersion, onDevModeCommit }: Props) {
  const [active, setActive] = useState(() => isDevModeActive());
  const [showWarning, setShowWarning] = useState(false);

  // Stable reference to entries for the refresh callback
  const getEntries = useCallback(() => entries, [entries]);

  // Register callbacks when component mounts / updates
  useEffect(() => {
    if (active) {
      registerDevModeCallbacks(onDevModeCommit, getEntries);
    }
    return () => {
      if (active) {
        unregisterDevModeCallbacks();
      }
    };
  }, [active, onDevModeCommit, getEntries]);

  // Sync state if Dev Mode auto-deactivates via timeout
  useEffect(() => {
    const interval = setInterval(() => {
      const currentState = isDevModeActive();
      if (currentState !== active) {
        setActive(currentState);
      }
    }, 5000);
    return () => clearInterval(interval);
  }, [active]);

  // Refresh the snapshot whenever entries change and Dev Mode is active
  // (only if there are no uncommitted mutations — see refreshDevMode)
  useEffect(() => {
    if (active && window.$vault && !window.$vault.dirty && window.$vault.version !== vaultVersion) {
      activateDevMode(entries, vaultVersion);
      registerDevModeCallbacks(onDevModeCommit, getEntries);
    }
  }, [entries, vaultVersion, active, onDevModeCommit, getEntries]);

  const handleToggle = () => {
    if (!active) {
      setShowWarning(true);
    } else {
      deactivateDevMode();
      setActive(false);
    }
  };

  const handleConfirmActivation = () => {
    registerDevModeCallbacks(onDevModeCommit, getEntries);
    activateDevMode(entries, vaultVersion);
    setActive(true);
    setShowWarning(false);
  };

  const handleCancelActivation = () => {
    setShowWarning(false);
  };

  return (
    <div className="mb-4 rounded-lg border border-gray-200 bg-white shadow-sm dark:border-gray-700 dark:bg-gray-800">
      <div className="flex items-center justify-between px-4 py-3">
        <div className="flex items-center gap-2">
          <Code size={16} className={active ? 'text-green-500' : 'text-gray-400'} />
          <span className="text-sm font-medium text-gray-700 dark:text-gray-200">Developer Mode</span>
          {active && (
            <span className="rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-700 dark:bg-green-900/40 dark:text-green-300">Active</span>
          )}
        </div>
        <button
          onClick={handleToggle}
          className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 focus:outline-none ${
            active ? 'bg-green-500' : 'bg-gray-300 dark:bg-gray-600'
          }`}
          role="switch"
          aria-checked={active}
          aria-label="Toggle Developer Mode"
        >
          <span
            className={`pointer-events-none inline-block h-5 w-5 rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${
              active ? 'translate-x-5' : 'translate-x-0'
            }`}
          />
        </button>
      </div>

      {active && (
        <div className="border-t border-gray-200 px-4 py-2 dark:border-gray-700">
          <p className="text-xs text-gray-500 dark:text-gray-400">
            <code className="rounded bg-gray-100 px-1 py-0.5 font-mono dark:bg-gray-700">window.$vault</code> is available in DevTools. Snapshot of{' '}
            <strong>{entries.length}</strong> entries. Use <code className="rounded bg-gray-100 px-1 py-0.5 font-mono dark:bg-gray-700">$vault.commit()</code>{' '}
            or <code className="rounded bg-gray-100 px-1 py-0.5 font-mono dark:bg-gray-700">$vault.update()</code> to push changes. Auto-deactivates in 15 min.
          </p>
        </div>
      )}

      {/* Confirmation dialog */}
      {showWarning && (
        <div className="border-t border-gray-200 px-4 py-3 dark:border-gray-700">
          <div className="mb-3 flex items-start gap-2 rounded border border-amber-200 bg-amber-50 p-3 dark:border-amber-700 dark:bg-amber-900/20">
            <AlertTriangle size={16} className="mt-0.5 shrink-0 text-amber-500" />
            <div className="text-sm text-amber-700 dark:text-amber-300">
              <p className="mb-1 font-medium">Security Notice</p>
              <p className="text-xs">
                This will attach a <strong>deep clone</strong> of all decrypted vault entries (including passwords, TOTP secrets, and all field values) to{' '}
                <code className="rounded bg-amber-100 px-1 dark:bg-amber-900/40">window.$vault</code>. The data will be accessible and <strong>editable</strong>{' '}
                from the browser console. Use <code className="rounded bg-amber-100 px-1 dark:bg-amber-900/40">$vault.commit()</code> to push changes back.
                Auto-clears after 15 minutes or on deactivation.
              </p>
            </div>
          </div>
          <div className="flex gap-2">
            <button onClick={handleConfirmActivation} className="rounded bg-green-600 px-3 py-1.5 text-sm text-white hover:bg-green-700">
              Activate Developer Mode
            </button>
            <button
              onClick={handleCancelActivation}
              className="rounded bg-gray-200 px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-300 dark:bg-gray-600 dark:text-gray-200 dark:hover:bg-gray-500"
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
