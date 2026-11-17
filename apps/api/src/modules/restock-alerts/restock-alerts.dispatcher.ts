import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { Prisma } from '@prisma/client';
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
/** Dòng đã nhận mà quá chừng này vẫn chưa có tin trong app: lượt trước dừng giữa chừng (container bị thay lúc deploy, lỗi DB). */
export const RESTOCK_STALE_CLAIM_MS = 10 * 60_000;
/** Chỉ cứu dòng nhận trong chừng này: xa hơn thì log tin có thể đã bị dọn, cứu nữa là gửi lại tin khách đã nhận. */
const RESTOCK_RECOVER_WINDOW_MS = 24 * 3_600_000;
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
    const recovered = await this.recoverStale(now, RESTOCK_SENDS_PER_TICK);
    let budget = RESTOCK_SENDS_PER_TICK - recovered.attempted;
    let sent = recovered.sent;
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
      sent += await this.deliver(id, claimed);
    }
    return sent;
  }

  /** Gửi các dòng vừa nhận của một biến thể. Lỗi giữa chừng không làm mất dòng chưa gửi: dòng được trả về chờ. */
  private async deliver(variationId: string, claimed: ClaimedAlert[]): Promise<number> {
    let data: Record<string, string>;
    try {
      data = await this.messageData(variationId);
    } catch (err) {
      this.logger.error(`Không đọc được tên biến thể ${variationId} để báo hàng về: ${err instanceof Error ? err.message : String(err)}`);
      for (const alert of claimed) await this.release(alert);
      return 0;
    }
    let sent = 0;
    for (const alert of claimed) {
      if (await this.send(alert, data)) sent++;
    }
    return sent;
  }

  /**
   * Cứu dòng đã nhận quá RESTOCK_STALE_CLAIM_MS mà khách chưa có tin trong app (`dedupeKey` `restock:<id>`): lượt trước dừng giữa chừng.
   * Biến thể còn bán và còn hàng thì gửi lại (khoá chống trùng giữ đúng một tin nếu tin thật ra đã lưu); hết hàng rồi thì trả về chờ.
   */
  private async recoverStale(now: Date, limit: number): Promise<{ attempted: number; sent: number }> {
    const rows = await this.prisma.$queryRaw<Array<ClaimedAlert & { variationId: string; inStock: boolean }>>`
      SELECT ra."id", ra."userId", ra."roundId", ra."variationId",
             (v."stock" > 0 AND v."isActive" AND p."isActive" AND p."approvalStatus" = 'APPROVED') AS "inStock"
        FROM "restock_alerts" ra
        JOIN "variations" v ON v."id" = ra."variationId"
        JOIN "products" p ON p."id" = v."productId"
       WHERE ra."notifiedAt" < ${new Date(now.getTime() - RESTOCK_STALE_CLAIM_MS)}
         AND ra."notifiedAt" > ${new Date(now.getTime() - RESTOCK_RECOVER_WINDOW_MS)}
         AND ra."roundId" IS NOT NULL
         AND NOT EXISTS (
               SELECT 1 FROM "notification_logs" nl
                WHERE nl."userId" = ra."userId" AND nl."channel" = 'INAPP' AND nl."templateCode" = 'RESTOCK_AVAILABLE'
                  AND nl."payload"->>'dedupeKey' = 'restock:' || ra."id")
       ORDER BY ra."notifiedAt", ra."id"
       LIMIT ${limit}`;
    let sent = 0;
    const names = new Map<string, Record<string, string>>();
    for (const row of rows) {
      if (!row.inStock) {
        await this.release(row);
        continue;
      }
      let data = names.get(row.variationId);
      if (!data) {
        try {
          data = await this.messageData(row.variationId);
        } catch (err) {
          this.logger.warn(`Chưa cứu được đăng ký báo hàng ${row.id}: ${err instanceof Error ? err.message : String(err)}`);
          continue;
        }
        names.set(row.variationId, data);
      }
      if (await this.send(row, data)) sent++;
    }
    if (rows.length > 0) this.logger.warn(`Cứu ${rows.length} đăng ký báo hàng đã nhận mà chưa gửi (lượt trước dừng giữa chừng), gửi được ${sent}.`);
    return { attempted: rows.length, sent };
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
    await this.release(alert);
    return false;
  }

  /**
   * Trả dòng đã nhận về chờ. Khách đã đăng ký lại cùng biến thể trong lúc đó thì partial unique báo P2002: dòng mới thay dòng này, xoá dòng
   * cũ. Lỗi khác chỉ ghi log, dòng ở lại trạng thái đã nhận và bước cứu ở đầu lượt sau xử lý.
   */
  private async release(alert: ClaimedAlert): Promise<void> {
    try {
      await this.prisma.restockAlert.updateMany({ where: { id: alert.id, roundId: alert.roundId }, data: { notifiedAt: null, roundId: null } });
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        await this.prisma.restockAlert.deleteMany({ where: { id: alert.id, roundId: alert.roundId } }).catch(() => undefined);
        return;
      }
      this.logger.warn(`Không trả được đăng ký báo hàng ${alert.id} về chờ: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
}
