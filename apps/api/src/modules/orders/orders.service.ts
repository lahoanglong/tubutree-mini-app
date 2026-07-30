import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import type { OrderStatus } from '@tubutree/shared-types';
import type { PrismaService } from '../../prisma/prisma.service';
import { paginated, skipTake } from '../../common/pagination';
import type { LoyaltyService } from '../loyalty/loyalty.service';
import type { CartService } from '../cart/cart.service';
import type { NotificationsService } from '../notifications/notifications.service';
import type { SystemConfigService } from '../system-config/system-config.service';
import type { FlashSaleService } from '../flash-sale/flash-sale.service';

@Injectable()
export class OrdersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly loyalty: LoyaltyService,
    private readonly cart: CartService,
    private readonly notifications: NotificationsService,
    private readonly config: SystemConfigService,
    private readonly flashSale: FlashSaleService,
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
    // Chuyển trạng thái ATOMIC (guard theo status) — chống hủy đồng thời (double-tap/retry) gây
    // HOÀN VÍ 2 LẦN: chỉ request THẮNG (count=1) mới hoàn điểm/ví. Nhất quán pattern atomic ở checkout.
    // Bọc flip-status + hoàn ví trong CÙNG $transaction để chống crash giữa chừng: nếu process chết
    // sau khi đơn đã CANCELLED nhưng trước khi increment ví → retry bị guard chặn → khách mất tiền.
    const won = await this.prisma.$transaction(async (tx) => {
      const res = await tx.order.updateMany({
        where: { id: order.id, status: { in: ['PENDING_PAYMENT', 'CONFIRMED'] } },
        data: { status: 'CANCELLED' },
      });
      if (res.count === 0) return false;
      // Refetch paymentStatus TRONG tx — snapshot `order.paymentStatus` (đọc ngoài tx ở detail())
      // có thể đã stale nếu webhook ZaloPay/Pancake chuyển REFUNDED giữa detail() và tx.
      // Dùng updateMany guard `paymentStatus: 'PAID'` để hoàn ví chỉ khi DB còn PAID — count=1
      // bảo đảm increment thực sự chạy trên đơn còn nợ tiền user.
      // Hoàn về Ví Tubu cho kênh prepaid (WALLET + ZALOPAY) đã PAID — nhất quán với
      // admin.reviewReturn (wasPaid gồm WALLET/ZALOPAY/COD). Trước đây chỉ WALLET → đơn
      // ZaloPay đã trả tiền thật mà user hủy thì KHÔNG được hoàn. COD lúc hủy luôn UNPAID
      // (chỉ PAID khi đã giao, mà đơn DELIVERED không hủy được) nên guard paymentStatus:'PAID'
      // tự loại COD; count=1 bảo đảm increment chỉ chạy đúng 1 lần ở nhánh thắng race.
      // XU: đơn trả bằng TubuXu → hoàn lại XU (coinsBalance) + ghi CoinTransaction(+total),
      // KHÔNG hoàn ví tiền thật (xu không rút được; hoàn vào ví = biến xu thành tiền rút được).
      // ⚠️ ZALOPAY hoàn vào Ví NỘI BỘ (không refund cổng) — nếu sau này thêm refund cổng phải
      // tránh hoàn 2 lần. Xem docs/ZALOPAY-SETUP.md §5.
      if (
        order.paymentMethod === 'WALLET' ||
        order.paymentMethod === 'ZALOPAY' ||
        order.paymentMethod === 'XU'
      ) {
        const refunded = await tx.order.updateMany({
          where: { id: order.id, paymentStatus: 'PAID' },
          data: { paymentStatus: 'REFUNDED' },
        });
        if (refunded.count === 1) {
          if (order.paymentMethod === 'XU') {
            await tx.user.update({
              where: { id: userId },
              data: { coinsBalance: { increment: order.total } },
            });
            await tx.coinTransaction.create({
              data: {
                userId,
                delta: order.total,
                reason: `ORDER_REFUND:${order.code}`,
                refType: 'ORDER',
                refId: order.id,
              },
            });
          } else {
            await tx.user.update({
              where: { id: userId },
              data: { walletBalance: { increment: order.total } },
            });
          }
        }
      }
      // Hoàn stock atomic — chỉ chạy ở nhánh THẮNG race (count=1) để tránh restock 2 lần
      // khi 2 request cancel song song. Dùng order.items đã include sẵn ở detail() phía trên.
      for (const item of order.items) {
        await tx.variation.update({
          where: { id: item.variationId },
          data: { stock: { increment: item.quantity } },
        });
        if (item.flashSaleItemId) {
          await this.flashSale.restore(tx, item.flashSaleItemId, userId, item.quantity);
        }
      }
      return true;
    });
    if (!won) return this.detail(userId, code); // đã bị hủy bởi request khác → không hoàn lần 2
    // reverseOrderPoints idempotent (guard ORDER_REVERSED + $transaction nội bộ) nên để ngoài tx được.
    await this.loyalty.reverseOrderPoints(order.id);
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

  /** Yêu cầu đổi/trả (§6.4): chỉ đơn DELIVERED, trong window (config returns.window_days=7),
   * chỉ-lỗi-NSX (user nêu lý do + ảnh). Admin duyệt sau (AdminService.reviewReturn). */
  async requestReturn(userId: string, code: string, dto: { reason: string; images?: string[] }) {
    const order = await this.detail(userId, code);
    if (order.status !== 'DELIVERED') {
      throw new BadRequestException('Chỉ yêu cầu đổi/trả với đơn đã giao.');
    }
    const windowDays = await this.config.get<number>('returns.window_days', 7);
    const deliveredAt = order.updatedAt ?? order.createdAt;
    if (Date.now() - new Date(deliveredAt).getTime() > windowDays * 864e5) {
      throw new BadRequestException(`Quá hạn đổi/trả (${windowDays} ngày từ khi nhận hàng).`);
    }
    const existing = await this.prisma.returnRequest.findFirst({
      where: { orderId: order.id, status: 'REQUESTED' },
    });
    if (existing) throw new BadRequestException('Đơn đang có yêu cầu đổi/trả chờ xử lý.');

    const req = await this.prisma.returnRequest.create({
      data: { orderId: order.id, userId, reason: dto.reason, images: dto.images ?? [] },
    });
    await this.notifications.notify(userId, 'RETURN_REQUESTED', { order_code: code }).catch(() => undefined);
    return req;
  }

  /** Danh sách yêu cầu đổi/trả của user (hiện trạng thái ở chi tiết đơn). */
  listMyReturns(userId: string) {
    return this.prisma.returnRequest.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
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
