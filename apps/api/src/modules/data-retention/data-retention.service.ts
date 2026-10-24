import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { SystemConfigService } from '../system-config/system-config.service';
import { CHAT_RETENTION_KEY, RECALL_TOMBSTONE_TTL_MS } from '../support-chat/support-chat.config';
import { markCronSkipped, TrackCron } from '../../common/cron-run/track-cron';

export const RETENTION_LOCK_KEY = 'cron:data-retention.cleanup';
export const BATCH_SIZE = 5_000;
export const BATCH_PAUSE_MS = 200;
// Dừng giữa chừng nếu chạy quá lâu: phần còn lại để đêm sau thay vì đè lên giờ cao điểm buổi sáng.
export const MAX_RUN_MS = 90 * 60_000;

/** Số ngày giữ SĐT của đơn ngoài app sau khi claim của nó về trạng thái cuối (CREDITED, VOIDED, REVERSED, LAPSED). */
export const EXTERNAL_PHONE_AFTER_FINAL_DAYS = 7;

export type RetentionTargetKey = 'analytics_events' | 'notification_logs' | 'webhook_events' | 'refresh_tokens' | 'support_chat';

/** Sàn tối thiểu: lỡ đặt 0/1 ngày trong tab Cấu hình thì không xoá sạch bảng ngay đêm sau. */
export const RETENTION_POLICY: Record<RetentionTargetKey, { configKey: string; defaultDays: number; minDays: number }> = {
  analytics_events: { configKey: 'retention.analytics_events_days', defaultDays: 395, minDays: 90 },
  notification_logs: { configKey: 'retention.notification_logs_days', defaultDays: 180, minDays: 30 },
  webhook_events: { configKey: 'retention.webhook_events_days', defaultDays: 90, minDays: 14 },
  refresh_tokens: { configKey: 'retention.refresh_sessions_days', defaultDays: 30, minDays: 7 },
  support_chat: { configKey: CHAT_RETENTION_KEY, defaultDays: 365, minDays: 90 },
};

export function resolveRetentionDays(target: RetentionTargetKey, raw: unknown): number {
  const { defaultDays, minDays } = RETENTION_POLICY[target];
  if (typeof raw !== 'number' || !Number.isFinite(raw)) return defaultDays;
  return Math.max(minDays, Math.floor(raw));
}

/** `set`: thay vì xoá dòng thì ghi đè cột (xoá thông tin cá nhân nhưng giữ dòng). */
type Cleanup = { table: string; where: Prisma.Sql; set?: Prisma.Sql; label?: string };
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
  @TrackCron()
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
    if (this.running) { markCronSkipped('RUNNING'); return { skipped: 'RUNNING' }; }
    this.running = true;
    try {
      // Khoá advisory theo transaction giữ suốt lượt chạy: nhiều instance cùng lên lịch thì chỉ một instance dọn.
      // Các lô DELETE chạy trên kết nối khác — transaction này chỉ để giữ khoá.
      return await this.prisma.$transaction(
        async (tx) => {
          const [row] = await tx.$queryRaw<{ locked: boolean }[]>`
            SELECT pg_try_advisory_xact_lock(hashtext(${RETENTION_LOCK_KEY})) AS "locked"`;
          if (!row?.locked) { markCronSkipped('LOCKED'); return { skipped: 'LOCKED' as const }; }
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
    const targets = Object.keys(RETENTION_POLICY) as RetentionTargetKey[];
    const deleted: Record<string, number> = {};
    let truncated = false;

    for (const [i, target] of targets.entries()) {
      // Mỗi bảng chỉ được dùng phần ngân sách còn lại chia đều cho các bảng chưa chạy: bảng tồn đọng lớn
      // (lần dọn đầu của analytics_events) không nuốt hết thời gian để các bảng sau chỉ xoá được một lô.
      const now0 = Date.now();
      const targetDeadline = Math.min(deadline, now0 + Math.max(0, deadline - now0) / (targets.length - i));
      try {
        const days = await this.days(target);
        const cutoff = new Date(now.getTime() - days * 86_400_000);
        for (const c of this.cleanups(target, cutoff, now)) {
          const res = await this.deleteInBatches(c, batchSize, pauseMs, targetDeadline);
          const key = c.label ?? c.table;
          deleted[key] = (deleted[key] ?? 0) + res.count;
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

  private cleanups(target: RetentionTargetKey, cutoff: Date, now: Date): Cleanup[] {
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
      case 'webhook_events': {
        // SĐT của đơn chat/điện thoại chỉ cần tới khi claim về trạng thái cuối: sau đó giữ thêm ngần này ngày (để xử lý khiếu nại) rồi xoá.
        // Mốc là `updatedAt` của claim: claim ở trạng thái cuối không còn bị sửa nên mốc đứng yên.
        const finalClaimCutoff = new Date(now.getTime() - EXTERNAL_PHONE_AFTER_FINAL_DAYS * 86_400_000);
        return [
          { table: 'pancake_webhook_events', where: Prisma.sql`"receivedAt" < ${cutoff}` },
          { table: 'gomdon_webhook_events', where: Prisma.sql`"receivedAt" < ${cutoff}` },
          { table: 'oa_inbound_messages', where: Prisma.sql`"createdAt" < ${cutoff}` },
          // Cùng hạn với payload thô của webhook: SĐT người mua của đơn ngoài app không giữ lâu hơn bản gốc. Giữ dòng đơn (mã vận đơn,
          // trạng thái, tiền hàng); claim còn chờ xử lý thì giữ SĐT vì bước ghép theo SĐT cần tới.
          {
            table: 'external_orders',
            label: 'external_orders.phone',
            set: Prisma.sql`"phone" = NULL`,
            where: Prisma.sql`"phone" IS NOT NULL AND "updatedAt" < ${cutoff} AND NOT EXISTS (
              SELECT 1 FROM external_points_claims c
              WHERE c."externalOrderId" = external_orders.id AND c."state" IN ('PENDING', 'REVIEW', 'HELD_NO_MEMBER')
            )`,
          },
          {
            table: 'external_orders',
            label: 'external_orders.phone_after_final',
            set: Prisma.sql`"phone" = NULL`,
            where: Prisma.sql`"phone" IS NOT NULL AND EXISTS (
              SELECT 1 FROM external_points_claims c
              WHERE c."externalOrderId" = external_orders.id
                AND c."state" IN ('CREDITED', 'VOIDED', 'REVERSED', 'LAPSED') AND c."updatedAt" < ${finalClaimCutoff}
            )`,
          },
          // Bản chép SĐT lúc tạo claim chat (để liên kết) theo cùng luật: bỏ khi claim đã xong 7 ngày, hoặc khi đơn đã mất SĐT.
          {
            table: 'external_points_claims',
            label: 'external_points_claims.order_phone',
            set: Prisma.sql`"orderPhone" = NULL`,
            where: Prisma.sql`"orderPhone" IS NOT NULL AND (
              ("state" IN ('CREDITED', 'VOIDED', 'REVERSED', 'LAPSED') AND "updatedAt" < ${finalClaimCutoff})
              OR EXISTS (SELECT 1 FROM external_orders o WHERE o.id = external_points_claims."externalOrderId" AND o."phone" IS NULL)
            )`,
          },
        ];
      }
      case 'refresh_tokens':
        return [
          {
            table: 'refresh_tokens',
            where: Prisma.sql`(("revokedAt" IS NOT NULL AND "revokedAt" < ${cutoff}) OR "expiresAt" < ${cutoff})`,
          },
        ];
      case 'support_chat':
        // Hội thoại giữ lại để mã của khách không đổi.
        return [
          { table: 'support_messages', where: Prisma.sql`"createdAt" < ${cutoff}` },
          { table: 'support_forwards', where: Prisma.sql`"createdAt" < ${cutoff}` },
          // Tombstone thu hồi chỉ cần vài ngày, không theo số ngày lưu tin cấu hình.
          { table: 'support_recall_tombstones', where: Prisma.sql`"createdAt" < ${new Date(now.getTime() - RECALL_TOMBSTONE_TTL_MS)}` },
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
      const n = c.set
        ? await this.prisma.$executeRaw`
            UPDATE ${table} SET ${c.set} WHERE id IN (SELECT id FROM ${table} WHERE ${c.where} LIMIT ${batchSize})`
        : await this.prisma.$executeRaw`
            DELETE FROM ${table} WHERE id IN (SELECT id FROM ${table} WHERE ${c.where} LIMIT ${batchSize})`;
      count += n;
      if (n < batchSize) return { count, truncated: false };
      if (Date.now() >= deadline) return { count, truncated: true };
      await new Promise((r) => setTimeout(r, pauseMs));
    }
  }
}
