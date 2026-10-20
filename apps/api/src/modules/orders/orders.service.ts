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
import { OrderStatusService } from './order-status.service';
import { WastePickupHooks } from '../waste-exchange/pickup/waste-pickup-hooks.service';
import { parseRefundDestination, type RefundDestinationInput } from './refund-destination';
import { announceBankRefund, receivedRefundNote, refundReportedUnderpayment } from './refund-queue';
import { refundNote } from './order-returns.service';
import { pendingPaymentDeadlines } from './pending-payment-ttl';
import { cancelHandover } from './order-transition';
import { notifyMerchantOwner } from './merchant-order-notify';
import { QUEUE_GOMDON_PUSH } from '../../jobs/queues';
import { enqueueGomdonCancel } from '../integrations/gomdon/gomdon-queue';
import { toPublicCart } from '../checkout/checkout-split';
import { forBuyer, type BuyerHiddenOrderField } from './buyer-order-fields';
import { ACTIVE_ORDER_STATUSES, ORDER_STATUS_GROUPS, type OrderStatusGroup } from './order-status-groups';
import { returnPointsTaken } from './return-ledger';
import { foldVietnamese } from '../catalog/search-text';
import { orderLineReviews, type OrderLineReview } from '../reviews/review-eligibility';

export interface OrderListFilter {
  status?: OrderStatus;
  group?: OrderStatusGroup;
  /** Tìm theo mã đơn hoặc tên sản phẩm trong đơn (không phân biệt hoa thường, không cần gõ dấu). */
  q?: string;
}

/** Số đơn tối đa quét khi tìm kiếm: khách thật chỉ có vài chục đơn; trần này chặn tài khoản khổng lồ làm nặng truy vấn. */
const ORDER_SEARCH_SCAN_CAP = 2000;

export interface OrderItemMedia {
  thumbnail: string | null;
  stock: number;
  available: boolean;
  currentPrice: number | null;
}
export type OrderWithItems = Prisma.OrderGetPayload<{ include: { items: true } }>;
export type OrderItemView = OrderWithItems['items'][number] & OrderItemMedia;
/** Ai giao đơn (D4): kho Tubu hay gian hàng đối tác tự giao, kèm hotline gian hàng để khách liên hệ. */
export interface OrderFulfilmentView {
  kind: 'TUBU' | 'MERCHANT';
  name: string;
  phone: string | null;
}

export interface SiblingOrderView {
  code: string;
  status: string;
  total: number;
  fulfillerName: string;
}

export type OrderView = Omit<OrderWithItems, 'items' | BuyerHiddenOrderField> & {
  /** Chỉ màn chi tiết (detailView) kèm trạng thái đánh giá từng dòng; danh sách đơn không có. */
  items: (OrderItemView & Partial<OrderLineReview>)[];
  fulfilment?: OrderFulfilmentView;
  /** Các đơn khác cùng lần đặt bị tách theo nơi giao. */
  siblings?: SiblingOrderView[];
  /**
   * Mã giảm giá của lần đặt khi chính đơn này không giữ lượt dùng mã (chỉ đơn đầu của nhóm giữ — `couponCode` chỉ có ở đó) nhưng nhận
   * một phần giảm của mã: để màn chi tiết ghi đúng "Mã giảm giá (XANH10)" thay vì khoản giảm không rõ nguồn. null = không có.
   */
  groupCouponCode?: string | null;
  /** Đơn trả trước chờ thanh toán: quá mốc này cron tự huỷ (BUYERMINI-8 — QR và chi tiết đơn ghi rõ hạn). */
  paymentDeadline?: string | null;
  /** Người xem tự huỷ được đơn này không (customerCancelBlock) — app/web chỉ bày nút "Hủy đơn" khi true (R3-CANCEL-2). */
  canCancel: boolean;
  /** Chỉ chi tiết đơn: Điểm Xanh tích của đơn thực sự đã thu lại do trả một phần (returnPointsTaken). */
  pointsReturnReversed?: number;
  /**
   * Đơn chờ thanh toán mà hàng đã bàn giao vận chuyển (Pancake đã gửi hàng, hệ thống thôi tự huỷ): Tubu xử lý tay với khách.
   * App/web thay hạn thanh toán, nút trả tiền và nút huỷ bằng câu trung tính "Tubu đang xử lý đơn này" (R5-SYNC-1).
   */
  manualHandling: boolean;
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

const CUSTOMER_CANCELLABLE: readonly string[] = ['PENDING_PAYMENT', 'CONFIRMED', 'PACKED'];
const CUSTOMER_CANCELLABLE_DEALER: readonly string[] = ['PENDING_PAYMENT', 'CONFIRMED'];

type CustomerCancelFacts = {
  status: string;
  type?: string | null;
  paymentStatus?: string | null;
  placedForCustomer?: boolean | null;
  referrerUserId?: string | null;
  hasRecyclingPickup?: boolean | null;
  gomdonStatus?: string | null;
  gomdonOrderId?: string | null;
  gomdonPartnerCode?: string | null;
  shippingCode?: string | null;
  shippingPartner?: string | null;
  shippedAt?: Date | null;
  autoCancelBlockedAt?: Date | null;
};

/** Hàng đã ở hãng vận chuyển (mốc thôi tự huỷ) nhưng đơn vẫn chờ tiền: khách chỉ thấy câu trung tính, CSKH xử lý. */
function isManualHandling(order: { status: string; autoCancelBlockedAt?: Date | null }): boolean {
  return order.status === 'PENDING_PAYMENT' && !!order.autoCancelBlockedAt;
}

/**
 * Lý do khách KHÔNG tự huỷ được (null = huỷ được) — cùng một luật cho nút "Hủy đơn" (OrderView.canCancel) và cho lần huỷ
 * thật. Pancake đã gửi hàng mà webhook chưa về thì chỉ lộ ra lúc huỷ (hỏi Pancake trước khi huỷ).
 */
export function customerCancelBlock(order: CustomerCancelFacts, actorId: string | null | undefined): string | null {
  // D1: khách huỷ được tới trước khi bàn giao vận chuyển (gồm cả đang đóng gói — Pancake quyết lần cuối). Đơn đại
  // lý giữ mốc cũ: PACKED đã tính doanh số thưởng (DEALER_SETTLED_STATUSES).
  const cancellable = order.type === 'DEALER' ? CUSTOMER_CANCELLABLE_DEALER : CUSTOMER_CANCELLABLE;
  if (!cancellable.includes(order.status)) {
    return 'Đơn đã vào quy trình giao, vui lòng liên hệ hotline hoặc Zalo OA của Tubu để được hỗ trợ.';
  }
  // Tiền của đơn lên hộ là của khách cuối: để CTV tự huỷ sau khi khách đã trả thì CTV quyết định
  // dòng tiền của người khác (C-001/Q-01). Chỉ admin huỷ, hoàn về khách qua OrderReversalService.
  if (order.placedForCustomer && order.paymentStatus === 'PAID' && !!actorId && order.referrerUserId === actorId) {
    return 'Đơn lên hộ khách đã thanh toán, CTV không tự huỷ được. Vui lòng liên hệ Tubu để admin huỷ và hoàn tiền cho khách.';
  }
  // Pancake đã báo gửi hàng (mốc ghi khi hệ thống hoặc người bấm huỷ hỏi Pancake): từ chối ngay, không hỏi lại Pancake — mỗi lần
  // hỏi lại là đồng bộ lại trạng thái và đưa đơn về "Cần xử lý Pancake" dù admin đã xử lý (R5-SYNC-1).
  if (order.autoCancelBlockedAt) {
    return 'Đơn đã bàn giao cho đơn vị vận chuyển và Tubu đang xử lý, bạn không tự huỷ được nữa. Vui lòng liên hệ hotline hoặc Zalo OA của Tubu nếu cần hỗ trợ.';
  }
  // D1 cùng một luật với admin/nhà bán (cancelHandover): đã có mã vận đơn hãng, bưu tá Gomdon đã lấy hàng (webhook
  // chuyển SHIPPING có thể tới trễ)... thì khách không tự huỷ được nữa.
  const handover = cancelHandover(order);
  if (!handover) return null;
  return handover.kind === 'GOMDON_PICKED_UP'
    ? 'Đơn đã được bưu tá lấy hàng, vui lòng liên hệ hotline hoặc Zalo OA của Tubu để được hỗ trợ.'
    : 'Đơn đã bàn giao cho đơn vị vận chuyển, vui lòng liên hệ hotline hoặc Zalo OA của Tubu để được hỗ trợ.';
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
    // Optional như trên: huỷ đơn đã lên Pancake phải hỏi/huỷ cả bên Pancake (D1).
    @Optional() private readonly orderStatus?: OrderStatusService,
    // Optional như trên: call site dựng tay 7-9 tham số vẫn chạy.
    @Optional() private readonly wastePickupHooks?: WastePickupHooks,
  ) {}

  async list(userId: string, filter: OrderListFilter, page: number, limit: number) {
    const where: Prisma.OrderWhereInput = { userId, ...statusWhere(filter) };
    const needle = foldVietnamese((filter.q ?? '').replace(/^\s*#/, ''));
    if (needle) return this.search(where, needle, page, limit, userId);
    const [items, total] = await this.prisma.$transaction([
      this.prisma.order.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        ...skipTake(page, limit),
        include: { items: true },
      }),
      this.prisma.order.count({ where }),
    ]);
    return paginated(await this.attachItemMedia(items, userId), page, limit, total);
  }

  /**
   * Tìm trong đơn của một khách: khớp mã đơn hoặc tên sản phẩm sau khi bỏ dấu cả hai phía (cùng bảng với tìm sản phẩm).
   * Tên sản phẩm của dòng đơn không có cột bỏ dấu và số đơn của một khách nhỏ, nên quét nhẹ (id, mã, tên dòng) rồi
   * lọc ở bộ nhớ; chỉ trang cần hiển thị mới tải đủ dòng + ảnh.
   */
  private async search(where: Prisma.OrderWhereInput, needle: string, page: number, limit: number, viewerId: string) {
    const rows = await this.prisma.order.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: ORDER_SEARCH_SCAN_CAP,
      select: { id: true, code: true, items: { select: { productName: true } } },
    });
    const matched = rows
      .filter((o) => foldVietnamese(o.code).includes(needle) || o.items.some((it) => foldVietnamese(it.productName).includes(needle)))
      .map((o) => o.id);
    const pageIds = matched.slice((page - 1) * limit, page * limit);
    if (pageIds.length === 0) return paginated([], page, limit, matched.length);
    const found = await this.prisma.order.findMany({ where: { id: { in: pageIds } }, include: { items: true } });
    const byId = new Map(found.map((o) => [o.id, o]));
    const ordered = pageIds.flatMap((id) => byId.get(id) ?? []);
    return paginated(await this.attachItemMedia(ordered, viewerId), page, limit, matched.length);
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
   * (cancel/repurchase/requestReturn) dùng detail() thô, không tốn thêm truy vấn; đơn trả ra cho khách vẫn qua forBuyer. */
  async detailView(userId: string, code: string): Promise<OrderView> {
    const order = await this.detail(userId, code);
    const [[view], fulfilment, reviewOf, pointsReturnReversed] = await Promise.all([
      this.attachItemMedia([order], userId),
      this.fulfilmentOf(order),
      orderLineReviews(this.prisma, order),
      order.status === 'DELIVERED' || order.status === 'RETURNED' ? returnPointsTaken(this.prisma, order) : undefined,
    ]);
    return {
      ...view!,
      items: view!.items.map((it) => ({ ...it, ...reviewOf(it.id) })),
      ...fulfilment,
      pointsReturnReversed,
    };
  }

  private async fulfilmentOf(order: {
    userId: string;
    code: string;
    fulfiller?: string | null;
    fulfillerStorefrontId?: string | null;
    checkoutGroup?: string | null;
    couponCode?: string | null;
  }): Promise<{ fulfilment: OrderFulfilmentView; siblings: SiblingOrderView[]; groupCouponCode: string | null }> {
    const nameOf = async (fulfiller: string | null | undefined, storefrontId: string | null | undefined) => {
      if (fulfiller !== 'MERCHANT' || !storefrontId) return { kind: 'TUBU' as const, name: 'Tubu Tree', phone: null };
      const sf = await this.prisma.storefront.findUnique({
        where: { id: storefrontId },
        select: { title: true, warehousePhone: true },
      });
      return { kind: 'MERCHANT' as const, name: sf?.title ?? 'Gian hàng đối tác', phone: sf?.warehousePhone ?? null };
    };
    const fulfilment = await nameOf(order.fulfiller, order.fulfillerStorefrontId);
    if (!order.checkoutGroup) return { fulfilment, siblings: [], groupCouponCode: null };
    const rows = await this.prisma.order.findMany({
      where: { checkoutGroup: order.checkoutGroup, userId: order.userId, code: { not: order.code } },
      select: {
        code: true,
        status: true,
        total: true,
        fulfiller: true,
        fulfillerStorefront: { select: { title: true } },
        couponCode: true,
      },
      orderBy: [{ fulfiller: 'asc' }, { code: 'asc' }],
    });
    return {
      fulfilment,
      groupCouponCode: order.couponCode ? null : (rows.find((r) => r.couponCode)?.couponCode ?? null),
      siblings: rows.map((r) => ({
        code: r.code,
        status: r.status,
        total: r.total,
        fulfillerName: r.fulfiller === 'MERCHANT' ? (r.fulfillerStorefront?.title ?? 'Gian hàng đối tác') : 'Tubu Tree',
      })),
    };
  }

  /** Ảnh + tồn kho + còn bán được của từng dòng, join theo variationId (OrderItem không có FK/ảnh —
   * spec §3.2 không thêm cột). Một truy vấn cho cả trang đơn. */
  private async attachItemMedia(orders: OrderWithItems[], viewerId: string): Promise<OrderView[]> {
    const ids = [...new Set(orders.flatMap((o) => o.items.map((it) => it.variationId)))];
    // Hạn thanh toán của đơn chờ chuyển khoản: danh sách đơn cũng cần để thẻ đơn ghi "Hạn …" (cùng luật với chi tiết đơn).
    const deadlines = await pendingPaymentDeadlines(orders, this.config);
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
    return orders.map((o) => ({
      ...forBuyer(o),
      items: o.items.map((it) => ({ ...it, ...media(it.variationId) })),
      canCancel: customerCancelBlock(o, viewerId) === null,
      manualHandling: isManualHandling(o),
      paymentDeadline: deadlines.get(o.id) ?? null,
    }));
  }

  async cancel(userId: string, code: string, refundInput: RefundDestinationInput = {}) {
    const order = await this.cancelOrder(userId, code, refundInput);
    return { ...forBuyer(order), canCancel: customerCancelBlock(order, userId) === null, manualHandling: isManualHandling(order) };
  }

  private async cancelOrder(userId: string, code: string, refundInput: RefundDestinationInput) {
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
    // D1: đơn đã lên Pancake → huỷ bên Pancake TRƯỚC; Pancake đã gửi hàng thì dừng ở đây (đồng bộ trạng thái, báo
    // khách liên hệ CSKH); không hỏi được Pancake thì cũng dừng ("Kho chưa phản hồi…") — webhook "Đã gửi hàng" có thể
    // chưa về, huỷ lúc này là hoàn tiền cho hàng đang ở hãng.
    const pancakeDecision = await this.orderStatus?.precheckPancakeCancel(order, 'CUSTOMER');
    // Điểm thường khách đã tiêu hoàn trong tx huỷ (cùng commit với lần lật CANCELLED): hoàn sau commit mà lỗi thì bấm huỷ lại bị
    // chặn bởi "đã huỷ" và khách mất điểm vĩnh viễn. Hạn của điểm hoàn đọc ngoài tx để không giữ kết nối trong lúc chờ cấu hình.
    const standardPointsExpiresAt =
      order.pointsUsed > order.pointsUsedConverted ? await this.loyalty.pointsExpiresAt(new Date()) : undefined;
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
      reversed = await this.reversal.reverseFinancials(tx, current, { destination, ...(standardPointsExpiresAt ? { standardPointsExpiresAt } : {}) });
      return true;
    }).catch(async (err: unknown) => {
      // Pancake đã huỷ đơn ở bước trên mà tx này không huỷ được (vừa PAID/giao vận, hay lỗi DB): để lại dấu cho CSKH; lỗi trả khách giữ nguyên.
      await this.orderStatus?.flagPancakeCancelDivergence(order.id, pancakeDecision, `khách bấm huỷ nhưng lần huỷ ở Tubu lỗi: ${err instanceof Error ? err.message : String(err)}`);
      throw err;
    });
    if (!won) {
      await this.orderStatus?.flagPancakeCancelDivergence(order.id, pancakeDecision, 'đơn đổi trạng thái trong lúc khách bấm huỷ');
      return this.detail(userId, code); // đã bị hủy bởi request khác → không hoàn lần 2
    }
    await this.wastePickupHooks?.onOrderCancelled(order.id).catch((err: unknown) => this.logger.error(`Hook thu kèm rác (huỷ) lỗi cho đơn ${code}: ${err instanceof Error ? err.message : err}`));
    await this.orderStatus?.afterPancakeCancel(order.id, pancakeDecision);
    // reverseOrderPoints/reverseCommissionsForOrder idempotent (guard riêng + $transaction nội bộ) nên để ngoài tx được; khách tự huỷ
    // cũng phải thu hồi hoa hồng PENDING của CTV như admin/pancake. Đơn đã CANCELLED nên bấm huỷ lại thoát sớm ở đầu hàm: lỗi đảo ở
    // đây không được làm bỏ các bước sau (hoàn tiền thiếu, vận đơn Gomdon, tin khách), chúng chạy hết rồi mới ném lỗi đầu tiên.
    let reversalFailure: unknown = null;
    let standardPointsBack = 0;
    try {
      standardPointsBack = (await this.loyalty.reverseOrderPoints(order.id)) || 0;
    } catch (err) {
      reversalFailure ??= err;
      this.logger.error(`Đảo điểm của đơn ${code} sau khi khách huỷ lỗi: ${err instanceof Error ? err.message : err}`);
    }
    try {
      await this.affiliate.reverseCommissionsForOrder(order.id);
    } catch (err) {
      reversalFailure ??= err;
      this.logger.error(`Thu hồi hoa hồng của đơn ${code} sau khi khách huỷ lỗi: ${err instanceof Error ? err.message : err}`);
    }
    const receivedBack = await refundReportedUnderpayment(
      { prisma: this.prisma, notifications: this.notifications, logger: this.logger },
      order.id,
    ).catch((err: unknown) => {
      this.logger.error(`Chưa ghi được khoản hoàn số tiền khách chuyển thiếu của đơn ${code}: ${err instanceof Error ? err.message : err}`);
      return 0;
    });
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
        { notifyCustomer: false },
      );
    }
    const pointsBack = ((reversed as ReversalResult | null)?.pointsRefunded ?? 0) + standardPointsBack;
    await this.notifications
      .notify(userId, 'ORDER_CANCELLED', {
        order_code: code,
        refund_note: refundNote(refund, bank, pointsBack) + receivedRefundNote(receivedBack, !!order.placedForCustomer),
      })
      .catch(() => undefined);
    await notifyMerchantOwner(this.prisma, this.notifications, this.logger, order.id, 'MERCHANT_ORDER_CANCELLED', {
      order_code: code,
      reason: 'Khách huỷ đơn',
    });
    if (reversalFailure !== null) throw reversalFailure;
    return this.detail(userId, code);
  }

  /** Luật khách tự huỷ — dùng cả cho ảnh chụp (kiểm tra sớm) lẫn bản đọc lại trong tx (quyết định). */
  private assertCustomerCancellable(order: CustomerCancelFacts, actorId: string) {
    const blocked = customerCancelBlock(order, actorId);
    if (blocked) throw new BadRequestException(blocked);
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
    // Dòng qua được kiểm tra đọc sẵn; ghi cả loạt một lần (addItems) rồi mới chốt kết quả, để không dựng lại giỏ theo từng dòng.
    const pending: { slot: number; line: (typeof lines)[number]; variationId: string; qty: number; want: number }[] = [];

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
      inCart.set(v.id, (inCart.get(v.id) ?? 0) + qty);
      pending.push({ slot: results.length, line, variationId: v.id, qty, want });
      results.push({ orderItemId: line.id, status: 'added', addedQuantity: qty });
    }

    if (pending.length > 0) {
      // Thêm bù chạy trong CÙNG lần addItems (callback nhận kết quả vòng đầu): lần ghi thứ hai riêng để lại giỏ nửa vời khi lỗi hạ tầng và ghi add_to_cart hai lần.
      // Chỗ mà dòng bị từ chối đã giữ trong inCart nhưng không vào giỏ được trả lại cho dòng sau cùng variation đã bị kẹp nhỏ vì phần đó.
      const outcomes = await this.cart.addItems(userId, pending.map((p) => ({ variationId: p.variationId, quantity: p.qty, addSource })), {
        topUp: (first) => {
          const freed = new Map<string, number>();
          const topUps: { index: number; quantity: number }[] = [];
          pending.forEach((p, i) => {
            const outcome = first[i]!;
            if (!outcome.ok) {
              freed.set(p.variationId, (freed.get(p.variationId) ?? 0) + p.qty);
            } else if (p.qty < p.want) {
              const extra = Math.min(p.want - p.qty, freed.get(p.variationId) ?? 0);
              if (extra > 0) {
                freed.set(p.variationId, (freed.get(p.variationId) ?? 0) - extra);
                topUps.push({ index: i, quantity: extra });
              }
            }
          });
          return topUps;
        },
      });
      pending.forEach((p, i) => {
        const outcome = outcomes[i]!;
        // Lỗi nghiệp vụ của RIÊNG dòng này (tồn kho đổi giữa lúc đọc và ghi, SP vừa bị ẩn) → bỏ qua dòng; lỗi hạ tầng do addItems ném ra.
        if (!outcome.ok) {
          results[p.slot] = { orderItemId: p.line.id, status: 'skipped', reason: outcome.error === 'UNAVAILABLE' ? 'INACTIVE' : 'EXCEEDS_STOCK', addedQuantity: 0 };
          return;
        }
        const added = p.qty + (outcome.toppedUp ?? 0);
        if (added < p.want) results[p.slot] = { orderItemId: p.line.id, status: 'partial', reason: 'EXCEEDS_STOCK', addedQuantity: added };
        else if (outcome.toppedUp) results[p.slot] = { orderItemId: p.line.id, status: 'added', addedQuantity: added };
      });
    }
    const cart = toPublicCart(await this.cart.getCart(userId));
    return { ...cart, cart, results };
  }
}
