const BASE_MS = 5_000;
const MAX_MS = 300_000;

export function backoffMs(attempt: number): number {
  return Math.min(BASE_MS * 2 ** (attempt - 1), MAX_MS);
}

export class Reconnector {
  private timer: NodeJS.Timeout | null = null;
  private attempt = 0;

  constructor(private readonly run: () => void) {}

  // Trả null khi đã có lần hẹn đang chờ: `closed` và `disconnected` có thể cùng nổ cho một lần rớt.
  schedule(): number | null {
    if (this.timer) return null;
    this.attempt++;
    const delay = backoffMs(this.attempt);
    this.timer = setTimeout(() => {
      this.timer = null;
      this.run();
    }, delay);
    return delay;
  }

  cancel(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }

  reset(): void {
    this.cancel();
    this.attempt = 0;
  }
}
