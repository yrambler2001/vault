import writeFileAtomic from 'write-file-atomic';
import fs from 'fs/promises';
import crypto from 'crypto';

/**
 * Atomic write with post-write verification.
 *
 * Uses write-file-atomic (temp file + rename) then reads back and
 * verifies the content hash to detect silent corruption — especially
 * important on USB drives with FAT32/exFAT filesystems where rename
 * atomicity is not guaranteed.
 *
 * If verification fails, throws an error rather than leaving corrupt data.
 */
export const atomicWrite = async (filePath: string, data: unknown): Promise<void> => {
  const content = typeof data === 'string' ? data : JSON.stringify(data, null, 2);
  const expectedHash = crypto.createHash('sha256').update(content).digest('hex');

  await writeFileAtomic(filePath, content, 'utf8');

  // Read back and verify
  const written = await fs.readFile(filePath, 'utf8');
  const actualHash = crypto.createHash('sha256').update(written).digest('hex');

  if (actualHash !== expectedHash) {
    throw new Error(`Write verification failed for ${filePath}: ` + `expected hash ${expectedHash}, got ${actualHash}. ` + `The file may be corrupted.`);
  }
};
