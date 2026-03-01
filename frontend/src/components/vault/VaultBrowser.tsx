import { useState, useMemo } from 'react';
import { Plus, Key, Shield } from 'lucide-react';
import type { VaultEntry, FolderNode } from '../../lib/types';
import { buildFolderTree, getFolderAtPath, filterEntries } from '../../lib/folders';
import { Breadcrumb } from '../ui/Breadcrumb';
import { SearchBar } from '../ui/SearchBar';
import { FolderView } from './FolderView';
import { EntryView } from './EntryView';
import { CreateEntry } from './CreateEntry';

interface Props {
  entries: VaultEntry[];
  onAddEntry: (entry: VaultEntry) => void;
  onUpdateEntry: (id: string, changes: Partial<VaultEntry>) => void;
  onDeleteEntry: (id: string) => void;
}

type ViewState =
  | { type: 'browse'; path: string }
  | { type: 'entry'; entryId: string; returnPath: string }
  | { type: 'create'; kind: 'password' | 'totp'; returnPath: string };

export function VaultBrowser({ entries, onAddEntry, onUpdateEntry, onDeleteEntry }: Props) {
  const [viewState, setViewState] = useState<ViewState>({ type: 'browse', path: '' });
  const [searchQuery, setSearchQuery] = useState('');
  const [showCreateMenu, setShowCreateMenu] = useState(false);

  // Build folder tree
  const folderTree = useMemo(() => buildFolderTree(entries), [entries]);

  // Filter by search
  const filteredEntries = useMemo(() => (searchQuery ? filterEntries(entries, searchQuery) : entries), [entries, searchQuery]);

  const filteredTree = useMemo(() => (searchQuery ? buildFolderTree(filteredEntries) : folderTree), [searchQuery, filteredEntries, folderTree]);

  // Current folder
  const currentPath = viewState.type === 'browse' ? viewState.path : '';
  const currentFolder: FolderNode | null = viewState.type === 'browse' ? getFolderAtPath(filteredTree, currentPath) : null;

  // Currently selected entry
  const selectedEntry = viewState.type === 'entry' ? entries.find((e) => e.id === viewState.entryId) || null : null;

  const handleNavigateFolder = (path: string) => {
    setViewState({ type: 'browse', path });
  };

  const handleSelectEntry = (entry: VaultEntry) => {
    setViewState({ type: 'entry', entryId: entry.id, returnPath: currentPath });
  };

  const handleBack = () => {
    if (viewState.type === 'entry') {
      setViewState({ type: 'browse', path: viewState.returnPath });
    } else if (viewState.type === 'create') {
      setViewState({ type: 'browse', path: viewState.returnPath });
    }
  };

  const handleCreateEntry = (kind: 'password' | 'totp') => {
    setShowCreateMenu(false);
    setViewState({ type: 'create', kind, returnPath: currentPath });
  };

  const handleSaveNewEntry = (entry: VaultEntry) => {
    onAddEntry(entry);
    setViewState({ type: 'entry', entryId: entry.id, returnPath: currentPath });
  };

  // ── Render: Entry View ──
  if (viewState.type === 'entry' && selectedEntry) {
    return (
      <div>
        <Breadcrumb currentPath={selectedEntry.folder || ''} onNavigate={(path) => setViewState({ type: 'browse', path })} />
        <div className="mt-3">
          <EntryView entry={selectedEntry} onBack={handleBack} onUpdate={onUpdateEntry} onDelete={onDeleteEntry} />
        </div>
      </div>
    );
  }

  // ── Render: Create Entry ──
  if (viewState.type === 'create') {
    return <CreateEntry kind={viewState.kind} defaultFolder={viewState.returnPath} onSave={handleSaveNewEntry} onCancel={handleBack} />;
  }

  // ── Render: Browse ──
  return (
    <div>
      {/* Search */}
      <div className="mb-4">
        <SearchBar value={searchQuery} onChange={setSearchQuery} placeholder="Search entries and folders..." />
      </div>

      {/* Breadcrumb */}
      <div className="mb-3 flex items-center justify-between">
        <Breadcrumb currentPath={currentPath} onNavigate={handleNavigateFolder} />
        <div className="relative">
          <button
            onClick={() => setShowCreateMenu(!showCreateMenu)}
            className="flex items-center gap-1 rounded bg-green-600 px-3 py-1.5 text-sm text-white transition-colors hover:bg-green-700"
          >
            <Plus size={14} /> Add Entry
          </button>
          {showCreateMenu && (
            <div className="absolute top-full right-0 z-10 mt-1 w-48 rounded-lg border border-gray-200 bg-white shadow-lg dark:border-gray-700 dark:bg-gray-800">
              <button
                onClick={() => handleCreateEntry('password')}
                className="flex w-full items-center gap-2 px-4 py-3 text-left text-sm hover:bg-gray-50 dark:hover:bg-gray-700"
              >
                <Key size={16} className="text-blue-500" />
                <span className="text-gray-900 dark:text-gray-100">Password</span>
              </button>
              <button
                onClick={() => handleCreateEntry('totp')}
                className="flex w-full items-center gap-2 px-4 py-3 text-left text-sm hover:bg-gray-50 dark:hover:bg-gray-700"
              >
                <Shield size={16} className="text-purple-500" />
                <span className="text-gray-900 dark:text-gray-100">TOTP (2FA)</span>
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Folder content */}
      {currentFolder ? (
        <FolderView folder={currentFolder} onNavigateFolder={handleNavigateFolder} onSelectEntry={handleSelectEntry} />
      ) : (
        <p className="py-8 text-center text-gray-500 italic dark:text-gray-400">Folder not found.</p>
      )}
    </div>
  );
}
