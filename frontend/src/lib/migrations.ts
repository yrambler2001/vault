/**
 * Frontend-only vault data migrations.
 *
 * Migrations transform the decrypted JSON payload from one schema version
 * to the next. They run "up" only (no down migrations).
 *
 * Each migration receives the full payload object and mutates it in-place,
 * then sets the new version number.
 *
 * IMPORTANT: Migrations only transform the in-memory data. The caller is
 * responsible for re-encrypting and saving (the user must click Save).
 */

import type { TOTPFieldValue, VaultPayload } from './types';

/** The latest schema version. Bump this when adding a new migration. */
export const LATEST_VERSION = 2;

export interface Migration {
  /** The version this migration produces */
  toVersion: number;
  /** Human-readable description */
  description: string;
  /** The migration function. Mutates payload in-place. */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  migrate: (payload: any) => void;
}

/**
 * Migration 1 → 2: Merge TOTP entries into password entries.
 *
 * - Entries with kind='totp' are converted to kind='password'
 * - The `totp` object is moved into a custom field with type='totp'
 * - The field value is a JSON-stringified TOTPFieldValue object
 * - The `totp` property is removed from the entry
 */
const migrateTotpToPassword: Migration = {
  toVersion: 2,
  description: 'Merge TOTP entries into password entries with TOTP custom field',
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  migrate: (payload: any) => {
    for (const entry of payload.entries) {
      if (entry.kind === 'totp') {
        entry.kind = 'password';

        entry.fields = entry.fields || [];
        entry.values = entry.values || {};

        if (entry.totp) {
          const totpFieldId = crypto.randomUUID();
          const totpFieldValue: TOTPFieldValue = {
            secret: entry.totp.secret,
            algorithm: entry.totp.algorithm || 'SHA1',
            digits: entry.totp.digits || 6,
            period: entry.totp.period || 30,
          };

          entry.fields.push({
            id: totpFieldId,
            name: 'TOTP Code',
            type: 'totp',
            searchable: false,
            hidden: true,
          });

          entry.values[totpFieldId] = JSON.stringify(totpFieldValue);
          delete entry.totp;
        }
      }
    }

    payload.version = 2;
  },
};

/** All migrations in order */
const migrations: Migration[] = [migrateTotpToPassword];

/**
 * Run all necessary migrations on a vault payload.
 *
 * @param payload The decrypted vault payload (may be mutated in-place)
 * @returns `{ migrated: boolean, payload }` — migrated is true if any migrations ran
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function runMigrations(payload: any): {
  migrated: boolean;
  payload: VaultPayload;
} {
  // Payloads without a version are version 1 (original schema)
  if (payload.version === undefined || payload.version === null) {
    payload.version = 1;
  }

  const startVersion = payload.version;

  for (const migration of migrations) {
    if (payload.version < migration.toVersion) {
      migration.migrate(payload);
    }
  }

  return {
    migrated: payload.version !== startVersion,
    payload,
  };
}
