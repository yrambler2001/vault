/**
 * Best-effort memory clearing. NOT cryptographically guaranteed in JavaScript.
 * The JS runtime may retain copies in GC, V8 optimized code, etc.
 * This is defense-in-depth only.
 */
export const clearBuffer = (buf: Uint8Array | ArrayBuffer | null): void => {
  if (!buf) return;
  const view = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  view.fill(0);
};

export class AutoLockTimer {
  private timeoutId: ReturnType<typeof setTimeout> | null = null;
  private readonly onLock: () => void;
  private readonly timeoutMs: number;

  constructor(onLock: () => void, timeoutMs: number) {
    this.onLock = onLock;
    this.timeoutMs = timeoutMs;
  }

  reset() {
    if (this.timeoutId) clearTimeout(this.timeoutId);
    this.timeoutId = setTimeout(() => {
      this.onLock();
    }, this.timeoutMs);
  }

  stop() {
    if (this.timeoutId) {
      clearTimeout(this.timeoutId);
      this.timeoutId = null;
    }
  }
}
