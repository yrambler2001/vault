import { useState, useCallback } from 'react';
import { HardDrive, RefreshCw, CheckCircle, AlertTriangle } from 'lucide-react';
import { api } from '../../lib/api';
import type { DriveInfo } from '../../lib/api';

export function USBDrivesPanel() {
  const [drives, setDrives] = useState<DriveInfo[]>([]);
  const [loadingDrives, setLoadingDrives] = useState(false);
  const [driveMessage, setDriveMessage] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);

  const showDriveMessage = (msg: string) => {
    setDriveMessage(msg);
    setTimeout(() => setDriveMessage(null), 5000);
  };

  const refreshDrives = useCallback(async () => {
    setLoadingDrives(true);
    try {
      const { drives: d } = await api.getDriveStatus();
      setDrives(d);
      setLoaded(true);
    } catch {
      /* non-critical */
    } finally {
      setLoadingDrives(false);
    }
  }, []);

  const handleSync = async () => {
    setLoadingDrives(true);
    try {
      const result = await api.syncDrives();
      await refreshDrives();
      showDriveMessage(result.message);
    } catch {
      showDriveMessage('Sync failed');
    } finally {
      setLoadingDrives(false);
    }
  };

  const handleInit = async (label: string) => {
    if (!window.confirm(`Initialize "${label}" as a vault backup drive? This won't erase existing files.`)) return;
    try {
      await api.initDrive(label);
      await refreshDrives();
      showDriveMessage(`Drive "${label}" initialized.`);
    } catch {
      showDriveMessage('Failed to initialize drive');
    }
  };

  const handleVerify = async (label: string) => {
    try {
      const result = await api.verifyDrive(label);
      const msg =
        `Integrity: ${result.valid}/${result.total} valid` +
        (result.corrupted.length > 0 ? `, ${result.corrupted.length} corrupted` : '') +
        (result.noSidecar.length > 0 ? `, ${result.noSidecar.length} no checksum` : '');
      showDriveMessage(msg);
    } catch {
      showDriveMessage('Verification failed');
    }
  };

  return (
    <div className="mb-8 rounded-lg border bg-white p-6 shadow-sm">
      <div className="mb-4 flex items-center justify-between border-b pb-2">
        <h2 className="flex items-center gap-2 text-xl font-bold">
          <HardDrive size={20} /> USB Backup Drives
        </h2>
        <div className="flex gap-2">
          <button
            onClick={handleSync}
            disabled={loadingDrives}
            className="flex items-center gap-1 rounded bg-blue-600 px-3 py-1 text-sm text-white transition-colors hover:bg-blue-700 disabled:opacity-50"
          >
            <RefreshCw size={14} /> Sync All
          </button>
          <button
            onClick={refreshDrives}
            disabled={loadingDrives}
            className="rounded bg-gray-200 px-3 py-1 text-sm transition-colors hover:bg-gray-300 disabled:opacity-50"
          >
            Refresh
          </button>
        </div>
      </div>

      {driveMessage && <div className="mb-3 rounded border border-blue-200 bg-blue-50 p-2 text-sm text-blue-700">{driveMessage}</div>}

      {!loaded ? (
        <p className="text-gray-500 italic">Click Refresh to load drive status.</p>
      ) : drives.length === 0 ? (
        <p className="text-gray-500 italic">No drives configured. Set VAULT_DRIVES in backend .env file.</p>
      ) : (
        <ul className="space-y-2">
          {drives.map((drive) => (
            <li key={drive.configuredPath} className="flex items-center justify-between border-b py-2 last:border-0">
              <div className="flex items-center gap-3">
                <HardDrive size={18} className={drive.healthy ? 'text-green-600' : drive.accessible ? 'text-yellow-500' : 'text-gray-400'} />
                <div>
                  <span className="font-medium">{drive.label}</span>
                  <div className="text-xs text-gray-400">{drive.configuredPath}</div>
                  {drive.healthy && <span className="text-xs text-gray-500">{drive.versionCount} versions</span>}
                  {!drive.accessible && <span className="text-xs text-red-500">Not accessible — drive may be disconnected</span>}
                </div>
              </div>
              <div className="flex items-center gap-2">
                {drive.accessible && !drive.healthy && !drive.vaultId && (
                  <button
                    onClick={() => handleInit(drive.label)}
                    className="rounded bg-green-600 px-3 py-1 text-xs text-white transition-colors hover:bg-green-700"
                  >
                    Initialize
                  </button>
                )}
                {!drive.accessible && (
                  <span className="flex items-center gap-1 rounded bg-red-100 px-2 py-1 text-xs text-red-600">
                    <AlertTriangle size={12} /> Offline
                  </span>
                )}
                {drive.healthy && (
                  <>
                    <button onClick={() => handleVerify(drive.label)} className="text-xs text-blue-600 hover:text-blue-800">
                      Verify
                    </button>
                    <span className="flex items-center gap-1 rounded bg-green-100 px-2 py-1 text-xs text-green-700">
                      <CheckCircle size={12} /> Active
                    </span>
                  </>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
