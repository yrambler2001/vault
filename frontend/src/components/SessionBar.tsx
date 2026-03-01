import { useState, useEffect, useCallback, useRef } from 'react';
import { api } from '../lib/api';
import { Clock } from 'lucide-react';

interface Props {
  onSessionExpired: () => void;
}

export function SessionBar({ onSessionExpired }: Props) {
  const [localExpiresAt, setLocalExpiresAt] = useState<number>(0);
  const [timeLeft, setTimeLeft] = useState<string>('');
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchSessionInfo = useCallback(async () => {
    try {
      const info = await api.getSession();
      if (!info.valid) {
        onSessionExpired();
        return;
      }
      // Use server's remainingMs to compute local expiration time,
      // avoiding client/server clock skew issues
      setLocalExpiresAt(Date.now() + info.remainingMs);
    } catch {
      onSessionExpired();
    }
  }, [onSessionExpired]);

  useEffect(() => {
    fetchSessionInfo();
  }, [fetchSessionInfo]);

  useEffect(() => {
    const update = () => {
      if (!localExpiresAt) return;

      const remaining = localExpiresAt - Date.now();
      if (remaining <= 0) {
        setTimeLeft('Expired');
        onSessionExpired();
        return;
      }

      const mins = Math.floor(remaining / 60000);
      const secs = Math.floor((remaining % 60000) / 1000);
      setTimeLeft(`${mins}:${secs.toString().padStart(2, '0')}`);
    };

    update();
    intervalRef.current = setInterval(update, 1000);
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [localExpiresAt, onSessionExpired]);

  // eslint-disable-next-line react-hooks/purity
  const remaining = localExpiresAt - Date.now();
  const isLow = remaining > 0 && remaining < 5 * 60 * 1000;

  return (
    <div className="fixed top-0 right-0 left-0 z-40 flex items-center justify-between bg-gray-800 px-4 py-1 text-xs text-white dark:bg-gray-950">
      <div className="flex items-center gap-2">
        <Clock size={12} />
        <span>
          Session: <span className={isLow ? 'font-bold text-red-400' : 'text-green-400'}>{timeLeft}</span>
        </span>
      </div>
    </div>
  );
}
