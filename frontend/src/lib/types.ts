/**
 * Shared types for the vault application.
 */

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
  /** Folder path, e.g. "Work/AWS" or "" for root */
  folder: string;
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
