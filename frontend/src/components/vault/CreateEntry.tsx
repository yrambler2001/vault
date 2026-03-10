import { useState } from 'react';
import { ArrowLeft, Plus, Save } from 'lucide-react';
import type { VaultEntry, FieldDefinition } from '../../lib/types';
import { EditableField } from './FieldComponents';

interface Props {
  defaultFolder: string;
  onSave: (entry: VaultEntry) => void;
  onCancel: () => void;
}

export function CreateEntry({ defaultFolder, onSave, onCancel }: Props) {
  const [name, setName] = useState('');
  const [folder, setFolder] = useState(defaultFolder);
  const [initialState] = useState(() => {
    const loginFieldId = crypto.randomUUID();
    const passwordFieldId = crypto.randomUUID();
    const websiteFieldId = crypto.randomUUID();

    return {
      fields: [
        {
          id: loginFieldId,
          name: 'Login',
          type: 'single' as const,
          searchable: true,
          hidden: false,
        },
        {
          id: passwordFieldId,
          name: 'Password',
          type: 'single' as const,
          searchable: false,
          hidden: true,
        },
        {
          id: websiteFieldId,
          name: 'Website',
          type: 'single' as const,
          searchable: true,
          hidden: false,
        },
      ],
      values: {
        [loginFieldId]: '',
        [passwordFieldId]: '',
        [websiteFieldId]: '',
      },
    };
  });

  const [fields, setFields] = useState<FieldDefinition[]>(initialState.fields);
  const [values, setValues] = useState<Record<string, string>>(initialState.values);
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

    const entry: VaultEntry = {
      id: crypto.randomUUID(),
      kind: 'password',
      name: name.trim(),
      folder: folder.trim(),
      fields,
      values,
      createdAt: new Date().toISOString(),
      modifiedAt: new Date().toISOString(),
    };

    onSave(entry);
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
        <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">New Password Entry</h2>
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

        {/* Dynamic Fields */}
        {fields.map((field) => (
          <div key={field.id} className="mb-3">
            <EditableField
              field={field}
              value={values[field.id] || ''}
              onFieldDefChange={(changes) => handleUpdateFieldDef(field.id, changes)}
              onValueChange={(val) => setValues({ ...values, [field.id]: val })}
              onRemove={() => handleRemoveField(field.id)}
            />
          </div>
        ))}

        {/* Add Field button */}
        <div className="mb-4 flex flex-wrap gap-2">
          <button
            onClick={handleAddField}
            className="flex items-center gap-1 rounded border border-dashed border-gray-300 px-3 py-2 text-sm text-gray-500 transition-colors hover:border-gray-400 hover:text-gray-700 dark:border-gray-600 dark:text-gray-400 dark:hover:border-gray-500 dark:hover:text-gray-200"
          >
            <Plus size={14} /> Add Field
          </button>
        </div>

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
