export interface WrappedKey {
  iv: string;
  wrappedDEK: string;
}

export interface EncryptedData {
  iv: string;
  ciphertext: string;
}

export interface KdfParams {
  algorithm: 'argon2id';
  parallelism: number;
  iterations: number;
  memorySize: number;
  hashLength: number;
}

export interface VaultMeta {
  vaultId: string;
  passwordSalt: string;
  kdfParams: KdfParams;
  version: number;
  createdAt: string;
  updatedAt: string;
}

export interface VaultDocument {
  meta: VaultMeta;
  keys: Record<string, WrappedKey>;
  data: EncryptedData;
}
