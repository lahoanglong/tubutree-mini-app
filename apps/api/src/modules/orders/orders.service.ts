import { BadRequestException, Injectable, Logger, NotFoundException, Optional } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import type { Queue } from 'bullmq';
import { Prisma } from '@prisma/client';
import type { OrderStatus } from '@tubutree/shared-types';
import { PrismaService } from '../../prisma/prisma.service';
import { paginated, skipTake } from '../../common/pagination';
import { LoyaltyService } from '../loyalty/loyalty.service';
import { CartService } from '../cart/cart.service';
import { NotificationsService } from '../notifications/notifications.service';
import { SystemConfigService } from '../system-config/system-config.service';
import { AffiliateService } from '../affiliate/affiliate.service';
import { OrderReversalService, type ReversalResult } from './order-reversal.service';
import { parseRefundDestination, type RefundDestinationInput } from './refund-destination';
import { announceBankRefund } from './refund-queue';
import { refundNote } from './order-returns.service';
import { readPendingPaymentTtlHours } from './pending-payment-expiry.cron';
import { PREPAID_METHODS } from './order-transition';
import { QUEUE_GOMDON_PUSH } from '../../jobs/queues';
import { enqueueGomdonCancel } from '../integrations/gomdon/gomdon-queue';
import { isGomdonPickedUp } from '../integrations/gomdon/gomdon-status';
import { ACTIVE_ORDER_STATUSES, ORDER_STATUS_GROUPS, type OrderStatusGroup } from './order-status-groups';

export interface OrderListFilter {
  status?: OrderStatus;
  group?: OrderStatusGroup;
}

export interface OrderItemMedia {
  thumbnail: string | null;
  stock: number;
  available: boolean;
  currentPrice: number | null;
}
export type OrderWithItems = Prisma.OrderGetPayload<{ include: { items: true } }>;
export type OrderItemView = OrderWithItems['items'][number] & OrderItemMedia;
export type OrderView = Omit<OrderWithItems, 'items'> & {
  items: OrderItemView[];
  /** Đơn trả trước chờ thanh toán: quá mốc này cron tự huỷ (BUYERMINI-8 — QR và chi tiết đơn ghi rõ hạn). */
  paymentDeadline?: string | null;
};

const MISSING_MEDIA: OrderItemMedia = { thumbnail: null, stock: 0, available: false, currentPrice: null };

export type RepurchaseAddSource = 'repurchase' | 'reorder_notification';
export type RepurchaseSkipReason = 'OUT_OF_STOCK' | 'INACTIVE' | 'NOT_APPROVED' | 'EXCEEDS_STOCK';
export interface RepurchaseLineResult {
  orderItemId: string;
  status: 'added' | 'partial' | 'skipped';
  reason?: RepurchaseSkipReason;
  addedQuantity: number;
}
export interface RepurchaseInput {
  items?: { orderItemId: string; quantity: number }[];
  addSource?: RepurchaseAddSource;
}

function statusWhere(filter: OrderListFilter): Prisma.OrderWhereInput {
  if (filter.status) return { status: filter.status };
  if (filter.group) return { status: { in: [...ORDER_STATUS_GROUPS[filter.group]] } };
  return {};
}

@Injectable()
export class OrdersService {
  private readonly logger = new Logger(OrdersService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly loyalty: LoyaltyService,
    private readonly cart: CartService,
    private readonly notifications: NotificationsService,
    private readonly config: SystemConfigService,
    private readonly affiliate: AffiliateService,
    private readonly reversal: OrderReversalService,
    // Optional: test/call site cũ dựng tay 7 tham số vẫn chạy (xem order-status.service.ts).
    @Optional() @InjectQueue(QUEUE_GOMDON_PUSH) private readonly gomdonQueue?: Queue,
  ) {}

  async list(userId: string, filter: OrderListFilter, page: number, limit: number) {
    const where: Prisma.OrderWhereInput = { userId, ...statusWhere(filter) };
    const [items, total] = await this.prisma.$transaction([
      this.prisma.order.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        ...skipTake(page, limit),
        include: { items: true },
      }),
      this.prisma.order.count({ where }),
    ]);
    return paginated(await this.attachItemMedia(items), page, limit, total);
  }

  /** Số đơn đang xử lý — endpoint nhẹ cho badge tab Đơn hàng. */
  async activeCount(userId: string): Promise<{ count: number }> {
    const count = await this.prisma.order.count({
      where: { userId, status: { in: [...ACTIVE_ORDER_STATUSES] } },
    });
    return { count };
  }

  async detail(userId: string, code: string) {
    const order = await this.prisma.order.findUnique({
      where: { code },
      include: { items: true },
    });
    if (!order || order.userId !== userId) throw new NotFoundException('Không tìm thấy đơn hàng.');
    return order;
  }

  /** Chi tiết đơn cho màn khách (GET /orders/:code) — kèm ảnh/tồn kho từng dòng. Các luồng nội bộ
   * (cancel/repurchase/requestReturn) vẫn dùng detail() thô, không tốn thêm truy vấn. */
  async detailView(userId: string, code: string): Promise<OrderView> {
    const order = await this.detail(userId, code);
    const [view] = await this.attachItemMedia([order]);
    return { ...view!, paymentDeadline: await this.paymentDeadline(order) };
  }

  /** Hạn thanh toán của đơn trả trước đang chờ tiền — cùng TTL với cron tự huỷ. Null với đơn khác. */
  async paymentDeadline(order: Pick<OrderWithItems, 'type' | 'status' | 'paymentStatus' | 'paymentMethod' | 'createdAt'>): Promise<string | null> {
    if (order.type !== 'RETAIL' || order.status !== 'PENDING_PAYMENT' || order.paymentStatus !== 'UNPAID') return null;
    if (!(PREPAID_METHODS as readonly string[]).includes(order.paymentMethod)) return null;
    const hours = await readPendingPaymentTtlHours(this.config);
    return new Date(new Date(order.createdAt).getTime() + hours * 3_600_000).toISOString();
  }

  /** Ảnh + tồn kho + còn bán được của từng dòng, join theo variationId (OrderItem không có FK/ảnh —
   * spec §3.2 không thêm cột). Một truy vấn cho cả trang đơn. */
  private async attachItemMedia(orders: OrderWithItems[]): Promise<OrderView[]> {
    const ids = [...new Set(orders.flatMap((o) => o.items.map((it) => it.variationId)))];
    const variations = ids.length
      ? await this.prisma.variation.findMany({
          where: { id: { in: ids } },
          select: {
            id: true,
            stock: true,
            isActive: true,
            retailPrice: true,
            salePrice: true,
            product: { select: { thumbnail: true, images: true, isActive: true, approvalStatus: true } },
          },
        })
      : [];
    const byId = new Map(variations.map((v) => [v.id, v]));
    const media = (variationId: string): OrderItemMedia => {
      const v = byId.get(variationId);
      if (!v) return MISSING_MEDIA;
      return {
        thumbnail: v.product.thumbnail ?? v.product.images[0] ?? null,
        stock: v.stock,
        available: v.isActive && v.product.isActive && v.product.approvalStatus === 'APPROVED' && v.stock > 0,
        currentPrice: v.salePrice ?? v.retailPrice,
      };
    };
    return orders.map((o) => ({ ...o, items: o.items.map((it) => ({ ...it, ...media(it.variationId) })) }));
  }

  async cancel(userId: string, code: string, refundInput: RefundDestinationInput = {}) {
    // Kiểm tra sớm trên ảnh chụp (thông báo thân thiện, không mở tx vô ích). Ảnh chụp này đọc NGOÀI tx
    // nên KHÔNG được dùng để quyết định ghi — tx bên dưới khoá dòng đơn rồi kiểm tra lại trên dữ liệu thật.
    const order = await this.detail(userId, code);
    // Huỷ lần hai (double-tap, mạng chậm, bấm lại từ màn cũ): đơn đã huỷ rồi thì trả đúng đơn đó như nhánh `won=false`
    // bên dưới, không để assertCustomerCancellable báo "đã vào quy trình giao" cho một đơn vừa huỷ thành công.
    if (order.status === 'CANCELLED') return order;
    this.assertCustomerCancellable(order, userId);
    // D2: khách chọn nhận tiền hoàn về Ví (ngay) hay tài khoản ngân hàng (admin chuyển tay). Kiểm trước tx để báo lỗi
    // nhập liệu sớm; chỉ có tác dụng khi đơn thật sự đã thanh toán (guard PAID→REFUNDED trong reverseFinancials).
    const destination = parseRefundDestination(refundInput, order.paymentMethod);
    let reversed: ReversalResult | null = null;
    // Chuyển trạng thái ATOMIC — chống hủy đồng thời (double-tap/retry) gây HOÀN VÍ 2 LẦN: chỉ request
    // THẮNG (count=1) mới hoàn điểm/ví. Bọc flip-status + hoàn ví trong CÙNG $transaction để chống crash
    // giữa chừng: nếu process chết sau khi đơn đã CANCELLED nhưng trước khi increment ví → retry bị guard
    // chặn → khách mất tiền.
    //
    // Giữa lần đọc ở detail() và tx này, admin xác nhận chuyển khoản (PENDING_PAYMENT+UNPAID →
    // CONFIRMED+PAID), webhook Pancake/ZaloPay lật PAID, admin chuyển giao vận, hay Gomdon báo đã lấy
    // hàng đều có thể chen vào. Nên trong tx: khoá dòng đơn (FOR UPDATE — các đường ghi kia xếp hàng sau
    // lần huỷ này), đọc lại, kiểm tra lại, lật guard theo ĐÚNG trạng thái vừa đọc, và đưa bản đọc lại
    // (không phải ảnh chụp) vào reverseFinancials + sổ lịch sử.
    const won = await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT "id" FROM "orders" WHERE "id" = ${order.id} FOR UPDATE`;
      const current = await tx.order.findUnique({ where: { id: order.id }, include: { items: true } });
      if (!current || current.status === 'CANCELLED') return false; // request khác đã huỷ trước → không hoàn lần 2
      this.assertCustomerCancellable(current, userId);
      const res = await tx.order.updateMany({
        where: { id: current.id, status: current.status },
        data: { status: 'CANCELLED' },
      });
      if (res.count === 0) return false;
      // Ghi vết trong cùng transaction — luồng khách tự huỷ không đi qua OrderStatusService
      // nhưng vẫn phải để lại actor, nếu không thì sổ lịch sử có lỗ đúng ở nhóm đơn đông nhất.
      await tx.orderStatusHistory.create({
        data: {
          orderId: current.id,
          fromStatus: current.status,
          toStatus: 'CANCELLED',
          actorType: 'CUSTOMER',
          actorId: userId,
        },
      });
      // Hoàn ví/Điểm Xanh + restock + release flash quota — logic dùng chung với admin.reviewReturn/
      // OrderStatusService (xem order-reversal.service.ts), tránh chép tay lệch nhau (P0-4
      // trong docs/2026-09-08-review-progress.md). Hoàn tiền quyết bằng guard PAID→REFUNDED
      // trong reverseFinancials (DB quyết, không phải paymentStatus của bản đọc).
      reversed = await this.reversal.reverseFinancials(tx, current, { destination });
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
    // Đơn thu gom tái chế: huỷ luôn vận đơn Gomdon (job có retry). Best-effort — lỗi enqueue chỉ log,
    // cron GomdonReconcileService quét đơn CANCELLED còn vận đơn chưa huỷ và enqueue lại.
    if (order.hasRecyclingPickup && this.gomdonQueue) {
      await enqueueGomdonCancel(this.gomdonQueue, order.id).catch((err) =>
        this.logger.error(`Enqueue huỷ vận đơn Gomdon lỗi cho đơn ${code}: ${err instanceof Error ? err.message : err}`),
      );
    }
    // Không để lỗi gửi thông báo (best-effort) làm 500 hoá cả response — đơn đã CANCELLED +
    // hoàn ví/điểm/stock xong xuôi ở trên; guard đầu hàm (status !== PENDING_PAYMENT/CONFIRMED)
    // chặn mọi lần gọi lại cancel() sau đó nên nếu để throw ở đây, client sẽ nhận 500 vĩnh viễn
    // cho một thao tác thực ra đã thành công. Nhất quán với requestReturn() bên dưới.
    const refund = (reversed as ReversalResult | null)?.refund ?? null;
    const bank = destination.method === 'BANK' ? { bankName: destination.bank.bankName, bankAccountNo: destination.bank.accountNumber } : null;
    if (refund?.to === 'BANK' && bank) {
      await announceBankRefund(
        { prisma: this.prisma, notifications: this.notifications, logger: this.logger },
        { orderCode: code, amount: refund.amount, userId, ...bank },
      );
    }
    await this.notifications
      .notify(userId, 'ORDER_CANCELLED', { order_code: code, refund_note: refundNote(refund, bank) })
      .catch(() => undefined);
    return this.detail(userId, code);
  }

  /** Luật khách tự huỷ — dùng cả cho ảnh chụp (kiểm tra sớm) lẫn bản đọc lại trong tx (quyết định). */
  private assertCustomerCancellable(
    order: {
      status: string;
      paymentStatus?: string | null;
      placedForCustomer?: boolean | null;
      referrerUserId?: string | null;
      hasRecyclingPickup?: boolean | null;
      gomdonStatus?: string | null;
    },
    actorId: string,
  ) {
    if (order.status !== 'PENDING_PAYMENT' && order.status !== 'CONFIRMED') {
      throw new BadRequestException(
        'Đơn đã vào quy trình giao, vui lòng liên hệ hotline hoặc Zalo OA của Tubu để được hỗ trợ.',
      );
    }
    // Tiền của đơn lên hộ là của khách cuối: để CTV tự huỷ sau khi khách đã trả thì CTV quyết định
    // dòng tiền của người khác (C-001/Q-01). Chỉ admin huỷ, hoàn về khách qua OrderReversalService.
    if (order.placedForCustomer && order.paymentStatus === 'PAID' && order.referrerUserId === actorId) {
      throw new BadRequestException(
        'Đơn lên hộ khách đã thanh toán, CTV không tự huỷ được. Vui lòng liên hệ Tubu để admin huỷ và hoàn tiền cho khách.',
      );
    }
    // Đơn thu gom tái chế: bưu tá Gomdon đã lấy hàng (webhook chuyển SHIPPING có thể tới trễ) → không
    // cho khách tự huỷ nữa (huỷ vận đơn bằng API không còn được, hàng đã rời kho).
    if (order.hasRecyclingPickup && isGomdonPickedUp(order.gomdonStatus)) {
      throw new BadRequestException(
        'Đơn đã được bưu tá lấy hàng, vui lòng liên hệ hotline hoặc Zalo OA của Tubu để được hỗ trợ.',
      );
    }
  }

  /**
   * Mua lại đơn (spec §3.2). Mỗi dòng xử lý ĐỘC LẬP — một dòng hết hàng/ngừng bán/vượt tồn không
   * dừng vòng lặp (bản cũ: addItem ném giữa vòng lặp → 400 sau khi đã thêm một phần, A2-05).
   * Response giữ các trường giỏ ở top-level (bản miniapp cũ: setQueryData(['cart'], res)) + `cart`
   * (spec §3.2) + `results` từng dòng.
   */
  async repurchase(userId: string, code: string, input: RepurchaseInput = {}) {
    const order = await this.detail(userId, code);
    const requested = input.items ? new Map(input.items.map((i) => [i.orderItemId, i.quantity])) : null;
    if (requested) {
      const known = new Set(order.items.map((i) => i.id));
      if ([...requested.keys()].some((id) => !known.has(id))) {
        throw new BadRequestException('Có dòng hàng không thuộc đơn này.');
      }
    }
    const lines = requested ? order.items.filter((i) => requested.has(i.id)) : order.items;
    const [variations, cartRow] = await Promise.all([
      this.prisma.variation.findMany({
        where: { id: { in: [...new Set(lines.map((l) => l.variationId))] } },
        select: { id: true, stock: true, isActive: true, product: { select: { isActive: true, approvalStatus: true } } },
      }),
      this.prisma.cart.findUnique({
        where: { userId },
        select: { items: { select: { variationId: true, quantity: true } } },
      }),
    ]);
    const byId = new Map(variations.map((v) => [v.id, v]));
    const inCart = new Map<string, number>((cartRow?.items ?? []).map((ci) => [ci.variationId, ci.quantity]));
    const addSource = input.addSource ?? 'repurchase';
    const results: RepurchaseLineResult[] = [];

    for (const line of lines) {
      const skip = (reason: RepurchaseSkipReason) =>
        results.push({ orderItemId: line.id, status: 'skipped', reason, addedQuantity: 0 });
      const v = byId.get(line.variationId);
      if (!v || !v.isActive || !v.product.isActive) { skip('INACTIVE'); continue; }
      if (v.product.approvalStatus !== 'APPROVED') { skip('NOT_APPROVED'); continue; }
      if (v.stock <= 0) { skip('OUT_OF_STOCK'); continue; }
      const room = v.stock - (inCart.get(v.id) ?? 0);
      if (room <= 0) { skip('EXCEEDS_STOCK'); continue; }
      const want = requested?.get(line.id) ?? line.quantity;
      const qty = Math.min(want, room);
      try {
        await this.cart.addItem(userId, { variationId: v.id, quantity: qty, addSource });
      } catch (err) {
        // Lỗi nghiệp vụ của RIÊNG dòng này (tồn kho đổi giữa lúc đọc và ghi, SP vừa bị ẩn) → bỏ qua
        // dòng; lỗi hạ tầng ném ra (mỗi addItem là một tx riêng nên giỏ không lệch).
        if (err instanceof BadRequestException) { skip('EXCEEDS_STOCK'); continue; }
        if (err instanceof NotFoundException) { skip('INACTIVE'); continue; }
        throw err;
      }
      inCart.set(v.id, (inCart.get(v.id) ?? 0) + qty);
      results.push(
        qty < want
          ? { orderItemId: line.id, status: 'partial', reason: 'EXCEEDS_STOCK', addedQuantity: qty }
          : { orderItemId: line.id, status: 'added', addedQuantity: qty },
      );
    }
    const cart = await this.cart.getCart(userId);
    return { ...cart, cart, results };
  }
}
