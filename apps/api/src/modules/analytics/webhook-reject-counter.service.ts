import { Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import type { LaunchWatchWebhookReject } from '@tubutree/shared-types';
import { PrismaService } from '../../prisma/prisma.service';
import {
  WEBHOOK_REJECT_BUCKETS_PER_DAY,
  WEBHOOK_REJECT_BUCKETS_PER_HOUR,
  WEBHOOK_REJECT_BUCKET_MS,
  WEBHOOK_REJECT_RETENTION_DAYS,
  WEBHOOK_SOURCES,
  type WebhookSource,
} from './webhook-reject-config';

const FLUSH_INTERVAL_MS = 30_000;
const PURGE_INTERVAL_MS = 3_600_000;
const HOUR_MS = 3_600_000;
const DAY_MS = 24 * HOUR_MS;

interface BucketRow {
  source: string;
  bucketStart: Date | string;
  count: number | bigint;
}

/** Cùng kiểu `timestamp` (UTC, không múi giờ) như cột Prisma, giống ts() ở launch-watch.service. */
const ts = (d: Date): string => d.toISOString();

interface Pending {
  source: WebhookSource;
  bucketMs: number;
  count: number;
}

const keyOf = (source: WebhookSource, bucketMs: number): string => `${source}|${bucketMs}`;

/**
 * Đếm số lần webhook bị từ chối 401 theo nguồn và khung 5 phút để lần sau thấy ngay thay vì mất nhiều ngày (Pancake bị 401 cả tuần mà không ai biết).
 * CHỈ lưu nguồn + số đếm + mốc giờ: không bao giờ nhận token, header, IP hay nội dung request.
 *
 * `record` chỉ tăng bộ đếm trong bộ nhớ (không chạm DB) vì webhook bỏ throttle: bị quét 401 liên tục mà ghi DB mỗi lần là tự khuếch đại tải.
 * Bộ đếm được ghi dồn vào DB mỗi 30 giây; tắt API thì ghi lần cuối. Mất tối đa vài chục giây số đếm khi tiến trình chết đột ngột, chấp nhận được vì
 * chỉ là chỉ báo cảnh báo.
 */
@Injectable()
export class WebhookRejectCounterService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(WebhookRejectCounterService.name);
  private pending = new Map<string, Pending>();
  private timer: NodeJS.Timeout | null = null;
  private flushing: Promise<void> | null = null;
  private lastPurgeAt = 0;

  constructor(private readonly prisma: PrismaService) {}

  onModuleInit(): void {
    this.timer = setInterval(() => void this.tick(), FLUSH_INTERVAL_MS);
    this.timer.unref();
  }

  async onModuleDestroy(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    await this.flushing;
    await this.flush();
  }

  /** Không bao giờ ném: lỗi đếm không được làm đổi phản hồi 401 của webhook. */
  record(source: WebhookSource, now: Date = new Date()): void {
    try {
      const bucketMs = Math.floor(now.getTime() / WEBHOOK_REJECT_BUCKET_MS) * WEBHOOK_REJECT_BUCKET_MS;
      if (!Number.isFinite(bucketMs)) return;
      this.addPending({ source, bucketMs, count: 1 });
    } catch {
      // cố ý nuốt: đây là chỉ báo phụ.
    }
  }

  private addPending(p: Pending): void {
    const key = keyOf(p.source, p.bucketMs);
    const cur = this.pending.get(key);
    this.pending.set(key, cur ? { ...cur, count: cur.count + p.count } : p);
  }

  /** Ghi dồn bộ đếm đang giữ vào DB (cộng dồn vào dòng có sẵn). Không ném; ghi lỗi thì trả số đếm về bộ nhớ để lần sau ghi lại. */
  flush(): Promise<void> {
    if (this.flushing) return this.flushing;
    const run = this.writePending().finally(() => {
      if (this.flushing === run) this.flushing = null;
    });
    this.flushing = run;
    return run;
  }

  private async writePending(): Promise<void> {
    if (this.pending.size === 0) return;
    const snapshot = this.pending;
    this.pending = new Map();
    const failed: Pending[] = [];
    let lastError: unknown = null;
    const updatedAt = ts(new Date());
    for (const p of snapshot.values()) {
      try {
        await this.prisma.$executeRaw`
          INSERT INTO "webhook_reject_counters" ("source", "bucketStart", "count", "updatedAt")
          VALUES (${p.source}, ${ts(new Date(p.bucketMs))}::timestamp, ${p.count}::int, ${updatedAt}::timestamp)
          ON CONFLICT ("source", "bucketStart")
          DO UPDATE SET "count" = "webhook_reject_counters"."count" + EXCLUDED."count", "updatedAt" = EXCLUDED."updatedAt"`;
      } catch (err) {
        failed.push(p);
        lastError = err;
      }
    }
    if (failed.length > 0) {
      for (const p of failed) this.addPending(p);
      this.logger.warn(`Ghi bộ đếm webhook bị từ chối lỗi (${failed.length} khung, sẽ ghi lại): ${lastError instanceof Error ? lastError.message : String(lastError)}`);
    }
  }

  private async tick(): Promise<void> {
    await this.flush();
    await this.purgeIfDue(new Date());
  }

  /** Xoá dòng quá hạn, tối đa mỗi giờ một lần. Lỗi chỉ cảnh báo và thử lại ở lần sau. */
  private async purgeIfDue(now: Date): Promise<void> {
    if (now.getTime() - this.lastPurgeAt < PURGE_INTERVAL_MS) return;
    this.lastPurgeAt = now.getTime();
    const cutoff = new Date(now.getTime() - WEBHOOK_REJECT_RETENTION_DAYS * DAY_MS);
    try {
      await this.prisma.$executeRaw`DELETE FROM "webhook_reject_counters" WHERE "bucketStart" < ${ts(cutoff)}::timestamp`;
    } catch (err) {
      this.lastPurgeAt = 0;
      this.logger.warn(`Xoá bộ đếm webhook quá hạn lỗi: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  /**
   * Tổng hợp theo từng nguồn, luôn đủ mọi nguồn theo thứ tự `WEBHOOK_SOURCES`. Đọc DB rồi cộng phần chưa ghi trong bộ nhớ nên số liệu tức thời
   * (lệch thoáng qua nếu một lần ghi dồn xong đúng lúc đang đọc). `lastHour` đếm khung có đầu khung SAU `now - 60 phút`; `lastAt` chỉ tìm trong 24 giờ.
   */
  async summary(now: Date, thresholdPerHour: number): Promise<LaunchWatchWebhookReject[]> {
    const nowMs = now.getTime();
    const since24h = nowMs - DAY_MS;
    const rows = await this.prisma.$queryRaw<BucketRow[]>`
      SELECT "source", "bucketStart", "count"
        FROM "webhook_reject_counters"
       WHERE "bucketStart" > ${ts(new Date(since24h))}::timestamp`;

    const perSource = new Map<string, Map<number, number>>(WEBHOOK_SOURCES.map((s) => [s, new Map<number, number>()]));
    const add = (source: string, bucketMs: number, count: number) => {
      const buckets = perSource.get(source);
      if (!buckets || !Number.isFinite(bucketMs) || !Number.isFinite(count) || bucketMs <= since24h || bucketMs > nowMs) return;
      buckets.set(bucketMs, (buckets.get(bucketMs) ?? 0) + count);
    };
    for (const r of rows) add(r.source, new Date(r.bucketStart).getTime(), Number(r.count));
    for (const p of this.pending.values()) add(p.source, p.bucketMs, p.count);

    const sinceHour = nowMs - HOUR_MS;
    const nowSlot = Math.floor(nowMs / WEBHOOK_REJECT_BUCKET_MS);
    return WEBHOOK_SOURCES.map((source) => {
      const buckets = perSource.get(source)!;
      let lastHour = 0;
      let last24h = 0;
      let lastAtMs = 0;
      for (const [bucketMs, count] of buckets) {
        last24h += count;
        if (bucketMs > sinceHour) lastHour += count;
        if (count > 0 && bucketMs > lastAtMs) lastAtMs = bucketMs;
      }
      // Cửa sổ trượt 12 khung liên tiếp trên 288 khung của 24 giờ gần nhất.
      const counts: number[] = [];
      for (let i = nowSlot - WEBHOOK_REJECT_BUCKETS_PER_DAY + 1; i <= nowSlot; i += 1) counts.push(buckets.get(i * WEBHOOK_REJECT_BUCKET_MS) ?? 0);
      let windowSum = 0;
      let peakPerHour = 0;
      counts.forEach((c, i) => {
        windowSum += c;
        if (i >= WEBHOOK_REJECT_BUCKETS_PER_HOUR) windowSum -= counts[i - WEBHOOK_REJECT_BUCKETS_PER_HOUR] ?? 0;
        if (windowSum > peakPerHour) peakPerHour = windowSum;
      });
      return {
        source,
        lastHour,
        last24h,
        peakPerHour,
        lastAt: lastAtMs > 0 ? new Date(lastAtMs).toISOString() : null,
        alert: lastHour >= thresholdPerHour,
      };
    });
  }
}
