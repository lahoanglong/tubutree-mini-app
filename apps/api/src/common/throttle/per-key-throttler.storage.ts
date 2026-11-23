import type { OnModuleDestroy } from '@nestjs/common';
import type { ThrottlerStorage } from '@nestjs/throttler';
import type { ThrottlerStorageRecord } from '@nestjs/throttler/dist/throttler-storage-record.interface';

interface Entry {
  hits: number;
  expiresAt: number;
  blockExpiresAt: number;
  isBlocked: boolean;
  timers: Set<NodeJS.Timeout>;
}

const entryId = (throttlerName: string, key: string) => `${throttlerName}:${key}`;
const secondsUntil = (at: number, now: number) => Math.ceil((at - now) / 1000);

/**
 * Bộ nhớ throttle trong RAM thay `ThrottlerStorageService` của @nestjs/throttler 6.5.0. Bản gốc gom hẹn giờ trừ lượt theo TÊN throttler, nên khi
 * một khoá hết bị chặn, `clearExpirationTimes` huỷ hẹn giờ của mọi khoá cùng tên: lượt của người khác không bao giờ được trừ, bộ đếm của họ
 * chỉ tăng và họ bị 429 sớm (vd trần SĐT tra đơn 15 phút). Ở đây mỗi `${tên}:${khoá}` giữ bộ đếm và hẹn giờ riêng.
 *
 * Ngữ nghĩa đếm giữ như bản gốc: mỗi lượt sống `ttl` ms rồi tự trừ, lượt vượt `limit` thì chặn `blockDuration` ms, lượt bị chặn không đếm,
 * lượt đầu sau khi hết chặn đếm lại từ 1. Khác bản gốc: khoá hết lượt, hết chặn và hết cửa sổ thì bị xoá, để bộ nhớ không phình theo số IP/SĐT
 * từng gọi.
 */
export class PerKeyThrottlerStorage implements ThrottlerStorage, OnModuleDestroy {
  private readonly entries = new Map<string, Entry>();

  async increment(key: string, ttl: number, limit: number, blockDuration: number, throttlerName: string): Promise<ThrottlerStorageRecord> {
    const id = entryId(throttlerName, key);
    const now = Date.now();
    let entry = this.entries.get(id);
    if (!entry) {
      entry = { hits: 0, expiresAt: now + ttl, blockExpiresAt: 0, isBlocked: false, timers: new Set() };
      this.entries.set(id, entry);
    }
    if (entry.expiresAt <= now) entry.expiresAt = now + ttl;
    const timeToExpire = secondsUntil(entry.expiresAt, now);

    if (!entry.isBlocked) this.countHit(id, entry, ttl);
    if (!entry.isBlocked && entry.hits > limit) {
      entry.isBlocked = true;
      entry.blockExpiresAt = now + blockDuration;
    }
    const timeToBlockExpire = secondsUntil(entry.blockExpiresAt, now);
    if (entry.isBlocked && timeToBlockExpire <= 0) {
      this.clearTimers(entry);
      entry.isBlocked = false;
      entry.hits = 0;
      this.countHit(id, entry, ttl);
    }
    return { totalHits: entry.hits, timeToExpire, isBlocked: entry.isBlocked, timeToBlockExpire };
  }

  /** Số giây (làm tròn lên) khoá còn bị chặn, 0 khi không bị chặn. Chỉ đọc, không đếm thêm lượt. */
  blockedSeconds(key: string, throttlerName: string): number {
    const entry = this.entries.get(entryId(throttlerName, key));
    if (!entry?.isBlocked) return 0;
    return Math.max(0, secondsUntil(entry.blockExpiresAt, Date.now()));
  }

  /** Số khoá đang giữ trong bộ nhớ (cho test và đo rò rỉ). */
  get size(): number {
    return this.entries.size;
  }

  onModuleDestroy(): void {
    for (const entry of this.entries.values()) this.clearTimers(entry);
    this.entries.clear();
  }

  private countHit(id: string, entry: Entry, ttl: number): void {
    entry.hits += 1;
    this.schedule(entry, ttl, () => {
      entry.hits = Math.max(0, entry.hits - 1);
      this.dropIfIdle(id, entry);
    });
  }

  /**
   * Khoá không còn lượt sống: xoá khi đã hết chặn và hết cửa sổ `expiresAt`, chưa hết thì hẹn xoá lúc hết. Khi đó lượt kế tiếp ở bản gốc
   * cũng mở cửa sổ mới và đếm từ 1, nên tạo lại khoá từ đầu cho cùng kết quả.
   */
  private dropIfIdle(id: string, entry: Entry): void {
    if (entry.hits > 0 || entry.timers.size > 0 || this.entries.get(id) !== entry) return;
    const now = Date.now();
    const wait = Math.max(entry.isBlocked ? entry.blockExpiresAt - now : 0, entry.expiresAt - now);
    if (wait <= 0) {
      this.entries.delete(id);
      return;
    }
    this.schedule(entry, wait, () => this.dropIfIdle(id, entry));
  }

  private schedule(entry: Entry, ms: number, run: () => void): void {
    const timer = setTimeout(() => {
      entry.timers.delete(timer);
      run();
    }, ms);
    timer.unref();
    entry.timers.add(timer);
  }

  private clearTimers(entry: Entry): void {
    for (const timer of entry.timers) clearTimeout(timer);
    entry.timers.clear();
  }
}
