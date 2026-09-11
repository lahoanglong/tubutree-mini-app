import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { OrderStatus } from '@tubutree/shared-types';
import { PrismaService } from '../../prisma/prisma.service';
import { paginated, skipTake } from '../../common/pagination';
import { LoyaltyService } from '../loyalty/loyalty.service';
import { CartService } from '../cart/cart.service';
import { NotificationsService } from '../notifications/notifications.service';
import { SystemConfigService } from '../system-config/system-config.service';
import { AffiliateService } from '../affiliate/affiliate.service';
import { OrderReversalService } from './order-reversal.service';

@Injectable()
export class OrdersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly loyalty: LoyaltyService,
    private readonly cart: CartService,
    private readonly notifications: NotificationsService,
    private readonly config: SystemConfigService,
    private readonly affiliate: AffiliateService,
    private readonly reversal: OrderReversalService,
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
      // Ghi vết trong cùng transaction — luồng khách tự huỷ không đi qua OrderStatusService
      // nhưng vẫn phải để lại actor, nếu không thì sổ lịch sử có lỗ đúng ở nhóm đơn đông nhất.
      await tx.orderStatusHistory.create({
        data: {
          orderId: order.id,
          fromStatus: order.status,
          toStatus: 'CANCELLED',
          actorType: 'CUSTOMER',
          actorId: userId,
        },
      });
      // Hoàn ví/xu + restock + release flash quota — logic dùng chung với admin.reviewReturn/
      // OrderStatusService (xem order-reversal.service.ts), tránh chép tay lệch nhau (P0-4
      // trong docs/2026-09-08-review-progress.md). Refetch paymentStatus TRONG tx qua guard
      // updateMany bên trong reverseFinancials — snapshot `order.paymentStatus` (đọc ngoài tx
      // ở detail()) có thể đã stale nếu webhook ZaloPay/Pancake chuyển REFUNDED giữa lúc đó.
      await this.reversal.reverseFinancials(tx, order);
      return true;
    });
    if (!won) return this.detail(userId, code); // đã bị hủy bởi request khác → không hoàn lần 2
    // reverseOrderPoints/reverseCommissionsForOrder idempotent (guard riêng + $transaction nội
    // bộ) nên để ngoài tx được. Trước đây THIẾU reverseCommissionsForOrder ở luồng khách tự hủy
    // — CTV vẫn giữ hoa hồng PENDING cho đơn khách đã hủy trước khi giao (không tự dọn, dù
    // không trả được vì payout chỉ rút từ status APPROVED — nhưng làm sai lệch số "chờ duyệt"
    // hiển thị cho CTV vĩnh viễn). Nhất quán với admin/pancake — cả hai đều gọi cặp đôi này.
    await this.loyalty.reverseOrderPoints(order.id);
    await this.affiliate.reverseCommissionsForOrder(order.id);
    // Không để lỗi gửi thông báo (best-effort) làm 500 hoá cả response — đơn đã CANCELLED +
    // hoàn ví/điểm/stock xong xuôi ở trên; guard đầu hàm (status !== PENDING_PAYMENT/CONFIRMED)
    // chặn mọi lần gọi lại cancel() sau đó nên nếu để throw ở đây, client sẽ nhận 500 vĩnh viễn
    // cho một thao tác thực ra đã thành công. Nhất quán với requestReturn() bên dưới.
    await this.notifications.notify(userId, 'ORDER_CANCELLED', { order_code: code }).catch(() => undefined);
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
    // Guard theo invoiceStatus hiện tại — trước đây set 'REQUESTED' vô điều kiện nên double-tap,
    // hoặc gọi lại sau khi webhook ISSUED (pancake.processor.ts onInvoiceIssued) đã phát hành
    // hóa đơn thật, sẽ âm thầm lật ngược invoiceStatus đã ISSUED về REQUESTED.
    if (order.invoiceStatus === 'ISSUED') {
      throw new BadRequestException('Hóa đơn đã được phát hành.');
    }
    if (order.invoiceStatus === 'REQUESTED') {
      return { ok: true, message: 'Yêu cầu phát hành hóa đơn đang được xử lý.' };
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
    // Pre-check nhanh + guard thật là unique index partial (orderId WHERE status='REQUESTED')
    // — 2 request gửi đổi/trả song song (double-tap/2 tab) đều có thể đọc "chưa có" trước khi
    // request đầu commit; P2002 chặn tạo trùng.
    const existing = await this.prisma.returnRequest.findFirst({
      where: { orderId: order.id, status: 'REQUESTED' },
    });
    if (existing) throw new BadRequestException('Đơn đang có yêu cầu đổi/trả chờ xử lý.');

    let req: Awaited<ReturnType<typeof this.prisma.returnRequest.create>>;
    try {
      req = await this.prisma.returnRequest.create({
        data: { orderId: order.id, userId, reason: dto.reason, images: dto.images ?? [] },
      });
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        throw new BadRequestException('Đơn đang có yêu cầu đổi/trả chờ xử lý.');
      }
      throw err;
    }
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
