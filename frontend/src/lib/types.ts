/**
 * Shared types for the vault application.
 */

// ── Field Definition ──

export interface FieldDefinition {
  /** Unique field ID */
  id: string;
  /** Display name / label */
  name: string;
  /** 'single' for single-line, 'multi' for multi-line */
  type: 'single' | 'multi';
  /** Whether this field is included in search */
  searchable: boolean;
  /** Whether this field is hidden with asterisks by default */
  hidden: boolean;
}

// ── Entry (Password or TOTP) ──

export interface VaultEntry {
  id: string;
  /** Entry kind: 'password' or 'totp' */
  kind: 'password' | 'totp';
  /** Display name (always present, always searchable) */
  name: string;
  /** Folder path, e.g. "Work/AWS" or "" for root */
  folder: string;
  /** Dynamic fields */
  fields: FieldDefinition[];
  /** Field values keyed by field id */
  values: Record<string, string>;
  /** TOTP-specific fields (only when kind === 'totp') */
  totp?: {
    secret: string;
    algorithm: string;
    digits: number;
    period: number;
  };
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
  entries: VaultEntry[];
}
