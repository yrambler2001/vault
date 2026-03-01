/* eslint-disable react-hooks/set-state-in-effect */
import { useState, useEffect } from 'react';
import { ArrowLeft, Copy, CheckCircle, Eye, Pencil, Trash2, Clock, Save, X } from 'lucide-react';
import type { VaultEntry, FieldDefinition } from '../../lib/types';
import * as totpLib from '../../lib/totp';

interface Props {
  entry: VaultEntry;
  onBack: () => void;
  onUpdate: (id: string, changes: Partial<VaultEntry>) => void;
  onDelete: (id: string) => void;
}

export function EntryView({ entry, onBack, onUpdate, onDelete }: Props) {
  const [editing, setEditing] = useState(false);
  const [editName, setEditName] = useState(entry.name);
  const [editFolder, setEditFolder] = useState(entry.folder);
  const [editFields, setEditFields] = useState<FieldDefinition[]>([...entry.fields]);
  const [editValues, setEditValues] = useState<Record<string, string>>({ ...entry.values });
  const [editTotp, setEditTotp] = useState(entry.totp ? { ...entry.totp } : undefined);

  // Reset edit state when entry changes
  useEffect(() => {
    setEditName(entry.name);
    setEditFolder(entry.folder);
    setEditFields([...entry.fields]);
    setEditValues({ ...entry.values });
    setEditTotp(entry.totp ? { ...entry.totp } : undefined);
    setEditing(false);
  }, [entry.id, entry.name, entry.folder, entry.fields, entry.values, entry.totp]);

  const handleSave = () => {
    onUpdate(entry.id, {
      name: editName,
      folder: editFolder,
      fields: editFields,
      values: editValues,
      totp: editTotp,
    });
    setEditing(false);
  };

  const handleCancel = () => {
    setEditName(entry.name);
    setEditFolder(entry.folder);
    setEditFields([...entry.fields]);
    setEditValues({ ...entry.values });
    setEditTotp(entry.totp ? { ...entry.totp } : undefined);
    setEditing(false);
  };

  const handleDelete = () => {
    if (window.confirm(`Delete "${entry.name || 'this entry'}"? This cannot be undone.`)) {
      onDelete(entry.id);
      onBack();
    }
  };

  const handleAddField = () => {
    const newField: FieldDefinition = {
      id: crypto.randomUUID(),
      name: '',
      type: 'single',
      searchable: false,
      hidden: false,
    };
    setEditFields([...editFields, newField]);
    setEditValues({ ...editValues, [newField.id]: '' });
  };

  const handleRemoveField = (fieldId: string) => {
    setEditFields(editFields.filter((f) => f.id !== fieldId));
    const newValues = { ...editValues };
    delete newValues[fieldId];
    setEditValues(newValues);
  };

  const handleUpdateFieldDef = (fieldId: string, changes: Partial<FieldDefinition>) => {
    setEditFields(editFields.map((f) => (f.id === fieldId ? { ...f, ...changes } : f)));
  };

  return (
    <div>
      {/* Header */}
      <div className="mb-4 flex items-center justify-between">
        <button
          onClick={onBack}
          className="flex items-center gap-1 rounded-lg px-3 py-2 text-sm text-gray-600 transition-colors hover:bg-gray-200 dark:text-gray-300 dark:hover:bg-gray-700"
        >
          <ArrowLeft size={16} />
          Back
        </button>
        <div className="flex items-center gap-2">
          {!editing && (
            <button
              onClick={() => setEditing(true)}
              className="flex items-center gap-1 rounded bg-blue-600 px-3 py-1.5 text-sm text-white transition-colors hover:bg-blue-700"
            >
              <Pencil size={14} /> Edit
            </button>
          )}
          <button
            onClick={handleDelete}
            className="flex items-center gap-1 rounded bg-red-500 px-3 py-1.5 text-sm text-white transition-colors hover:bg-red-600"
          >
            <Trash2 size={14} /> Delete
          </button>
        </div>
      </div>

      {/* Content */}
      <div className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm dark:border-gray-700 dark:bg-gray-800">
        {/* Name */}
        <div className="mb-4">
          <label className="mb-1 block text-xs font-medium tracking-wide text-gray-500 uppercase dark:text-gray-400">Name</label>
          {editing ? (
            <input
              type="text"
              value={editName}
              onChange={(e) => setEditName(e.target.value)}
              className="w-full rounded border border-gray-300 bg-white px-3 py-2 text-sm focus:border-blue-500 focus:ring-1 focus:ring-blue-500 focus:outline-none dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100 dark:focus:border-blue-400 dark:focus:ring-blue-400"
            />
          ) : (
            <FieldDisplay value={entry.name} hidden={false} />
          )}
        </div>

        {/* Folder */}
        <div className="mb-4">
          <label className="mb-1 block text-xs font-medium tracking-wide text-gray-500 uppercase dark:text-gray-400">Folder</label>
          {editing ? (
            <input
              type="text"
              value={editFolder}
              onChange={(e) => setEditFolder(e.target.value)}
              placeholder="e.g. Work/Cloud"
              className="w-full rounded border border-gray-300 bg-white px-3 py-2 text-sm focus:border-blue-500 focus:ring-1 focus:ring-blue-500 focus:outline-none dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100 dark:focus:border-blue-400 dark:focus:ring-blue-400"
            />
          ) : (
            <div className="text-sm text-gray-900 dark:text-gray-100">{entry.folder || <span className="text-gray-400 italic">(root)</span>}</div>
          )}
        </div>

        {/* Dynamic Fields */}
        {(editing ? editFields : entry.fields).map((field) => (
          <div key={field.id} className="mb-4">
            {editing ? (
              <EditableField
                field={field}
                value={editValues[field.id] || ''}
                onFieldDefChange={(changes) => handleUpdateFieldDef(field.id, changes)}
                onValueChange={(val) => setEditValues({ ...editValues, [field.id]: val })}
                onRemove={() => handleRemoveField(field.id)}
              />
            ) : (
              <div>
                <label className="mb-1 block text-xs font-medium tracking-wide text-gray-500 uppercase dark:text-gray-400">
                  {field.name || 'Unnamed Field'}
                </label>
                <FieldDisplay value={entry.values[field.id] || ''} hidden={field.hidden} />
              </div>
            )}
          </div>
        ))}

        {/* TOTP Display */}
        {entry.kind === 'totp' && entry.totp && !editing && <TOTPLiveCode secret={entry.totp.secret} digits={entry.totp.digits} period={entry.totp.period} />}

        {/* TOTP Editing */}
        {entry.kind === 'totp' && editing && editTotp && (
          <div className="mb-4">
            <label className="mb-1 block text-xs font-medium tracking-wide text-gray-500 uppercase dark:text-gray-400">TOTP Secret (Base32)</label>
            <input
              type="text"
              value={editTotp.secret}
              onChange={(e) => setEditTotp({ ...editTotp, secret: e.target.value.replace(/\s/g, '').toUpperCase() })}
              className="w-full rounded border border-gray-300 bg-white px-3 py-2 font-mono text-sm focus:border-blue-500 focus:ring-1 focus:ring-blue-500 focus:outline-none dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100 dark:focus:border-blue-400 dark:focus:ring-blue-400"
            />
          </div>
        )}

        {/* Add field button (edit mode) */}
        {editing && (
          <button
            onClick={handleAddField}
            className="mt-2 rounded border border-dashed border-gray-300 px-3 py-2 text-sm text-gray-500 transition-colors hover:border-gray-400 hover:text-gray-700 dark:border-gray-600 dark:text-gray-400 dark:hover:border-gray-500 dark:hover:text-gray-200"
          >
            + Add Field
          </button>
        )}

        {/* Save / Cancel */}
        {editing && (
          <div className="mt-4 flex gap-2 border-t border-gray-200 pt-4 dark:border-gray-700">
            <button
              onClick={handleSave}
              className="flex items-center gap-1 rounded bg-blue-600 px-4 py-2 text-sm text-white transition-colors hover:bg-blue-700"
            >
              <Save size={14} /> Save
            </button>
            <button
              onClick={handleCancel}
              className="flex items-center gap-1 rounded bg-gray-200 px-4 py-2 text-sm text-gray-700 transition-colors hover:bg-gray-300 dark:bg-gray-600 dark:text-gray-200 dark:hover:bg-gray-500"
            >
              <X size={14} /> Cancel
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Field Display (with copy and reveal) ──

function FieldDisplay({ value, hidden }: { value: string; hidden: boolean }) {
  const [revealed, setRevealed] = useState(false);
  const [copied, setCopied] = useState(false);

  const displayValue = hidden && !revealed ? '••••••••' : value;

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

// ── Editable Field Definition + Value ──

function EditableField({
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
          onChange={(e) => onFieldDefChange({ type: e.target.value as 'single' | 'multi' })}
          className="rounded border border-gray-300 bg-white px-2 py-1 text-xs dark:border-gray-500 dark:bg-gray-700 dark:text-gray-100"
        >
          <option value="single">Single line</option>
          <option value="multi">Multi-line</option>
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

// ── TOTP Live Code ──

function TOTPLiveCode({ secret, digits, period }: { secret: string; digits: number; period: number }) {
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
    <div className="mb-4">
      <label className="mb-1 block text-xs font-medium tracking-wide text-gray-500 uppercase dark:text-gray-400">TOTP Code</label>
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
