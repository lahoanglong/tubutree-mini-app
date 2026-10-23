export interface SendQueueOptions {
  spacingMs?: number;
  jitterMs?: number;
  maxPerHour?: number;
  now: () => number;
  sleep: (ms: number) => Promise<void>;
  random: () => number;
}

const HOUR_MS = 3_600_000;

// Giãn cách và trần theo giờ để tài khoản Zalo cá nhân không bị coi là gửi tự động dồn dập.
export class SendQueue {
  private readonly spacingMs: number;
  private readonly jitterMs: number;
  private readonly maxPerHour: number;
  private readonly now: () => number;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly random: () => number;
  private tail: Promise<unknown> = Promise.resolve();
  private pending = 0;
  private lastStart: number | null = null;
  private starts: number[] = [];

  constructor(opts: SendQueueOptions) {
    this.spacingMs = opts.spacingMs ?? 1500;
    this.jitterMs = opts.jitterMs ?? 1000;
    this.maxPerHour = opts.maxPerHour ?? 300;
    this.now = opts.now;
    this.sleep = opts.sleep;
    this.random = opts.random;
  }

  enqueue<T>(fn: () => Promise<T>): Promise<T> {
    this.pending++;
    const run = this.tail.then(() => this.runOne(fn));
    this.tail = run.catch(() => undefined);
    return run.finally(() => {
      this.pending--;
    });
  }

  size(): number {
    return this.pending;
  }

  private async runOne<T>(fn: () => Promise<T>): Promise<T> {
    if (this.lastStart !== null) {
      const gap = this.spacingMs + Math.floor(this.random() * this.jitterMs);
      const wait = this.lastStart + gap - this.now();
      if (wait > 0) await this.sleep(wait);
    }
    this.starts = this.starts.filter((t) => this.now() - t < HOUR_MS);
    if (this.starts.length >= this.maxPerHour) {
      const wait = this.starts[0] + HOUR_MS - this.now();
      if (wait > 0) await this.sleep(wait);
      this.starts = this.starts.filter((t) => this.now() - t < HOUR_MS);
    }
    const start = this.now();
    this.lastStart = start;
    this.starts.push(start);
    return fn();
  }
}
