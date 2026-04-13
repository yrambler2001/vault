/**
 * Developer Mode — exposes a deep clone of decrypted vault entries
 * on `window.$vault` for ad-hoc querying AND mutation in Chrome DevTools.
 *
 * SECURITY NOTES:
 * - The snapshot is a deep clone; mutations only affect the snapshot
 *   until commit() is called.
 * - commit() pushes changes into React state, marking the vault as
 *   "unsaved". The user must still click Save to persist to server.
 * - The variable is deleted when Developer Mode is deactivated, on vault
 *   lock, or after the configured timeout (default 15 minutes).
 * - A GC hint is issued by nulling the reference, but JavaScript cannot
 *   guarantee cryptographic erasure (same limitation as the rest of the app).
 * - This feature is intended for single-person, self-hosted use only.
 *
 * Example DevTools usage:
 *
 *   // Read-only
 *   $vault.findDuplicatePasswords()
 *   $vault.search(/github/i)
 *
 *   // Batch rename folders
 *   $vault.update(
 *     e => e.folders.includes('Old Folder'),
 *     e => { e.folders = e.folders.map(f => f === 'Old Folder' ? 'New Folder' : f); }
 *   )
 *
 *   // Manual mutation + commit
 *   $vault.entries.forEach(e => {
 *     if (e.folders[0] === 'Legacy') e.folders = ['Archive/Legacy'];
 *   });
 *   $vault.commit()
 *
 *   // Preview changes before committing
 *   $vault.preview()
 *
 *   // Add new entries programmatically
 *   $vault.add([{ name: 'New Service', folders: ['Work'] }])
 *
 *   // Remove entries
 *   $vault.remove(e => e.name.includes('Old'))
 *
 *   // Discard mutations and re-sync from live state
 *   $vault.refresh()
 */

import type { VaultEntry, DevVaultHandle, DevVaultDiff, DevModeCommitCallback, DevModeRefreshCallback, TOTPFieldValue } from './types';
import { getAllFolderPaths } from './folders';

/** Auto-deactivation timeout ID */
let devModeTimeoutId: ReturnType<typeof setTimeout> | null = null;

/** Default timeout: 15 minutes */
const DEV_MODE_TIMEOUT_MS = 15 * 60 * 1000;

/** Registered callback to push entries back into React state */
let commitCallback: DevModeCommitCallback | null = null;

/** Registered callback to read current entries from React state */
let refreshCallback: DevModeRefreshCallback | null = null;

/** Snapshot of entries at the time of activation (for diff) */
let originalSnapshot: VaultEntry[] = [];

/**
 * Register the callbacks that connect DevMode to React state.
 * Called by the DevModeToggle component.
 */
export function registerDevModeCallbacks(onCommit: DevModeCommitCallback, onRefresh: DevModeRefreshCallback): void {
  commitCallback = onCommit;
  refreshCallback = onRefresh;
}

/**
 * Unregister callbacks (called on deactivation / unmount).
 */
export function unregisterDevModeCallbacks(): void {
  commitCallback = null;
  refreshCallback = null;
}

/**
 * Validate that an entry has the required shape. Fills in defaults
 * for missing optional fields.
 */
function normalizeEntry(partial: Partial<VaultEntry>): VaultEntry {
  const now = new Date().toISOString();
  return {
    id: partial.id || crypto.randomUUID(),
    kind: 'password',
    name: partial.name || 'Unnamed Entry',
    folders: Array.isArray(partial.folders) ? partial.folders : [''],
    fields: Array.isArray(partial.fields) ? partial.fields : [],
    values: partial.values && typeof partial.values === 'object' ? partial.values : {},
    createdAt: partial.createdAt || now,
    modifiedAt: partial.modifiedAt || now,
  };
}

/**
 * Compute a diff between the original snapshot and current entries.
 */
function computeDiff(original: VaultEntry[], current: VaultEntry[]): DevVaultDiff {
  const originalIds = new Map(original.map((e) => [e.id, e]));
  const currentIds = new Map(current.map((e) => [e.id, e]));

  const addedEntries: string[] = [];
  const removedEntries: string[] = [];
  const modifiedEntries: string[] = [];
  let unchanged = 0;

  // Find added and modified
  for (const [id, entry] of currentIds) {
    const orig = originalIds.get(id);
    if (!orig) {
      addedEntries.push(entry.name || id);
    } else if (JSON.stringify(orig) !== JSON.stringify(entry)) {
      modifiedEntries.push(entry.name || id);
    } else {
      unchanged++;
    }
  }

  // Find removed
  for (const [id, entry] of originalIds) {
    if (!currentIds.has(id)) {
      removedEntries.push(entry.name || id);
    }
  }

  return {
    added: addedEntries.length,
    removed: removedEntries.length,
    modified: modifiedEntries.length,
    unchanged,
    total: current.length,
    details: { addedEntries, removedEntries, modifiedEntries },
  };
}

/**
 * Activate Developer Mode — attach `window.$vault` with a deep clone
 * of the current entries and helper methods.
 */
export function activateDevMode(entries: VaultEntry[], vaultVersion: number): void {
  // Deep clone to prevent accidental direct mutations of React state
  const snapshot: VaultEntry[] = JSON.parse(JSON.stringify(entries));
  originalSnapshot = JSON.parse(JSON.stringify(entries));

  const handle: DevVaultHandle = {
    entries: snapshot,
    snapshotAt: new Date().toISOString(),
    version: vaultVersion,
    dirty: false,

    // ── Commit / Write-back ──

    commit() {
      if (!commitCallback) {
        console.error('%c[Dev Mode] Cannot commit — no callback registered. Is Developer Mode still active?', 'color: #ef4444; font-weight: bold;');
        return 0;
      }

      // Validate all entries
      const validated = this.entries.map((e) => normalizeEntry(e));

      // Check for duplicate IDs
      const ids = new Set<string>();
      for (const entry of validated) {
        if (ids.has(entry.id)) {
          console.error(`%c[Dev Mode] Duplicate entry ID found: ${entry.id}. Aborting commit.`, 'color: #ef4444; font-weight: bold;');
          return 0;
        }
        ids.add(entry.id);
      }

      // Deep clone into React state
      const toCommit: VaultEntry[] = JSON.parse(JSON.stringify(validated));

      const diff = computeDiff(originalSnapshot, toCommit);

      commitCallback(toCommit);

      // Update our references
      this.entries = JSON.parse(JSON.stringify(toCommit));
      originalSnapshot = JSON.parse(JSON.stringify(toCommit));
      this.dirty = false;
      this.snapshotAt = new Date().toISOString();

      console.log('%c[Dev Mode] ✅ Committed %d entries to vault state.', 'color: #22c55e; font-weight: bold;', toCommit.length);
      console.log('%c  Added: %d | Modified: %d | Removed: %d | Unchanged: %d', 'color: #94a3b8;', diff.added, diff.modified, diff.removed, diff.unchanged);
      if (diff.details.addedEntries.length > 0) {
        console.log(`%c  + ${diff.details.addedEntries.join(', ')}`, 'color: #22c55e;');
      }
      if (diff.details.modifiedEntries.length > 0) {
        console.log(`%c  ~ ${diff.details.modifiedEntries.join(', ')}`, 'color: #f59e0b;');
      }
      if (diff.details.removedEntries.length > 0) {
        console.log(`%c  - ${diff.details.removedEntries.join(', ')}`, 'color: #ef4444;');
      }
      console.log('%c  Remember to click Save in the UI to persist to server.', 'color: #94a3b8; font-style: italic;');

      return toCommit.length;
    },

    preview() {
      const diff = computeDiff(originalSnapshot, this.entries);
      console.log('%c[Dev Mode] Preview — changes since last commit/activation:', 'color: #3b82f6; font-weight: bold;');
      console.log(
        '%c  Added: %d | Modified: %d | Removed: %d | Unchanged: %d | Total: %d',
        'color: #94a3b8;',
        diff.added,
        diff.modified,
        diff.removed,
        diff.unchanged,
        diff.total,
      );
      if (diff.details.addedEntries.length > 0) {
        console.log(`%c  + ${diff.details.addedEntries.join(', ')}`, 'color: #22c55e;');
      }
      if (diff.details.modifiedEntries.length > 0) {
        console.log(`%c  ~ ${diff.details.modifiedEntries.join(', ')}`, 'color: #f59e0b;');
      }
      if (diff.details.removedEntries.length > 0) {
        console.log(`%c  - ${diff.details.removedEntries.join(', ')}`, 'color: #ef4444;');
      }
      return diff;
    },

    update(predicate, mutator) {
      const matched: VaultEntry[] = [];
      for (const entry of this.entries) {
        if (predicate(entry)) {
          matched.push(entry);
          mutator(entry);
          entry.modifiedAt = new Date().toISOString();
        }
      }

      if (matched.length === 0) {
        console.log('%c[Dev Mode] No entries matched the predicate.', 'color: #f59e0b;');
        return { matched: 0, committed: 0 };
      }

      console.log('%c[Dev Mode] Mutated %d entries. Committing...', 'color: #3b82f6;', matched.length);

      this.dirty = true;
      const committed = this.commit();
      return { matched: matched.length, committed };
    },

    add(newEntries) {
      const normalized = newEntries.map((e) => normalizeEntry(e));
      this.entries.push(...normalized);
      this.dirty = true;

      console.log('%c[Dev Mode] Added %d entries. Committing...', 'color: #22c55e;', normalized.length);

      this.commit();
      return { added: normalized.length };
    },

    remove(predicate) {
      const before = this.entries.length;
      const removed = this.entries.filter(predicate);
      this.entries = this.entries.filter((e) => !predicate(e));
      const removedCount = before - this.entries.length;

      if (removedCount === 0) {
        console.log('%c[Dev Mode] No entries matched the predicate for removal.', 'color: #f59e0b;');
        return { removed: 0 };
      }

      console.log('%c[Dev Mode] Removing %d entries: %s', 'color: #ef4444;', removedCount, removed.map((e) => e.name).join(', '));

      this.dirty = true;
      this.commit();
      return { removed: removedCount };
    },

    refresh() {
      if (!refreshCallback) {
        console.error('%c[Dev Mode] Cannot refresh — no callback registered.', 'color: #ef4444; font-weight: bold;');
        return 0;
      }

      const liveEntries = refreshCallback();
      this.entries = JSON.parse(JSON.stringify(liveEntries));
      originalSnapshot = JSON.parse(JSON.stringify(liveEntries));
      this.dirty = false;
      this.snapshotAt = new Date().toISOString();

      console.log('%c[Dev Mode] 🔄 Refreshed snapshot from live state. %d entries.', 'color: #3b82f6; font-weight: bold;', this.entries.length);

      return this.entries.length;
    },

    // ── Read-only Helpers ──

    findDuplicatePasswords() {
      const passwordMap = new Map<string, string[]>();

      for (const entry of this.entries) {
        for (const field of entry.fields) {
          if (field.hidden && field.type !== 'totp') {
            const value = entry.values[field.id];
            if (value && value.trim()) {
              const existing = passwordMap.get(value) || [];
              existing.push(`${entry.name} → ${field.name}`);
              passwordMap.set(value, existing);
            }
          }
        }
      }

      const result: Record<string, { password: string; entries: string[] }> = {};
      let idx = 0;
      for (const [password, entryNames] of passwordMap) {
        if (entryNames.length > 1) {
          result[`group_${idx++}`] = { password, entries: entryNames };
        }
      }
      return result;
    },

    findEmptyPasswords() {
      const results: { id: string; name: string; fieldName: string }[] = [];
      for (const entry of this.entries) {
        for (const field of entry.fields) {
          if (field.hidden && field.type !== 'totp') {
            const value = entry.values[field.id];
            if (!value || !value.trim()) {
              results.push({ id: entry.id, name: entry.name, fieldName: field.name });
            }
          }
        }
      }
      return results;
    },

    findWeakPasswords(minLength = 12) {
      const results: { id: string; name: string; fieldName: string; length: number }[] = [];
      for (const entry of this.entries) {
        for (const field of entry.fields) {
          if (field.hidden && field.type !== 'totp') {
            const value = entry.values[field.id];
            if (value && value.length < minLength) {
              results.push({ id: entry.id, name: entry.name, fieldName: field.name, length: value.length });
            }
          }
        }
      }
      return results;
    },

    listTOTP() {
      const results: { id: string; name: string; issuer: string }[] = [];
      for (const entry of this.entries) {
        for (const field of entry.fields) {
          if (field.type === 'totp') {
            let issuer = entry.name;
            try {
              const parsed: TOTPFieldValue = JSON.parse(entry.values[field.id]);
              if (parsed.secret) issuer = entry.name;
            } catch {
              /* ignore */
            }
            results.push({ id: entry.id, name: entry.name, issuer });
          }
        }
      }
      return results;
    },

    search(pattern: string | RegExp) {
      const regex = typeof pattern === 'string' ? new RegExp(pattern, 'i') : pattern;
      return this.entries.filter((entry) => {
        if (regex.test(entry.name)) return true;
        for (const folder of entry.folders) {
          if (regex.test(folder)) return true;
        }
        for (const field of entry.fields) {
          if (field.type !== 'totp') {
            const val = entry.values[field.id] || '';
            if (regex.test(val)) return true;
          }
        }
        return false;
      });
    },

    summary() {
      const allFolders = getAllFolderPaths(this.entries);
      let totalFields = 0;
      let totpCount = 0;
      for (const entry of this.entries) {
        totalFields += entry.fields.length;
        for (const field of entry.fields) {
          if (field.type === 'totp') totpCount++;
        }
      }
      return {
        totalEntries: this.entries.length,
        totalFolders: allFolders.length,
        totalFields,
        totpCount,
      };
    },
  };

  window.$vault = handle;

  // Clear any existing timeout
  if (devModeTimeoutId !== null) {
    clearTimeout(devModeTimeoutId);
  }

  // Auto-deactivate after timeout
  devModeTimeoutId = setTimeout(() => {
    deactivateDevMode();
    console.log('%c[Dev Mode] Auto-deactivated after timeout.', 'color: #f59e0b; font-weight: bold;');
  }, DEV_MODE_TIMEOUT_MS);

  // Log helpful banner to console
  console.log('%c🔧 Developer Mode Activated', 'color: #22c55e; font-size: 14px; font-weight: bold;');
  console.log(
    '%cwindow.$vault is now available. Snapshot taken at %s with %d entries.\n\n' +
      'Read-only queries:\n' +
      '  $vault.findDuplicatePasswords()    — entries sharing the same password\n' +
      '  $vault.findEmptyPasswords()        — entries with empty password fields\n' +
      '  $vault.findWeakPasswords(16)       — passwords shorter than 16 chars\n' +
      '  $vault.listTOTP()                  — all TOTP entries\n' +
      '  $vault.search(/github/i)           — search by regex\n' +
      '  $vault.summary()                   — vault statistics\n' +
      '  $vault.entries                     — raw entry array (mutable)\n\n' +
      'Mutations:\n' +
      '  $vault.update(predicate, mutator)  — filter + mutate + auto-commit\n' +
      '  $vault.add([{name, folders}])      — add entries + auto-commit\n' +
      '  $vault.remove(predicate)           — remove entries + auto-commit\n' +
      '  $vault.commit()                    — push manual changes to vault\n' +
      '  $vault.preview()                   — diff without committing\n' +
      '  $vault.refresh()                   — discard edits, re-sync from live\n\n' +
      'After commit(), click Save in the UI to persist to server.\n' +
      'Auto-deactivates in 15 minutes.',
    'color: #94a3b8;',
    handle.snapshotAt,
    handle.entries.length,
  );
}

/**
 * Refresh the Developer Mode snapshot with updated entries.
 * Only refreshes if Dev Mode is currently active.
 */
export function refreshDevMode(entries: VaultEntry[], vaultVersion: number): void {
  if (!window.$vault) return;
  // Only refresh if not dirty (user hasn't made uncommitted local changes)
  if (window.$vault.dirty) {
    console.log(
      '%c[Dev Mode] Snapshot has uncommitted changes — skipping auto-refresh. Call $vault.refresh() to discard changes and re-sync.',
      'color: #f59e0b;',
    );
    return;
  }
  activateDevMode(entries, vaultVersion);
}

/**
 * Deactivate Developer Mode — remove `window.$vault` and null the reference.
 */
export function deactivateDevMode(): void {
  if (devModeTimeoutId !== null) {
    clearTimeout(devModeTimeoutId);
    devModeTimeoutId = null;
  }

  unregisterDevModeCallbacks();
  originalSnapshot = [];

  if (window.$vault) {
    window.$vault.entries = [];
    delete window.$vault;

    console.log('%c🔒 Developer Mode Deactivated', 'color: #ef4444; font-size: 14px; font-weight: bold;');
    console.log('%cwindow.$vault has been removed.', 'color: #94a3b8;');
  }
}

/**
 * Check if Developer Mode is currently active.
 */
export function isDevModeActive(): boolean {
  return window.$vault !== undefined;
}
