import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { SystemConfigService } from '../system-config/system-config.service';
import { isCouponEligible } from '../coupons/coupon-scope';

/**
 * Loyalty core (Build Spec §6.6). Phase 1 dùng cho vòng đời đơn:
 *  - creditOrderPoints khi DELIVERED
 *  - reverseOrderPoints khi CANCELLED/RETURNED
 *  - recalcTier theo điểm hoặc chi tiêu 12 tháng
 * Redemption/voucher endpoints mở rộng ở Phase 2.
 */
@Injectable()
export class LoyaltyService {
  private readonly logger = new Logger(LoyaltyService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: SystemConfigService,
  ) {}

  /**
   * Cộng điểm tích cho đơn đã giao (idempotent theo reason).
   *
   * RACE: 2 webhook DELIVERED song song/retry trước đây cùng findFirst NGOÀI tx → cùng thấy
   * chưa cộng → cùng create + increment → DOUBLE credit. Fix: pre-check để giảm ops vô ích,
   * nhưng GUARD CỨNG là partial unique index (reason, refId) where reason LIKE 'ORDER_DELIVERED:%'
   * (migration 20260623010000_loyalty_credit_unique). Caller thua race ăn P2002 → bail idempotent.
   * Đối xứng với reverseOrderPoints.
   */
  async creditOrderPoints(orderId: string): Promise<void> {
    const order = await this.prisma.order.findUniqueOrThrow({ where: { id: orderId } });
    if (order.pointsEarned <= 0) return;
    const reason = `ORDER_DELIVERED:${order.code}`;

    const existed = await this.prisma.pointsTransaction.findFirst({
      where: { userId: order.userId, reason },
    });
    if (existed) return; // đã cộng rồi (pre-check; unique index là guard cứng cho race)

    const expireMonths = await this.config.get<number>('loyalty.point_expire_months', 12);
    const expiresAt = new Date();
    expiresAt.setMonth(expiresAt.getMonth() + expireMonths);

    try {
      await this.prisma.$transaction([
        this.prisma.pointsTransaction.create({
          data: {
            userId: order.userId,
            delta: order.pointsEarned,
            reason,
            refType: 'ORDER',
            refId: order.id,
            expiresAt,
          },
        }),
        this.prisma.user.update({
          where: { id: order.userId },
          data: { pointsBalance: { increment: order.pointsEarned } },
        }),
      ]);
    } catch (err) {
      // Partial unique (reason, refId) chặn double-credit — caller thua race ăn P2002 → no-op.
      // CHỈ coi idempotent skip nếu P2002 ĐÚNG là index credit này: re-query thấy bản ghi reason
      // đã tồn tại (kẻ thắng race đã commit). P2002 từ constraint KHÁC (vd unique mới thêm sau này
      // trên cùng tx) → bản ghi reason vẫn chưa có → re-throw, KHÔNG nuốt lỗi thật làm mất điểm âm thầm.
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        const already = await this.prisma.pointsTransaction.findFirst({
          where: { userId: order.userId, reason },
          select: { id: true },
        });
        if (already) {
          this.logger.debug(`creditOrderPoints idempotent skip order=${order.code}`);
          return;
        }
        this.logger.error(
          `creditOrderPoints P2002 KHÔNG khớp idempotency (reason=${reason}) order=${order.code} — re-throw`,
        );
      }
      throw err;
    }
    await this.recalcTier(order.userId);
  }

  /**
   * Hoàn ngược khi hủy/trả: trừ điểm đã tích, hoàn lại điểm đã tiêu.
   *
   * RACE: 2 caller song song (orders.cancel + webhook RETURNED) trước đây cùng
   * findFirst NGOÀI tx → cùng thấy chưa reverse → cùng cộng/trừ → DOUBLE.
   * Fix: di chuyển ALL check + write VÀO 1 transaction; relies on
   * unique partial index (reason, refId) để insert thứ 2 P2002 → bail idempotent.
   * Migration 20260623000000_loyalty_reverse_unique tạo unique index.
   */
  async reverseOrderPoints(orderId: string): Promise<void> {
    const order = await this.prisma.order.findUniqueOrThrow({ where: { id: orderId } });
    try {
      await this.prisma.$transaction(async (tx) => {
        // Re-check trong tx để giảm xác suất chạy ops vô ích; unique index là guard cứng.
        const reversed = await tx.pointsTransaction.findFirst({
          where: {
            userId: order.userId,
            refId: order.id,
            reason: { in: [`ORDER_REVERSED:${order.code}`, `ORDER_REFUND_POINTS:${order.code}`] },
          },
          select: { id: true },
        });
        if (reversed) return;

        // pointsEarned CHỈ được cộng khi đơn DELIVERED (xem creditOrderPoints).
        // Nếu user hủy đơn CONFIRMED (chưa giao), điểm chưa cộng → KHÔNG trừ.
        const wasCredited = order.pointsEarned > 0
          ? Boolean(
              await tx.pointsTransaction.findFirst({
                where: { userId: order.userId, reason: `ORDER_DELIVERED:${order.code}` },
                select: { id: true },
              }),
            )
          : false;

        if (wasCredited) {
          // create() trước user.update — nếu duplicate caller chạy đồng thời, P2002
          // bay ra TRƯỚC khi balance bị decrement lần 2 (xem catch ngoài tx).
          await tx.pointsTransaction.create({
            data: {
              userId: order.userId,
              delta: -order.pointsEarned,
              reason: `ORDER_REVERSED:${order.code}`,
              refType: 'ORDER',
              refId: order.id,
            },
          });
          await tx.user.update({
            where: { id: order.userId },
            data: { pointsBalance: { decrement: order.pointsEarned } },
          });
        }
        if (order.pointsUsed > 0) {
          await tx.pointsTransaction.create({
            data: {
              userId: order.userId,
              delta: order.pointsUsed,
              reason: `ORDER_REFUND_POINTS:${order.code}`,
              refType: 'ORDER',
              refId: order.id,
            },
          });
          await tx.user.update({
            where: { id: order.userId },
            data: { pointsBalance: { increment: order.pointsUsed } },
          });
        }
      });
    } catch (err) {
      // Unique partial index (reason, refId) trên points_transactions chặn double-reverse —
      // 2 caller song song: 1 thắng commit, 1 bị P2002 → coi như idempotent no-op.
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === 'P2002'
      ) {
        this.logger.debug(`reverseOrderPoints idempotent skip order=${order.code}`);
        return;
      }
      throw err;
    }
  }

  /** Tính lại hạng theo điểm tích lũy HOẶC chi tiêu 12 tháng (chọn hạng cao nhất đạt). */
  async recalcTier(userId: string): Promise<void> {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    const tiers = await this.prisma.membershipTier.findMany({ orderBy: { sortOrder: 'asc' } });

    const since = new Date();
    since.setMonth(since.getMonth() - 12);
    const spentAgg = await this.prisma.order.aggregate({
      where: { userId, status: 'DELIVERED', createdAt: { gte: since } },
      _sum: { total: true },
    });
    const spent12m = spentAgg._sum.total ?? 0;

    let qualified = tiers[0];
    for (const t of tiers) {
      const byPoints = user.pointsBalance >= t.minPoints;
      const bySpending = t.minSpending != null && spent12m >= t.minSpending;
      if (byPoints || bySpending) qualified = t;
    }
    if (qualified && user.tierId !== qualified.id) {
      await this.prisma.user.update({ where: { id: userId }, data: { tierId: qualified.id } });
    }
  }

  /** Multiplier điểm của hạng hiện tại (1 nếu chưa có hạng). */
  async getTierMultiplier(tierId?: string | null): Promise<number> {
    if (!tierId) return 1;
    const tier = await this.prisma.membershipTier.findUnique({ where: { id: tierId } });
    return tier ? Number(tier.pointMultiplier) : 1;
  }

  /** Tổng quan loyalty: hạng hiện tại, multiplier, tiến độ lên hạng kế tiếp. */
  async getOverview(userId: string) {
    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
      include: { tier: true },
    });
    const tiers = await this.prisma.membershipTier.findMany({ orderBy: { sortOrder: 'asc' } });
    // Mọi user mặc định ở hạng thấp nhất (Mầm Xanh, minPoints 0) — tierId chỉ được gán khi có
    // đơn DELIVERED đầu tiên, nên user mới chưa có tier. Hiển thị hạng nền để trang loyalty đúng.
    const current = user.tier ?? tiers[0] ?? null;
    const currentSort = current?.sortOrder ?? -1;
    const next = tiers.find((t) => t.sortOrder > currentSort);

    return {
      pointsBalance: user.pointsBalance,
      tier: current
        ? {
            id: current.id,
            name: current.name,
            multiplier: Number(current.pointMultiplier),
            perks: current.perks,
          }
        : null,
      nextTier: next
        ? {
            id: next.id,
            name: next.name,
            minPoints: next.minPoints,
            pointsToGo: Math.max(0, next.minPoints - user.pointsBalance),
          }
        : null,
      tiers: tiers.map((t) => ({
        id: t.id,
        name: t.name,
        minPoints: t.minPoints,
        multiplier: Number(t.pointMultiplier),
      })),
    };
  }

  getPointsTransactions(userId: string) {
    return this.prisma.pointsTransaction.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
  }

  /** Coupon khả dụng cho user: PUBLIC + đúng hạng, còn hạn, chưa hết lượt cá nhân. */
  async getAvailableCoupons(userId: string) {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    const now = new Date();
    const coupons = await this.prisma.coupon.findMany({
      where: { startAt: { lte: now }, endAt: { gte: now } },
    });

    // Pre-filter theo scope trước, rồi 1 groupBy duy nhất đếm used count cho mọi coupon.
    // Trước đây loop từng coupon gọi count() → 1 + N query khi user có nhiều voucher khả dụng.
    // Điều kiện scope dùng CHUNG isCouponEligible với CouponsService.assertScopeOwnership
    // (validate/redeem) để list & apply KHÔNG lệch (coupon hiện mà redeem fail).
    const filtered = coupons.filter((c) => isCouponEligible(c, user));

    const ids = filtered.map((c) => c.id);
    const grouped = ids.length
      ? await this.prisma.couponRedemption.groupBy({
          by: ['couponId'],
          where: { userId, couponId: { in: ids } },
          _count: { _all: true },
        })
      : [];
    const usedMap = new Map(grouped.map((g) => [g.couponId, g._count._all]));

    const result = [];
    for (const c of filtered) {
      const used = usedMap.get(c.id) ?? 0;
      if (used >= c.perUserLimit) continue;
      result.push({
        code: c.code,
        type: c.type,
        value: c.value,
        minOrder: c.minOrder,
        maxDiscount: c.maxDiscount,
        endAt: c.endAt,
      });
    }
    return result;
  }
}
