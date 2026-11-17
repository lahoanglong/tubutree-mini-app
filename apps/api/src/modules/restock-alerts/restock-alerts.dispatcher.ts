import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { CRON_TZ } from '../../common/cron-tz';
import { markCronSkipped, TrackCron } from '../../common/cron-run/track-cron';
import { runExclusive } from '../../common/cron-leader/run-exclusive';
import { RestockAlertsService } from './restock-alerts.service';

/** Giãn tin: tối đa chừng này tin báo hàng về mỗi phút (mỗi lượt cron), trên mọi biến thể. */
export const RESTOCK_SENDS_PER_TICK = 100;
/** Chống tồn dao động (về rồi hết rồi về): một biến thể mở tối đa một đợt báo trong chừng này. */
export const RESTOCK_ROUND_COOLDOWN_MS = 24 * 3_600_000;
const VARIATIONS_PER_TICK = 200;
const RUN_TTL_MS = 110_000;

interface ClaimedAlert {
  id: string;
  userId: string;
  roundId: string;
}

/**
 * Gửi "Hàng về rồi" cho khách đã bấm "Báo tôi khi có hàng" (cờ catalog.restock_alert_enabled).
 *
 * Phát hiện hàng về không gắn vào từng đường ghi tồn (đồng bộ Pancake, webhook, huỷ đơn trả kho, nhập trả hàng, admin sửa tay): chỉ nhận
 * đăng ký khi biến thể hết hàng (stock ≤ 0), nên "còn đăng ký chờ mà stock > 0" nghĩa là tồn vừa đi từ ≤ 0 lên > 0, dù đường nào ghi.
 * Cron mỗi phút, trễ tối đa một phút sau lần ghi tồn.
 *
 * Mỗi đăng ký đúng một tin: dòng được nhận bằng `UPDATE ... WHERE "notifiedAt" IS NULL RETURNING` cùng điều kiện còn hàng ngay lúc nhận,
 * nên hàng về rồi hết trước khi tới lượt thì không gửi và đăng ký được giữ. Một đợt (`restock_alert_rounds`) gồm các đăng ký có trước lúc
 * mở đợt; đợt có thể kéo qua nhiều phút khi đông người. Một biến thể không mở đợt mới trong 24 giờ: đăng ký mới trong thời gian đó chờ đợt sau.
 */
@Injectable()
export class RestockAlertsDispatcher {
  private readonly logger = new Logger(RestockAlertsDispatcher.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly restock: RestockAlertsService,
    private readonly notifications: NotificationsService,
  ) {}

  @Cron('* * * * *', { timeZone: CRON_TZ })
  @TrackCron({ alertAfter: 2 })
  async dispatchRestocked(): Promise<void> {
    try {
      if (!(await this.restock.enabled())) return;
      const run = await runExclusive(this.prisma, 'restock-alerts', () => this.dispatchOnce(new Date()), { ttlMs: RUN_TTL_MS });
      if (!run.acquired) markCronSkipped('LOCKED');
    } catch (err) {
      this.logger.error(err);
    }
  }

  /** Một lượt: trả số tin đã gửi được. Tách khỏi cron để test gọi thẳng với mốc giờ tự chọn. */
  async dispatchOnce(now: Date): Promise<number> {
    let budget = RESTOCK_SENDS_PER_TICK;
    let sent = 0;
    const variations = await this.prisma.$queryRaw<Array<{ id: string }>>`
      SELECT v."id"
        FROM "variations" v
        JOIN "products" p ON p."id" = v."productId"
       WHERE v."stock" > 0 AND v."isActive" AND p."isActive" AND p."approvalStatus" = 'APPROVED'
         AND EXISTS (SELECT 1 FROM "restock_alerts" ra WHERE ra."variationId" = v."id" AND ra."notifiedAt" IS NULL)
       ORDER BY (SELECT MIN(ra."createdAt") FROM "restock_alerts" ra WHERE ra."variationId" = v."id" AND ra."notifiedAt" IS NULL), v."id"
       LIMIT ${VARIATIONS_PER_TICK}`;
    for (const { id } of variations) {
      if (budget <= 0) break;
      const claimed = await this.claim(id, budget, now);
      budget -= claimed.length;
      if (claimed.length === 0) continue;
      const data = await this.messageData(id);
      for (const alert of claimed) {
        if (await this.send(alert, data)) sent++;
      }
    }
    return sent;
  }

  /** Mở đợt (nếu biến thể không có đợt nào trong 24 giờ) và nhận tối đa `limit` đăng ký của đợt đang mở, dưới khoá advisory theo biến thể. */
  private claim(variationId: string, limit: number, now: Date): Promise<ClaimedAlert[]> {
    return this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`restock-round:${variationId}`}))`;
      let round = await tx.restockAlertRound.findFirst({ where: { variationId }, orderBy: { startedAt: 'desc' }, select: { id: true, startedAt: true } });
      if (!round || now.getTime() - round.startedAt.getTime() >= RESTOCK_ROUND_COOLDOWN_MS) {
        const current = await tx.variation.findUnique({ where: { id: variationId }, select: { stock: true } });
        if (!current || current.stock <= 0) return [];
        round = await tx.restockAlertRound.create({ data: { variationId, startedAt: now, stockAtStart: current.stock }, select: { id: true, startedAt: true } });
      }
      return tx.$queryRaw<ClaimedAlert[]>`
        UPDATE "restock_alerts" SET "notifiedAt" = ${now}, "roundId" = ${round.id}
         WHERE "id" IN (
                 SELECT ra."id" FROM "restock_alerts" ra
                  WHERE ra."variationId" = ${variationId} AND ra."notifiedAt" IS NULL AND ra."createdAt" <= ${round.startedAt}
                  ORDER BY ra."createdAt", ra."id"
                  LIMIT ${limit}
                  FOR UPDATE SKIP LOCKED)
           AND "notifiedAt" IS NULL
           AND EXISTS (SELECT 1 FROM "variations" v WHERE v."id" = ${variationId} AND v."stock" > 0)
        RETURNING "id", "userId", "roundId"`;
    });
  }

  private async messageData(variationId: string): Promise<Record<string, string>> {
    const v = await this.prisma.variation.findUnique({
      where: { id: variationId },
      select: { name: true, product: { select: { name: true, slug: true, _count: { select: { variations: true } } } } },
    });
    if (!v) return { product: 'Sản phẩm bạn chờ' };
    const label = v.product._count.variations > 1 && v.name ? `${v.product.name} (${v.name})` : v.product.name;
    return { product: label, product_slug: v.product.slug };
  }

  /** Gửi lỗi thì trả dòng về chờ (lượt sau gửi lại, cùng khoá chống trùng nên tin trong app không lặp). */
  private async send(alert: ClaimedAlert, data: Record<string, string>): Promise<boolean> {
    const ok = await this.notifications.notifySafe(alert.userId, 'RESTOCK_AVAILABLE', data, { dedupeKey: `restock:${alert.id}` }, `restock=${alert.id}`);
    if (ok) return true;
    await this.prisma.restockAlert.updateMany({ where: { id: alert.id, roundId: alert.roundId }, data: { notifiedAt: null, roundId: null } });
    return false;
  }
}
