import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { randomInt } from 'node:crypto';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { SystemConfigService } from '../system-config/system-config.service';
import { PricingService } from '../pricing/pricing.service';
import { LoyaltyService } from '../loyalty/loyalty.service';
import { NotificationsService } from '../notifications/notifications.service';

interface CreateSubInput {
  variationId: string;
  quantity: number;
  intervalWeeks: number;
  addressId: string;
}

/**
 * Subscribe & Save (Build Spec §6.14.4): đặt định kỳ 4/6/8/10 tuần, giảm subscribe.discount_pct (12%).
 * Cron tạo đơn COD tự động khi đến hạn → user skip/pause/cancel bất kỳ lúc nào.
 */
@Injectable()
export class SubscriptionsService {
  private readonly logger = new Logger(SubscriptionsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: SystemConfigService,
    private readonly pricing: PricingService,
    private readonly loyalty: LoyaltyService,
    private readonly notifications: NotificationsService,
  ) {}

  async create(userId: string, dto: CreateSubInput) {
    if (![4, 6, 8, 10].includes(dto.intervalWeeks)) {
      throw new BadRequestException('Chu kỳ chỉ nhận 4/6/8/10 tuần.');
    }
    const variation = await this.prisma.variation.findUnique({ where: { id: dto.variationId } });
    if (!variation || !variation.isActive) throw new BadRequestException('Sản phẩm không khả dụng.');
    const address = await this.prisma.address.findUnique({ where: { id: dto.addressId } });
    if (!address || address.userId !== userId) throw new BadRequestException('Địa chỉ không hợp lệ.');

    return this.prisma.subscription.create({
      data: {
        userId,
        variationId: dto.variationId,
        quantity: Math.max(1, dto.quantity),
        intervalWeeks: dto.intervalWeeks,
        addressId: dto.addressId,
        nextRunAt: this.addWeeks(new Date(), dto.intervalWeeks),
      },
    });
  }

  list(userId: string) {
    return this.prisma.subscription.findMany({
      where: { userId, status: { not: 'CANCELLED' } },
      orderBy: { createdAt: 'desc' },
    });
  }

  async setStatus(userId: string, id: string, status: 'ACTIVE' | 'PAUSED' | 'CANCELLED') {
    const sub = await this.prisma.subscription.findUnique({ where: { id } });
    if (!sub || sub.userId !== userId) throw new NotFoundException('Không tìm thấy lịch đặt định kỳ.');
    // Khi bật lại từ PAUSED, dời nextRunAt tới chu kỳ kế nếu đã quá hạn.
    const nextRunAt =
      status === 'ACTIVE' && sub.nextRunAt < new Date()
        ? this.addWeeks(new Date(), sub.intervalWeeks)
        : sub.nextRunAt;
    return this.prisma.subscription.update({ where: { id }, data: { status, nextRunAt } });
  }

  /** Cron 3h sáng: xử lý các subscription đến hạn → tạo đơn COD + dời chu kỳ. */
  @Cron('0 3 * * *')
  async processDue(): Promise<void> {
    const due = await this.prisma.subscription.findMany({
      where: { status: 'ACTIVE', nextRunAt: { lte: new Date() } },
      take: 200,
    });
    let created = 0;
    for (const sub of due) {
      try {
        await this.createOrderFor(sub);
        await this.prisma.subscription.update({
          where: { id: sub.id },
          data: { nextRunAt: this.addWeeks(new Date(), sub.intervalWeeks) },
        });
        created++;
      } catch (err) {
        this.logger.error(`Subscription ${sub.id} lỗi: ${err instanceof Error ? err.message : err}`);
      }
    }
    if (created) this.logger.log(`Subscription orders created: ${created}`);
  }

  private async createOrderFor(sub: {
    id: string;
    userId: string;
    variationId: string;
    quantity: number;
    addressId: string;
  }): Promise<void> {
    const variation = await this.prisma.variation.findUnique({
      where: { id: sub.variationId },
      include: { product: { select: { name: true } } },
    });
    if (!variation || !variation.isActive) {
      // SP ngừng bán → tạm dừng lịch + báo user.
      await this.prisma.subscription.update({ where: { id: sub.id }, data: { status: 'PAUSED' } });
      await this.notifications.notify(sub.userId, 'SUBSCRIPTION_PAUSED', {}).catch(() => undefined);
      return;
    }
    const addr = await this.prisma.address.findUnique({ where: { id: sub.addressId } });
    if (!addr || addr.userId !== sub.userId) {
      await this.prisma.subscription.update({ where: { id: sub.id }, data: { status: 'PAUSED' } });
      await this.notifications.notify(sub.userId, 'SUBSCRIPTION_PAUSED', {}).catch(() => undefined);
      return;
    }
    const address: Prisma.InputJsonValue = {
      recipient: addr.recipient,
      phone: addr.phone,
      province: addr.province,
      district: addr.district,
      ward: addr.ward,
      street: addr.street,
      provinceCode: addr.provinceCode,
      districtCode: addr.districtCode,
      wardCode: addr.wardCode,
    };
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: sub.userId } });

    const unitPrice = variation.salePrice ?? variation.retailPrice;
    const subtotal = unitPrice * sub.quantity;
    const discountPct = await this.config.get<number>('subscribe.discount_pct', 0.12);
    const discount = Math.floor(subtotal * discountPct);
    const goods = Math.max(0, subtotal - discount);
    const shippingFee = await this.pricing.calcShippingFee({ subtotal, tierId: user.tierId });
    const multiplier = await this.loyalty.getTierMultiplier(user.tierId);
    const pointsEarned = await this.pricing.calcPointsEarned(goods, multiplier);
    const total = goods + shippingFee;
    const code = await this.generateCode();

    const order = await this.prisma.order.create({
      data: {
        code,
        userId: sub.userId,
        type: 'RETAIL',
        status: 'CONFIRMED',
        subtotal,
        discount,
        shippingFee,
        total,
        pointsEarned,
        paymentMethod: 'COD',
        paymentStatus: 'UNPAID',
        shippingAddress: address,
        note: 'Đơn đặt định kỳ (Subscribe & Save)',
        items: {
          create: [
            {
              variationId: variation.id,
              productName: variation.product.name,
              variationName: variation.name,
              unitPrice,
              quantity: sub.quantity,
              total: subtotal,
            },
          ],
        },
      },
    });
    await this.prisma.subscription.update({ where: { id: sub.id }, data: { lastOrderId: order.id } });
    await this.notifications.notify(sub.userId, 'SUBSCRIPTION_ORDER', { order_code: code }).catch(() => undefined);
  }

  private addWeeks(from: Date, weeks: number): Date {
    return new Date(from.getTime() + weeks * 7 * 864e5);
  }

  private async generateCode(): Promise<string> {
    for (let i = 0; i < 6; i++) {
      const code = `TUBUSUB${Date.now().toString().slice(-7)}${String(randomInt(0, 1000)).padStart(3, '0')}`;
      const exists = await this.prisma.order.findUnique({ where: { code } });
      if (!exists) return code;
    }
    return `TUBUSUB${Date.now()}`;
  }
}
