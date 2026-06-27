import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { CommissionStatus } from '@prisma/client';
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

  /**
   * Ghi "chạm" giới thiệu (attribution last-touch persistent §quyết-định). Khi khách (đã đăng nhập)
   * mở link CTV/nhãn → lưu referrerUserId + slug, hạn = now + config(attribution_days, mặc định 3).
   * Mỗi lần mở làm mới hạn. Bỏ qua nếu thiếu code / code không tồn tại / trỏ chính mình.
   */
  async recordTouch(
    userId: string,
    dto: { referralCode?: string; storefrontSlug?: string; kind?: string },
    now: Date = new Date(),
  ): Promise<{ ok: boolean }> {
    if (!dto.referralCode) return { ok: false };
    const ref = await this.prisma.user.findUnique({
      where: { referralCode: dto.referralCode },
      select: { id: true },
    });
    if (!ref || ref.id === userId) return { ok: false };
    const days = await this.config.get<number>('affiliate.attribution_days', 3);
    const expiresAt = new Date(now.getTime() + days * 24 * 60 * 60 * 1000);
    const data = {
      referrerUserId: ref.id,
      storefrontSlug: dto.storefrontSlug ?? null,
      kind: dto.kind ?? 'ctv',
      expiresAt,
    };
    await this.prisma.referralTouch.upsert({
      where: { userId },
      update: data,
      create: { userId, ...data },
    });
    return { ok: true };
  }

  /** Lấy "chạm" còn hạn của khách (fallback attribution khi phiên đã mất). */
  async getActiveTouch(
    userId: string,
    now: Date = new Date(),
  ): Promise<{ referrerUserId: string; storefrontSlug: string | null; kind: string } | null> {
    const t = await this.prisma.referralTouch.findUnique({ where: { userId } });
    if (!t || t.expiresAt <= now) return null;
    return { referrerUserId: t.referrerUserId, storefrontSlug: t.storefrontSlug, kind: t.kind };
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
        where: { affiliateUserId: userId, status: 'APPROVED', payoutBatchId: null },
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

  /**
   * Refer-reward MỘT LẦN (tách khỏi hoa hồng %): đơn DELIVERED có người giới thiệu →
   * thưởng voucher cho cả người mời và người được mời. Idempotent qua coupon.code @unique:
   * mỗi cặp (mời, được-mời) thưởng 1 lần; mỗi người-được-mời nhận welcome-giới-thiệu 1 lần.
   */
  async grantReferralReward(orderId: string): Promise<void> {
    const order = await this.prisma.order.findUniqueOrThrow({ where: { id: orderId } });
    const referrerId = order.referrerUserId;
    if (!referrerId || referrerId === order.userId) return;

    // §6.14.5: chỉ kích hoạt khi đơn (đầu) của người được mời ≥ ngưỡng (mặc định 200k).
    const minOrder = await this.config.get<number>('referral.min_order_amount', 200000);
    if (order.total < minOrder) return;

    const refereeId = order.userId;
    // §6.14.5: CẢ hai nhận voucher 50k. Voucher áp cho đơn ≥ minOrder.
    const referrerAmount = await this.config.get<number>('referral.referrer_reward_amount', 50000);
    const refereeAmount = await this.config.get<number>('referral.referee_reward_amount', 50000);
    await this.grantReferralVoucher(referrerId, `REFER-${referrerId}-${refereeId}`, referrerAmount, minOrder);
    await this.grantReferralVoucher(refereeId, `REFERRED-${refereeId}`, refereeAmount, minOrder);
  }

  /** Cấp voucher cá nhân AMOUNT (USER_GROUP). Idempotent: code deterministic + catch P2002. */
  private async grantReferralVoucher(
    userId: string,
    rawCode: string,
    amount: number,
    minOrder: number,
  ): Promise<void> {
    if (amount <= 0) return;
    const code = rawCode.toUpperCase();
    const existing = await this.prisma.coupon.findUnique({ where: { code } });
    if (existing) return;
    const now = new Date();
    const endAt = new Date(now.getTime() + 30 * 864e5);
    try {
      await this.prisma.coupon.create({
        data: {
          code,
          type: 'AMOUNT',
          value: amount,
          minOrder,
          startAt: now,
          endAt,
          usageLimit: 1,
          perUserLimit: 1,
          scope: 'USER_GROUP',
          scopeMeta: { userId },
        },
      });
    } catch (err) {
      // Race: instance khác vừa cấp cùng code → coi như đã thưởng.
      if (typeof err === 'object' && err !== null && (err as { code?: string }).code === 'P2002') return;
      throw err;
    }
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

    // "Khả dụng" = APPROVED và CHƯA thuộc batch payout nào (payoutBatchId null).
    const approved = await this.prisma.commission.aggregate({
      where: { affiliateUserId: userId, status: 'APPROVED', payoutBatchId: null },
      _sum: { amount: true },
    });
    const available = approved._sum.amount ?? 0;
    if (available <= 0) throw new BadRequestException('Không có hoa hồng khả dụng để rút.');
    if (amount > available) throw new BadRequestException('Số dư hoa hồng khả dụng không đủ.');

    // Rút = cash-out TOÀN BỘ hoa hồng khả dụng (commission là bản ghi rời rạc, không
    // tách lẻ theo số tiền tùy ý). credited tính theo tổng THỰC trong transaction →
    // không mất tiền; gate theo updateMany.count → không double-spend khi chạy đồng thời.
    if (method === 'WALLET_BALANCE') {
      const result = await this.prisma.$transaction(async (tx) => {
        const rows = await tx.commission.findMany({
          where: { affiliateUserId: userId, status: 'APPROVED', payoutBatchId: null },
          select: { id: true, amount: true },
        });
        const total = rows.reduce((s, c) => s + c.amount, 0);
        const marked = await tx.commission.updateMany({
          where: { id: { in: rows.map((r) => r.id) }, status: 'APPROVED', payoutBatchId: null },
          data: { status: 'PAID', paidAt: new Date() },
        });
        if (marked.count === 0 || total <= 0) throw new BadRequestException('Hoa hồng đã được xử lý.');
        const credited = Math.floor(total * multiplier);
        await tx.user.update({ where: { id: userId }, data: { walletBalance: { increment: credited } } });
        await tx.payout.create({
          data: { userId, amount: credited, method, status: 'PAID', paidAt: new Date() },
        });
        return { credited };
      });
      return {
        ok: true,
        method,
        credited: result.credited,
        note: `Đã cộng ${result.credited}đ vào Ví Tubu (×${multiplier}).`,
      };
    }

    // Rút về STK ngân hàng.
    if (amount < minWithdraw) {
      throw new BadRequestException(`Số tiền rút tối thiểu ${minWithdraw.toLocaleString('vi-VN')}đ.`);
    }
    const payout = await this.prisma.$transaction(async (tx) => {
      const rows = await tx.commission.findMany({
        where: { affiliateUserId: userId, status: 'APPROVED', payoutBatchId: null },
        select: { id: true, amount: true },
      });
      const total = rows.reduce((s, c) => s + c.amount, 0);
      if (total <= 0) throw new BadRequestException('Không có hoa hồng khả dụng để rút.');
      const p = await tx.payout.create({
        data: { userId, amount: total, method: 'BANK', bankInfo: bankInfo ?? {}, status: 'REQUESTED' },
      });
      // Gán batch + set PAID để loại khỏi "khả dụng" → chống rút trùng (gate theo count).
      const marked = await tx.commission.updateMany({
        where: { id: { in: rows.map((r) => r.id) }, status: 'APPROVED', payoutBatchId: null },
        data: { payoutBatchId: p.id, status: 'PAID', paidAt: new Date() },
      });
      if (marked.count === 0) throw new BadRequestException('Hoa hồng đã được xử lý.');
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

  /** Thống kê theo từng gian hàng của CTV (đơn có storefrontSlug thuộc tôi + referrer là tôi). */
  async storefrontAnalytics(userId: string) {
    const myStores = await this.prisma.storefront.findMany({
      where: { ownerUserId: userId }, select: { slug: true, title: true },
    });
    const out = [] as Array<{ slug: string; title?: string; orders: number; revenue: number; commission: number }>;
    for (const s of myStores) {
      const [orderAgg, commAgg] = await Promise.all([
        this.prisma.order.aggregate({
          where: { storefrontSlug: s.slug, referrerUserId: userId },
          _count: { _all: true }, _sum: { total: true },
        }),
        this.prisma.commission.aggregate({
          where: { affiliateUserId: userId, order: { storefrontSlug: s.slug } },
          _sum: { amount: true },
        }),
      ]);
      out.push({
        slug: s.slug, title: s.title,
        orders: orderAgg._count._all, revenue: orderAgg._sum.total ?? 0,
        commission: commAgg._sum.amount ?? 0,
      });
    }
    return { storefronts: out };
  }

  /** Phân rã hoa hồng theo sản phẩm (join Commission→Order.items, tính theo affiliateRate). */
  async productCommissionBreakdown(userId: string) {
    const commissions = await this.prisma.commission.findMany({
      where: { affiliateUserId: userId, status: { not: CommissionStatus.REJECTED } },
      include: { order: { include: { items: true } } },
      orderBy: { createdAt: 'desc' }, // cửa sổ 500 commission gần nhất (deterministic)
      take: 500,
    });
    const variationIds = [
      ...new Set(commissions.flatMap((c) => c.order?.items.map((i) => i.variationId) ?? [])),
    ];
    const variations = await this.prisma.variation.findMany({
      where: { id: { in: variationIds } }, select: { id: true, affiliateRate: true },
    });
    const rate = new Map(variations.map((v) => [v.id, v.affiliateRate ? Number(v.affiliateRate) : 0]));
    // Đếm đơn theo orderId riêng biệt (Set) — 1 đơn có 2 item cùng SP vẫn tính 1 đơn.
    const acc = new Map<string, { productName: string; commission: number; orderIds: Set<string> }>();
    for (const c of commissions) {
      for (const it of c.order?.items ?? []) {
        const r = rate.get(it.variationId) ?? 0;
        if (r <= 0) continue;
        const amount = Math.floor((it.total * r) / 100);
        const cur =
          acc.get(it.productName) ?? { productName: it.productName, commission: 0, orderIds: new Set<string>() };
        cur.commission += amount;
        cur.orderIds.add(c.orderId);
        acc.set(it.productName, cur);
      }
    }
    return [...acc.values()]
      .map((x) => ({ productName: x.productName, commission: x.commission, orders: x.orderIds.size }))
      .sort((a, b) => b.commission - a.commission);
  }

  // ── Helpers ──
  private async sumCommission(userId: string, since: Date): Promise<number> {
    const agg = await this.prisma.commission.aggregate({
      where: { affiliateUserId: userId, createdAt: { gte: since } },
      _sum: { amount: true },
    });
    return agg._sum.amount ?? 0;
  }

}
