import * as OTPAuth from 'otpauth';

export interface TOTPParams {
  secret: string;
  algorithm?: string;
  digits?: number;
  period?: number;
}

/**
 * Generate a TOTP code for the given parameters and time.
 */
export const generateTOTP = async (params: TOTPParams, now?: number): Promise<{ code: string; remainingSeconds: number }> => {
  const { secret, algorithm = 'SHA1', digits = 6, period = 30 } = params;

  const totp = new OTPAuth.TOTP({
    secret: OTPAuth.Secret.fromBase32(secret.replace(/[\s=-]+/g, '').toUpperCase()),
    algorithm,
    digits,
    period,
  });

  const timestamp = now ? now * 1000 : Date.now();
  const code = totp.generate({ timestamp });

  const timeSeconds = Math.floor(timestamp / 1000);
  const remainingSeconds = period - (timeSeconds % period);

  return { code, remainingSeconds };
};

// ── OTPAuth URI Parsing ──

export interface ParsedOTPAuth {
  type: 'totp' | 'hotp';
  issuer: string;
  account: string;
  secret: string;
  algorithm: string;
  digits: number;
  period: number;
}

/**
 * Parse an otpauth:// URI.
 * Format: otpauth://totp/Issuer:account?secret=XXX&issuer=YYY&algorithm=SHA1&digits=6&period=30
 */
export const parseOTPAuthURI = (uri: string): ParsedOTPAuth => {
  const parsed = OTPAuth.URI.parse(uri);

  if (!(parsed instanceof OTPAuth.TOTP)) {
    throw new Error('Only TOTP codes are supported. HOTP is not supported.');
  }

  return {
    type: 'totp',
    issuer: parsed.issuer,
    account: parsed.label,
    secret: parsed.secret.base32,
    algorithm: parsed.algorithm,
    digits: parsed.digits,
    period: parsed.period,
  };
};

/**
 * Build an otpauth:// URI from parameters.
 */
export const buildOTPAuthURI = (params: { issuer: string; account: string; secret: string; digits?: number; period?: number }): string => {
  const totp = new OTPAuth.TOTP({
    issuer: params.issuer,
    label: params.account,
    secret: OTPAuth.Secret.fromBase32(params.secret.replace(/[\s=-]+/g, '').toUpperCase()),
    algorithm: 'SHA1',
    digits: params.digits || 6,
    period: params.period || 30,
  });

  return totp.toString();
};

/**
 * Validate a base32 secret.
 */
export const isValidBase32 = (input: string): boolean => {
  const cleaned = input.replace(/[\s=-]+/g, '').toUpperCase();
  if (cleaned.length === 0) return false;
  return /^[A-Z2-7]+$/.test(cleaned);
};

/**
 * Extract QR code data from an image file.
 * Uses the BarcodeDetector API if available, otherwise throws.
 */
export const decodeQRFromImage = async (imageSource: ImageBitmapSource): Promise<string> => {
  // Check for BarcodeDetector API
  if (!('BarcodeDetector' in window)) {
    throw new Error('QR code scanning is not supported in this browser. ' + 'Please use Chrome/Edge 83+ or enter the secret manually.');
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const BarcodeDetector = (window as any).BarcodeDetector;

  const detector = new BarcodeDetector({ formats: ['qr_code'] });
  const barcodes = await detector.detect(imageSource);

  if (barcodes.length === 0) {
    throw new Error('No QR code found in the image. Please try again with a clearer image.');
  }

  return barcodes[0].rawValue;
};

/**
 * Decode QR from a video stream frame.
 */
export const decodeQRFromVideo = async (video: HTMLVideoElement): Promise<string | null> => {
  if (!('BarcodeDetector' in window)) {
    return null;
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const BarcodeDetector = (window as any).BarcodeDetector;
  const detector = new BarcodeDetector({ formats: ['qr_code'] });

  try {
    const barcodes = await detector.detect(video);
    if (barcodes.length > 0) {
      return barcodes[0].rawValue;
    }
  } catch {
    // Detection failed — frame might not be ready
  }

  return null;
};
