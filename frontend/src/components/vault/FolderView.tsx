import { Folder, FileText, Key } from 'lucide-react';
import type { FolderNode, VaultEntry } from '../../lib/types';
import { getEntryTypeLabel, entryHasTOTP } from '../../lib/types';

interface Props {
  folder: FolderNode;
  onNavigateFolder: (path: string) => void;
  onSelectEntry: (entry: VaultEntry) => void;
}

export function FolderView({ folder, onNavigateFolder, onSelectEntry }: Props) {
  const hasContent = folder.children.length > 0 || folder.entries.length > 0;

  if (!hasContent) {
    return <p className="py-8 text-center text-gray-500 italic dark:text-gray-400">This folder is empty.</p>;
  }

  return (
    <div className="space-y-1">
      {/* Subfolders first */}
      {folder.children.map((child) => {
        const totalEntries = countEntries(child);
        return (
          <button
            key={child.path}
            onClick={() => onNavigateFolder(child.path)}
            className="flex w-full items-center gap-3 rounded-lg border border-gray-200 bg-white px-4 py-3 text-left transition-colors hover:bg-gray-50 active:bg-gray-100 dark:border-gray-700 dark:bg-gray-800 dark:hover:bg-gray-700 dark:active:bg-gray-600"
          >
            <Folder size={20} className="shrink-0 text-yellow-500 dark:text-yellow-400" />
            <div className="min-w-0 flex-1">
              <div className="font-medium text-gray-900 dark:text-gray-100">{child.name}</div>
              <div className="text-xs text-gray-500 dark:text-gray-400">
                {totalEntries} {totalEntries === 1 ? 'entry' : 'entries'}
              </div>
            </div>
          </button>
        );
      })}

      {/* Entries */}
      {folder.entries.map((entry) => {
        const hasTOTP = entryHasTOTP(entry);
        return (
          <button
            key={entry.id}
            onClick={() => onSelectEntry(entry)}
            className="flex w-full items-center gap-3 rounded-lg border border-gray-200 bg-white px-4 py-3 text-left transition-colors hover:bg-gray-50 active:bg-gray-100 dark:border-gray-700 dark:bg-gray-800 dark:hover:bg-gray-700 dark:active:bg-gray-600"
          >
            <Key size={20} className={`shrink-0 ${hasTOTP ? 'text-purple-500 dark:text-purple-400' : 'text-blue-500 dark:text-blue-400'}`} />
            <div className="min-w-0 flex-1">
              <div className="truncate font-medium text-gray-900 dark:text-gray-100">{entry.name || <span className="text-gray-400 italic">Unnamed</span>}</div>
              <div className="flex items-center gap-2 text-xs text-gray-500 dark:text-gray-400">
                <span>{getEntryTypeLabel(entry)}</span>
                {entry.fields.length > 0 && (
                  <span>
                    · {entry.fields.length} field{entry.fields.length !== 1 ? 's' : ''}
                  </span>
                )}
              </div>
            </div>
            <FileText size={16} className="shrink-0 text-gray-300 dark:text-gray-600" />
          </button>
        );
      })}
    </div>
  );
}

function countEntries(node: FolderNode): number {
  let count = node.entries.length;
  for (const child of node.children) {
    count += countEntries(child);
  }
  return count;
}
