import { Injectable, Logger, type NestMiddleware, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';
import { vnDateKey } from '../../common/vn-time';
import { PrismaService } from '../../prisma/prisma.service';

/** Mỗi ngày VN một dòng `ops_health_states` khoá `http.5xx:YYYY-MM-DD`, `detail.count` = số phản hồi 5xx của ngày đó (mọi instance cộng dồn). */
export const SERVER_ERROR_KEY_PREFIX = 'http.5xx:';
export const serverErrorStateKey = (dayKey: string): string => `${SERVER_ERROR_KEY_PREFIX}${dayKey}`;
/** Dòng của ngày cũ hơn ngần này bị xoá: bản tin sáng chỉ đọc ngày hôm qua. */
export const SERVER_ERROR_RETENTION_DAYS = 14;

const FLUSH_INTERVAL_MS = 60_000;
const PURGE_INTERVAL_MS = 3_600_000;
const DAY_MS = 86_400_000;

/** Cùng kiểu `timestamp` (UTC, không múi giờ) như cột Prisma, như webhook-reject-counter.service. */
const ts = (d: Date): string => d.toISOString();

/**
 * Đếm số phản hồi HTTP 5xx theo ngày VN cho bản tin sáng của chủ shop. Chỉ lưu SỐ ĐẾM: không đường dẫn, không lỗi, không dữ liệu request
 * (chi tiết lỗi đã có ở Sentry và log).
 *
 * `record` chỉ tăng bộ đếm trong bộ nhớ: lúc sự cố (DB chậm, mỗi request trả 500) mà ghi DB mỗi lần là tự khuếch đại tải. Bộ đếm được ghi
 * dồn mỗi phút và lần cuối khi tắt API; process chết đột ngột thì mất tối đa một phút số đếm, chấp nhận được vì chỉ là chỉ báo.
 */
@Injectable()
export class ServerErrorCounterService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ServerErrorCounterService.name);
  private pending = new Map<string, number>();
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

  /** Không bao giờ ném: lỗi đếm không được làm đổi phản hồi đang gửi cho khách. */
  record(now: Date = new Date()): void {
    try {
      if (!Number.isFinite(now.getTime())) return;
      this.add(vnDateKey(now), 1);
    } catch {
      // cố ý nuốt: đây là chỉ báo phụ.
    }
  }

  private add(dayKey: string, count: number): void {
    this.pending.set(dayKey, (this.pending.get(dayKey) ?? 0) + count);
  }

  /** Ghi dồn bộ đếm đang giữ vào DB (cộng vào dòng có sẵn). Không ném; ghi lỗi thì trả số đếm về bộ nhớ để lần sau ghi lại. */
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
    const updatedAt = ts(new Date());
    let failed = 0;
    let lastError: unknown = null;
    for (const [dayKey, count] of snapshot) {
      try {
        await this.prisma.$executeRaw`
          INSERT INTO "ops_health_states" ("key", "detail", "updatedAt")
          VALUES (${serverErrorStateKey(dayKey)}, jsonb_build_object('count', ${count}::int), ${updatedAt}::timestamp)
          ON CONFLICT ("key") DO UPDATE
            SET "detail" = jsonb_build_object('count', COALESCE(("ops_health_states"."detail"->>'count')::int, 0) + ${count}::int),
                "updatedAt" = EXCLUDED."updatedAt"`;
      } catch (err) {
        this.add(dayKey, count);
        failed += 1;
        lastError = err;
      }
    }
    if (failed > 0) {
      this.logger.warn(`Ghi bộ đếm lỗi 5xx lỗi (${failed} ngày, sẽ ghi lại): ${lastError instanceof Error ? lastError.message : String(lastError)}`);
    }
  }

  private async tick(): Promise<void> {
    await this.flush();
    await this.purgeIfDue(new Date());
  }

  /** Xoá dòng của ngày quá hạn, tối đa mỗi giờ một lần. Khoá ngày dạng YYYY-MM-DD nên so chuỗi là so ngày. */
  private async purgeIfDue(now: Date): Promise<void> {
    if (now.getTime() - this.lastPurgeAt < PURGE_INTERVAL_MS) return;
    this.lastPurgeAt = now.getTime();
    const cutoffKey = serverErrorStateKey(vnDateKey(new Date(now.getTime() - SERVER_ERROR_RETENTION_DAYS * DAY_MS)));
    try {
      await this.prisma.$executeRaw`
        DELETE FROM "ops_health_states" WHERE "key" LIKE ${`${SERVER_ERROR_KEY_PREFIX}%`} AND "key" < ${cutoffKey}`;
    } catch (err) {
      this.lastPurgeAt = 0;
      this.logger.warn(`Xoá bộ đếm lỗi 5xx quá hạn lỗi: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  /** Số phản hồi 5xx của ngày VN `dayKey`: phần đã ghi DB cộng phần instance này còn giữ trong bộ nhớ. */
  async countForDay(dayKey: string): Promise<number> {
    const row = await this.prisma.opsHealthState.findUnique({ where: { key: serverErrorStateKey(dayKey) }, select: { detail: true } });
    const stored = Number((row?.detail as { count?: unknown } | null)?.count ?? 0);
    return (Number.isFinite(stored) && stored > 0 ? stored : 0) + (this.pending.get(dayKey) ?? 0);
  }
}

/**
 * Gắn cho mọi route (OpsModule.configure): khi phản hồi gửi xong mà mã >= 500 thì đếm một lần. Đọc mã lúc `finish` nên bắt được cả 5xx do
 * exception filter (Prisma, Sentry, BaseExceptionFilter) đặt sau controller. Request khách tự huỷ giữa chừng (`close` không `finish`) không đếm.
 */
@Injectable()
export class ServerErrorCountMiddleware implements NestMiddleware {
  constructor(private readonly counter: ServerErrorCounterService) {}

  use(_req: Request, res: Response, next: NextFunction): void {
    res.once('finish', () => {
      if (res.statusCode >= 500) this.counter.record();
    });
    next();
  }
}
