import { useState } from 'react';
import { Plus, Trash2, Eye, EyeOff, Copy, CheckCircle, RefreshCw } from 'lucide-react';
import * as cryptoLib from '../../lib/crypto';
import type { PasswordEntry } from '../vault/LockedVault';

interface Props {
  passwords: PasswordEntry[];
  onAdd: () => void;
  onUpdate: (id: string, changes: Partial<PasswordEntry>) => void;
  onDelete: (id: string) => void;
}

export function PasswordsPanel({ passwords, onAdd, onUpdate, onDelete }: Props) {
  return (
    <div className="mb-8 rounded-lg border bg-white p-6 shadow-sm">
      <div className="mb-4 flex items-center justify-between border-b pb-2">
        <h2 className="text-xl font-bold">Passwords</h2>
        <button onClick={onAdd} className="flex items-center gap-1 rounded bg-green-600 px-3 py-1 text-sm text-white transition-colors hover:bg-green-700">
          <Plus size={14} /> Add Entry
        </button>
      </div>
      {passwords.length === 0 ? (
        <p className="text-gray-500 italic">No passwords yet. Add your first entry!</p>
      ) : (
        <ul className="space-y-3">
          {passwords.map((entry) => (
            <PasswordEntryRow key={entry.id} entry={entry} onUpdate={onUpdate} onDelete={onDelete} />
          ))}
        </ul>
      )}
    </div>
  );
}

function PasswordEntryRow({
  entry,
  onUpdate,
  onDelete,
}: {
  entry: PasswordEntry;
  onUpdate: (id: string, changes: Partial<PasswordEntry>) => void;
  onDelete: (id: string) => void;
}) {
  const [showPassword, setShowPassword] = useState(false);
  const [copied, setCopied] = useState(false);

  const copyToClipboard = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* clipboard unavailable */
    }
  };

  const handleGeneratePassword = () => {
    const generated = cryptoLib.generatePassword(20);
    onUpdate(entry.id, { password: generated });
  };

  return (
    <li className="rounded-lg border p-3">
      <div className="mb-2 flex gap-2">
        <input
          type="text"
          placeholder="Service (e.g., github.com)"
          value={entry.service}
          onChange={(e) => onUpdate(entry.id, { service: e.target.value })}
          className="flex-1 rounded border p-1.5 text-sm"
        />
        <input
          type="text"
          placeholder="Username"
          value={entry.username}
          onChange={(e) => onUpdate(entry.id, { username: e.target.value })}
          className="flex-1 rounded border p-1.5 text-sm"
        />
      </div>
      <div className="flex items-center gap-2">
        <div className="relative flex-1">
          <input
            type={showPassword ? 'text' : 'password'}
            placeholder="Password"
            value={entry.password}
            onChange={(e) => onUpdate(entry.id, { password: e.target.value })}
            className="w-full rounded border p-1.5 pr-24 text-sm"
          />
          <div className="absolute top-1/2 right-1 flex -translate-y-1/2 gap-1">
            <button onClick={handleGeneratePassword} className="p-0.5 text-gray-400 hover:text-blue-600" title="Generate random password">
              <RefreshCw size={14} />
            </button>
            <button onClick={() => setShowPassword(!showPassword)} className="p-0.5 text-gray-400 hover:text-gray-600" title={showPassword ? 'Hide' : 'Show'}>
              {showPassword ? <EyeOff size={14} /> : <Eye size={14} />}
            </button>
            <button
              onClick={() => copyToClipboard(entry.password)}
              className={`p-0.5 ${copied ? 'text-green-500' : 'text-gray-400 hover:text-gray-600'}`}
              title={copied ? 'Copied!' : 'Copy password'}
            >
              {copied ? <CheckCircle size={14} /> : <Copy size={14} />}
            </button>
          </div>
        </div>
        <button onClick={() => onDelete(entry.id)} className="p-1 text-red-500 hover:text-red-700">
          <Trash2 size={18} />
        </button>
      </div>
      <input
        type="text"
        placeholder="Notes (optional)"
        value={entry.notes}
        onChange={(e) => onUpdate(entry.id, { notes: e.target.value })}
        className="mt-2 w-full rounded border p-1.5 text-sm"
      />
    </li>
  );
}
