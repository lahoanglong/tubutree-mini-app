import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { randomBytes } from 'node:crypto';
import { PrismaService } from '../../prisma/prisma.service';
import { SystemConfigService } from '../system-config/system-config.service';

/**
 * CTV nội bộ (Build Spec §6.x, §15 affiliate.*).
 * Commission: rate theo từng variation (variation.affiliateRate). Vòng đời:
 * PENDING (đặt) → LOCKED (DELIVERED) → APPROVED (sau hold_days) → PAID (payout).
 */
@Injectable()
export class AffiliateService {
  private readonly logger = new Logger(AffiliateService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: SystemConfigService,
  ) {}

  async register(userId: string) {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    if (user.role === 'DEALER' || user.role === 'ADMIN' || user.role === 'STAFF') {
      throw new BadRequestException('Tài khoản này không thể đăng ký CTV.');
    }
    if (user.role !== 'AFFILIATE') {
      await this.prisma.user.update({ where: { id: userId }, data: { role: 'AFFILIATE' } });
    }
    return { ok: true, referralCode: user.referralCode };
  }

  async getMe(userId: string) {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    return {
      isAffiliate: user.role === 'AFFILIATE' || user.role === 'ADMIN',
      referralCode: user.referralCode,
      walletBalance: user.walletBalance,
    };
  }

  async createLink(userId: string, targetType: string, targetId?: string) {
    const shortCode = randomBytes(5).toString('base64url');
    return this.prisma.affiliateLink.create({
      data: { userId, shortCode, targetType, targetId },
    });
  }

  listLinks(userId: string) {
    return this.prisma.affiliateLink.findMany({ where: { userId }, orderBy: { createdAt: 'desc' } });
  }

  /** Track click (web redirect /r/:shortCode). Trả target để redirect. */
  async trackClick(shortCode: string, visitorId: string, ipHash: string) {
    const link = await this.prisma.affiliateLink.findUnique({ where: { shortCode } });
    if (!link) return null;
    await this.prisma.$transaction([
      this.prisma.affiliateLink.update({ where: { id: link.id }, data: { clicks: { increment: 1 } } }),
      this.prisma.affiliateClick.create({ data: { shortCode, visitorId, ipHash } }),
    ]);
    return { targetType: link.targetType, targetId: link.targetId };
  }

  async dashboard(userId: string) {
    const now = new Date();
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());

    const [today, month, pending, approved, links, monthRevenueAgg] = await Promise.all([
      this.sumCommission(userId, startOfDay),
      this.sumCommission(userId, startOfMonth),
      this.prisma.commission.aggregate({
        where: { affiliateUserId: userId, status: { in: ['PENDING', 'LOCKED'] } },
        _sum: { amount: true },
      }),
      this.prisma.commission.aggregate({
        where: { affiliateUserId: userId, status: 'APPROVED' },
        _sum: { amount: true },
      }),
      this.prisma.affiliateLink.aggregate({
        where: { userId },
        _sum: { clicks: true, conversions: true },
      }),
      // Doanh số tháng = tổng giá trị đơn giới thiệu (để tính bậc bonus §6.8.2).
      this.prisma.commission.aggregate({
        where: { affiliateUserId: userId, createdAt: { gte: startOfMonth } },
        _sum: { orderTotal: true },
      }),
    ]);

    const monthRevenue = monthRevenueAgg._sum.orderTotal ?? 0;
    return {
      todayCommission: today,
      monthCommission: month,
      pendingCommission: pending._sum.amount ?? 0,
      withdrawableCommission: approved._sum.amount ?? 0,
      totalClicks: links._sum.clicks ?? 0,
      totalConversions: links._sum.conversions ?? 0,
      monthRevenue,
      tier: this.monthlyTier(monthRevenue),
    };
  }

  /** Bậc bonus doanh số tháng (Build Spec §6.8.2). */
  private monthlyTier(revenue: number) {
    const TIERS = [
      { name: 'Tân binh', emoji: '🌱', bonusPct: 0, min: 0 },
      { name: 'Đồng', emoji: '🌿', bonusPct: 1, min: 3_000_000 },
      { name: 'Bạc', emoji: '🌳', bonusPct: 2.5, min: 10_000_000 },
      { name: 'Vàng', emoji: '🌲', bonusPct: 4, min: 30_000_000 },
      { name: 'Kim Cương', emoji: '💎', bonusPct: 6, min: 80_000_000 },
    ];
    let idx = 0;
    for (let i = 0; i < TIERS.length; i++) if (revenue >= TIERS[i]!.min) idx = i;
    const cur = TIERS[idx]!;
    const next = TIERS[idx + 1];
    return {
      name: cur.name,
      emoji: cur.emoji,
      bonusPct: cur.bonusPct,
      nextName: next?.name ?? null,
      nextThreshold: next?.min ?? null,
      toNext: next ? Math.max(0, next.min - revenue) : 0,
    };
  }

  listCommissions(userId: string) {
    return this.prisma.commission.findMany({
      where: { affiliateUserId: userId },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
  }

  /** Tạo commission PENDING cho đơn có người giới thiệu (gọi từ checkout). */
  async createCommissionForOrder(orderId: string): Promise<void> {
    const order = await this.prisma.order.findUniqueOrThrow({
      where: { id: orderId },
      include: { items: true },
    });
    if (!order.referrerUserId || order.referrerUserId === order.userId) return;

    const variationIds = order.items.map((i) => i.variationId);
    const variations = await this.prisma.variation.findMany({
      where: { id: { in: variationIds } },
      select: { id: true, affiliateRate: true },
    });
    const rateMap = new Map(variations.map((v) => [v.id, v.affiliateRate ? Number(v.affiliateRate) : 0]));

    let amount = 0;
    let weightedRate = 0;
    for (const item of order.items) {
      const rate = rateMap.get(item.variationId) ?? 0;
      amount += Math.floor((item.total * rate) / 100);
      weightedRate += rate;
    }
    if (amount <= 0) return;

    await this.prisma.commission.create({
      data: {
        affiliateUserId: order.referrerUserId,
        orderId: order.id,
        orderTotal: order.total,
        rate: weightedRate / order.items.length,
        amount,
        status: 'PENDING',
      },
    });
  }

  /** Đơn DELIVERED → khóa commission, bắt đầu đếm hold. */
  async lockCommissionsForOrder(orderId: string): Promise<void> {
    await this.prisma.commission.updateMany({
      where: { orderId, status: 'PENDING' },
      data: { status: 'LOCKED', lockedAt: new Date() },
    });
  }

  /** Đơn hoàn/hủy trong cửa sổ → reject commission. */
  async reverseCommissionsForOrder(orderId: string): Promise<void> {
    await this.prisma.commission.updateMany({
      where: { orderId, status: { in: ['PENDING', 'LOCKED'] } },
      data: { status: 'REJECTED' },
    });
  }

  async requestPayout(userId: string, amount: number, method: string, bankInfo?: object) {
    const minWithdraw = await this.config.get<number>('affiliate.min_withdraw_bank', 50000);
    const multiplier = await this.config.get<number>('affiliate.tubu_wallet_multiplier', 1.5);

    const approved = await this.prisma.commission.aggregate({
      where: { affiliateUserId: userId, status: 'APPROVED' },
      _sum: { amount: true },
    });
    const available = approved._sum.amount ?? 0;
    if (amount > available) throw new BadRequestException('Số dư hoa hồng khả dụng không đủ.');

    if (method === 'WALLET_BALANCE') {
      // Chuyển vào Ví Tubu ×1.5 (không cần min).
      const credited = Math.floor(amount * multiplier);
      await this.prisma.$transaction([
        this.prisma.user.update({
          where: { id: userId },
          data: { walletBalance: { increment: credited } },
        }),
        this.markCommissionsPaid(userId, amount),
        this.prisma.payout.create({
          data: { userId, amount: credited, method, status: 'PAID', paidAt: new Date() },
        }),
      ]);
      return { ok: true, method, credited, note: `Đã cộng ${credited}đ vào Ví Tubu (×${multiplier}).` };
    }

    // Rút về STK ngân hàng.
    if (amount < minWithdraw) {
      throw new BadRequestException(`Số tiền rút tối thiểu ${minWithdraw.toLocaleString('vi-VN')}đ.`);
    }
    const payout = await this.prisma.$transaction(async (tx) => {
      const p = await tx.payout.create({
        data: { userId, amount, method: 'BANK', bankInfo: bankInfo ?? {}, status: 'REQUESTED' },
      });
      // đánh dấu commission sẽ trả trong batch này
      await tx.commission.updateMany({
        where: { affiliateUserId: userId, status: 'APPROVED' },
        data: { payoutBatchId: p.id },
      });
      return p;
    });
    return { ok: true, payoutId: payout.id, status: 'REQUESTED' };
  }

  /** Cron mỗi giờ: LOCKED quá hold_days → APPROVED. */
  @Cron('0 0 * * * *')
  async approveDueCommissions(): Promise<void> {
    const holdDays = await this.config.get<number>('affiliate.hold_days', 20);
    const threshold = new Date(Date.now() - holdDays * 24 * 3600 * 1000);
    const res = await this.prisma.commission.updateMany({
      where: { status: 'LOCKED', lockedAt: { lte: threshold } },
      data: { status: 'APPROVED', approvedAt: new Date() },
    });
    if (res.count > 0) this.logger.log(`Duyệt ${res.count} commission hết hold.`);
  }

  // ── Helpers ──
  private async sumCommission(userId: string, since: Date): Promise<number> {
    const agg = await this.prisma.commission.aggregate({
      where: { affiliateUserId: userId, createdAt: { gte: since } },
      _sum: { amount: true },
    });
    return agg._sum.amount ?? 0;
  }

  private markCommissionsPaid(userId: string, _amount: number) {
    return this.prisma.commission.updateMany({
      where: { affiliateUserId: userId, status: 'APPROVED' },
      data: { status: 'PAID', paidAt: new Date() },
    });
  }
}
