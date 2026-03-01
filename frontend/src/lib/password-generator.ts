/**
 * Password generator with configurable character sets.
 */
export interface GeneratorOptions {
  length: number;
  uppercase: boolean;
  lowercase: boolean;
  digits: boolean;
  special: boolean;
}

export const DEFAULT_GENERATOR_OPTIONS: GeneratorOptions = {
  length: 32,
  uppercase: true,
  lowercase: true,
  digits: true,
  special: true,
};

export function generatePassword(options: GeneratorOptions): string {
  const { length, uppercase, lowercase, digits, special } = options;

  let chars = '';
  if (lowercase) chars += 'abcdefghijklmnopqrstuvwxyz';
  if (uppercase) chars += 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  if (digits) chars += '0123456789';
  if (special) chars += '#$&!@%^*()-_=+[]{}|;:,.<>?';

  if (!chars) chars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';

  // Calculate the maximum unbiased value for rejection sampling.
  // We use a Uint8Array where the max value is 255 (256 total values).
  const charLength = chars.length;
  const maxValid = 256 - (256 % charLength);

  let password = '';
  // Allocate a buffer slightly larger than the requested length
  // to minimize the chance of needing a second crypto.getRandomValues call.

  const randomBytes = new Uint8Array(length + Math.ceil(length * 0.25));

  while (password.length < length) {
    crypto.getRandomValues(randomBytes);
    for (let i = 0; i < randomBytes.length && password.length < length; i++) {
      // Rejection sampling: only use the byte if it falls in the unbiased range
      if (randomBytes[i] < maxValid) {
        password += chars[randomBytes[i] % charLength];
      }
    }
  }

  return password;
}
