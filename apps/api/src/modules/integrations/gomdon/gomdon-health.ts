import { Logger } from '@nestjs/common';

/**
 * Tình trạng kết nối Gomdon: lần gọi gần nhất thành công hay lỗi, và Gomdon có đang từ chối TÀI KHOẢN (sai SĐT/mật khẩu, bị
 * khoá) không.
 *
 * Lần đăng nhập được / bị từ chối ghi vào bản ghi CHUNG (GomdonHealthStore — ops_health_states) để mọi replica sau load balancer
 * cùng một câu trả lời: trước đây cờ nằm trong bộ nhớ từng process, replica không phải leader (không chạy cron dò lại) cứ ẩn
 * lựa chọn thu gom sau khi Gomdon đã ổn, và "Kiểm tra kết nối" chỉ chữa đúng replica nhận request (R4-SYNC-4). Bộ nhớ trong
 * process vẫn giữ để replica phản ứng ngay với lần gọi của chính nó và để chạy được khi DB chập.
 *
 * Là một đối tượng module (không phải provider) vì isGomdonRecyclingEnabled — dùng ở checkout VÀ /config/public, nơi không
 * inject được GomdonClient — cũng phải đọc nó; GomdonClient gắn bản ghi chung lúc khởi tạo.
 */
export interface GomdonHealthSnapshot {
  lastOkAt: string | null;
  lastErrorAt: string | null;
  lastError: string | null;
  credentialsRejected: boolean;
  credentialsRejectedAt: string | null;
}

/** Bản ghi chung: mốc đăng nhập được và mốc bị từ chối gần nhất của MỌI replica. Bị từ chối = mốc từ chối sau mốc được. */
export interface GomdonLoginRecord {
  okAt: Date | null;
  rejectedAt: Date | null;
  rejectedMessage: string | null;
}

export interface GomdonHealthStore {
  load(): Promise<GomdonLoginRecord | null>;
  /** Mỗi mốc chỉ tiến (ghi muộn một mốc cũ hơn không được lùi mốc). */
  recordOk(at: Date): Promise<void>;
  recordRejected(at: Date, message: string): Promise<void>;
}

/** Mỗi replica đọc lại bản ghi chung tối đa một lần mỗi chu kỳ này. */
const SHARED_MAX_AGE_MS = 10_000;

export class GomdonHealth {
  private readonly logger = new Logger(GomdonHealth.name);
  private lastOkAt: Date | null = null;
  private lastErrorAt: Date | null = null;
  private lastError: string | null = null;
  private credentialsRejectedAt: Date | null = null;
  private store: GomdonHealthStore | null = null;
  private readonly sharedMaxAgeMs: number;
  private loadedAt: number | null = null;
  private loading: Promise<void> | null = null;

  constructor(opts: { sharedMaxAgeMs?: number } = {}) {
    this.sharedMaxAgeMs = opts.sharedMaxAgeMs ?? SHARED_MAX_AGE_MS;
  }

  attachStore(store: GomdonHealthStore): void {
    this.store = store;
    this.loadedAt = null;
  }

  async recordOk(now = new Date()): Promise<void> {
    if (!this.lastOkAt || now > this.lastOkAt) this.lastOkAt = now;
    this.credentialsRejectedAt = null;
    await this.persist((s) => s.recordOk(now));
  }

  async recordError(message: string, opts: { credentialsRejected?: boolean } = {}, now = new Date()): Promise<void> {
    this.lastErrorAt = now;
    this.lastError = message.slice(0, 500);
    if (!opts.credentialsRejected) return;
    this.credentialsRejectedAt = now;
    await this.persist((s) => s.recordRejected(now, this.lastError!));
  }

  /** Đọc bản ghi chung (tối đa một lần mỗi chu kỳ, các lời gọi đồng thời dùng chung một lần đọc). Lỗi đọc: giữ trạng thái cũ. */
  async refresh(): Promise<void> {
    if (!this.store) return;
    if (this.loadedAt !== null && Date.now() - this.loadedAt < this.sharedMaxAgeMs) return;
    this.loading ??= this.load().finally(() => {
      this.loading = null;
    });
    await this.loading;
  }

  get credentialsRejected(): boolean {
    return this.credentialsRejectedAt != null;
  }

  /** Mili-giây kể từ lần Gomdon từ chối tài khoản gần nhất; null khi không bị từ chối. */
  msSinceCredentialsRejected(now = Date.now()): number | null {
    return this.credentialsRejectedAt ? now - this.credentialsRejectedAt.getTime() : null;
  }

  snapshot(): GomdonHealthSnapshot {
    return {
      lastOkAt: this.lastOkAt?.toISOString() ?? null,
      lastErrorAt: this.lastErrorAt?.toISOString() ?? null,
      lastError: this.lastError,
      credentialsRejected: this.credentialsRejected,
      credentialsRejectedAt: this.credentialsRejectedAt?.toISOString() ?? null,
    };
  }

  reset(): void {
    this.lastOkAt = null;
    this.lastErrorAt = null;
    this.lastError = null;
    this.credentialsRejectedAt = null;
    this.store = null;
    this.loadedAt = null;
  }

  private async load(): Promise<void> {
    try {
      const rec = await this.store!.load();
      this.loadedAt = Date.now();
      if (rec) this.merge(rec);
    } catch (err) {
      this.logger.warn(`Không đọc được trạng thái đăng nhập Gomdon dùng chung: ${err instanceof Error ? err.message : err}`);
    }
  }

  private merge(rec: GomdonLoginRecord): void {
    if (rec.okAt && (!this.lastOkAt || rec.okAt > this.lastOkAt)) this.lastOkAt = rec.okAt;
    if (rec.rejectedAt && (!this.credentialsRejectedAt || rec.rejectedAt > this.credentialsRejectedAt)) {
      this.credentialsRejectedAt = rec.rejectedAt;
      if (!this.lastErrorAt || rec.rejectedAt > this.lastErrorAt) {
        this.lastErrorAt = rec.rejectedAt;
        this.lastError = rec.rejectedMessage;
      }
    }
    if (this.credentialsRejectedAt && this.lastOkAt && this.lastOkAt >= this.credentialsRejectedAt) this.credentialsRejectedAt = null;
  }

  private async persist(write: (s: GomdonHealthStore) => Promise<void>): Promise<void> {
    if (!this.store) return;
    try {
      await write(this.store);
    } catch (err) {
      this.logger.warn(`Không ghi được trạng thái đăng nhập Gomdon dùng chung: ${err instanceof Error ? err.message : err}`);
    }
  }
}

export const gomdonHealth = new GomdonHealth();
