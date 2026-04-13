/**
 * Shared types for the vault application.
 */

// ── Global Developer Mode ──

/**
 * When Developer Mode is active, a deep clone of decrypted entries
 * is attached to window.$vault for ad-hoc querying in Chrome DevTools.
 *
 * The snapshot is mutable — you can modify entries in-place and then
 * call $vault.commit() to push changes back into the live vault state.
 *
 * Example usage in console:
 *   // Read-only queries
 *   $vault.entries.filter(e => e.name.includes('GitHub'))
 *   $vault.findDuplicatePasswords()
 *
 *   // Mutations
 *   $vault.entries.forEach(e => { if (e.folders[0] === 'Old') e.folders = ['New']; })
 *   $vault.commit()
 *
 *   // Targeted update
 *   $vault.update(e => e.folders.includes('Legacy'), e => { e.folders = ['Archive/Legacy']; })
 */
export interface DevVaultHandle {
  /** Deep clone of all decrypted entries — mutable */
  entries: VaultEntry[];
  /** Timestamp when the snapshot was taken */
  snapshotAt: string;
  /** Vault version at time of snapshot */
  version: number;
  /** Whether there are uncommitted changes */
  dirty: boolean;

  // ── Commit / Write-back ──

  /**
   * Push the current `entries` array back into the live vault state.
   * This replaces ALL entries with the current snapshot (deep-cloned
   * back into React state). The vault will show "unsaved" — you must
   * click Save in the UI to persist to server.
   *
   * Returns the number of entries committed.
   */
  commit: () => number;

  /**
   * Preview what commit() would do — returns a diff summary without
   * actually committing.
   */
  preview: () => DevVaultDiff;

  /**
   * Apply a transformation to entries matching a predicate, then
   * auto-commit. Equivalent to filter + mutate + commit().
   *
   * @param predicate - Filter function to select entries
   * @param mutator   - Function that mutates each matched entry in-place
   * @returns Summary of what was changed
   */
  update: (predicate: (entry: VaultEntry) => boolean, mutator: (entry: VaultEntry) => void) => { matched: number; committed: number };

  /**
   * Add new entries to the snapshot and auto-commit.
   * Each entry must have at minimum: name, kind='password', folders.
   * Missing fields (id, createdAt, etc.) are auto-generated.
   */
  add: (entries: Partial<VaultEntry>[]) => { added: number };

  /**
   * Remove entries matching a predicate and auto-commit.
   */
  remove: (predicate: (entry: VaultEntry) => boolean) => { removed: number };

  /**
   * Discard all local mutations and re-sync from the live vault state.
   */
  refresh: () => number;

  // ── Read-only Helpers ──

  /** Helper: find entries sharing the same password value */
  findDuplicatePasswords: () => Record<string, { password: string; entries: string[] }>;
  /** Helper: find entries with empty/missing password fields */
  findEmptyPasswords: () => { id: string; name: string; fieldName: string }[];
  /** Helper: find entries with weak passwords (< minLength chars) */
  findWeakPasswords: (minLength?: number) => { id: string; name: string; fieldName: string; length: number }[];
  /** Helper: list all TOTP entries */
  listTOTP: () => { id: string; name: string; issuer: string }[];
  /** Helper: search entries by regex pattern on name or field values */
  search: (pattern: string | RegExp) => VaultEntry[];
  /** Helper: get a summary of the vault structure */
  summary: () => { totalEntries: number; totalFolders: number; totalFields: number; totpCount: number };
}

export interface DevVaultDiff {
  added: number;
  removed: number;
  modified: number;
  unchanged: number;
  total: number;
  details: {
    addedEntries: string[];
    removedEntries: string[];
    modifiedEntries: string[];
  };
}

/**
 * Callback type for pushing DevMode changes back into React state.
 */
export type DevModeCommitCallback = (entries: VaultEntry[]) => void;

/**
 * Callback type for refreshing DevMode snapshot from live state.
 */
export type DevModeRefreshCallback = () => VaultEntry[];

declare global {
  interface Window {
    $vault?: DevVaultHandle;
  }
}

// ── Field Definition ──

export interface FieldDefinition {
  /** Unique field ID */
  id: string;
  /** Display name / label */
  name: string;
  /** 'single' for single-line, 'multi' for multi-line, 'totp' for TOTP */
  type: 'single' | 'multi' | 'totp';
  /** Whether this field is included in search */
  searchable: boolean;
  /** Whether this field is hidden with asterisks by default */
  hidden: boolean;
}

// ── TOTP Custom Field Value ──

export interface TOTPFieldValue {
  secret: string;
  algorithm: string;
  digits: number;
  period: number;
}

// ── Entry (Password) ──

export interface VaultEntry {
  id: string;
  /** Entry kind: always 'password' */
  kind: 'password';
  /** Display name (always present, always searchable) */
  name: string;
  /** Folder paths where this entry appears, e.g. ["Work/AWS", "Cloud"] or [""] for root only */
  folders: string[];
  /** Dynamic fields */
  fields: FieldDefinition[];
  /** Field values keyed by field id. For 'totp' fields, value is JSON-stringified TOTPFieldValue */
  values: Record<string, string>;
  createdAt: string;
  modifiedAt: string;
}

// ── Folder Tree Node ──

export interface FolderNode {
  name: string;
  path: string;
  children: FolderNode[];
  entries: VaultEntry[];
}

// ── Vault Payload ──

export interface VaultPayload {
  /** Schema version for migrations */
  version: number;
  entries: VaultEntry[];
}

// ── Helper to check if an entry has a TOTP field ──

export function entryHasTOTP(entry: VaultEntry): boolean {
  return entry.fields.some((f) => f.type === 'totp');
}

/**
 * Get the display label for an entry's type.
 */
export function getEntryTypeLabel(entry: VaultEntry): string {
  return entryHasTOTP(entry) ? 'Password + TOTP' : 'Password';
}

/**
 * Get the primary folder (first in the list) for navigation purposes.
 */
export function getPrimaryFolder(entry: VaultEntry): string {
  return entry.folders.length > 0 ? entry.folders[0] : '';
}
