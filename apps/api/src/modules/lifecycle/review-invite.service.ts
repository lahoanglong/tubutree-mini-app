import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../../prisma/prisma.service';
import { SystemConfigService } from '../system-config/system-config.service';
import { NotificationsService } from '../notifications/notifications.service';
import { CRON_TZ } from '../../common/cron-tz';

export type ReviewInviteRunResult = { skipped: 'RUNNING' | 'LOCKED' | 'ERROR' } | { sent: number; claimed: number };

interface DueOrder {
  id: string;
  code: string;
  userId: string;
}

interface UnreviewedItem {
  productName: string;
  productSlug: string | null;
}

/**
 * Tin mời đánh giá sau giao (C-017). Tin giao dịch (REVIEW_REQUEST không thuộc nhóm PROMO) về đúng đơn khách đã nhận,
 * gửi một lần mỗi đơn sau `review.invite_delay_hours` giờ để khách kịp dùng thử. Chỉ nêu SP khách CHƯA đánh giá
 * (Q-30: một đánh giá/SP, điểm chỉ thưởng lần đầu); đơn đã đánh giá hết thì đánh dấu và không gửi.
 *
 * Chỉ xét đơn giao trong `review.invite_max_age_days` ngày gần nhất: cột reviewInvitedAt mới thêm nên mọi đơn cũ đều
 * NULL, không có trần này thì lần chạy đầu sau deploy gửi tin cho toàn bộ lịch sử đơn.
 */
@Injectable()
export class ReviewInviteService {
  private static readonly PAGE = 200;
  /** 200 × 10 = 2.000 đơn/lượt; phần dư lượt sau lấy tiếp vì đơn đã nhận có reviewInvitedAt. */
  private static readonly MAX_PAGES = 10;
  /** Chặn dưới createdAt để truy vấn đi qua index (status, createdAt) thay vì quét mọi đơn DELIVERED. */
  private static readonly CREATED_LOOKBACK_DAYS = 60;
  private static readonly LOCK_KEY = 'cron:lifecycle.review_invite';

  private readonly logger = new Logger(ReviewInviteService.name);
  private running = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: SystemConfigService,
    private readonly notifications: NotificationsService,
  ) {}

  /** 10h và 19h giờ VN: tránh gửi tin lúc khách ngủ. */
  @Cron('0 10,19 * * *', { timeZone: CRON_TZ })
  async sendReviewInvites(): Promise<ReviewInviteRunResult> {
    if (this.running) return { skipped: 'RUNNING' };
    this.running = true;
    try {
      // Khoá advisory theo transaction giữ suốt lượt (nhiều instance chỉ một chạy); claim từng đơn vẫn là chốt cuối.
      return await this.prisma.$transaction(
        async (tx) => {
          const [row] = await tx.$queryRaw<{ locked: boolean }[]>`
            SELECT pg_try_advisory_xact_lock(hashtext(${ReviewInviteService.LOCK_KEY})) AS "locked"`;
          if (!row?.locked) return { skipped: 'LOCKED' as const };
          return this.processBatches();
        },
        { maxWait: 10_000, timeout: 10 * 60_000 },
      );
    } catch (err) {
      this.logger.error(`sendReviewInvites lỗi: ${err instanceof Error ? err.message : err}`);
      return { skipped: 'ERROR' };
    } finally {
      this.running = false;
    }
  }

  private async processBatches(): Promise<{ sent: number; claimed: number }> {
    const delayHours = await this.config.get<number>('review.invite_delay_hours', 48);
    const maxAgeDays = await this.config.get<number>('review.invite_max_age_days', 7);
    const now = Date.now();
    const dueBefore = new Date(now - delayHours * 3600e3);
    const oldest = new Date(now - maxAgeDays * 864e5);
    const createdFloor = new Date(now - ReviewInviteService.CREATED_LOOKBACK_DAYS * 864e5);

    let sent = 0;
    let claimed = 0;
    let cursor = '';
    for (let page = 0; page < ReviewInviteService.MAX_PAGES; page++) {
      // Đơn lên hộ mang userId của CTV, đơn đại lý là hàng buôn: người nhận tin không phải người dùng SP.
      const orders = await this.prisma.$queryRaw<DueOrder[]>`
        SELECT o.id, o.code, o."userId"
        FROM orders o
        WHERE o.status::text = 'DELIVERED'
          AND o."reviewInvitedAt" IS NULL
          AND o.type::text = 'RETAIL'
          AND o."placedForCustomer" = false
          AND o."createdAt" >= ${createdFloor}
          AND o."deliveredAt" IS NOT NULL AND o."deliveredAt" <= ${dueBefore} AND o."deliveredAt" >= ${oldest}
          AND o.id > ${cursor}
        ORDER BY o.id
        LIMIT ${ReviewInviteService.PAGE}`;
      for (const o of orders) {
        const outcome = await this.inviteOne(o).catch((err: unknown) => {
          this.logger.error(`Mời đánh giá lỗi (order=${o.id}): ${err instanceof Error ? err.message : err}`);
          return 'SKIPPED' as const;
        });
        if (outcome !== 'SKIPPED') claimed++;
        if (outcome === 'SENT') sent++;
      }
      if (orders.length < ReviewInviteService.PAGE) break;
      cursor = orders[orders.length - 1]!.id;
    }
    if (claimed) this.logger.log(`Review invites: gửi ${sent}/${claimed} đơn đã nhận.`);
    return { sent, claimed };
  }

  private async inviteOne(o: DueOrder): Promise<'SENT' | 'NOTHING_TO_REVIEW' | 'SKIPPED'> {
    const claimedAt = new Date();
    const claim = await this.prisma.order.updateMany({
      where: { id: o.id, reviewInvitedAt: null },
      data: { reviewInvitedAt: claimedAt },
    });
    if (claim.count === 0) return 'SKIPPED';

    const items = await this.prisma.$queryRaw<UnreviewedItem[]>`
      SELECT DISTINCT ON (v."productId") oi."productName", oi."productSlug"
      FROM order_items oi
      JOIN variations v ON v.id = oi."variationId"
      JOIN products p ON p.id = v."productId"
      WHERE oi."orderId" = ${o.id}
        -- Tin mời mở trang sản phẩm: hàng đã ngừng bán (tắt hoặc chưa duyệt) thì trang đó 404.
        AND p."isActive" = true
        AND p."approvalStatus"::text = 'APPROVED'
        AND NOT EXISTS (SELECT 1 FROM reviews r WHERE r."userId" = ${o.userId} AND r."productId" = v."productId")
      ORDER BY v."productId", oi.id`;
    if (items.length === 0) return 'NOTHING_TO_REVIEW';

    const first = items[0]!;
    const data: Record<string, string> = {
      order_code: o.code,
      product: items.length > 1 ? `${first.productName} và ${items.length - 1} sản phẩm khác` : first.productName,
    };
    if (first.productSlug) data.product_slug = first.productSlug;
    try {
      await this.notifications.notify(o.userId, 'REVIEW_REQUEST', data);
      return 'SENT';
    } catch (err) {
      // Đã claim trước khi gửi: không trả cờ thì đơn này không bao giờ được mời lại.
      this.logger.error(`Gửi tin mời đánh giá lỗi (order=${o.id}): ${err instanceof Error ? err.message : err}`);
      await this.prisma.order
        .updateMany({ where: { id: o.id, reviewInvitedAt: claimedAt }, data: { reviewInvitedAt: null } })
        .catch(() => undefined);
      return 'SKIPPED';
    }
  }
}
