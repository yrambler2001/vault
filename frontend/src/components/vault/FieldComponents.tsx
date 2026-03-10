import { useState, useEffect, useRef, useCallback } from 'react';
import { Eye, Camera, Image as ImageIcon, Trash2, Copy, CheckCircle, Clock, ExternalLink, X } from 'lucide-react';
import type { FieldDefinition, TOTPFieldValue } from '../../lib/types';
import * as totpLib from '../../lib/totp';

// ── Camera Capture ──

export function CameraCapture({ onResult, onCancel }: { onResult: (uri: string) => void; onCancel: () => void }) {
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
          setError('QR scanning not supported.');
          setScanning(false);
          return;
        }
        const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
        if (!mounted) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play();
        }
        scanIntervalRef.current = setInterval(async () => {
          if (!videoRef.current || !mounted) return;
          try {
            const result = await totpLib.decodeQRFromVideo(videoRef.current);
            if (result && mounted) {
              stopCamera();
              setScanning(false);
              onResult(result);
            }
          } catch {
            /* continue */
          }
        }, 500);
      } catch (err) {
        if (mounted) {
          setError(err instanceof Error ? err.message : 'Camera failed');
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
    <div className="mb-3 rounded border border-blue-200 bg-blue-50 p-3 dark:border-blue-800 dark:bg-blue-900/20">
      <div className="mb-2 flex items-center justify-between">
        <span className="text-xs font-medium text-blue-700 dark:text-blue-300">Scan QR Code</span>
        <button
          type="button"
          onClick={() => {
            stopCamera();
            onCancel();
          }}
          className="text-gray-500 hover:text-gray-700"
        >
          <X size={14} />
        </button>
      </div>
      {error ? (
        <div className="text-sm text-red-600">{error}</div>
      ) : (
        <div className="relative mx-auto max-w-sm overflow-hidden rounded bg-black">
          <video ref={videoRef} className="w-full" playsInline muted />
          {scanning && (
            <div className="absolute inset-0 flex items-center justify-center">
              <div className="h-32 w-32 rounded-lg border-2 border-white/50" />
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── Image Import ──

export function ImageImport({ onResult, onCancel }: { onResult: (uri: string) => void; onCancel: () => void }) {
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const imageBitmap = await createImageBitmap(file);
      const rawValue = await totpLib.decodeQRFromImage(imageBitmap);
      onResult(rawValue);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to process image');
    }
  };

  return (
    <div className="mb-3 rounded border border-purple-200 bg-purple-50 p-3 dark:border-purple-800 dark:bg-purple-900/20">
      <div className="mb-2 flex items-center justify-between">
        <span className="text-xs font-medium text-purple-700 dark:text-purple-300">Import QR Image</span>
        <button type="button" onClick={onCancel} className="text-gray-500 hover:text-gray-700">
          <X size={14} />
        </button>
      </div>
      {error && <div className="mb-2 text-sm text-red-600">{error}</div>}
      <div
        onClick={() => fileInputRef.current?.click()}
        className="cursor-pointer rounded border-2 border-dashed border-purple-300 p-4 text-center hover:bg-purple-100 dark:border-purple-700 dark:hover:bg-purple-900/40"
      >
        <ImageIcon size={24} className="mx-auto mb-1 text-purple-400" />
        <p className="text-sm text-purple-700 dark:text-purple-400">Click to select image</p>
      </div>
      <input ref={fileInputRef} type="file" accept="image/*" onChange={handleFileSelect} className="hidden" />
    </div>
  );
}

// ── TOTP Secret Input (Editable Field UI) ──

export function TOTPSecretInput({ value, onValueChange }: { value: string; onValueChange: (val: string) => void }) {
  const [showSecret, setShowSecret] = useState(false);
  const [mode, setMode] = useState<'camera' | 'import' | null>(null);

  let parsed: TOTPFieldValue | null = null;
  try {
    parsed = JSON.parse(value);
  } catch {
    // ignore
  }

  const handleSecretChange = (newSecret: string) => {
    const updated: TOTPFieldValue = {
      secret: newSecret.replace(/\s/g, '').toUpperCase(),
      algorithm: parsed?.algorithm || 'SHA1',
      digits: parsed?.digits || 6,
      period: parsed?.period || 30,
    };
    onValueChange(JSON.stringify(updated));
  };

  const handleQRResult = (uri: string) => {
    try {
      const parsedUri = totpLib.parseOTPAuthURI(uri);
      const updated: TOTPFieldValue = {
        secret: parsedUri.secret,
        algorithm: parsedUri.algorithm || 'SHA1',
        digits: parsedUri.digits || 6,
        period: parsedUri.period || 30,
      };
      onValueChange(JSON.stringify(updated));
      setMode(null);
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Invalid QR code');
    }
  };

  return (
    <div className="mt-2 w-full">
      {mode === 'camera' && <CameraCapture onResult={handleQRResult} onCancel={() => setMode(null)} />}
      {mode === 'import' && <ImageImport onResult={handleQRResult} onCancel={() => setMode(null)} />}

      {!mode && (
        <div className="flex flex-col gap-1">
          <div className="flex items-center gap-2">
            <input
              type={showSecret ? 'text' : 'password'}
              value={parsed?.secret || ''}
              onChange={(e) => handleSecretChange(e.target.value)}
              placeholder="Base32 Secret (e.g. JBSWY3DP...)"
              className="w-full rounded border border-gray-300 bg-white px-2 py-1 font-mono text-sm focus:border-blue-500 focus:ring-1 focus:ring-blue-500 focus:outline-none dark:border-gray-500 dark:bg-gray-700 dark:text-gray-100 dark:focus:border-blue-400 dark:focus:ring-blue-400"
            />
            <button
              type="button"
              onClick={() => setShowSecret(!showSecret)}
              className="shrink-0 rounded border border-gray-300 bg-gray-50 p-1.5 text-gray-500 hover:bg-gray-200 dark:border-gray-500 dark:bg-gray-700 dark:text-gray-400 dark:hover:bg-gray-600"
              title={showSecret ? 'Hide secret' : 'Reveal secret'}
            >
              <Eye size={14} />
            </button>
            <button
              type="button"
              onClick={() => setMode('camera')}
              className="shrink-0 rounded bg-blue-100 p-1.5 text-blue-700 hover:bg-blue-200 dark:bg-blue-900/30 dark:text-blue-400 dark:hover:bg-blue-900/50"
              title="Scan QR Code"
            >
              <Camera size={14} />
            </button>
            <button
              type="button"
              onClick={() => setMode('import')}
              className="shrink-0 rounded bg-purple-100 p-1.5 text-purple-700 hover:bg-purple-200 dark:bg-purple-900/30 dark:text-purple-400 dark:hover:bg-purple-900/50"
              title="Import Image"
            >
              <ImageIcon size={14} />
            </button>
          </div>
          {parsed && parsed.secret && (
            <div className="text-xs text-gray-500 dark:text-gray-400">
              {parsed.algorithm} · {parsed.digits} digits · {parsed.period}s period
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── TOTP Live Code (Read-Only) ──

export function TOTPLiveCode({ secret, digits, period }: { secret: string; digits: number; period: number }) {
  const [code, setCode] = useState('------');
  const [remaining, setRemaining] = useState(() => period - (Math.floor(Date.now() / 1000) % period));
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let mounted = true;
    const update = async () => {
      try {
        const result = await totpLib.generateTOTP({ secret, digits, period });
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
  }, [secret, digits, period]);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* ignore */
    }
  };

  const progressPercent = (remaining / period) * 100;
  const isLow = remaining <= 5;

  return (
    <div>
      <div className="flex items-center gap-3">
        <span className={`font-mono text-2xl tracking-widest ${isLow ? 'text-red-600' : 'text-gray-900 dark:text-gray-100'}`}>
          {code.length >= 6 ? `${code.slice(0, 3)} ${code.slice(3)}` : code}
        </span>
        <button
          onClick={handleCopy}
          className={`rounded p-1.5 ${copied ? 'text-green-500' : 'text-gray-400 hover:text-gray-600 dark:hover:text-gray-300'}`}
          title={copied ? 'Copied!' : 'Copy code'}
        >
          {copied ? <CheckCircle size={16} /> : <Copy size={16} />}
        </button>
      </div>
      <div className="mt-2 flex items-center gap-2">
        <Clock size={12} className="text-gray-400" />
        <div className="h-1.5 max-w-[120px] flex-1 rounded-full bg-gray-200 dark:bg-gray-600">
          <div className={`h-1.5 rounded-full transition-all duration-1000 ${isLow ? 'bg-red-500' : 'bg-blue-500'}`} style={{ width: `${progressPercent}%` }} />
        </div>
        <span className={`text-xs ${isLow ? 'font-bold text-red-500' : 'text-gray-400 dark:text-gray-500'}`}>{remaining}s</span>
      </div>
    </div>
  );
}

// ── Read-Only Field Display ──

export function FieldDisplay({ value, hidden }: { value: string; hidden: boolean }) {
  const [revealed, setRevealed] = useState(false);
  const [copied, setCopied] = useState(false);

  const displayValue = hidden && value && !revealed ? '••••••••' : value;
  const isLink = value.toLowerCase().startsWith('http://') || value.toLowerCase().startsWith('https://');

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // clipboard unavailable
    }
  };

  const handleReveal = () => {
    if (!revealed && hidden) {
      const ok = window.confirm('Are you sure you want to reveal this field?');
      if (!ok) return;
    }
    setRevealed(!revealed);
  };

  return (
    <div className="flex items-start gap-2">
      <div className="min-w-0 flex-1 rounded bg-gray-50 px-3 py-2 font-mono text-sm break-all whitespace-pre-wrap text-gray-900 dark:bg-gray-700 dark:text-gray-100">
        {displayValue || <span className="text-gray-400 italic">—</span>}
      </div>
      <div className="flex shrink-0 gap-1">
        {isLink && (
          <a
            href={value}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center justify-center rounded p-1.5 text-gray-400 transition-colors hover:text-blue-600 dark:hover:text-blue-400"
            title="Open link in new tab"
          >
            <ExternalLink size={16} />
          </a>
        )}
        {hidden && (
          <button
            onClick={handleReveal}
            className="rounded p-1.5 text-gray-400 transition-colors hover:text-gray-600 dark:hover:text-gray-300"
            title={revealed ? 'Hide' : 'Reveal'}
          >
            <Eye size={16} />
          </button>
        )}
        <button
          onClick={handleCopy}
          className={`rounded p-1.5 ${copied ? 'text-green-500' : 'text-gray-400 hover:text-gray-600 dark:hover:text-gray-300'}`}
          title={copied ? 'Copied!' : 'Copy'}
        >
          {copied ? <CheckCircle size={16} /> : <Copy size={16} />}
        </button>
      </div>
    </div>
  );
}

// ── Generic Editable Field (Handles all types) ──

export function EditableField({
  field,
  value,
  onFieldDefChange,
  onValueChange,
  onRemove,
}: {
  field: FieldDefinition;
  value: string;
  onFieldDefChange: (changes: Partial<FieldDefinition>) => void;
  onValueChange: (val: string) => void;
  onRemove: () => void;
}) {
  return (
    <div className="rounded border border-gray-200 bg-gray-50 p-3 dark:border-gray-600 dark:bg-gray-700">
      {/* Field config row */}
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <input
          type="text"
          placeholder="Field name"
          value={field.name}
          onChange={(e) => onFieldDefChange({ name: e.target.value })}
          className="min-w-[120px] flex-1 rounded border border-gray-300 bg-white px-2 py-1 text-sm focus:border-blue-500 focus:ring-1 focus:ring-blue-500 focus:outline-none dark:border-gray-500 dark:bg-gray-700 dark:text-gray-100 dark:focus:border-blue-400 dark:focus:ring-blue-400"
        />
        <select
          value={field.type}
          onChange={(e) => {
            const type = e.target.value as 'single' | 'multi' | 'totp';
            onFieldDefChange({ type });
            // Initialize TOTP JSON structure if switching to TOTP
            if (type === 'totp' && !value.startsWith('{')) {
              onValueChange(JSON.stringify({ secret: value.replace(/\s/g, '').toUpperCase() || '', algorithm: 'SHA1', digits: 6, period: 30 }));
            }
          }}
          className="rounded border border-gray-300 bg-white px-2 py-1 text-xs dark:border-gray-500 dark:bg-gray-700 dark:text-gray-100"
        >
          <option value="single">Single line</option>
          <option value="multi">Multi-line</option>
          <option value="totp">TOTP</option>
        </select>
        <label className="flex items-center gap-1 text-xs text-gray-600 dark:text-gray-400">
          <input type="checkbox" checked={field.searchable} onChange={(e) => onFieldDefChange({ searchable: e.target.checked })} className="accent-blue-600" />
          Search
        </label>
        <label className="flex items-center gap-1 text-xs text-gray-600 dark:text-gray-400">
          <input type="checkbox" checked={field.hidden} onChange={(e) => onFieldDefChange({ hidden: e.target.checked })} className="accent-blue-600" />
          Hidden
        </label>
        <button onClick={onRemove} className="rounded p-1 text-red-400 hover:text-red-600" title="Remove field">
          <Trash2 size={14} />
        </button>
      </div>

      {/* Field value */}
      {field.type === 'multi' ? (
        <textarea
          value={value}
          onChange={(e) => onValueChange(e.target.value)}
          rows={3}
          className="w-full rounded border border-gray-300 bg-white px-2 py-1 text-sm dark:border-gray-500 dark:bg-gray-700 dark:text-gray-100"
        />
      ) : field.type === 'totp' ? (
        <TOTPSecretInput value={value} onValueChange={onValueChange} />
      ) : (
        <input
          type={field.hidden ? 'password' : 'text'}
          value={value}
          onChange={(e) => onValueChange(e.target.value)}
          className="w-full rounded border border-gray-300 bg-white px-2 py-1 text-sm focus:border-blue-500 focus:ring-1 focus:ring-blue-500 focus:outline-none dark:border-gray-500 dark:bg-gray-700 dark:text-gray-100 dark:focus:border-blue-400 dark:focus:ring-blue-400"
        />
      )}
    </div>
  );
}
