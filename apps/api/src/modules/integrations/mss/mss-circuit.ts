import { Logger } from '@nestjs/common';
import type { Queue } from 'bullmq';
import { withQueueTimeout } from '../../../jobs/queue-timeout';

/** 10 lỗi liên tiếp (quá hạn chờ, lỗi mạng, 5xx) thì ngắt. */
export const MSS_CIRCUIT_THRESHOLD = 10;
/** Ngắt 5 phút, hết hạn thì cho đúng một lần dò bằng `GET /health`. */
export const MSS_CIRCUIT_OPEN_MS = 5 * 60_000;
/** Mỗi tiến trình đọc lại trạng thái ngắt chung tối đa một lần mỗi chu kỳ này. */
const SHARED_REFRESH_MS = 5_000;
const SHARED_TIMEOUT_MS = 1_000;

export const MSS_CIRCUIT_KEY = 'tubu:mss:circuit:open_until';

/** Kho khoá–giá trị dùng chung giữa các replica (Redis). Lỗi hay quá hạn của kho không được chặn đường gọi MSS. */
export interface MssSharedStore {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, ttlMs: number): Promise<void>;
  /** true khi khoá chưa có và vừa được đặt. */
  setIfAbsent(key: string, value: string, ttlMs: number): Promise<boolean>;
  del(key: string): Promise<void>;
}

export const MSS_SHARED_STORE = Symbol('MSS_SHARED_STORE');

/** Phần ioredis mà kho cần; client của BullMQ chuyển tiếp lệnh sang ioredis nhưng không khai báo đủ kiểu. */
interface RedisLike {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, px: 'PX', ttlMs: number, nx?: 'NX'): Promise<'OK' | null>;
  del(key: string): Promise<number>;
}

/**
 * Kho chung trên kết nối Redis sẵn có của BullMQ (không mở kết nối mới). Mỗi lệnh có hạn chờ ngắn: Redis mất kết nối thì
 * ioredis giữ lệnh trong hàng đợi offline vô hạn (xem jobs/queue-timeout.ts), MSS phải rơi về trạng thái trong bộ nhớ.
 */
export class BullRedisSharedStore implements MssSharedStore {
  constructor(private readonly queue: Pick<Queue, 'client'>) {}

  private run<T>(label: string, fn: (c: RedisLike) => Promise<T>): Promise<T> {
    return withQueueTimeout(
      this.queue.client.then((c) => fn(c as unknown as RedisLike)),
      `mss:${label}`,
      SHARED_TIMEOUT_MS,
    );
  }

  get(key: string): Promise<string | null> {
    return this.run('get', (c) => c.get(key));
  }

  async set(key: string, value: string, ttlMs: number): Promise<void> {
    await this.run('set', (c) => c.set(key, value, 'PX', Math.max(1, Math.round(ttlMs))));
  }

  async setIfAbsent(key: string, value: string, ttlMs: number): Promise<boolean> {
    return (await this.run('setnx', (c) => c.set(key, value, 'PX', Math.max(1, Math.round(ttlMs)), 'NX'))) === 'OK';
  }

  async del(key: string): Promise<void> {
    await this.run('del', (c) => c.del(key));
  }
}

export type MssCircuitState = 'closed' | 'open' | 'half_open';
export type MssCircuitAdmission = 'allow' | 'probe' | 'reject';

export interface MssCircuitSnapshot {
  state: MssCircuitState;
  consecutiveFailures: number;
  openUntil: string | null;
  lastFailureAt: string | null;
  lastFailureKind: string | null;
  /** Trạng thái kho chung lần gần nhất: `none` khi chạy không có Redis (test, công cụ). */
  sharedStore: 'ok' | 'unavailable' | 'none';
}

export interface MssCircuitOptions {
  threshold?: number;
  openMs?: number;
  now?: () => number;
}

/**
 * Cầu dao của lời gọi Tubu → MSS: trong bộ nhớ từng tiến trình, mốc ngắt chép sang Redis để replica khác cũng ngắt theo.
 * Đang ngắt thì lời gọi lỗi ngay (`circuit_open`, người gọi để outbox thử lại sau); hết hạn ngắt thì đúng một lời gọi được dò
 * bằng `GET /health` (MssClient), dò tốt thì đóng, dò hỏng thì ngắt thêm một chu kỳ.
 */
export class MssCircuitBreaker {
  private readonly logger = new Logger(MssCircuitBreaker.name);
  private failures = 0;
  private openUntil = 0;
  private probing = false;
  private lastFailureAt = 0;
  private lastFailureKind: string | null = null;
  private sharedCheckedAt = 0;
  private sharedState: MssCircuitSnapshot['sharedStore'];
  private readonly threshold: number;
  private readonly openMs: number;
  private readonly now: () => number;

  constructor(
    private readonly store?: MssSharedStore,
    opts: MssCircuitOptions = {},
  ) {
    this.threshold = opts.threshold ?? MSS_CIRCUIT_THRESHOLD;
    this.openMs = opts.openMs ?? MSS_CIRCUIT_OPEN_MS;
    this.now = opts.now ?? (() => Date.now());
    this.sharedState = store ? 'ok' : 'none';
  }

  /** `probe`: lời gọi này phải dò `/health` trước; người gọi PHẢI kết thúc bằng recordSuccess hoặc recordFailure. */
  async admit(): Promise<MssCircuitAdmission> {
    await this.adoptShared();
    if (this.openUntil === 0) return 'allow';
    if (this.now() < this.openUntil || this.probing) return 'reject';
    this.probing = true;
    return 'probe';
  }

  recordSuccess(): void {
    const wasOpen = this.openUntil !== 0;
    this.failures = 0;
    this.openUntil = 0;
    this.probing = false;
    if (wasOpen) {
      this.logger.log('Cầu dao MSS đóng lại: MSS trả lời tốt.');
      this.writeShared((s) => s.del(MSS_CIRCUIT_KEY));
    }
  }

  recordFailure(kind: string): void {
    this.failures += 1;
    this.lastFailureAt = this.now();
    this.lastFailureKind = kind;
    const reopen = this.probing || this.failures >= this.threshold;
    this.probing = false;
    if (!reopen) return;
    const until = this.now() + this.openMs;
    if (this.openUntil === 0) this.logger.warn(`Cầu dao MSS ngắt ${Math.round(this.openMs / 60_000)} phút sau ${this.failures} lỗi liên tiếp (gần nhất: ${kind}).`);
    this.openUntil = until;
    this.writeShared((s) => s.set(MSS_CIRCUIT_KEY, String(until), this.openMs));
  }

  snapshot(): MssCircuitSnapshot {
    const now = this.now();
    const state: MssCircuitState = this.openUntil === 0 ? 'closed' : now < this.openUntil && !this.probing ? 'open' : 'half_open';
    return {
      state,
      consecutiveFailures: this.failures,
      openUntil: this.openUntil ? new Date(this.openUntil).toISOString() : null,
      lastFailureAt: this.lastFailureAt ? new Date(this.lastFailureAt).toISOString() : null,
      lastFailureKind: this.lastFailureKind,
      sharedStore: this.sharedState,
    };
  }

  /** Replica khác vừa ngắt: nhận mốc ngắt của nó. Chỉ đọc khi đang đóng, tối đa một lần mỗi SHARED_REFRESH_MS. */
  private async adoptShared(): Promise<void> {
    if (!this.store || this.openUntil !== 0) return;
    const now = this.now();
    if (now - this.sharedCheckedAt < SHARED_REFRESH_MS) return;
    this.sharedCheckedAt = now;
    try {
      const until = Number(await this.store.get(MSS_CIRCUIT_KEY));
      this.sharedState = 'ok';
      if (Number.isFinite(until) && until > now) {
        this.openUntil = until;
        this.logger.warn('Cầu dao MSS ngắt theo trạng thái chung (replica khác đã ngắt).');
      }
    } catch {
      this.sharedState = 'unavailable';
    }
  }

  private writeShared(op: (s: MssSharedStore) => Promise<void>): void {
    if (!this.store) return;
    op(this.store).then(
      () => {
        this.sharedState = 'ok';
      },
      () => {
        this.sharedState = 'unavailable';
      },
    );
  }
}
