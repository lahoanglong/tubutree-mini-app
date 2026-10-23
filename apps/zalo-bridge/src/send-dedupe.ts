import { readFileSync } from 'node:fs';
import { writeFileAtomic } from './fs-atomic';

const DAY_MS = 24 * 3_600_000;

// Lưu đĩa để gửi lại cùng khoá sau khi cầu nối khởi động lại vẫn trả msgId cũ, không gửi lên nhóm lần hai.
export class SendDedupe {
  private readonly entries = new Map<string, { msgId: string; expiresAt: number }>();
  private writeChain: Promise<void> = Promise.resolve();

  constructor(
    private readonly ttlMs = DAY_MS,
    private readonly max = 5000,
    private readonly now: () => number = Date.now,
    private readonly path?: string,
  ) {
    if (path) this.load(path);
  }

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

  persist(): Promise<void> {
    const path = this.path;
    if (!path) return Promise.resolve();
    const p = this.writeChain.then(() => writeFileAtomic(path, JSON.stringify([...this.entries])));
    this.writeChain = p.catch(() => undefined);
    return p;
  }

  private load(path: string): void {
    try {
      const parsed = JSON.parse(readFileSync(path, 'utf8')) as [string, { msgId: string; expiresAt: number }][];
      const t = this.now();
      for (const [k, v] of parsed) {
        if (typeof v?.msgId === 'string' && typeof v.expiresAt === 'number' && v.expiresAt > t) this.entries.set(k, v);
      }
    } catch {
      // thiếu hoặc hỏng thì bắt đầu rỗng
    }
  }
}
