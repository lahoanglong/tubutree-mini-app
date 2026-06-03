import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import type { OrderStatus } from '@tubutree/shared-types';
import { PrismaService } from '../../prisma/prisma.service';
import { paginated, skipTake } from '../../common/pagination';
import { LoyaltyService } from '../loyalty/loyalty.service';
import { CartService } from '../cart/cart.service';
import { NotificationsService } from '../notifications/notifications.service';

@Injectable()
export class OrdersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly loyalty: LoyaltyService,
    private readonly cart: CartService,
    private readonly notifications: NotificationsService,
  ) {}

  async list(userId: string, status: OrderStatus | undefined, page: number, limit: number) {
    const where = { userId, ...(status ? { status } : {}) };
    const [items, total] = await this.prisma.$transaction([
      this.prisma.order.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        ...skipTake(page, limit),
        include: { items: true },
      }),
      this.prisma.order.count({ where }),
    ]);
    return paginated(items, page, limit, total);
  }

  async detail(userId: string, code: string) {
    const order = await this.prisma.order.findUnique({
      where: { code },
      include: { items: true },
    });
    if (!order || order.userId !== userId) throw new NotFoundException('Không tìm thấy đơn hàng.');
    return order;
  }

  async cancel(userId: string, code: string) {
    const order = await this.detail(userId, code);
    if (order.status !== 'PENDING_PAYMENT' && order.status !== 'CONFIRMED') {
      throw new BadRequestException(
        'Đơn đã vào quy trình giao, vui lòng liên hệ Zalo OA để được hỗ trợ.',
      );
    }
    await this.prisma.order.update({ where: { id: order.id }, data: { status: 'CANCELLED' } });
    await this.loyalty.reverseOrderPoints(order.id);
    // hoàn ví nếu đã thanh toán bằng ví
    if (order.paymentMethod === 'WALLET' && order.paymentStatus === 'PAID') {
      await this.prisma.user.update({
        where: { id: userId },
        data: { walletBalance: { increment: order.total } },
      });
    }
    await this.notifications.notify(userId, 'ORDER_CANCELLED', { order_code: code });
    return this.detail(userId, code);
  }

  async repurchase(userId: string, code: string) {
    const order = await this.detail(userId, code);
    for (const item of order.items) {
      const variation = await this.prisma.variation.findUnique({ where: { id: item.variationId } });
      if (variation && variation.isActive && variation.stock > 0) {
        await this.cart.addItem(userId, {
          variationId: item.variationId,
          quantity: Math.min(item.quantity, variation.stock),
        });
      }
    }
    return this.cart.getCart(userId);
  }

  async issueInvoice(userId: string, code: string) {
    const order = await this.detail(userId, code);
    if (!order.invoiceRequest) {
      throw new BadRequestException('Đơn này chưa có yêu cầu xuất hóa đơn VAT.');
    }
    await this.prisma.order.update({
      where: { id: order.id },
      data: { invoiceStatus: 'REQUESTED' },
    });
    return { ok: true, message: 'Đã gửi yêu cầu phát hành hóa đơn.' };
  }

  /** Force refetch trạng thái từ Pancake (Phase 1: trả trạng thái hiện tại; bổ sung poll khi có key). */
  async track(userId: string, code: string) {
    const order = await this.detail(userId, code);
    return {
      code: order.code,
      status: order.status,
      shippingStatus: order.shippingStatus,
      shippingCode: order.shippingCode,
      shippingHistory: order.shippingHistory ?? [],
    };
  }
}
