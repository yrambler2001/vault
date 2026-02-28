import { useState, useEffect, useRef, useCallback } from 'react';
import { Plus, Trash2, Copy, CheckCircle, Clock, Camera, Image, Keyboard, X, Shield, Pencil } from 'lucide-react';
import * as totpLib from '../../lib/totp';

export interface TOTPEntry {
  id: string;
  issuer: string;
  account: string;
  secret: string;
  algorithm: string;
  digits: number;
  period: number;
  createdAt: string;
  modifiedAt: string;
}

interface Props {
  totps: TOTPEntry[];
  onAdd: (entry: TOTPEntry) => void;
  onUpdate: (id: string, changes: Partial<TOTPEntry>) => void;
  onDelete: (id: string) => void;
}

export function TOTPPanel({ totps, onAdd, onUpdate, onDelete }: Props) {
  const [showAddMenu, setShowAddMenu] = useState(false);
  const [addMode, setAddMode] = useState<'camera' | 'import' | 'manual' | null>(null);

  const handleAddComplete = (entry: TOTPEntry) => {
    onAdd(entry);
    setAddMode(null);
    setShowAddMenu(false);
  };

  const handleCancel = () => {
    setAddMode(null);
    setShowAddMenu(false);
  };

  return (
    <div className="mb-8 rounded-lg border bg-white p-6 shadow-sm">
      <div className="mb-4 flex items-center justify-between border-b pb-2">
        <h2 className="flex items-center gap-2 text-xl font-bold">
          <Shield size={20} /> Two-Factor Authentication
        </h2>
        <div className="relative">
          {!addMode && (
            <button
              onClick={() => setShowAddMenu(!showAddMenu)}
              className="flex items-center gap-1 rounded bg-green-600 px-3 py-1 text-sm text-white transition-colors hover:bg-green-700"
            >
              <Plus size={14} /> Add 2FA
            </button>
          )}
          {showAddMenu && !addMode && (
            <div className="absolute top-full right-0 z-10 mt-1 w-56 rounded-lg border bg-white shadow-lg">
              <button onClick={() => setAddMode('camera')} className="flex w-full items-center gap-3 border-b px-4 py-3 text-left text-sm hover:bg-gray-50">
                <Camera size={16} className="text-blue-600" />
                <div>
                  <div className="font-medium">Scan QR Code</div>
                  <div className="text-xs text-gray-400">Open camera to capture</div>
                </div>
              </button>
              <button onClick={() => setAddMode('import')} className="flex w-full items-center gap-3 border-b px-4 py-3 text-left text-sm hover:bg-gray-50">
                <Image size={16} className="text-purple-600" />
                <div>
                  <div className="font-medium">Import a Photo</div>
                  <div className="text-xs text-gray-400">Upload QR code image</div>
                </div>
              </button>
              <button onClick={() => setAddMode('manual')} className="flex w-full items-center gap-3 px-4 py-3 text-left text-sm hover:bg-gray-50">
                <Keyboard size={16} className="text-green-600" />
                <div>
                  <div className="font-medium">Enter Manually</div>
                  <div className="text-xs text-gray-400">Type secret key</div>
                </div>
              </button>
            </div>
          )}
        </div>
      </div>

      {addMode === 'camera' && <CameraCapture onResult={handleAddComplete} onCancel={handleCancel} />}

      {addMode === 'import' && <ImageImport onResult={handleAddComplete} onCancel={handleCancel} />}

      {addMode === 'manual' && <ManualEntry onResult={handleAddComplete} onCancel={handleCancel} />}

      {totps.length === 0 && !addMode ? (
        <p className="text-gray-500 italic">No 2FA tokens yet. Add your first one!</p>
      ) : (
        <ul className="space-y-3">
          {totps.map((entry) => (
            <TOTPEntryRow key={entry.id} entry={entry} onUpdate={onUpdate} onDelete={onDelete} />
          ))}
        </ul>
      )}
    </div>
  );
}

// ── TOTP Entry Row with live code ──

function TOTPEntryRow({
  entry,
  onUpdate,
  onDelete,
}: {
  entry: TOTPEntry;
  onUpdate: (id: string, changes: Partial<TOTPEntry>) => void;
  onDelete: (id: string) => void;
}) {
  const [code, setCode] = useState('------');
  const [remaining, setRemaining] = useState(30);
  const [copied, setCopied] = useState(false);

  // Edit State
  const [isEditing, setIsEditing] = useState(false);
  const [editIssuer, setEditIssuer] = useState(entry.issuer);
  const [editAccount, setEditAccount] = useState(entry.account);
  const [editSecret, setEditSecret] = useState(entry.secret);
  const [editError, setEditError] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;

    const update = async () => {
      // Don't calculate if we are in edit mode
      if (isEditing) return;

      try {
        const result = await totpLib.generateTOTP({
          secret: entry.secret,
          digits: entry.digits,
          period: entry.period,
        });
        if (mounted) {
          setCode(result.code);
          setRemaining(result.remainingSeconds);
        }
      } catch {
        if (mounted) setCode('ERROR');
      }
    };

    update();
    const interval = setInterval(update, 1000);
    return () => {
      mounted = false;
      clearInterval(interval);
    };
  }, [entry.secret, entry.digits, entry.period, isEditing]);

  const copyToClipboard = async () => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* clipboard unavailable */
    }
  };

  const handleSaveEdit = () => {
    const cleanSecret = editSecret.replace(/\s/g, '').toUpperCase();
    if (!cleanSecret) {
      setEditError('Secret key is required.');
      return;
    }
    if (!totpLib.isValidBase32(cleanSecret)) {
      setEditError('Invalid secret key (Base32 only).');
      return;
    }

    onUpdate(entry.id, {
      issuer: editIssuer.trim(),
      account: editAccount.trim(),
      secret: cleanSecret,
    });

    setEditError(null);
    setIsEditing(false);
  };

  const handleCancelEdit = () => {
    setEditIssuer(entry.issuer);
    setEditAccount(entry.account);
    setEditSecret(entry.secret);
    setEditError(null);
    setIsEditing(false);
  };

  if (isEditing) {
    return (
      <li className="rounded-lg border bg-gray-50 p-3">
        <div className="space-y-3">
          {editError && <div className="rounded border border-red-200 bg-red-50 p-2 text-sm text-red-600">{editError}</div>}
          <div className="flex gap-2">
            <div className="flex-1">
              <label className="mb-1 block text-xs font-medium text-gray-700">Service / Issuer</label>
              <input type="text" value={editIssuer} onChange={(e) => setEditIssuer(e.target.value)} className="w-full rounded border p-1.5 text-sm" />
            </div>
            <div className="flex-1">
              <label className="mb-1 block text-xs font-medium text-gray-700">Account / Email</label>
              <input type="text" value={editAccount} onChange={(e) => setEditAccount(e.target.value)} className="w-full rounded border p-1.5 text-sm" />
            </div>
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-gray-700">Secret Key (Base32)</label>
            <input
              type="text"
              value={editSecret}
              onChange={(e) => setEditSecret(e.target.value)}
              className="w-full rounded border p-1.5 font-mono text-sm"
              spellCheck={false}
            />
          </div>
          <div className="flex gap-2 pt-1">
            <button onClick={handleSaveEdit} className="rounded bg-blue-600 px-3 py-1.5 text-sm text-white hover:bg-blue-700">
              Save Changes
            </button>
            <button onClick={handleCancelEdit} className="rounded bg-gray-200 px-3 py-1.5 text-sm hover:bg-gray-300">
              Cancel
            </button>
          </div>
        </div>
      </li>
    );
  }

  const progressPercent = (remaining / entry.period) * 100;
  const isLow = remaining <= 5;

  return (
    <li className="rounded-lg border p-3">
      <div className="flex items-start justify-between">
        <div className="flex-1">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium">{entry.issuer || 'Unknown'}</span>
            {entry.account && <span className="text-xs text-gray-400">({entry.account})</span>}
          </div>

          <div className="mt-2 flex items-center gap-3">
            <span className={`font-mono text-2xl tracking-widest ${isLow ? 'text-red-600' : 'text-gray-900'}`}>
              {code.slice(0, 3)} {code.slice(3)}
            </span>
            <button
              onClick={copyToClipboard}
              className={`rounded p-1 ${copied ? 'text-green-500' : 'text-gray-400 hover:text-gray-600'}`}
              title={copied ? 'Copied!' : 'Copy code'}
            >
              {copied ? <CheckCircle size={18} /> : <Copy size={18} />}
            </button>
          </div>

          <div className="mt-2 flex items-center gap-2">
            <Clock size={12} className="text-gray-400" />
            <div className="h-1.5 max-w-[120px] flex-1 rounded-full bg-gray-200">
              <div
                className={`h-1.5 rounded-full transition-all duration-1000 ${isLow ? 'bg-red-500' : 'bg-blue-500'}`}
                style={{ width: `${progressPercent}%` }}
              />
            </div>
            <span className={`text-xs ${isLow ? 'font-bold text-red-500' : 'text-gray-400'}`}>{remaining}s</span>
          </div>
        </div>

        <div className="flex gap-1">
          <button onClick={() => setIsEditing(true)} className="p-1 text-blue-500 hover:text-blue-700" title="Edit">
            <Pencil size={18} />
          </button>
          <button
            onClick={() => {
              if (window.confirm(`Delete 2FA for "${entry.issuer || 'this account'}"? This cannot be undone.`)) {
                onDelete(entry.id);
              }
            }}
            className="p-1 text-red-500 hover:text-red-700"
            title="Delete"
          >
            <Trash2 size={18} />
          </button>
        </div>
      </div>
    </li>
  );
}

// ── Camera Capture ──

function CameraCapture({ onResult, onCancel }: { onResult: (entry: TOTPEntry) => void; onCancel: () => void }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [scanning, setScanning] = useState(true);
  const scanIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const stopCamera = useCallback(() => {
    if (scanIntervalRef.current) {
      clearInterval(scanIntervalRef.current);
      scanIntervalRef.current = null;
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
  }, []);

  useEffect(() => {
    let mounted = true;

    const startCamera = async () => {
      try {
        if (!('BarcodeDetector' in window)) {
          setError('QR code scanning is not supported in this browser. ' + 'Please use Chrome/Edge 83+ or try importing an image instead.');
          setScanning(false);
          return;
        }

        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: 'environment' },
        });

        if (!mounted) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }

        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play();
        }

        // Start scanning
        scanIntervalRef.current = setInterval(async () => {
          if (!videoRef.current || !mounted) return;
          try {
            const result = await totpLib.decodeQRFromVideo(videoRef.current);
            if (result && mounted) {
              stopCamera();
              setScanning(false);
              processQRData(result, onResult, setError);
            }
          } catch {
            // Continue scanning
          }
        }, 500);
      } catch (err) {
        if (mounted) {
          const msg = err instanceof Error ? err.message : 'Unknown error';
          if (msg.includes('NotAllowed') || msg.includes('Permission')) {
            setError('Camera access was denied. Please allow camera access and try again.');
          } else {
            setError(`Failed to start camera: ${msg}`);
          }
          setScanning(false);
        }
      }
    };

    startCamera();

    return () => {
      mounted = false;
      stopCamera();
    };
  }, [onResult, stopCamera]);

  return (
    <div className="mb-4 rounded-lg border border-blue-200 bg-blue-50 p-4">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="flex items-center gap-2 font-semibold text-blue-800">
          <Camera size={16} /> Scan QR Code
        </h3>
        <button
          onClick={() => {
            stopCamera();
            onCancel();
          }}
          className="text-gray-500 hover:text-gray-700"
        >
          <X size={18} />
        </button>
      </div>

      {error ? (
        <div className="rounded border border-red-200 bg-red-50 p-3 text-sm text-red-600">{error}</div>
      ) : (
        <>
          <div className="relative mx-auto max-w-sm overflow-hidden rounded-lg bg-black">
            <video ref={videoRef} className="w-full" playsInline muted />
            {scanning && (
              <div className="absolute inset-0 flex items-center justify-center">
                <div className="h-48 w-48 rounded-lg border-2 border-white/50" />
              </div>
            )}
          </div>
          <p className="mt-2 text-center text-xs text-gray-500">Point your camera at the QR code</p>
        </>
      )}
    </div>
  );
}

// ── Image Import ──

function ImageImport({ onResult, onCancel }: { onResult: (entry: TOTPEntry) => void; onCancel: () => void }) {
  const [error, setError] = useState<string | null>(null);
  const [processing, setProcessing] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setProcessing(true);
    setError(null);

    try {
      const imageBitmap = await createImageBitmap(file);
      const rawValue = await totpLib.decodeQRFromImage(imageBitmap);
      processQRData(rawValue, onResult, setError);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to process image');
    } finally {
      setProcessing(false);
    }
  };

  return (
    <div className="mb-4 rounded-lg border border-purple-200 bg-purple-50 p-4">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="flex items-center gap-2 font-semibold text-purple-800">
          <Image size={16} /> Import QR Code Image
        </h3>
        <button onClick={onCancel} className="text-gray-500 hover:text-gray-700">
          <X size={18} />
        </button>
      </div>

      {error && <div className="mb-3 rounded border border-red-200 bg-red-50 p-3 text-sm text-red-600">{error}</div>}

      <div
        onClick={() => fileInputRef.current?.click()}
        className="cursor-pointer rounded-lg border-2 border-dashed border-purple-300 p-8 text-center transition-colors hover:bg-purple-100"
      >
        <Image size={32} className="mx-auto mb-2 text-purple-400" />
        <p className="text-sm text-purple-700">{processing ? 'Processing...' : 'Click to select a QR code image'}</p>
        <p className="mt-1 text-xs text-gray-400">PNG, JPG, or other image formats</p>
      </div>

      <input ref={fileInputRef} type="file" accept="image/*" onChange={handleFileSelect} className="hidden" />
    </div>
  );
}

// ── Manual Entry ──

function ManualEntry({ onResult, onCancel }: { onResult: (entry: TOTPEntry) => void; onCancel: () => void }) {
  const [issuer, setIssuer] = useState('');
  const [account, setAccount] = useState('');
  const [secret, setSecret] = useState('');
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = () => {
    setError(null);

    const cleanSecret = secret.replace(/\s/g, '').toUpperCase();

    if (!cleanSecret) {
      setError('Secret key is required.');
      return;
    }

    if (!totpLib.isValidBase32(cleanSecret)) {
      setError('Invalid secret key. Must be a valid base32 string (A-Z, 2-7).');
      return;
    }

    if (!issuer && !account) {
      setError('Please enter at least an issuer or account name.');
      return;
    }

    const entry: TOTPEntry = {
      id: crypto.randomUUID(),
      issuer: issuer.trim(),
      account: account.trim(),
      secret: cleanSecret,
      algorithm: 'SHA1',
      digits: 6,
      period: 30,
      createdAt: new Date().toISOString(),
      modifiedAt: new Date().toISOString(),
    };

    onResult(entry);
  };

  return (
    <div className="mb-4 rounded-lg border border-green-200 bg-green-50 p-4">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="flex items-center gap-2 font-semibold text-green-800">
          <Keyboard size={16} /> Enter Manually
        </h3>
        <button onClick={onCancel} className="text-gray-500 hover:text-gray-700">
          <X size={18} />
        </button>
      </div>

      {error && <div className="mb-3 rounded border border-red-200 bg-red-50 p-3 text-sm text-red-600">{error}</div>}

      <div className="space-y-3">
        <div>
          <label className="mb-1 block text-sm font-medium text-gray-700">Service / Issuer</label>
          <input
            type="text"
            placeholder="e.g., GitHub, Google, AWS"
            value={issuer}
            onChange={(e) => setIssuer(e.target.value)}
            className="w-full rounded border p-2 text-sm"
          />
        </div>
        <div>
          <label className="mb-1 block text-sm font-medium text-gray-700">Account / Email</label>
          <input
            type="text"
            placeholder="e.g., user@example.com"
            value={account}
            onChange={(e) => setAccount(e.target.value)}
            className="w-full rounded border p-2 text-sm"
          />
        </div>
        <div>
          <label className="mb-1 block text-sm font-medium text-gray-700">Secret Key (Base32)</label>
          <input
            type="text"
            placeholder="e.g., JBSWY3DPEHPK3PXP"
            value={secret}
            onChange={(e) => setSecret(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleSubmit()}
            className="w-full rounded border p-2 font-mono text-sm"
            autoComplete="off"
            spellCheck={false}
          />
          <p className="mt-1 text-xs text-gray-400">The secret key provided by the service (usually shown below the QR code)</p>
        </div>
        <div className="flex gap-2">
          <button onClick={handleSubmit} className="rounded bg-green-600 px-4 py-2 text-sm text-white transition-colors hover:bg-green-700">
            Add Token
          </button>
          <button onClick={onCancel} className="rounded bg-gray-200 px-4 py-2 text-sm transition-colors hover:bg-gray-300">
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Shared helper to process QR data ──

function processQRData(rawValue: string, onResult: (entry: TOTPEntry) => void, setError: (err: string) => void) {
  try {
    const parsed = totpLib.parseOTPAuthURI(rawValue);

    if (parsed.type !== 'totp') {
      setError('Only TOTP codes are supported. HOTP is not supported.');
      return;
    }

    const entry: TOTPEntry = {
      id: crypto.randomUUID(),
      issuer: parsed.issuer,
      account: parsed.account,
      secret: parsed.secret,
      algorithm: parsed.algorithm,
      digits: parsed.digits,
      period: parsed.period,
      createdAt: new Date().toISOString(),
      modifiedAt: new Date().toISOString(),
    };

    onResult(entry);
  } catch (err) {
    setError(err instanceof Error ? err.message : 'Failed to parse QR code data');
  }
}
