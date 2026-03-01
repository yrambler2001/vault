import { useState, useRef, useCallback, useEffect } from 'react';
import { ArrowLeft, Plus, Trash2, Save, Camera, Image, Keyboard, X } from 'lucide-react';
import type { VaultEntry, FieldDefinition } from '../../lib/types';
import * as totpLib from '../../lib/totp';

interface Props {
  kind: 'password' | 'totp';
  defaultFolder: string;
  onSave: (entry: VaultEntry) => void;
  onCancel: () => void;
}

export function CreateEntry({ kind, defaultFolder, onSave, onCancel }: Props) {
  const [name, setName] = useState('');
  const [folder, setFolder] = useState(defaultFolder);
  const [initialState] = useState(() => {
    if (kind === 'password') {
      const defaultFieldId = crypto.randomUUID();
      return {
        fields: [
          {
            id: defaultFieldId,
            name: 'Password',
            type: 'single' as const,
            searchable: false,
            hidden: true,
          },
        ],
        values: { [defaultFieldId]: '' },
      };
    }
    return { fields: [], values: {} };
  });
  const [fields, setFields] = useState<FieldDefinition[]>(initialState.fields);
  const [values, setValues] = useState<Record<string, string>>(initialState.values);
  const [totpSecret, setTotpSecret] = useState('');
  const [totpMode, setTotpMode] = useState<'manual' | 'camera' | 'import' | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleAddField = () => {
    const newField: FieldDefinition = {
      id: crypto.randomUUID(),
      name: '',
      type: 'single',
      searchable: false,
      hidden: false,
    };
    setFields([...fields, newField]);
    setValues({ ...values, [newField.id]: '' });
  };

  const handleRemoveField = (fieldId: string) => {
    setFields(fields.filter((f) => f.id !== fieldId));
    const newValues = { ...values };
    delete newValues[fieldId];
    setValues(newValues);
  };

  const handleUpdateFieldDef = (fieldId: string, changes: Partial<FieldDefinition>) => {
    setFields(fields.map((f) => (f.id === fieldId ? { ...f, ...changes } : f)));
  };

  const handleSave = () => {
    if (!name.trim()) {
      setError('Name is required.');
      return;
    }

    if (kind === 'totp') {
      const clean = totpSecret.replace(/\s/g, '').toUpperCase();
      if (!clean) {
        setError('TOTP secret is required.');
        return;
      }
      if (!totpLib.isValidBase32(clean)) {
        setError('Invalid TOTP secret (must be Base32).');
        return;
      }
    }

    const entry: VaultEntry = {
      id: crypto.randomUUID(),
      kind,
      name: name.trim(),
      folder: folder.trim(),
      fields,
      values,
      createdAt: new Date().toISOString(),
      modifiedAt: new Date().toISOString(),
    };

    if (kind === 'totp') {
      entry.totp = {
        secret: totpSecret.replace(/\s/g, '').toUpperCase(),
        algorithm: 'SHA1',
        digits: 6,
        period: 30,
      };
    }

    onSave(entry);
  };

  const handleTotpFromQR = (uri: string) => {
    try {
      const parsed = totpLib.parseOTPAuthURI(uri);
      if (!name) setName(parsed.issuer || parsed.account || '');
      setTotpSecret(parsed.secret);
      setTotpMode(null);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to parse QR code');
    }
  };

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <button
          onClick={onCancel}
          className="flex items-center gap-1 rounded-lg px-3 py-2 text-sm text-gray-600 transition-colors hover:bg-gray-200 dark:text-gray-300 dark:hover:bg-gray-700"
        >
          <ArrowLeft size={16} />
          Cancel
        </button>
        <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">New {kind === 'password' ? 'Password' : 'TOTP'} Entry</h2>
      </div>

      {error && (
        <div className="mb-4 rounded border border-red-200 bg-red-50 p-3 text-sm text-red-700 dark:border-red-800 dark:bg-red-900/30 dark:text-red-400">
          {error}
        </div>
      )}

      <div className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm dark:border-gray-700 dark:bg-gray-800">
        {/* Name */}
        <div className="mb-4">
          <label className="mb-1 block text-xs font-medium tracking-wide text-gray-500 uppercase dark:text-gray-400">Name *</label>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. GitHub, Gmail"
            className="w-full rounded border border-gray-300 bg-white px-3 py-2 text-sm focus:border-blue-500 focus:ring-1 focus:ring-blue-500 focus:outline-none dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100 dark:focus:border-blue-400 dark:focus:ring-blue-400"
            autoFocus
          />
        </div>

        {/* Folder */}
        <div className="mb-4">
          <label className="mb-1 block text-xs font-medium tracking-wide text-gray-500 uppercase dark:text-gray-400">Folder</label>
          <input
            type="text"
            value={folder}
            onChange={(e) => setFolder(e.target.value)}
            placeholder="e.g. Work/Cloud (optional)"
            className="w-full rounded border border-gray-300 bg-white px-3 py-2 text-sm focus:border-blue-500 focus:ring-1 focus:ring-blue-500 focus:outline-none dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100 dark:focus:border-blue-400 dark:focus:ring-blue-400"
          />
        </div>

        {/* TOTP Secret */}
        {kind === 'totp' && (
          <div className="mb-4">
            <label className="mb-1 block text-xs font-medium tracking-wide text-gray-500 uppercase dark:text-gray-400">TOTP Secret *</label>
            {!totpMode && (
              <div className="mb-2 flex flex-wrap gap-2">
                <button
                  onClick={() => setTotpMode('camera')}
                  className="flex items-center gap-1 rounded bg-blue-100 px-3 py-1.5 text-xs text-blue-700 hover:bg-blue-200 dark:bg-blue-900/30 dark:text-blue-400 dark:hover:bg-blue-900/50"
                >
                  <Camera size={14} /> Scan QR
                </button>
                <button
                  onClick={() => setTotpMode('import')}
                  className="flex items-center gap-1 rounded bg-purple-100 px-3 py-1.5 text-xs text-purple-700 hover:bg-purple-200 dark:bg-purple-900/30 dark:text-purple-400 dark:hover:bg-purple-900/50"
                >
                  <Image size={14} /> Import Image
                </button>
                <button
                  onClick={() => setTotpMode('manual')}
                  className="flex items-center gap-1 rounded bg-green-100 px-3 py-1.5 text-xs text-green-700 hover:bg-green-200 dark:bg-green-900/30 dark:text-green-400 dark:hover:bg-green-900/50"
                >
                  <Keyboard size={14} /> Manual
                </button>
              </div>
            )}
            {totpMode === 'camera' && <CameraCapture onResult={handleTotpFromQR} onCancel={() => setTotpMode(null)} />}
            {totpMode === 'import' && <ImageImport onResult={handleTotpFromQR} onCancel={() => setTotpMode(null)} />}
            {(totpMode === 'manual' || totpSecret) && (
              <input
                type="text"
                value={totpSecret}
                onChange={(e) => setTotpSecret(e.target.value)}
                placeholder="e.g. JBSWY3DPEHPK3PXP"
                className="w-full rounded border border-gray-300 bg-white px-3 py-2 font-mono text-sm focus:border-blue-500 focus:ring-1 focus:ring-blue-500 focus:outline-none dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100 dark:focus:border-blue-400 dark:focus:ring-blue-400"
              />
            )}
          </div>
        )}

        {/* Dynamic Fields */}
        {fields.map((field) => (
          <div key={field.id} className="mb-3 rounded border border-gray-200 bg-gray-50 p-3 dark:border-gray-600 dark:bg-gray-700">
            <div className="mb-2 flex flex-wrap items-center gap-2">
              <input
                type="text"
                placeholder="Field name"
                value={field.name}
                onChange={(e) => handleUpdateFieldDef(field.id, { name: e.target.value })}
                className="min-w-[120px] flex-1 rounded border border-gray-300 bg-white px-2 py-1 text-sm focus:border-blue-500 focus:ring-1 focus:ring-blue-500 focus:outline-none dark:border-gray-500 dark:bg-gray-700 dark:text-gray-100 dark:focus:border-blue-400 dark:focus:ring-blue-400"
              />
              <select
                value={field.type}
                onChange={(e) => handleUpdateFieldDef(field.id, { type: e.target.value as 'single' | 'multi' })}
                className="rounded border border-gray-300 bg-white px-2 py-1 text-xs dark:border-gray-500 dark:bg-gray-700 dark:text-gray-100"
              >
                <option value="single">Single line</option>
                <option value="multi">Multi-line</option>
              </select>
              <label className="flex items-center gap-1 text-xs text-gray-600 dark:text-gray-400">
                <input
                  type="checkbox"
                  checked={field.searchable}
                  onChange={(e) => handleUpdateFieldDef(field.id, { searchable: e.target.checked })}
                  className="accent-blue-600"
                />
                Search
              </label>
              <label className="flex items-center gap-1 text-xs text-gray-600 dark:text-gray-400">
                <input
                  type="checkbox"
                  checked={field.hidden}
                  onChange={(e) => handleUpdateFieldDef(field.id, { hidden: e.target.checked })}
                  className="accent-blue-600"
                />
                Hidden
              </label>
              <button onClick={() => handleRemoveField(field.id)} className="rounded p-1 text-red-400 hover:text-red-600">
                <Trash2 size={14} />
              </button>
            </div>
            {field.type === 'multi' ? (
              <textarea
                value={values[field.id] || ''}
                onChange={(e) => setValues({ ...values, [field.id]: e.target.value })}
                rows={3}
                className="w-full rounded border border-gray-300 bg-white px-2 py-1 text-sm dark:border-gray-500 dark:bg-gray-700 dark:text-gray-100"
              />
            ) : (
              <input
                type={field.hidden ? 'password' : 'text'}
                value={values[field.id] || ''}
                onChange={(e) => setValues({ ...values, [field.id]: e.target.value })}
                className="w-full rounded border border-gray-300 bg-white px-2 py-1 text-sm focus:border-blue-500 focus:ring-1 focus:ring-blue-500 focus:outline-none dark:border-gray-500 dark:bg-gray-700 dark:text-gray-100 dark:focus:border-blue-400 dark:focus:ring-blue-400"
              />
            )}
          </div>
        ))}

        <button
          onClick={handleAddField}
          className="mb-4 flex items-center gap-1 rounded border border-dashed border-gray-300 px-3 py-2 text-sm text-gray-500 transition-colors hover:border-gray-400 hover:text-gray-700 dark:border-gray-600 dark:text-gray-400 dark:hover:border-gray-500 dark:hover:text-gray-200"
        >
          <Plus size={14} /> Add Field
        </button>

        {/* Save */}
        <div className="flex gap-2 border-t border-gray-200 pt-4 dark:border-gray-700">
          <button
            onClick={handleSave}
            className="flex items-center gap-1 rounded bg-green-600 px-4 py-2 text-sm text-white transition-colors hover:bg-green-700"
          >
            <Save size={14} /> Create Entry
          </button>
          <button
            onClick={onCancel}
            className="rounded bg-gray-200 px-4 py-2 text-sm text-gray-700 transition-colors hover:bg-gray-300 dark:bg-gray-600 dark:text-gray-200 dark:hover:bg-gray-500"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Camera Capture (reused from old TOTP panel) ──

function CameraCapture({ onResult, onCancel }: { onResult: (uri: string) => void; onCancel: () => void }) {
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
          setError('QR scanning not supported. Try importing an image or entering manually.');
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
            /* continue scanning */
          }
        }, 500);
      } catch (err) {
        if (mounted) {
          setError(err instanceof Error ? err.message : 'Failed to start camera');
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
        <span className="text-sm font-medium text-blue-800 dark:text-blue-300">Scan QR Code</span>
        <button
          onClick={() => {
            stopCamera();
            onCancel();
          }}
          className="text-gray-500 hover:text-gray-700"
        >
          <X size={16} />
        </button>
      </div>
      {error ? (
        <div className="text-sm text-red-600 dark:text-red-400">{error}</div>
      ) : (
        <div className="relative mx-auto max-w-sm overflow-hidden rounded bg-black">
          <video ref={videoRef} className="w-full" playsInline muted />
          {scanning && (
            <div className="absolute inset-0 flex items-center justify-center">
              <div className="h-48 w-48 rounded-lg border-2 border-white/50" />
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── Image Import ──

function ImageImport({ onResult, onCancel }: { onResult: (uri: string) => void; onCancel: () => void }) {
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
        <span className="text-sm font-medium text-purple-800 dark:text-purple-300">Import QR Image</span>
        <button onClick={onCancel} className="text-gray-500 hover:text-gray-700">
          <X size={16} />
        </button>
      </div>
      {error && <div className="mb-2 text-sm text-red-600 dark:text-red-400">{error}</div>}
      <div
        onClick={() => fileInputRef.current?.click()}
        className="cursor-pointer rounded border-2 border-dashed border-purple-300 p-6 text-center hover:bg-purple-100 dark:border-purple-700 dark:hover:bg-purple-900/40"
      >
        <Image size={24} className="mx-auto mb-1 text-purple-400" />
        <p className="text-sm text-purple-700 dark:text-purple-400">Click to select image</p>
      </div>
      <input ref={fileInputRef} type="file" accept="image/*" onChange={handleFileSelect} className="hidden" />
    </div>
  );
}
