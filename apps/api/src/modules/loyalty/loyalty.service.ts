import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { SystemConfigService } from '../system-config/system-config.service';

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

  /** Cộng điểm tích cho đơn đã giao (idempotent theo reason). */
  async creditOrderPoints(orderId: string): Promise<void> {
    const order = await this.prisma.order.findUniqueOrThrow({ where: { id: orderId } });
    if (order.pointsEarned <= 0) return;
    const reason = `ORDER_DELIVERED:${order.code}`;

    const existed = await this.prisma.pointsTransaction.findFirst({
      where: { userId: order.userId, reason },
    });
    if (existed) return; // đã cộng rồi

    const expireMonths = await this.config.get<number>('loyalty.point_expire_months', 12);
    const expiresAt = new Date();
    expiresAt.setMonth(expiresAt.getMonth() + expireMonths);

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
    await this.recalcTier(order.userId);
  }

  /** Hoàn ngược khi hủy/trả: trừ điểm đã tích, hoàn lại điểm đã tiêu. */
  async reverseOrderPoints(orderId: string): Promise<void> {
    const order = await this.prisma.order.findUniqueOrThrow({ where: { id: orderId } });
    const ops = [];

    if (order.pointsEarned > 0) {
      ops.push(
        this.prisma.pointsTransaction.create({
          data: {
            userId: order.userId,
            delta: -order.pointsEarned,
            reason: `ORDER_REVERSED:${order.code}`,
            refType: 'ORDER',
            refId: order.id,
          },
        }),
        this.prisma.user.update({
          where: { id: order.userId },
          data: { pointsBalance: { decrement: order.pointsEarned } },
        }),
      );
    }
    if (order.pointsUsed > 0) {
      ops.push(
        this.prisma.pointsTransaction.create({
          data: {
            userId: order.userId,
            delta: order.pointsUsed,
            reason: `ORDER_REFUND_POINTS:${order.code}`,
            refType: 'ORDER',
            refId: order.id,
          },
        }),
        this.prisma.user.update({
          where: { id: order.userId },
          data: { pointsBalance: { increment: order.pointsUsed } },
        }),
      );
    }
    if (ops.length) await this.prisma.$transaction(ops);
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
    const currentSort = user.tier?.sortOrder ?? -1;
    const next = tiers.find((t) => t.sortOrder > currentSort);

    return {
      pointsBalance: user.pointsBalance,
      tier: user.tier
        ? {
            id: user.tier.id,
            name: user.tier.name,
            multiplier: Number(user.tier.pointMultiplier),
            perks: user.tier.perks,
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
    const result = [];
    for (const c of coupons) {
      if (c.scope === 'TIER') {
        const meta = c.scopeMeta as { tierId?: string } | null;
        if (meta?.tierId && meta.tierId !== user.tierId) continue;
      } else if (c.scope === 'USER_GROUP') {
        // Voucher cá nhân (welcome/birthday/winback) — chỉ hiện cho đúng user.
        const meta = c.scopeMeta as { userId?: string } | null;
        if (meta?.userId !== userId) continue;
      } else if (c.scope !== 'PUBLIC') {
        continue; // INVITE xử lý riêng
      }
      const used = await this.prisma.couponRedemption.count({ where: { couponId: c.id, userId } });
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
