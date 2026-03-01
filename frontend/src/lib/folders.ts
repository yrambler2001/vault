import type { VaultEntry, FolderNode } from './types';

/**
 * Build a folder tree from a flat list of entries.
 */
export function buildFolderTree(entries: VaultEntry[]): FolderNode {
  const root: FolderNode = {
    name: '',
    path: '',
    children: [],
    entries: [],
  };

  for (const entry of entries) {
    const folder = (entry.folder || '').trim();
    if (!folder) {
      root.entries.push(entry);
      continue;
    }

    const parts = folder.split('/').filter(Boolean);
    let current = root;

    for (let i = 0; i < parts.length; i++) {
      const part = parts[i];
      const path = parts.slice(0, i + 1).join('/');
      let child = current.children.find((c) => c.name === part);
      if (!child) {
        child = { name: part, path, children: [], entries: [] };
        current.children.push(child);
      }
      current = child;
    }

    current.entries.push(entry);
  }

  // Sort children alphabetically at each level
  sortFolderNode(root);

  return root;
}

function sortFolderNode(node: FolderNode): void {
  node.children.sort((a, b) => a.name.localeCompare(b.name));
  node.entries.sort((a, b) => a.name.localeCompare(b.name));
  for (const child of node.children) {
    sortFolderNode(child);
  }
}

/**
 * Navigate to a specific folder path in the tree.
 */
export function getFolderAtPath(root: FolderNode, path: string): FolderNode | null {
  if (!path) return root;

  const parts = path.split('/').filter(Boolean);
  let current = root;

  for (const part of parts) {
    const child = current.children.find((c) => c.name === part);
    if (!child) return null;
    current = child;
  }

  return current;
}

/**
 * Get breadcrumb parts from a path.
 */
export function getBreadcrumbs(path: string): { name: string; path: string }[] {
  if (!path) return [];
  const parts = path.split('/').filter(Boolean);
  return parts.map((part, i) => ({
    name: part,
    path: parts.slice(0, i + 1).join('/'),
  }));
}

/**
 * Filter entries by search query.
 * Searches name and any field marked as searchable.
 */
export function filterEntries(entries: VaultEntry[], query: string): VaultEntry[] {
  if (!query.trim()) return entries;
  const q = query.toLowerCase().trim();

  return entries.filter((entry) => {
    // Always search name
    if (entry.name.toLowerCase().includes(q)) return true;

    // Search folder
    if (entry.folder.toLowerCase().includes(q)) return true;

    // Search searchable fields
    for (const field of entry.fields) {
      if (field.searchable) {
        const val = entry.values[field.id] || '';
        if (val.toLowerCase().includes(q)) return true;
      }
    }

    // For TOTP, search issuer/account in values
    if (entry.kind === 'totp' && entry.totp) {
      // already covered by searchable fields
    }

    return false;
  });
}

/**
 * Collect all unique folder paths from entries.
 */
export function getAllFolderPaths(entries: VaultEntry[]): string[] {
  const paths = new Set<string>();
  for (const entry of entries) {
    if (entry.folder) {
      const parts = entry.folder.split('/').filter(Boolean);
      for (let i = 1; i <= parts.length; i++) {
        paths.add(parts.slice(0, i).join('/'));
      }
    }
  }
  return Array.from(paths).sort();
}
