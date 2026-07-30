import { BadRequestException, ForbiddenException, Injectable, Logger, Optional } from '@nestjs/common';
import { randomInt } from 'node:crypto';
import type { PrismaService } from '../../prisma/prisma.service';
import type { SystemConfigService } from '../system-config/system-config.service';
import type { NotificationsService } from '../notifications/notifications.service';
import type { ApplyDealerDto, DealerOrderDto } from './dto/dealer.dto';

interface BonusTier {
  min: number;
  pct: number;
}

/** Tính phần thưởng cho 1 mức doanh số theo bậc (thuần). */
function bonusForRevenue(revenue: number, sortedTiers: BonusTier[]) {
  const reached = [...sortedTiers].reverse().find((t) => revenue >= t.min) ?? null;
  const next = sortedTiers.find((t) => revenue < t.min) ?? null;
  const bonusPct = reached?.pct ?? 0;
  return { bonusPct, bonusAmount: Math.round((revenue * bonusPct) / 100), reached, next };
}

/**
 * Đại lý B2B (Build Spec §6.x, §15 dealer.*).
 * Giá đại lý = giá lẻ × (1 - chiết khấu bậc), kẹp theo dealer.max_discount_pct.
 * Đơn B2B có thể ghi công nợ (DealerCreditLedger).
 */
@Injectable()
export class DealerService {
  private readonly logger = new Logger(DealerService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: SystemConfigService,
    @Optional() private readonly notifications?: NotificationsService,
  ) {}

  async apply(userId: string, dto: ApplyDealerDto) {
    const pending = await this.prisma.dealerApplication.findFirst({
      where: { userId, status: 'PENDING' },
    });
    if (pending) throw new BadRequestException('Bạn đã có đơn đăng ký đang chờ duyệt.');
    return this.prisma.dealerApplication.create({ data: { ...dto, userId } });
  }

  async getMe(userId: string) {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    const application = await this.prisma.dealerApplication.findFirst({
      where: { userId },
      orderBy: { createdAt: 'desc' },
    });
    const tier = user.metadata && (user.metadata as { dealerTierId?: string }).dealerTierId
      ? await this.prisma.dealerTier.findUnique({
          where: { id: (user.metadata as { dealerTierId: string }).dealerTierId },
        })
      : null;
    const creditAgg = await this.prisma.dealerCreditLedger.aggregate({
      where: { userId },
      _sum: { delta: true },
    });
    return {
      isDealer: user.role === 'DEALER',
      status: application?.status ?? 'NONE',
      tier: tier ? { id: tier.id, name: tier.name, creditLimit: tier.creditLimit } : null,
      currentDebt: creditAgg._sum.delta ?? 0,
    };
  }

  /** Bảng giá đại lý theo bậc của user. */
  async pricelist(userId: string) {
    const { discountPct, tier } = await this.dealerContext(userId);
    const variations = await this.prisma.variation.findMany({
      where: { isActive: true },
      include: { product: { select: { name: true, brand: true } } },
    });
    return variations.map((v) => {
      const dealerPrice = this.unitPrice(v, tier?.id, discountPct);
      return {
        variationId: v.id,
        sku: v.sku,
        product: v.product.name,
        brand: v.product.brand,
        variation: v.name,
        retailPrice: v.retailPrice,
        dealerPrice,
        discountPct: Math.round(discountPct * 100),
        stock: v.stock,
      };
    });
  }

  async placeOrder(userId: string, dto: DealerOrderDto) {
    const { discountPct, tier } = await this.dealerContext(userId);
    if (dto.items.length === 0) throw new BadRequestException('Đơn trống.');

    const variations = await this.prisma.variation.findMany({
      where: { id: { in: dto.items.map((i) => i.variationId) } },
      include: { product: { select: { name: true } } },
    });
    const vmap = new Map(variations.map((v) => [v.id, v]));

    let subtotal = 0;
    const items = dto.items.map((line) => {
      const v = vmap.get(line.variationId);
      if (!v) throw new BadRequestException(`Sản phẩm ${line.variationId} không tồn tại.`);
      const unitPrice = this.unitPrice(v, tier?.id, discountPct);
      const total = unitPrice * line.quantity;
      subtotal += total;
      return {
        variationId: v.id,
        productName: v.product.name,
        variationName: v.name,
        unitPrice,
        quantity: line.quantity,
        total,
      };
    });

    const onCredit = dto.paymentMethod === 'CREDIT';
    // Fast-fail thân thiện (không tốn generateCode khi rõ ràng vượt). Check
    // QUYẾT ĐỊNH nằm trong transaction Serializable bên dưới để chống TOCTOU.
    if (onCredit && tier) {
      const pre = await this.prisma.dealerCreditLedger.aggregate({ where: { userId }, _sum: { delta: true } });
      if ((pre._sum.delta ?? 0) + subtotal > tier.creditLimit) {
        throw new BadRequestException('Vượt hạn mức công nợ.');
      }
    }

    const code = await this.generateCode();
    let order: Awaited<ReturnType<typeof this.prisma.order.create>>;
    try {
      order = await this.prisma.$transaction(
        async (tx) => {
          // Kiểm tra hạn mức công nợ TRONG transaction Serializable: 2 đơn CREDIT
          // đồng thời không thể cùng vượt trần (một trong hai sẽ serialization-fail).
          if (onCredit && tier) {
            const agg = await tx.dealerCreditLedger.aggregate({ where: { userId }, _sum: { delta: true } });
            const debt = agg._sum.delta ?? 0;
            if (debt + subtotal > tier.creditLimit) throw new BadRequestException('Vượt hạn mức công nợ.');
          }
          const created = await tx.order.create({
            data: {
              code,
              userId,
              type: 'DEALER',
              status: onCredit ? 'CONFIRMED' : 'PENDING_PAYMENT',
              subtotal,
              discount: 0,
              shippingFee: 0,
              total: subtotal,
              paymentMethod: 'BANK_TRANSFER',
              paymentStatus: 'UNPAID',
              shippingAddress: { note: 'Giao theo hợp đồng đại lý' },
              note: dto.note,
              items: { create: items },
            },
          });
          if (onCredit) {
            await tx.dealerCreditLedger.create({
              data: { userId, delta: subtotal, refType: 'ORDER', refId: created.id, note: `Đơn ${code}` },
            });
          }
          return created;
        },
        onCredit ? { isolationLevel: 'Serializable' } : undefined,
      );
    } catch (err) {
      // P2034: serialization failure — 2 đơn CREDIT chạm nhau. Báo thử lại thay vì 500.
      if (typeof err === 'object' && err !== null && (err as { code?: string }).code === 'P2034') {
        throw new BadRequestException('Hệ thống đang bận xử lý đơn công nợ, vui lòng thử lại.');
      }
      throw err;
    }
    return this.prisma.order.findUniqueOrThrow({ where: { id: order.id }, include: { items: true } });
  }

  listOrders(userId: string) {
    return this.prisma.order.findMany({
      where: { userId, type: 'DEALER' },
      orderBy: { createdAt: 'desc' },
      include: { items: true },
      take: 100,
    });
  }

  async creditLedger(userId: string) {
    const entries = await this.prisma.dealerCreditLedger.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      take: 200,
    });
    const balance = entries.reduce((s, e) => s + e.delta, 0);
    return { balance, entries };
  }

  async creditPayment(userId: string, amount: number, note?: string) {
    if (amount <= 0) throw new BadRequestException('Số tiền không hợp lệ.');
    await this.prisma.dealerCreditLedger.create({
      data: { userId, delta: -amount, refType: 'PAYMENT', note: note ?? 'Thanh toán công nợ' },
    });
    return this.creditLedger(userId);
  }

  /** Chênh lệch giờ VN (UTC+7) so với UTC — mốc quý/năm tính theo giờ tường VN, độc lập TZ máy chủ. */
  private static readonly VN_OFFSET = 7 * 60 * 60 * 1000;

  /** Mốc UTC [start, end) của quý `q` (0..3) năm `year`, theo giờ VN. */
  private static vnQuarterRange(year: number, q: number) {
    const VN = DealerService.VN_OFFSET;
    return {
      start: new Date(Date.UTC(year, q * 3, 1) - VN),
      end: new Date(Date.UTC(year, q * 3 + 3, 1) - VN),
    };
  }

  /**
   * Quý/năm HIỆN TẠI theo giờ VN + mốc UTC [start,end) của quý và của năm.
   * Dùng chung cho quarterlyReport / rewardsProgress / payoutQuarterlyBonuses (tránh lệch mốc).
   */
  private vnPeriodBounds(now: Date) {
    const VN = DealerService.VN_OFFSET;
    const vnNow = new Date(now.getTime() + VN); // giờ tường VN, đọc qua các field UTC*
    const q = Math.floor(vnNow.getUTCMonth() / 3); // 0..3
    const year = vnNow.getUTCFullYear();
    const quarter = DealerService.vnQuarterRange(year, q);
    return {
      q,
      year,
      qStart: quarter.start,
      qEnd: quarter.end,
      yStart: new Date(Date.UTC(year, 0, 1) - VN),
      yEnd: new Date(Date.UTC(year + 1, 0, 1) - VN),
    };
  }

  /**
   * Báo cáo quý đại lý (#71): doanh số quý hiện tại (đơn DEALER không huỷ) + bậc thưởng đạt được.
   * Bậc thưởng lấy từ config dealer.quarterly_bonus_tiers (mặc định 50tr→2%, 100tr→3%, 200tr→4%).
   */
  async quarterlyReport(userId: string) {
    await this.dealerContext(userId); // chặn nếu chưa phải đại lý
    const { q, year, qStart: start, qEnd: end } = this.vnPeriodBounds(new Date());

    const agg = await this.prisma.order.aggregate({
      where: {
        userId,
        type: 'DEALER',
        status: { notIn: ['CANCELLED', 'RETURNED'] },
        createdAt: { gte: start, lt: end },
      },
      _sum: { total: true },
      _count: true,
    });
    const revenue = agg._sum.total ?? 0;

    const sorted = await this.bonusTiers();
    const { bonusPct, bonusAmount, next } = bonusForRevenue(revenue, sorted);

    return {
      quarter: `Q${q + 1}/${year}`,
      periodStart: start.toISOString(),
      periodEnd: end.toISOString(),
      revenue,
      orderCount: agg._count,
      bonusPct,
      bonusAmount,
      nextTier: next ? { min: next.min, pct: next.pct, toNext: next.min - revenue } : null,
      tiers: sorted,
    };
  }

  /**
   * Tiến trình đạt mốc DealerReward (#hoãn): đối chiếu doanh số nhập kỳ (quý/năm theo giờ VN)
   * với điều kiện từng phần thưởng → hiển thị cho đại lý. CHỈ hiển thị điều kiện + tiến trình;
   * trao thưởng (tour/quà) admin làm offline. `now` truyền vào để test tất định.
   */
  async rewardsProgress(userId: string, now: Date = new Date()) {
    await this.dealerContext(userId); // chặn nếu chưa phải đại lý
    const { q, year, qStart, qEnd, yStart, yEnd } = this.vnPeriodBounds(now);
    const base = { userId, type: 'DEALER' as const, status: { notIn: ['CANCELLED', 'RETURNED'] as ('CANCELLED' | 'RETURNED')[] } };
    const [qAgg, yAgg] = await Promise.all([
      this.prisma.order.aggregate({ where: { ...base, createdAt: { gte: qStart, lt: qEnd } }, _sum: { total: true } }),
      this.prisma.order.aggregate({ where: { ...base, createdAt: { gte: yStart, lt: yEnd } }, _sum: { total: true } }),
    ]);
    const quarterVolume = qAgg._sum.total ?? 0;
    const yearVolume = yAgg._sum.total ?? 0;
    const rewards = await this.prisma.dealerReward.findMany({
      where: { isActive: true },
      orderBy: [{ sortOrder: 'asc' }],
    });
    return {
      quarter: `Q${q + 1}/${year}`,
      year,
      quarterVolume,
      yearVolume,
      rewards: rewards.map((r) => {
        const volume = r.period === 'YEAR' ? yearVolume : quarterVolume;
        return {
          id: r.id,
          type: r.type,
          title: r.title,
          description: r.description,
          threshold: r.threshold,
          period: r.period,
          volume,
          achieved: volume >= r.threshold,
          toGo: Math.max(0, r.threshold - volume),
        };
      }),
    };
  }

  private async bonusTiers(): Promise<BonusTier[]> {
    const tiers = await this.config.get<BonusTier[]>('dealer.quarterly_bonus_tiers', [
      { min: 50_000_000, pct: 2 },
      { min: 100_000_000, pct: 3 },
      { min: 200_000_000, pct: 4 },
    ]);
    return [...tiers].sort((a, b) => a.min - b.min);
  }

  /**
   * Cron (đầu mỗi quý): trả thưởng doanh số cho quý VỪA KẾT THÚC cho mọi đại lý.
   * Thưởng ghi vào DealerCreditLedger delta ÂM (giảm công nợ) — nhất quán với creditPayment.
   * Idempotent theo (userId, refType=QUARTER_BONUS, refId=quý) → cron chạy lại không cộng trùng.
   */
  async payoutQuarterlyBonuses(now: Date = new Date()): Promise<{ paid: number; quarter: string }> {
    const cur = this.vnPeriodBounds(now);
    let q = cur.q - 1; // quý TRƯỚC (vừa kết thúc)
    let year = cur.year;
    if (q < 0) {
      q = 3;
      year -= 1;
    }
    const { start, end } = DealerService.vnQuarterRange(year, q);
    const quarter = `Q${q + 1}/${year}`;

    const sorted = await this.bonusTiers();
    const dealers = await this.prisma.user.findMany({ where: { role: 'DEALER' }, select: { id: true } });

    let paid = 0;
    for (const d of dealers) {
      const agg = await this.prisma.order.aggregate({
        where: { userId: d.id, type: 'DEALER', status: { notIn: ['CANCELLED', 'RETURNED'] }, createdAt: { gte: start, lt: end } },
        _sum: { total: true },
      });
      const revenue = agg._sum.total ?? 0;
      const { bonusAmount } = bonusForRevenue(revenue, sorted);
      if (bonusAmount <= 0) continue;

      // Idempotent: đã trả thưởng quý này cho đại lý này thì bỏ qua.
      const existed = await this.prisma.dealerCreditLedger.findFirst({
        where: { userId: d.id, refType: 'QUARTER_BONUS', refId: quarter },
        select: { id: true },
      });
      if (existed) continue;

      await this.prisma.dealerCreditLedger.create({
        data: { userId: d.id, delta: -bonusAmount, refType: 'QUARTER_BONUS', refId: quarter, note: `Thưởng doanh số ${quarter}` },
      });
      if (this.notifications) {
        await this.notifications
          .notify(d.id, 'DEALER_BONUS_PAID', {
            quarter,
            amount: bonusAmount.toLocaleString('vi-VN'),
            revenue: revenue.toLocaleString('vi-VN'),
          })
          .catch((e) => this.logger.warn(`notify thưởng quý lỗi (${d.id}): ${(e as Error).message}`));
      }
      paid += 1;
    }
    if (paid > 0) this.logger.log(`Đã trả thưởng quý ${quarter} cho ${paid} đại lý.`);
    return { paid, quarter };
  }

  // ── Mẫu đơn lưu sẵn (#64) ──
  async listTemplates(userId: string) {
    await this.dealerContext(userId);
    return this.prisma.dealerOrderTemplate.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
  }

  async saveTemplate(userId: string, name: string, items: { variationId: string; quantity: number }[]) {
    await this.dealerContext(userId);
    const clean = (items ?? [])
      .filter((i) => i?.variationId && Number(i.quantity) > 0)
      .map((i) => ({ variationId: String(i.variationId), quantity: Math.floor(Number(i.quantity)) }));
    if (clean.length === 0) throw new BadRequestException('Mẫu đơn trống.');
    return this.prisma.dealerOrderTemplate.create({
      data: { userId, name: name.trim() || 'Mẫu đơn', items: clean },
    });
  }

  async deleteTemplate(userId: string, id: string) {
    await this.dealerContext(userId);
    // deleteMany theo (id,userId) → chỉ xoá mẫu của chính mình, không lộ mẫu người khác.
    const res = await this.prisma.dealerOrderTemplate.deleteMany({ where: { id, userId } });
    if (res.count === 0) throw new BadRequestException('Không tìm thấy mẫu đơn.');
    return { ok: true };
  }

  // ── Helpers ──
  /**
   * Giá đại lý cho 1 variation: ƯU TIÊN giá riêng theo bậc đã nhập (Variation.dealerPrices[tierId]),
   * fallback giá lẻ × (1 - chiết khấu bậc). Cho phép admin đặt giá B2B cố định khác công thức %.
   */
  private unitPrice(
    v: { retailPrice: number; dealerPrices?: unknown },
    tierId: string | undefined,
    discountPct: number,
  ): number {
    const override = tierId ? (v.dealerPrices as Record<string, number> | null)?.[tierId] : undefined;
    if (typeof override === 'number' && override > 0) return override;
    return Math.round(v.retailPrice * (1 - discountPct));
  }

  private async dealerContext(userId: string) {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    if (user.role !== 'DEALER') throw new ForbiddenException('Tài khoản chưa được duyệt làm đại lý.');
    const tierId = (user.metadata as { dealerTierId?: string } | null)?.dealerTierId;
    const tier = tierId ? await this.prisma.dealerTier.findUnique({ where: { id: tierId } }) : null;

    const maxDiscount = await this.config.get<number>('dealer.max_discount_pct', 0.45);
    const rules = (tier?.discountRules as { default?: number } | undefined) ?? {};
    const discountPct = Math.min(rules.default ?? 0.2, maxDiscount);
    return { discountPct, tier };
  }

  private async generateCode(): Promise<string> {
    for (let i = 0; i < 6; i++) {
      const code = `DLR${Date.now().toString().slice(-8)}${String(randomInt(0, 1000)).padStart(3, '0')}`;
      const exists = await this.prisma.order.findUnique({ where: { code } });
      if (!exists) return code;
    }
    return `DLR${Date.now()}`;
  }
}
