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
    if (onCredit && tier) {
      const creditAgg = await this.prisma.dealerCreditLedger.aggregate({
        where: { userId },
        _sum: { delta: true },
      });
      const currentDebt = creditAgg._sum.delta ?? 0;
      if (currentDebt + subtotal > tier.creditLimit) {
        throw new BadRequestException('Vượt hạn mức công nợ.');
      }
    }

    const code = await this.generateCode();
    const order = await this.prisma.$transaction(async (tx) => {
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
          paymentMethod: onCredit ? 'BANK_TRANSFER' : 'BANK_TRANSFER',
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
    });
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
