const DAY_MS = 24 * 3_600_000;

// Bộ nhớ trong: cầu nối khởi động lại thì hàng đợi gửi cũng mất, nên không cần lưu đĩa.
export class SendDedupe {
  private readonly entries = new Map<string, { msgId: string; expiresAt: number }>();

  constructor(
    private readonly ttlMs = DAY_MS,
    private readonly max = 5000,
    private readonly now: () => number = Date.now,
  ) {}

  get(key: string): string | undefined {
    const e = this.entries.get(key);
    if (!e) return undefined;
    if (e.expiresAt <= this.now()) {
      this.entries.delete(key);
      return undefined;
    }
    return e.msgId;
  }

  set(key: string, msgId: string): void {
    this.entries.delete(key);
    this.entries.set(key, { msgId, expiresAt: this.now() + this.ttlMs });
    while (this.entries.size > this.max) {
      const oldest = this.entries.keys().next().value;
      if (oldest === undefined) break;
      this.entries.delete(oldest);
    }
  }
}
