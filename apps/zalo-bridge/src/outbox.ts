import { mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { writeFileAtomic } from './fs-atomic';
import type { ZaloBridgeEvent } from './types';

export type PostResult = 'ok' | 'retry' | 'drop';

interface Entry {
  event: ZaloBridgeEvent;
  at: number;
  attempts: number;
  nextAt: number;
}

const BASE_BACKOFF_MS = 5_000;
const MAX_BACKOFF_MS = 600_000;
const MAX_AGE_MS = 24 * 3_600_000;
const POLL_MS = 1_000;

// Ghi đĩa trước khi gửi để cầu nối khởi động lại không làm mất tin của khách/nhân viên;
// API chống trùng theo zaloMsgId nên gửi lại là an toàn.
export class Outbox {
  private readonly path: string;
  private entries: Entry[] = [];
  private timer: NodeJS.Timeout | null = null;
  private flushing = false;
  private writeChain: Promise<void> = Promise.resolve();

  constructor(
    dir: string,
    private readonly post: (e: ZaloBridgeEvent) => Promise<PostResult>,
    private readonly now: () => number,
    private readonly write: (path: string, data: string) => Promise<void> = writeFileAtomic,
  ) {
    mkdirSync(dir, { recursive: true });
    this.path = join(dir, 'outbox.jsonl');
    this.entries = this.readFile();
  }

  size(): number {
    return this.entries.length;
  }

  async push(event: ZaloBridgeEvent): Promise<void> {
    const t = this.now();
    this.entries.push({ event, at: t, attempts: 0, nextAt: t });
    await this.persist();
    if (this.timer) void this.flushOnce();
  }

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => void this.flushOnce(), POLL_MS);
    void this.flushOnce();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  async flushOnce(): Promise<void> {
    if (this.flushing) return;
    this.flushing = true;
    try {
      let changed = false;
      for (const entry of [...this.entries]) {
        const t = this.now();
        if (t - entry.at > MAX_AGE_MS) {
          this.remove(entry);
          changed = true;
          continue;
        }
        if (entry.nextAt > t) continue;
        let result: PostResult;
        try {
          result = await this.post(entry.event);
        } catch {
          result = 'retry';
        }
        if (result === 'retry') {
          entry.attempts++;
          entry.nextAt = this.now() + Math.min(BASE_BACKOFF_MS * 2 ** (entry.attempts - 1), MAX_BACKOFF_MS);
        } else {
          this.remove(entry);
        }
        changed = true;
      }
      if (changed) await this.persist().catch(() => this.logPersistFailure());
    } finally {
      this.flushing = false;
    }
  }

  private remove(entry: Entry): void {
    this.entries = this.entries.filter((e) => e !== entry);
  }

  private persist(): Promise<void> {
    // Chuỗi phải tự hồi phục sau một lần ghi lỗi, nếu không mọi lần ghi sau đều bị bỏ qua.
    const p = this.writeChain.then(() => {
      const body = this.entries.map((e) => JSON.stringify({ at: e.at, event: e.event })).join('\n');
      return this.write(this.path, body ? `${body}\n` : '');
    });
    this.writeChain = p.catch(() => undefined);
    return p;
  }

  // Không log nội dung tin, chỉ số lượng.
  private logPersistFailure(): void {
    console.error(`[outbox] ghi outbox.jsonl lỗi, còn ${this.entries.length} sự kiện trong bộ nhớ`);
  }

  private readFile(): Entry[] {
    let raw: string;
    try {
      raw = readFileSync(this.path, 'utf8');
    } catch {
      return [];
    }
    const t = this.now();
    const out: Entry[] = [];
    for (const line of raw.split('\n')) {
      if (!line.trim()) continue;
      try {
        const parsed = JSON.parse(line) as { at: number; event: ZaloBridgeEvent };
        if (typeof parsed.at === 'number' && parsed.event) {
          out.push({ event: parsed.event, at: parsed.at, attempts: 0, nextAt: t });
        }
      } catch {
        // dòng hỏng (ghi dở khi tắt máy) thì bỏ, giữ phần còn lại
      }
    }
    return out;
  }
}
