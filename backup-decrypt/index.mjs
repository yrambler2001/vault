import fs from 'node:fs/promises';
import readline from 'node:readline/promises';
import { webcrypto } from 'node:crypto';
import { gunzipSync } from 'node:zlib';
import { argon2id } from 'hash-wasm';

const ALG = { name: 'AES-GCM', length: 256 };

const fromBase64 = (b64) => Buffer.from(b64, 'base64');

async function main() {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  try {
    const filePath = await rl.question('Enter the path to your vault JSON backup: ');

    let fileContent;
    try {
      fileContent = await fs.readFile(filePath.trim(), 'utf8');
    } catch (err) {
      console.error(`\n❌ Could not read file at ${filePath}`);
      process.exit(1);
    }

    const vault = JSON.parse(fileContent);
    const password = await rl.question('Enter your Master Password: ');

    console.log('\nDecrypting... (Deriving keys via Argon2id)');

    // 1. Derive the Key Encryption Key (KEK) using Argon2id
    const kekBytes = await argon2id({
      password,
      salt: fromBase64(vault.meta.passwordSalt),
      parallelism: vault.meta.kdfParams.parallelism,
      iterations: vault.meta.kdfParams.iterations,
      memorySize: vault.meta.kdfParams.memorySize,
      hashLength: vault.meta.kdfParams.hashLength,
      outputType: 'binary',
    });

    const kek = await webcrypto.subtle.importKey('raw', kekBytes, ALG, false, ['decrypt']);

    // 2. Unwrap the Data Encryption Key (DEK)
    const masterKeyNode = vault.keys.master_password;
    if (!masterKeyNode) {
      throw new Error('No master_password key slot found in this vault file.');
    }

    let rawDEK;
    try {
      rawDEK = await webcrypto.subtle.decrypt({ name: 'AES-GCM', iv: fromBase64(masterKeyNode.iv) }, kek, fromBase64(masterKeyNode.wrappedDEK));
    } catch (err) {
      throw new Error('Incorrect master password (failed to unwrap DEK).');
    }

    const dek = await webcrypto.subtle.importKey('raw', rawDEK, ALG, false, ['decrypt']);

    // 3. Decrypt the actual Vault Data
    let decryptedBuffer;
    try {
      decryptedBuffer = await webcrypto.subtle.decrypt({ name: 'AES-GCM', iv: fromBase64(vault.data.iv) }, dek, fromBase64(vault.data.ciphertext));
    } catch (err) {
      throw new Error('Vault data corruption (failed to decrypt payload).');
    }

    // 4. Decompress the payload
    let decompressedBuffer;
    try {
      decompressedBuffer = gunzipSync(decryptedBuffer);
    } catch (err) {
      throw new Error('Failed to decompress.');
    }

    // 5. Parse and output
    const decryptedString = new TextDecoder().decode(decompressedBuffer);
    const payload = JSON.parse(decryptedString);

    const outPath = `decrypted_vault_${Date.now()}.json`;
    await fs.writeFile(outPath, JSON.stringify(payload, null, 2), 'utf8');

    console.log(`\n✅ Success! Decrypted & decompressed vault saved to: ${outPath}`);
    console.log(`Found ${payload.entries?.length || 0} entries.`);
  } catch (error) {
    console.error(`\n❌ Error: ${error.message}`);
  } finally {
    rl.close();
  }
}

main();
