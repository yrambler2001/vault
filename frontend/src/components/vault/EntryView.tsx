/* eslint-disable react-hooks/set-state-in-effect */
import { useState, useEffect } from 'react';
import { ArrowLeft, Pencil, Trash2, Save, X, Plus } from 'lucide-react';
import type { VaultEntry, FieldDefinition, TOTPFieldValue } from '../../lib/types';
import { EditableField, FieldDisplay, TOTPLiveCode } from './FieldComponents';

interface Props {
  entry: VaultEntry;
  onBack: () => void;
  onUpdate: (id: string, changes: Partial<VaultEntry>) => void;
  onDelete: (id: string) => void;
  onNavigateFolder: (path: string) => void;
}

export function EntryView({ entry, onBack, onUpdate, onDelete, onNavigateFolder }: Props) {
  const [editing, setEditing] = useState(false);
  const [editName, setEditName] = useState(entry.name);
  const [editFolders, setEditFolders] = useState<string[]>([...entry.folders]);
  const [editFields, setEditFields] = useState<FieldDefinition[]>([...entry.fields]);
  const [editValues, setEditValues] = useState<Record<string, string>>({ ...entry.values });

  // Reset edit state when entry changes
  useEffect(() => {
    setEditName(entry.name);
    setEditFolders([...entry.folders]);
    setEditFields([...entry.fields]);
    setEditValues({ ...entry.values });
    setEditing(false);
  }, [entry.id, entry.name, entry.folders, entry.fields, entry.values]);

  const handleSave = () => {
    // Normalize folders: trim, deduplicate, keep at least one
    const normalizedFolders = [...new Set(editFolders.map((f) => f.trim()))];
    if (normalizedFolders.length === 0) {
      normalizedFolders.push('');
    }

    onUpdate(entry.id, {
      name: editName,
      folders: normalizedFolders,
      fields: editFields,
      values: editValues,
    });
    setEditing(false);
  };

  const handleCancel = () => {
    setEditName(entry.name);
    setEditFolders([...entry.folders]);
    setEditFields([...entry.fields]);
    setEditValues({ ...entry.values });
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

  const handleAddFolder = () => {
    setEditFolders([...editFolders, '']);
  };

  const handleUpdateFolder = (index: number, value: string) => {
    const updated = [...editFolders];
    updated[index] = value;
    setEditFolders(updated);
  };

  const handleRemoveFolder = (index: number) => {
    if (editFolders.length <= 1) return;
    setEditFolders(editFolders.filter((_, i) => i !== index));
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

        {/* Folders */}
        <div className="mb-4">
          <label className="mb-1 block text-xs font-medium tracking-wide text-gray-500 uppercase dark:text-gray-400">Folders</label>
          {editing ? (
            <div>
              <div className="space-y-2">
                {editFolders.map((folder, index) => (
                  <div key={index} className="flex items-center gap-2">
                    <input
                      type="text"
                      value={folder}
                      onChange={(e) => handleUpdateFolder(index, e.target.value)}
                      placeholder="e.g. Work/Cloud"
                      className="flex-1 rounded border border-gray-300 bg-white px-3 py-2 text-sm focus:border-blue-500 focus:ring-1 focus:ring-blue-500 focus:outline-none dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100 dark:focus:border-blue-400 dark:focus:ring-blue-400"
                    />
                    {editFolders.length > 1 && (
                      <button onClick={() => handleRemoveFolder(index)} className="rounded p-1.5 text-red-400 hover:text-red-600" title="Remove folder">
                        <X size={16} />
                      </button>
                    )}
                  </div>
                ))}
              </div>
              <button
                onClick={handleAddFolder}
                className="mt-2 flex items-center gap-1 text-sm text-blue-600 hover:text-blue-800 dark:text-blue-400 dark:hover:text-blue-300"
              >
                <Plus size={14} /> Add another folder
              </button>
            </div>
          ) : (
            <div className="flex flex-wrap gap-2">
              {entry.folders.filter((f) => f).length === 0 ? (
                <button
                  onClick={() => onNavigateFolder('')}
                  className="rounded bg-gray-100 px-2 py-1 text-sm text-gray-500 transition-colors hover:bg-gray-200 dark:bg-gray-700 dark:text-gray-400 dark:hover:bg-gray-600"
                >
                  <span className="italic">(root)</span>
                </button>
              ) : (
                entry.folders.map((folder, index) => (
                  <button
                    key={index}
                    onClick={() => onNavigateFolder(folder || '')}
                    className="rounded bg-blue-50 px-2 py-1 text-sm text-blue-700 transition-colors hover:bg-blue-100 dark:bg-blue-900/30 dark:text-blue-300 dark:hover:bg-blue-900/50"
                  >
                    {folder || <span className="text-blue-400 italic dark:text-blue-500">(root)</span>}
                  </button>
                ))
              )}
            </div>
          )}
        </div>

        {/* Dynamic Fields */}
        {(editing ? editFields : entry.fields).map((field) => {
          if (!editing && field.type === 'totp') {
            let parsed: TOTPFieldValue | null = null;
            try {
              parsed = JSON.parse(entry.values[field.id]);
            } catch {
              // ignore
            }
            return (
              <div key={field.id} className="mb-4">
                <label className="mb-1 block text-xs font-medium tracking-wide text-gray-500 uppercase dark:text-gray-400">{field.name || 'TOTP Code'}</label>
                {parsed && parsed.secret ? (
                  <TOTPLiveCode secret={parsed.secret} digits={parsed.digits} period={parsed.period} />
                ) : (
                  <div className="text-sm text-gray-400 italic">—</div>
                )}
              </div>
            );
          }

          // Regular fields
          return (
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
          );
        })}

        {/* Add field buttons (edit mode) */}
        {editing && (
          <div className="mt-2 flex flex-wrap gap-2">
            <button
              onClick={handleAddField}
              className="flex items-center gap-1 rounded border border-dashed border-gray-300 px-3 py-2 text-sm text-gray-500 transition-colors hover:border-gray-400 hover:text-gray-700 dark:border-gray-600 dark:text-gray-400 dark:hover:border-gray-500 dark:hover:text-gray-200"
            >
              <Plus size={14} /> Add Field
            </button>
          </div>
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
