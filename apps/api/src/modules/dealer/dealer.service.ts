import { BadRequestException, ForbiddenException, Injectable } from '@nestjs/common';
import { randomInt } from 'node:crypto';
import { PrismaService } from '../../prisma/prisma.service';
import { SystemConfigService } from '../system-config/system-config.service';
import { ApplyDealerDto, DealerOrderDto } from './dto/dealer.dto';

/**
 * Đại lý B2B (Build Spec §6.x, §15 dealer.*).
 * Giá đại lý = giá lẻ × (1 - chiết khấu bậc), kẹp theo dealer.max_discount_pct.
 * Đơn B2B có thể ghi công nợ (DealerCreditLedger).
 */
@Injectable()
export class DealerService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: SystemConfigService,
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
    const { discountPct } = await this.dealerContext(userId);
    const variations = await this.prisma.variation.findMany({
      where: { isActive: true },
      include: { product: { select: { name: true, brand: true } } },
    });
    return variations.map((v) => {
      const dealerPrice = Math.round(v.retailPrice * (1 - discountPct));
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
      const unitPrice = Math.round(v.retailPrice * (1 - discountPct));
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

  /**
   * Báo cáo quý đại lý (#71): doanh số quý hiện tại (đơn DEALER không huỷ) + bậc thưởng đạt được.
   * Bậc thưởng lấy từ config dealer.quarterly_bonus_tiers (mặc định 50tr→2%, 100tr→3%, 200tr→4%).
   */
  async quarterlyReport(userId: string) {
    await this.dealerContext(userId); // chặn nếu chưa phải đại lý
    const now = new Date();
    const q = Math.floor(now.getMonth() / 3); // 0..3
    const start = new Date(now.getFullYear(), q * 3, 1);
    const end = new Date(now.getFullYear(), q * 3 + 3, 1);

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

    const tiers = await this.config.get<{ min: number; pct: number }[]>('dealer.quarterly_bonus_tiers', [
      { min: 50_000_000, pct: 2 },
      { min: 100_000_000, pct: 3 },
      { min: 200_000_000, pct: 4 },
    ]);
    const sorted = [...tiers].sort((a, b) => a.min - b.min);
    const reached = [...sorted].reverse().find((t) => revenue >= t.min) ?? null;
    const next = sorted.find((t) => revenue < t.min) ?? null;
    const bonusPct = reached?.pct ?? 0;
    const bonusAmount = Math.round((revenue * bonusPct) / 100);

    return {
      quarter: `Q${q + 1}/${now.getFullYear()}`,
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
