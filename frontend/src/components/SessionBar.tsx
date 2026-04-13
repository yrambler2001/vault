import { useState, useEffect, useCallback, useRef } from 'react';
import { Clock, Lock, WifiOff } from 'lucide-react';
import { api } from '../lib/api';

interface Props {
  onSessionExpired: () => void;
  autoLockMs?: number;
  lastActiveRef?: React.MutableRefObject<number>;
  isOfflineMode?: boolean;
}

export function SessionBar({ onSessionExpired, autoLockMs, lastActiveRef, isOfflineMode }: Props) {
  const [localExpiresAt, setLocalExpiresAt] = useState<number>(0);
  const [timeLeft, setTimeLeft] = useState<string>('');
  const [vaultTimeLeft, setVaultTimeLeft] = useState<string>('');

  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchSessionInfo = useCallback(async () => {
    if (isOfflineMode) return;
    try {
      const info = await api.getSession();
      if (!info.valid) {
        onSessionExpired();
        return;
      }
      setLocalExpiresAt(Date.now() + info.remainingMs);
    } catch {
      onSessionExpired();
    }
  }, [onSessionExpired, isOfflineMode]);

  useEffect(() => {
    fetchSessionInfo();
  }, [fetchSessionInfo]);

  useEffect(() => {
    const update = () => {
      // 1. Session Logic (skip in offline mode)
      if (!isOfflineMode && localExpiresAt) {
        const remaining = localExpiresAt - Date.now();
        if (remaining <= 0) {
          setTimeLeft('Expired');
          onSessionExpired();
          return;
        }
        const mins = Math.floor(remaining / 60000);
        const secs = Math.floor((remaining % 60000) / 1000);
        setTimeLeft(`${mins}:${secs.toString().padStart(2, '0')}`);
      }

      // 2. Vault Auto-lock Logic
      if (autoLockMs && lastActiveRef) {
        const vaultRemaining = autoLockMs - (Date.now() - lastActiveRef.current);
        if (vaultRemaining > 0) {
          const vMins = Math.floor(vaultRemaining / 60000);
          const vSecs = Math.floor((vaultRemaining % 60000) / 1000);
          setVaultTimeLeft(`${vMins}:${vSecs.toString().padStart(2, '0')}`);
        } else {
          setVaultTimeLeft('Locked');
        }
      }
    };

    update();
    intervalRef.current = setInterval(update, 1000);
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [localExpiresAt, onSessionExpired, autoLockMs, lastActiveRef, isOfflineMode]);

  // eslint-disable-next-line react-hooks/purity
  const remaining = localExpiresAt - Date.now();
  const isSessionLow = remaining > 0 && remaining < 5 * 60 * 1000;

  // eslint-disable-next-line react-hooks/purity
  const vaultRemaining = autoLockMs && lastActiveRef ? autoLockMs - (Date.now() - lastActiveRef.current) : 0;
  const isVaultLow = vaultRemaining > 0 && vaultRemaining < 60 * 1000;

  return (
    <div className="fixed top-0 right-0 left-0 z-40 flex items-center justify-between bg-gray-800 px-4 py-1 text-xs text-white dark:bg-gray-950">
      <div className="flex items-center gap-4">
        {isOfflineMode ? (
          <div className="flex items-center gap-2 text-amber-400">
            <WifiOff size={12} />
            <span className="font-medium">Offline Mode</span>
          </div>
        ) : (
          <div className="flex items-center gap-2">
            <Clock size={12} />
            <span>
              Session: <span className={`font-mono tabular-nums ${isSessionLow ? 'font-bold text-red-400' : 'text-green-400'}`}>{timeLeft}</span>
            </span>
          </div>
        )}

        {autoLockMs && (
          <div className="flex items-center gap-2 border-l border-gray-600 pl-4">
            <Lock size={12} />
            <span>
              Vault Auto-lock: <span className={`font-mono tabular-nums ${isVaultLow ? 'font-bold text-amber-400' : 'text-green-400'}`}>{vaultTimeLeft}</span>
            </span>
          </div>
        )}
      </div>
    </div>
  );
}
