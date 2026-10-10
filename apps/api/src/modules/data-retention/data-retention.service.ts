import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { SystemConfigService } from '../system-config/system-config.service';

export const RETENTION_LOCK_KEY = 'cron:data-retention.cleanup';
export const BATCH_SIZE = 5_000;
export const BATCH_PAUSE_MS = 200;
// Dừng giữa chừng nếu chạy quá lâu: phần còn lại để đêm sau thay vì đè lên giờ cao điểm buổi sáng.
export const MAX_RUN_MS = 90 * 60_000;

export type RetentionTargetKey = 'analytics_events' | 'notification_logs' | 'webhook_events' | 'refresh_tokens';

/** Sàn tối thiểu: lỡ đặt 0/1 ngày trong tab Cấu hình thì không xoá sạch bảng ngay đêm sau. */
export const RETENTION_POLICY: Record<RetentionTargetKey, { configKey: string; defaultDays: number; minDays: number }> = {
  analytics_events: { configKey: 'retention.analytics_events_days', defaultDays: 395, minDays: 90 },
  notification_logs: { configKey: 'retention.notification_logs_days', defaultDays: 180, minDays: 30 },
  webhook_events: { configKey: 'retention.webhook_events_days', defaultDays: 90, minDays: 14 },
  refresh_tokens: { configKey: 'retention.refresh_tokens_days', defaultDays: 30, minDays: 7 },
};

export function resolveRetentionDays(target: RetentionTargetKey, raw: unknown): number {
  const { defaultDays, minDays } = RETENTION_POLICY[target];
  if (typeof raw !== 'number' || !Number.isFinite(raw)) return defaultDays;
  return Math.max(minDays, Math.floor(raw));
}

type Cleanup = { table: string; where: Prisma.Sql };
type RunOpts = { now?: Date; batchSize?: number; pauseMs?: number; maxRunMs?: number };
export type RetentionResult =
  | { skipped: 'RUNNING' | 'LOCKED' }
  | { deleted: Record<string, number>; truncated: boolean };

/**
 * Dọn bảng log phình vô hạn theo lô nhỏ (C-046, Q-21). Mỗi lô là một câu DELETE riêng có LIMIT rồi nghỉ ngắn,
 * không giữ khoá dòng lâu và không làm WAL/vacuum bùng nổ. Không có ORDER BY: Postgres dừng quét ngay khi đủ
 * LIMIT dòng khớp nên lô đầu rẻ kể cả khi cột thời gian chưa có index.
 *
 * Chỉ dòng ĐÃ QUÁ HẠN bị xoá — dòng còn hạn không bao giờ lọt vào điều kiện, nên chạy lại là idempotent.
 */
@Injectable()
export class DataRetentionService {
  private readonly logger = new Logger(DataRetentionService.name);
  private running = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly systemConfig: SystemConfigService,
  ) {}

  // Sau cron retention 03:00 (đã đọc refresh_tokens của hôm qua để tính DAU) và trước giờ cao điểm sáng.
  @Cron('0 30 4 * * *', { name: 'data-retention.cleanup', timeZone: 'Asia/Ho_Chi_Minh' })
  async handleCron(): Promise<void> {
    try {
      const res = await this.runAll();
      if ('skipped' in res) {
        this.logger.log(`Bỏ qua dọn dữ liệu cũ: ${res.skipped}.`);
        return;
      }
      this.logger.log(`Dọn dữ liệu cũ xong: ${JSON.stringify(res.deleted)}${res.truncated ? ' (dừng sớm do quá thời lượng)' : ''}.`);
    } catch (err) {
      this.logger.error(`Cron dọn dữ liệu cũ lỗi: ${err instanceof Error ? err.stack ?? err.message : err}`);
    }
  }

  async runAll(opts: RunOpts = {}): Promise<RetentionResult> {
    if (this.running) return { skipped: 'RUNNING' };
    this.running = true;
    try {
      // Khoá advisory theo transaction giữ suốt lượt chạy: nhiều instance cùng lên lịch thì chỉ một instance dọn.
      // Các lô DELETE chạy trên kết nối khác — transaction này chỉ để giữ khoá.
      return await this.prisma.$transaction(
        async (tx) => {
          const [row] = await tx.$queryRaw<{ locked: boolean }[]>`
            SELECT pg_try_advisory_xact_lock(hashtext(${RETENTION_LOCK_KEY})) AS "locked"`;
          if (!row?.locked) return { skipped: 'LOCKED' as const };
          return this.cleanupAll(opts);
        },
        { maxWait: 10_000, timeout: 3 * 3_600_000 },
      );
    } finally {
      this.running = false;
    }
  }

  private async cleanupAll(opts: RunOpts): Promise<{ deleted: Record<string, number>; truncated: boolean }> {
    const now = opts.now ?? new Date();
    const batchSize = opts.batchSize ?? BATCH_SIZE;
    const pauseMs = opts.pauseMs ?? BATCH_PAUSE_MS;
    const deadline = Date.now() + (opts.maxRunMs ?? MAX_RUN_MS);
    const deleted: Record<string, number> = {};
    let truncated = false;

    for (const target of Object.keys(RETENTION_POLICY) as RetentionTargetKey[]) {
      try {
        const days = await this.days(target);
        const cutoff = new Date(now.getTime() - days * 86_400_000);
        for (const c of this.cleanups(target, cutoff)) {
          const res = await this.deleteInBatches(c, batchSize, pauseMs, deadline);
          deleted[c.table] = (deleted[c.table] ?? 0) + res.count;
          if (res.truncated) truncated = true;
        }
      } catch (err) {
        // Một bảng lỗi không chặn các bảng còn lại.
        this.logger.error(`Dọn ${target} lỗi: ${err instanceof Error ? err.message : err}`);
      }
    }
    return { deleted, truncated };
  }

  private async days(target: RetentionTargetKey): Promise<number> {
    const { configKey, defaultDays } = RETENTION_POLICY[target];
    return resolveRetentionDays(target, await this.systemConfig.get<unknown>(configKey, defaultDays));
  }

  private cleanups(target: RetentionTargetKey, cutoff: Date): Cleanup[] {
    switch (target) {
      case 'analytics_events':
        // Chỉ xoá khi số tổng hợp của NGÀY (giờ VN) đó đã nằm trong retention_daily_snapshot: tổng hợp theo sự kiện
        // (funnel/cohort từ analytics_events) hiện chưa có job ghi nên đây là snapshot duy nhất làm căn cứ.
        // Mốc là receivedAt (giờ server) vì occurredAt do client tự khai.
        return [
          {
            table: 'analytics_events',
            where: Prisma.sql`"receivedAt" < ${cutoff} AND EXISTS (
              SELECT 1 FROM retention_daily_snapshot s
              WHERE s."date" = ((analytics_events."receivedAt" AT TIME ZONE 'UTC') AT TIME ZONE 'Asia/Ho_Chi_Minh')::date
            )`,
          },
        ];
      case 'notification_logs':
        return [{ table: 'notification_logs', where: Prisma.sql`"sentAt" < ${cutoff}` }];
      case 'webhook_events':
        return [
          { table: 'pancake_webhook_events', where: Prisma.sql`"receivedAt" < ${cutoff}` },
          { table: 'gomdon_webhook_events', where: Prisma.sql`"receivedAt" < ${cutoff}` },
          { table: 'oa_inbound_messages', where: Prisma.sql`"createdAt" < ${cutoff}` },
        ];
      case 'refresh_tokens':
        return [
          {
            table: 'refresh_tokens',
            where: Prisma.sql`(("revokedAt" IS NOT NULL AND "revokedAt" < ${cutoff}) OR "expiresAt" < ${cutoff})`,
          },
        ];
    }
  }

  private async deleteInBatches(
    c: Cleanup,
    batchSize: number,
    pauseMs: number,
    deadline: number,
  ): Promise<{ count: number; truncated: boolean }> {
    // Tên bảng lấy từ danh sách cố định ở cleanups(), không bao giờ từ input ngoài.
    const table = Prisma.raw(`"${c.table}"`);
    let count = 0;
    for (;;) {
      const n = await this.prisma.$executeRaw`
        DELETE FROM ${table} WHERE id IN (SELECT id FROM ${table} WHERE ${c.where} LIMIT ${batchSize})`;
      count += n;
      if (n < batchSize) return { count, truncated: false };
      if (Date.now() >= deadline) return { count, truncated: true };
      await new Promise((r) => setTimeout(r, pauseMs));
    }
  }
}
