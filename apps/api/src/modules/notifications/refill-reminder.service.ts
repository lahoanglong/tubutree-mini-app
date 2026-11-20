import { randomUUID } from 'node:crypto';
import { Injectable, Logger, Optional } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { SystemConfigService } from '../system-config/system-config.service';
import { CRON_TZ } from '../../common/cron-tz';
import { REAL_USER_SQL } from '../../common/real-user';
import { markCronSkipped, TrackCron } from '../../common/cron-run/track-cron';
import { runExclusive } from '../../common/cron-leader/run-exclusive';
import { loadRefillPairTable } from '../catalog/refill/refill-pair-table';
import { NotificationsService } from './notifications.service';
import {
  REFILL_REMINDER_ENABLED_KEY,
  REFILL_REMINDER_TEMPLATE,
  REFILL_REMINDER_ZNS_KEY,
  pickRefillReminder,
  refillReminderDedupeKey,
  refillReminderOptedOut,
  refillReminderWindow,
  type RefillReminderDecision,
} from './refill-reminder.rules';

export type RefillReminderRun =
  | { skipped: 'OFF' | 'RUNNING' | 'LOCKED' | 'ERROR' }
  | { sent: number; reordered: number; optedOut: number; nudged: number; capped: number; noPair: number; failed: number };

/** TAKEN: lượt khác (instance khác) đã nhận đơn này trước. */
type Outcome = RefillReminderDecision['outcome'] | 'SENT' | 'FAILED' | 'TAKEN';

interface DueOrder {
  id: string;
  userId: string;
  createdAt: Date;
}

/**
 * Nhắc đổi sang gói Refill 21 ngày sau khi khách nhận một chai có cặp Refill đang bán (tubu-w11-03, cờ
 * `retention.refill_21d_reminder_enabled`, mặc định TẮT).
 *
 * - Một đơn một lượt xét: dòng `refill_reminders` (unique theo đơn) ghi lúc nhận việc, cộng khoá chống trùng `refill21d:<đơn>` của tin.
 * - Bỏ qua khách đã tắt tin khuyến mãi, bị khoá, hay MSS báo từ chối; khách đã đặt lại gói Refill đó trong 21 ngày.
 * - Mỗi khách tối đa một tin nhắc Refill mỗi 7 ngày (kiểm dưới khoá advisory theo khách); tối đa BATCH đơn mỗi lượt.
 * - Không nhắc đôi cùng chai với tin "Nhắc mua lại" 30 ngày (LifecycleService): tin đó đã nhắc chai sau khi đặt đơn thì đơn dừng
 *   (NUDGED); tin Refill đã gửi thì chu kỳ của chai được nêu ở `reorder_reminders` coi như đã nhắc, trừ khi khách đã mua chai đó lần nữa.
 * - Chỉ đơn giao từ 21 tới 28 ngày trước: bật cờ lần đầu không nhắc cả lịch sử đơn.
 * - Tin vào chuông trong app; ZNS chỉ khi cờ `retention.refill_21d_zns_enabled` bật (và mẫu đã gắn mã ZNS), khi đó trần tin chủ động
 *   và trần tin khuyến mãi tháng của NotificationsService áp như mọi tin nhắc mua lại.
 */
@Injectable()
export class RefillReminderService {
  private static readonly LOCK_KEY = 'cron:notify.refill_21d';
  static readonly BATCH = 300;
  private readonly logger = new Logger(RefillReminderService.name);
  private running = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
    @Optional() private readonly config?: SystemConfigService,
  ) {}

  /** 09:30 giờ VN: ngoài giờ yên tĩnh, sau khi kho chốt đơn giao hôm trước. */
  @Cron('30 9 * * *', { timeZone: CRON_TZ })
  @TrackCron()
  async sendDue(now: Date = new Date()): Promise<RefillReminderRun> {
    if (this.running) {
      markCronSkipped('RUNNING');
      return { skipped: 'RUNNING' };
    }
    this.running = true;
    try {
      if (!(await this.flag(REFILL_REMINDER_ENABLED_KEY))) {
        markCronSkipped('NOT_CONFIGURED');
        return { skipped: 'OFF' };
      }
      const run = await runExclusive(this.prisma, RefillReminderService.LOCK_KEY, () => this.runOnce(now));
      if (!run.acquired) {
        markCronSkipped('LOCKED');
        return { skipped: 'LOCKED' };
      }
      return run.value;
    } catch (err) {
      this.logger.error(`Nhắc Refill 21 ngày lỗi: ${err instanceof Error ? err.message : err}`);
      return { skipped: 'ERROR' };
    } finally {
      this.running = false;
    }
  }

  private async flag(key: string): Promise<boolean> {
    return (await this.config?.get<unknown>(key, false)) === true;
  }

  private async runOnce(now: Date): Promise<Exclude<RefillReminderRun, { skipped: string }>> {
    const stats = { sent: 0, reordered: 0, optedOut: 0, nudged: 0, capped: 0, noPair: 0, failed: 0 };
    const pairs = await loadRefillPairTable(this.prisma, this.config);
    if (pairs.size === 0) return stats;
    const zns = await this.flag(REFILL_REMINDER_ZNS_KEY);
    const w = refillReminderWindow(now);
    // Chặn dưới createdAt để truy vấn đi qua index (status, createdAt): đơn giao trong cửa sổ không thể đặt trước đó quá 60 ngày.
    const createdFloor = new Date(w.oldest.getTime() - 60 * 864e5);
    const orders = await this.prisma.$queryRaw<DueOrder[]>`
      SELECT o.id, o."userId", o."createdAt"
        FROM orders o
       WHERE o.status::text = 'DELIVERED'
         AND o.type::text = 'RETAIL'
         AND o."placedForCustomer" = false
         AND o."createdAt" >= ${createdFloor}
         AND o."deliveredAt" IS NOT NULL AND o."deliveredAt" <= ${w.dueBefore} AND o."deliveredAt" > ${w.oldest}
         -- Chỉ khách thật: tài khoản guest_ không có chuông thông báo để nhận tin.
         AND EXISTS (SELECT 1 FROM users u WHERE u.id = o."userId" AND ${REAL_USER_SQL})
         AND NOT EXISTS (SELECT 1 FROM refill_reminders rr WHERE rr."orderId" = o.id)
         -- Khách vừa nhận tin trong 7 ngày: đơn chờ ngoài truy vấn, không chiếm chỗ của lô (đơn khác vẫn tới lượt).
         AND NOT EXISTS (
           SELECT 1 FROM refill_reminders r2
            WHERE r2."userId" = o."userId" AND r2.outcome = 'SENT' AND r2."createdAt" >= ${w.userGapSince})
         AND EXISTS (
           SELECT 1 FROM order_items oi JOIN variations v ON v.id = oi."variationId"
            WHERE oi."orderId" = o.id AND oi."isGift" = false AND v."productId" IN (${Prisma.join([...pairs.keys()])}))
       ORDER BY o."deliveredAt" ASC, o.id ASC
       LIMIT ${RefillReminderService.BATCH}`;
    for (const o of orders) {
      const outcome = await this.remindOne(o, pairs, now, zns).catch((err: unknown): Outcome => {
        this.logger.error(`Nhắc Refill lỗi (order=${o.id}): ${err instanceof Error ? err.message : err}`);
        return 'FAILED';
      });
      if (outcome === 'SENT') stats.sent++;
      else if (outcome === 'REORDERED') stats.reordered++;
      else if (outcome === 'OPTED_OUT') stats.optedOut++;
      else if (outcome === 'NUDGED') stats.nudged++;
      else if (outcome === 'CAPPED') stats.capped++;
      else if (outcome === 'NO_PAIR') stats.noPair++;
      else if (outcome === 'FAILED') stats.failed++;
    }
    if (orders.length > 0) this.logger.log(`Nhắc Refill 21 ngày: ${orders.length} đơn tới hạn, ${JSON.stringify(stats)}.`);
    return stats;
  }

  private async remindOne(o: DueOrder, pairs: ReadonlyMap<string, string>, now: Date, zns: boolean): Promise<Outcome> {
    const w = refillReminderWindow(now);
    const items = await this.prisma.$queryRaw<{ id: string; productId: string; variationId: string; productName: string; quantity: number }[]>`
      SELECT oi.id, v."productId", oi."variationId", oi."productName", oi.quantity
        FROM order_items oi JOIN variations v ON v.id = oi."variationId"
       WHERE oi."orderId" = ${o.id} AND oi."isGift" = false
       ORDER BY oi.id`;
    const paired = items.filter((i) => pairs.has(i.productId));
    // Chai đã trả (yêu cầu trả chưa bị từ chối) thì khách không còn chai để châm lại.
    const returned = paired.length
      ? await this.prisma.returnRequestItem.findMany({
          where: { orderItemId: { in: paired.map((i) => i.id) }, returnRequest: { status: { not: 'REJECTED' } } },
          select: { orderItemId: true, quantity: true },
        })
      : [];
    const returnedQty = new Map<string, number>();
    for (const r of returned) returnedQty.set(r.orderItemId, (returnedQty.get(r.orderItemId) ?? 0) + r.quantity);
    const kept = paired.filter((i) => i.quantity - (returnedQty.get(i.id) ?? 0) > 0);
    const bottleIds = [...new Set(kept.map((i) => i.productId))];
    if (bottleIds.length === 0) {
      // Trả hết chai: ghi để đơn không đứng đầu lô mỗi ngày; bảng cặp đổi (paired rỗng) thì không ghi, lượt sau xét lại.
      if (paired.length > 0) await this.record(this.prisma, o, null, null, 'NO_PAIR', now);
      return 'NO_PAIR';
    }

    const user = await this.prisma.user.findUnique({
      where: { id: o.userId },
      select: { notifyPromo: true, notifyOrderZalo: true, notifyOrderZaloSource: true, isBlocked: true },
    });
    const refillIds = [...new Set(bottleIds.map((id) => pairs.get(id)!))];
    const reordered = await this.prisma.$queryRaw<{ id: string }[]>`
      SELECT DISTINCT v."productId" AS id
        FROM order_items oi
        JOIN orders o2 ON o2.id = oi."orderId"
        JOIN variations v ON v.id = oi."variationId"
       WHERE o2."userId" = ${o.userId}
         AND o2."createdAt" >= ${o.createdAt}
         AND o2.status::text IN ('CONFIRMED', 'PACKED', 'SHIPPING', 'DELIVERED')
         AND v."productId" IN (${Prisma.join(refillIds)})`;
    // Đơn đã đặt từ 21 ngày trước nên "đã nhắc sau khi đặt" bao luôn mọi tin "Nhắc mua lại" trong 7 ngày qua.
    const nudged = await this.prisma.reorderReminder.count({
      where: { userId: o.userId, variationId: { in: [...new Set(kept.map((i) => i.variationId))] }, remindedAt: { gte: o.createdAt } },
    });
    const input = {
      bottleIds,
      pairs,
      reorderedRefillIds: new Set(reordered.map((r) => r.id)),
      optedOut: !user || refillReminderOptedOut(user),
      alreadyNudged: nudged > 0,
      recentlyReminded: false,
    };
    const first = pickRefillReminder(input);
    if (first.outcome === 'NO_PAIR') return 'NO_PAIR';
    if (first.outcome === 'REORDERED' || first.outcome === 'OPTED_OUT' || first.outcome === 'NUDGED') {
      await this.record(this.prisma, o, null, null, first.outcome, now);
      return first.outcome;
    }
    if (first.outcome !== 'SEND') return first.outcome;

    const products = await this.prisma.product.findMany({ where: { id: { in: [first.bottleId, first.refillId] } }, select: { id: true, slug: true, name: true } });
    const bottle = products.find((p) => p.id === first.bottleId);
    const refill = products.find((p) => p.id === first.refillId);
    if (!bottle || !refill) return 'NO_PAIR';

    // Trần 7 ngày mỗi khách và việc nhận đơn nằm chung một khoá theo khách: hai lượt (hai instance) không cùng thấy "chưa nhắc".
    const claimed = await this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`refill21d:user:${o.userId}`}))`;
      const recent = await tx.refillReminder.findFirst({ where: { userId: o.userId, outcome: 'SENT', createdAt: { gte: w.userGapSince } }, select: { id: true } });
      const d = pickRefillReminder({ ...input, recentlyReminded: recent !== null });
      if (d.outcome !== 'SEND') return d.outcome;
      return (await this.record(tx, o, d.bottleId, d.refillId, 'SENT', now)) ? 'CLAIMED' : 'TAKEN';
    });
    if (claimed !== 'CLAIMED') return claimed;

    try {
      await this.notifications.notify(
        o.userId,
        REFILL_REMINDER_TEMPLATE,
        { product: refill.name, bottle: bottle.name, product_slug: refill.slug },
        { dedupeKey: refillReminderDedupeKey(o.id), inAppOnly: !zns },
      );
    } catch (err) {
      // Đã nhận đơn trước khi gửi: bỏ dòng để lượt sau (còn trong cửa sổ) thử lại; khoá chống trùng của tin chặn gửi hai lần.
      this.logger.error(`Gửi tin nhắc Refill lỗi (order=${o.id}): ${err instanceof Error ? err.message : err}`);
      await this.prisma.refillReminder.deleteMany({ where: { orderId: o.id, outcome: 'SENT' } }).catch(() => undefined);
      return 'FAILED';
    }
    await this.markGenericReminded(o, kept.filter((i) => i.productId === bottle.id), now);
    return 'SENT';
  }

  /**
   * Tin Refill đã nhắc chai của đơn: chu kỳ "Nhắc mua lại" của chai đó coi như đã nhắc. Khách đã mua chai đó lần nữa (đơn đặt sau đơn này,
   * đã chốt, kể cả còn đang giao) thì để nguyên: chu kỳ của đơn mới vẫn được nhắc sau khi đơn đó giao xong. Lỗi chỉ ghi log, tin đã gửi.
   */
  private async markGenericReminded(o: DueOrder, items: { variationId: string; productName: string }[], now: Date): Promise<void> {
    for (const it of items) {
      const newer = await this.prisma.order.count({
        where: {
          userId: o.userId,
          status: { in: ['CONFIRMED', 'PACKED', 'SHIPPING', 'DELIVERED'] },
          type: 'RETAIL',
          createdAt: { gt: o.createdAt },
          items: { some: { variationId: it.variationId, isGift: false } },
        },
      });
      if (newer > 0) continue;
      await this.prisma.reorderReminder
        .upsert({
          where: { userId_variationId: { userId: o.userId, variationId: it.variationId } },
          create: { userId: o.userId, variationId: it.variationId, productName: it.productName, lastOrderAt: o.createdAt, remindedAt: now },
          update: { remindedAt: now },
        })
        .catch((err: unknown) => this.logger.warn(`Không đánh dấu nhắc mua lại (order=${o.id}): ${err instanceof Error ? err.message : err}`));
    }
  }

  /** Ghi một dòng cho đơn; đơn đã có dòng (lượt khác nhận trước) thì không ghi và trả false. */
  private async record(
    db: Pick<PrismaService, '$executeRaw'>,
    o: DueOrder,
    bottleId: string | null,
    refillId: string | null,
    outcome: 'SENT' | 'REORDERED' | 'OPTED_OUT' | 'NUDGED' | 'NO_PAIR',
    now: Date,
  ): Promise<boolean> {
    const rows = await db.$executeRaw`
      INSERT INTO refill_reminders (id, "orderId", "userId", "bottleProductId", "refillProductId", outcome, "createdAt")
      VALUES (${randomUUID()}, ${o.id}, ${o.userId}, ${bottleId}, ${refillId}, ${outcome}, ${now})
      ON CONFLICT ("orderId") DO NOTHING`;
    return rows === 1;
  }
}
