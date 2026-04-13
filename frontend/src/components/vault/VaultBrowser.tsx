import { useState, useMemo } from 'react';
import { Plus } from 'lucide-react';
import type { VaultEntry, FolderNode } from '../../lib/types';
import { getPrimaryFolder } from '../../lib/types';
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

type ViewState = { type: 'browse'; path: string } | { type: 'entry'; entryId: string; returnPath: string } | { type: 'create'; returnPath: string };

export function VaultBrowser({ entries, onAddEntry, onUpdateEntry, onDeleteEntry }: Props) {
  const [viewState, setViewState] = useState<ViewState>({ type: 'browse', path: '' });
  const [searchQuery, setSearchQuery] = useState('');

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

  const handleCreateEntry = () => {
    setViewState({ type: 'create', returnPath: currentPath });
  };

  const handleSaveNewEntry = (entry: VaultEntry) => {
    onAddEntry(entry);
    setViewState({ type: 'entry', entryId: entry.id, returnPath: currentPath });
  };

  // ── Render: Entry View ──
  if (viewState.type === 'entry' && selectedEntry) {
    return (
      <div>
        <Breadcrumb currentPath={getPrimaryFolder(selectedEntry)} onNavigate={(path) => setViewState({ type: 'browse', path })} />
        <div className="mt-3">
          <EntryView entry={selectedEntry} onBack={handleBack} onUpdate={onUpdateEntry} onDelete={onDeleteEntry} onNavigateFolder={handleNavigateFolder} />
        </div>
      </div>
    );
  }

  // ── Render: Create Entry ──
  if (viewState.type === 'create') {
    return <CreateEntry defaultFolder={viewState.returnPath} onSave={handleSaveNewEntry} onCancel={handleBack} />;
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
        <button
          onClick={handleCreateEntry}
          className="flex items-center gap-1 rounded bg-green-600 px-3 py-1.5 text-sm text-white transition-colors hover:bg-green-700"
        >
          <Plus size={14} /> Add Entry
        </button>
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
