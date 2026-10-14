import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { OrderStatus } from '@tubutree/shared-types';
import { PrismaService } from '../../prisma/prisma.service';
import { paginated, skipTake } from '../../common/pagination';
import { NotificationsService } from '../notifications/notifications.service';
import { SystemConfigService } from '../system-config/system-config.service';
import { OrderStatusService, toHttpBadRequest } from '../orders/order-status.service';
import {
  DEFAULT_MERCHANT_COMMISSION_PCT,
  DEFAULT_MERCHANT_CONFIRM_SLA_HOURS,
  DEFAULT_MERCHANT_DELIVER_SLA_DAYS,
  DEFAULT_MERCHANT_NEGATIVE_PAYOUT_DUE_DAYS,
  DEFAULT_MERCHANT_SETTLEMENT_HOLD_DAYS,
  DEFAULT_MERCHANT_SHIP_SLA_HOURS,
  RETURN_REF_PREFIX,
} from './merchant-config';
import {
  ITEM_REF_PREFIX,
  consignmentPartialReversals,
  consignmentSaleLines,
  consignmentWholeReversal,
  termsAt,
  type ConsignmentItem,
  type ConsignmentOrder,
  type ConsignmentSale,
  type ConsignmentTerms,
  type ConsignmentTermsRow,
} from './merchant-consignment';

type Db = Prisma.TransactionClient;

export interface SettlementConfig {
  holdDays: number;
  defaultCommissionPct: number;
}

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

/**
 * Hướng tiền của phiếu đối soát: dương Tubu chuyển cho đối tác, âm đối tác nộp lại Tubu (phí sàn trên đơn COD đối tác đã tự thu)
 * — kèm nội dung chuyển khoản theo mã phiếu và hạn nộp của phiếu âm chưa thu (R2-MERCHANT-4).
 */
export function payoutView<P extends { id: string; amount: number; status: string; createdAt: Date }>(p: P, dueDays: number) {
  const toTubu = p.amount < 0;
  return {
    ...p,
    direction: toTubu ? ('TO_TUBU' as const) : ('TO_MERCHANT' as const),
    transferMemo: `TUBU DS ${p.id.slice(-8).toUpperCase()}`,
    dueAt: toTubu && p.status === 'PENDING' ? new Date(p.createdAt.getTime() + dueDays * DAY) : null,
  };
}

/** Đơn đối tác tự giao: đủ thông tin người nhận vì đối tác phải tự giao (docs/2026-10-14-merchant-fulfilment-design.md mục 5). */
const FULFIL_ORDER_SELECT = {
  id: true,
  code: true,
  status: true,
  subtotal: true,
  discount: true,
  shippingFee: true,
  total: true,
  paymentMethod: true,
  paymentStatus: true,
  shippingAddress: true,
  note: true,
  shippingPartner: true,
  shippingCode: true,
  trackingLink: true,
  merchantAcceptedAt: true,
  shippedAt: true,
  deliveredAt: true,
  createdAt: true,
  checkoutGroup: true,
  items: {
    select: { id: true, productName: true, variationName: true, unitPrice: true, quantity: true, total: true },
  },
  user: { select: { fullName: true, phone: true } },
} satisfies Prisma.OrderSelect;

export const MERCHANT_FULFIL_STATUSES = ['CONFIRMED', 'PACKED', 'SHIPPING', 'DELIVERED', 'CANCELLED', 'RETURNED'] as const;

export interface ShipDto {
  carrier: string;
  trackingCode: string;
  trackingUrl?: string;
}

export interface SlaConfig {
  confirmHours: number;
  shipHours: number;
  deliverDays: number;
}

export type SlaState = 'CONFIRM_OVERDUE' | 'SHIP_OVERDUE' | 'DELIVER_OVERDUE' | null;

/** Hạn của bước đối tác đang phải làm và đơn đã quá hạn chưa (null: không có bước nào đang chờ đối tác). */
export function slaStateOf(
  o: { status: string; createdAt: Date; merchantAcceptedAt: Date | null; shippedAt: Date | null },
  sla: SlaConfig,
  now: Date,
): { state: SlaState; dueAt: Date | null } {
  if (o.status === 'CONFIRMED' && !o.merchantAcceptedAt) {
    const dueAt = new Date(o.createdAt.getTime() + sla.confirmHours * HOUR);
    return { state: dueAt < now ? 'CONFIRM_OVERDUE' : null, dueAt };
  }
  if (o.status === 'CONFIRMED' || o.status === 'PACKED') {
    const dueAt = new Date(o.createdAt.getTime() + sla.shipHours * HOUR);
    return { state: dueAt < now ? 'SHIP_OVERDUE' : null, dueAt };
  }
  if (o.status === 'SHIPPING' && o.shippedAt) {
    const dueAt = new Date(o.shippedAt.getTime() + sla.deliverDays * DAY);
    return { state: dueAt < now ? 'DELIVER_OVERDUE' : null, dueAt };
  }
  return { state: null, dueAt: null };
}

export interface SettlementLine {
  orderId: string;
  orderCode: string;
  kind: 'SALE' | 'REVERSAL';
  /**
   * '' = dòng của cả đơn; `RETURN:<id>` = đảo một lần trả một phần (D3). Hàng "Tubu giao hộ": `ITEM:<dòng hàng>` và
   * `RETURN:<id>:ITEM:<dòng hàng>` (merchant-consignment.ts).
   */
  refKey: string;
  goodsAmount: number;
  shippingFee: number;
  commissionAmount: number;
  /** Phí Tubu giao hộ (chỉ dòng hàng giao hộ; 0 với đơn tự giao). */
  opsFeeAmount: number;
  codCollected: number;
  netAmount: number;
  deliveredAt: Date | null;
  /** Dòng hàng "Tubu giao hộ" của đơn kho Tubu; null = đơn gian hàng tự giao. */
  orderItemId: string | null;
  item?: { productName: string; variationName: string | null; quantity: number } | null;
}

/**
 * Một dòng đối soát của đơn đã giao (mục 7 thiết kế): tiền hàng sau combo + phí giao − phí sàn − tiền COD đối tác đã tự thu.
 * Dương: Tubu trả đối tác; âm: đối tác nộp lại Tubu (mã giảm/Điểm Xanh Tubu tài trợ nhỏ hơn phí sàn).
 */
export function saleLineOf(o: {
  id: string;
  code: string;
  paymentMethod: string;
  total: number;
  shippingFee: number;
  merchantCommissionPct: Prisma.Decimal | number | null;
  deliveredAt: Date | null;
  items: { total: number }[];
}): SettlementLine {
  const goodsAmount = o.items.reduce((s, it) => s + it.total, 0);
  const pct = o.merchantCommissionPct == null ? 0 : Number(o.merchantCommissionPct);
  const commissionAmount = Math.round(goodsAmount * pct);
  const codCollected = o.paymentMethod === 'COD' ? o.total : 0;
  return {
    orderId: o.id,
    orderCode: o.code,
    kind: 'SALE',
    refKey: '',
    goodsAmount,
    shippingFee: o.shippingFee,
    commissionAmount,
    opsFeeAmount: 0,
    codCollected,
    netAmount: goodsAmount + o.shippingFee - commissionAmount - codCollected,
    deliveredAt: o.deliveredAt,
    orderItemId: null,
  };
}

type PayoutAmounts = Pick<SettlementLine, 'goodsAmount' | 'shippingFee' | 'commissionAmount' | 'codCollected' | 'netAmount'>;

export { RETURN_REF_PREFIX };

/** Lần trả một phần đã duyệt (p5, D3) của một đơn đối tác — đủ để tính phần đối tác trả lại. */
export interface ApprovedPartialReturn {
  id: string;
  reviewedAt: Date | null;
  /** Phí giao Tubu đã hoàn khách ở lần trả này (lỗi do shop). */
  shippingRefund: number;
  items: { orderItemId: string; quantity: number }[];
}

/**
 * Dòng REVERSAL cho từng lần trả một phần của đơn đối tác (cùng công thức với dòng đảo cả đơn, áp lên phần hàng trả): đối tác
 * nhận hàng về nên trả lại tiền hàng của các đơn vị trả + phí giao Tubu đã hoàn khách − phí sàn của phần đó. COD không đảo
 * (tiền mặt đối tác thu đã nằm trong dòng SALE). Tính luỹ kế theo thứ tự duyệt rồi lấy hiệu, nên nhiều lần trả cộng lại đúng
 * bằng trả cả dòng, không lệch làm tròn.
 */
export function partialReversalLinesOf(
  o: { id: string; code: string; merchantCommissionPct: Prisma.Decimal | number | null; items: { id: string; total: number; quantity: number }[] },
  requests: ApprovedPartialReturn[],
): SettlementLine[] {
  if (requests.length === 0) return [];
  const pct = o.merchantCommissionPct == null ? 0 : Number(o.merchantCommissionPct);
  const items = new Map(o.items.map((i) => [i.id, i]));
  const returned = new Map<string, number>();
  const goodsOf = () =>
    [...returned].reduce((s, [id, q]) => {
      const it = items.get(id);
      return it && it.quantity > 0 ? s + Math.round((it.total * Math.min(q, it.quantity)) / it.quantity) : s;
    }, 0);
  const ordered = [...requests].sort(
    (a, b) => (a.reviewedAt?.getTime() ?? 0) - (b.reviewedAt?.getTime() ?? 0) || a.id.localeCompare(b.id),
  );
  const out: SettlementLine[] = [];
  let goodsBefore = 0;
  for (const r of ordered) {
    for (const it of r.items) returned.set(it.orderItemId, (returned.get(it.orderItemId) ?? 0) + it.quantity);
    const goodsAfter = goodsOf();
    const goods = goodsAfter - goodsBefore;
    const commission = Math.round(goodsAfter * pct) - Math.round(goodsBefore * pct);
    goodsBefore = goodsAfter;
    const ship = Math.max(0, r.shippingRefund);
    if (goods === 0 && ship === 0) continue;
    out.push({
      orderId: o.id,
      orderCode: o.code,
      kind: 'REVERSAL',
      refKey: `${RETURN_REF_PREFIX}${r.id}`,
      goodsAmount: -goods,
      shippingFee: -ship,
      commissionAmount: -commission,
      opsFeeAmount: 0,
      codCollected: 0,
      netAmount: -(goods + ship - commission),
      deliveredAt: null,
      orderItemId: null,
    });
  }
  return out;
}

/**
 * Dòng đảo của đơn đối tác bị trả (Tubu đã hoàn khách). Đối tác nhận hàng về nên trả lại phần đã được tính cho đơn: đã đối soát
 * thì đảo tiền hàng + phí giao − phí sàn; tiền COD đối tác tự thu vẫn nằm ở đối tác nên không đảo, tổng SALE + REVERSAL của đơn
 * COD = −số tiền đã thu. Chưa đối soát thì đơn trả trước không có gì để đảo, còn đơn COD là đúng số tiền mặt đối tác đang giữ.
 * Các lần trả một phần trước đó đã có dòng REVERSAL riêng (`partials`, số âm) nên dòng của cả đơn chỉ đảo phần còn lại.
 */
export function reversalLineOf(
  o: { id: string; code: string; paymentMethod: string; paymentStatus: string; total: number },
  sale: PayoutAmounts | null,
  partials: PayoutAmounts[] = [],
): SettlementLine | null {
  const base = { orderId: o.id, orderCode: o.code, kind: 'REVERSAL' as const, refKey: '', deliveredAt: null, orderItemId: null, opsFeeAmount: 0 };
  if (sale) {
    const sum = (k: 'goodsAmount' | 'shippingFee' | 'commissionAmount') => sale[k] + partials.reduce((s, p) => s + p[k], 0);
    const goods = sum('goodsAmount');
    const ship = sum('shippingFee');
    const commission = sum('commissionAmount');
    return {
      ...base,
      goodsAmount: -goods,
      shippingFee: -ship,
      commissionAmount: -commission,
      codCollected: 0,
      netAmount: -(goods + ship - commission),
    };
  }
  if (o.paymentMethod !== 'COD' || o.paymentStatus !== 'REFUNDED' || o.total <= 0) return null;
  return { ...base, goodsAmount: 0, shippingFee: 0, commissionAmount: 0, codCollected: o.total, netAmount: -o.total };
}

function saleOf(l: SettlementLine): ConsignmentSale {
  return {
    orderId: l.orderId,
    orderCode: l.orderCode,
    orderItemId: l.orderItemId ?? '',
    quantity: l.item?.quantity ?? 0,
    goodsAmount: l.goodsAmount,
    commissionAmount: l.commissionAmount,
    opsFeeAmount: l.opsFeeAmount,
    item: l.item ?? null,
  };
}

/** Dòng phiếu đã lập kèm tên hàng của dòng "Tubu giao hộ" (cùng dạng với dòng của bảng kê). */
const PAYOUT_LINES_INCLUDE = {
  orderBy: { createdAt: 'asc' },
  include: { orderItem: { select: { productName: true, variationName: true, quantity: true } } },
} satisfies Prisma.MerchantPayout$linesArgs;

function withLineItems<P extends { lines: (Record<string, unknown> & { orderItem: SettlementLine['item'] })[] }>(p: P) {
  return { ...p, lines: p.lines.map(({ orderItem, ...l }) => ({ ...l, item: orderItem ?? null })) };
}

@Injectable()
export class MerchantFulfilmentService {
  private readonly logger = new Logger(MerchantFulfilmentService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly orderStatus: OrderStatusService,
    @Optional() private readonly notifications?: NotificationsService,
    @Optional() private readonly config?: SystemConfigService,
  ) {}

  private async num(key: string, fallback: number): Promise<number> {
    return (await this.config?.get<number>(key, fallback)) ?? fallback;
  }

  async slaConfig(): Promise<SlaConfig> {
    const [confirmHours, shipHours, deliverDays] = await Promise.all([
      this.num('merchant.confirm_sla_hours', DEFAULT_MERCHANT_CONFIRM_SLA_HOURS),
      this.num('merchant.ship_sla_hours', DEFAULT_MERCHANT_SHIP_SLA_HOURS),
      this.num('merchant.deliver_sla_days', DEFAULT_MERCHANT_DELIVER_SLA_DAYS),
    ]);
    return { confirmHours, shipHours, deliverDays };
  }

  private async merchantStore(userId: string) {
    const store = await this.prisma.storefront.findFirst({
      where: { ownerUserId: userId },
      select: { id: true, type: true, title: true, ownerUserId: true },
    });
    if (!store || store.type !== 'MERCHANT') {
      throw new ForbiddenException('Chỉ gian hàng đối tác tự giao hàng mới có đơn cần giao.');
    }
    return store;
  }

  // ── Đối tác: đơn cần giao ──

  async listOrders(userId: string, status: string | undefined, page = 1, limit = 20, now = new Date()) {
    const store = await this.merchantStore(userId);
    const base: Prisma.OrderWhereInput = { fulfiller: 'MERCHANT', fulfillerStorefrontId: store.id };
    const where: Prisma.OrderWhereInput = { ...base, ...(status ? { status: status as OrderStatus } : {}) };
    const [total, rows, grouped, sla] = await Promise.all([
      this.prisma.order.count({ where }),
      this.prisma.order.findMany({ where, orderBy: { createdAt: 'desc' }, select: FULFIL_ORDER_SELECT, ...skipTake(page, limit) }),
      this.prisma.order.groupBy({
        by: ['status'],
        where: { ...base, status: { in: ['CONFIRMED', 'PACKED', 'SHIPPING'] } },
        _count: { _all: true },
      }),
      this.slaConfig(),
    ]);
    const counts = Object.fromEntries(grouped.map((g) => [g.status, g._count._all]));
    const data = rows.map((o) => ({ ...o, sla: slaStateOf(o, sla, now) }));
    return { ...paginated(data, page, limit, total), counts, slaConfig: sla };
  }

  private async ownOrder(userId: string, orderId: string) {
    const store = await this.merchantStore(userId);
    const order = await this.prisma.order.findFirst({
      where: { id: orderId, fulfiller: 'MERCHANT', fulfillerStorefrontId: store.id },
      select: { id: true, code: true, status: true, merchantAcceptedAt: true },
    });
    if (!order) throw new NotFoundException('Không tìm thấy đơn cần giao của gian hàng bạn.');
    return { store, order };
  }

  private async transition(
    userId: string,
    order: { id: string; status: string },
    target: OrderStatus,
    opts: Parameters<OrderStatusService['setStatus']>[2],
  ) {
    let result: { status: string };
    try {
      result = await this.orderStatus.setStatus(order.id, target, {
        ...opts,
        actorType: 'MERCHANT',
        actorId: userId,
        expectedStatus: order.status as OrderStatus,
      });
    } catch (err) {
      toHttpBadRequest(err);
    }
    if (result.status !== target) {
      throw new ConflictException('Đơn vừa được cập nhật ở nơi khác. Tải lại danh sách để xem trạng thái mới.');
    }
    return result;
  }

  async accept(userId: string, orderId: string) {
    const { order } = await this.ownOrder(userId, orderId);
    if (order.status !== 'CONFIRMED' && order.status !== 'PACKED') {
      throw new BadRequestException('Đơn không còn chờ xác nhận.');
    }
    await this.prisma.order.updateMany({
      where: { id: order.id, status: { in: ['CONFIRMED', 'PACKED'] }, merchantAcceptedAt: null },
      data: { merchantAcceptedAt: new Date() },
    });
    return this.prisma.order.findUniqueOrThrow({ where: { id: order.id }, select: FULFIL_ORDER_SELECT });
  }

  async pack(userId: string, orderId: string) {
    const { order } = await this.ownOrder(userId, orderId);
    if (order.status === 'PACKED') return this.prisma.order.findUniqueOrThrow({ where: { id: order.id }, select: FULFIL_ORDER_SELECT });
    if (order.status !== 'CONFIRMED') throw new BadRequestException('Chỉ đơn đang chờ xử lý mới chuyển được sang "Đã đóng gói".');
    await this.transition(userId, order, 'PACKED', { patch: { merchantAcceptedAt: order.merchantAcceptedAt ?? new Date() } });
    return this.prisma.order.findUniqueOrThrow({ where: { id: order.id }, select: FULFIL_ORDER_SELECT });
  }

  async ship(userId: string, orderId: string, dto: ShipDto) {
    const { order } = await this.ownOrder(userId, orderId);
    if (order.status !== 'CONFIRMED' && order.status !== 'PACKED') {
      throw new BadRequestException('Chỉ đơn chưa gửi đi mới nhập được mã vận đơn.');
    }
    const carrier = dto.carrier.trim();
    const trackingCode = dto.trackingCode.trim();
    if (!carrier || !trackingCode) throw new BadRequestException('Cần nhập hãng vận chuyển và mã vận đơn.');
    const now = new Date();
    await this.transition(userId, order, 'SHIPPING', {
      patch: {
        shippingPartner: carrier,
        shippingCode: trackingCode,
        trackingLink: dto.trackingUrl?.trim() || null,
        shippedAt: now,
        merchantAcceptedAt: order.merchantAcceptedAt ?? now,
      },
    });
    return this.prisma.order.findUniqueOrThrow({ where: { id: order.id }, select: FULFIL_ORDER_SELECT });
  }

  async deliver(userId: string, orderId: string) {
    const { order } = await this.ownOrder(userId, orderId);
    if (order.status !== 'SHIPPING') throw new BadRequestException('Chỉ đơn đang giao mới xác nhận "Đã giao" được.');
    await this.transition(userId, order, 'DELIVERED', {});
    return this.prisma.order.findUniqueOrThrow({ where: { id: order.id }, select: FULFIL_ORDER_SELECT });
  }

  /** Giao thất bại (khách không nhận, hoàn về): huỷ đơn, hoàn tiền trả trước, hoàn kho như mọi đơn huỷ. */
  async fail(userId: string, orderId: string, reason: string) {
    const { store, order } = await this.ownOrder(userId, orderId);
    if (order.status !== 'SHIPPING') throw new BadRequestException('Chỉ đơn đang giao mới báo giao thất bại được.');
    // Giao không thành = hàng quay về gian hàng: đây là luồng hoàn của D1 nên huỷ được dù đã gửi hàng.
    return this.cancelBySeller(userId, store.title, order, `Giao không thành công: ${reason.trim()}`, true);
  }

  /** Đối tác huỷ trước khi giao cho đơn vị vận chuyển (cùng mốc D1: chưa SHIPPING). */
  async cancel(userId: string, orderId: string, reason: string) {
    const { store, order } = await this.ownOrder(userId, orderId);
    if (order.status !== 'CONFIRMED' && order.status !== 'PACKED') {
      throw new BadRequestException('Đơn đã gửi đi thì không huỷ được; nếu khách không nhận, chọn "Giao không thành công".');
    }
    return this.cancelBySeller(userId, store.title, order, reason.trim());
  }

  private async cancelBySeller(
    userId: string,
    storeTitle: string,
    order: { id: string; status: string },
    reason: string,
    returnedToSender = false,
  ) {
    if (!reason) throw new BadRequestException('Cần nhập lý do để báo khách.');
    await this.transition(userId, order, 'CANCELLED', {
      note: reason,
      returnedToSender,
      notifyEvent: 'MERCHANT_ORDER_CANCELLED_BY_SELLER',
      notifyData: { reason, store: storeTitle },
    });
    return this.prisma.order.findUniqueOrThrow({ where: { id: order.id }, select: FULFIL_ORDER_SELECT });
  }

  // ── Đối soát ──

  async holdDays(): Promise<number> {
    return this.num('merchant.settlement_hold_days', DEFAULT_MERCHANT_SETTLEMENT_HOLD_DAYS);
  }

  /**
   * Cấu hình bảng kê. Lập phiếu đọc trước khi mở transaction: SystemConfigService đọc qua pool chung, đọc trong lúc giữ kết nối
   * của transaction (và các lần lập phiếu khác đang chờ khoá) có thể cạn pool.
   */
  async settlementConfig(): Promise<SettlementConfig> {
    const [holdDays, defaultCommissionPct] = await Promise.all([
      this.holdDays(),
      this.num('merchant.commission_pct', DEFAULT_MERCHANT_COMMISSION_PCT),
    ]);
    return { holdDays, defaultCommissionPct };
  }

  /**
   * Bảng kê chưa đối soát của một gian hàng, tính từ đơn lúc xem (không lưu sẵn): đơn đã giao qua hạn đổi/trả chưa vào phiếu
   * nào (SALE), mỗi lần trả một phần đã duyệt của đơn đã/đang vào phiếu (REVERSAL `RETURN:<id>`) và đơn bị trả mà đối tác đã
   * được tính tiền hoặc đang giữ tiền COD (REVERSAL của cả đơn, âm, chỉ phần còn lại sau các lần trả một phần). Hàng "Tubu
   * giao hộ" theo cùng luật nhưng từng dòng hàng (consignmentStatement). Chỉ tính đơn Tubu đã thu tiền (trả trước đã PAID)
   * hoặc COD — cùng luật doanh thu của admin. `db` là transaction khi lập phiếu để bảng kê và phiếu cùng một lần đọc.
   */
  async statementFor(storefrontId: string, now = new Date(), db: Db = this.prisma, cfg?: SettlementConfig) {
    const { holdDays, defaultCommissionPct } = cfg ?? (await this.settlementConfig());
    const cutoff = new Date(now.getTime() - holdDays * DAY);
    const saleSelect = {
      id: true,
      code: true,
      paymentMethod: true,
      total: true,
      shippingFee: true,
      merchantCommissionPct: true,
      deliveredAt: true,
      items: { select: { id: true, total: true, quantity: true } },
    } satisfies Prisma.OrderSelect;
    const storedSelect = { kind: true, refKey: true, goodsAmount: true, shippingFee: true, commissionAmount: true, codCollected: true, netAmount: true } as const;
    const base = { fulfiller: 'MERCHANT' as const, fulfillerStorefrontId: storefrontId };
    const collected: Prisma.OrderWhereInput = { OR: [{ paymentStatus: 'PAID' }, { paymentMethod: 'COD' }] };
    const [sales, upcoming, returned, settledWithReturns] = await Promise.all([
      db.order.findMany({
        where: { ...base, ...collected, status: 'DELIVERED', deliveredAt: { lte: cutoff }, merchantPayoutLines: { none: { kind: 'SALE' } } },
        select: saleSelect,
        orderBy: { deliveredAt: 'asc' },
      }),
      db.order.findMany({
        where: { ...base, ...collected, status: 'DELIVERED', deliveredAt: { gt: cutoff } },
        select: saleSelect,
        orderBy: { deliveredAt: 'asc' },
      }),
      db.order.findMany({
        where: {
          ...base,
          status: 'RETURNED',
          merchantPayoutLines: { none: { kind: 'REVERSAL', refKey: '' } },
          OR: [{ merchantPayoutLines: { some: { kind: 'SALE' } } }, { paymentMethod: 'COD', paymentStatus: 'REFUNDED' }],
        },
        select: {
          ...saleSelect,
          paymentStatus: true,
          merchantPayoutLines: { select: storedSelect },
        },
      }),
      // Đơn đã vào phiếu (có SALE) còn lần trả một phần đã duyệt chưa có dòng đảo.
      db.$queryRaw<{ orderId: string }[]>`
        SELECT DISTINCT rr."orderId" FROM "return_requests" rr
          JOIN "orders" o ON o."id" = rr."orderId"
         WHERE o."fulfiller" = 'MERCHANT' AND o."fulfillerStorefrontId" = ${storefrontId}
           AND rr."status" = 'APPROVED' AND rr."fullReturn" = false
           AND EXISTS (SELECT 1 FROM "merchant_payout_lines" s WHERE s."orderId" = o."id" AND s."kind" = 'SALE')
           AND NOT EXISTS (
             SELECT 1 FROM "merchant_payout_lines" l
              WHERE l."orderId" = o."id" AND l."kind" = 'REVERSAL' AND l."refKey" = ${RETURN_REF_PREFIX} || rr."id")`,
    ]);
    const returnedIds = new Set(returned.map((o) => o.id));
    const settledIds = settledWithReturns.map((r) => r.orderId).filter((id) => !returnedIds.has(id));
    const settled = settledIds.length
      ? await db.order.findMany({
          where: { id: { in: settledIds }, ...base },
          select: { ...saleSelect, merchantPayoutLines: { select: storedSelect } },
        })
      : [];
    const partialOrderIds = [...sales, ...returned, ...settled, ...upcoming].map((o) => o.id);
    const partialRows = partialOrderIds.length
      ? await db.returnRequest.findMany({
          where: { orderId: { in: partialOrderIds }, status: 'APPROVED', fullReturn: false },
          select: { id: true, orderId: true, reviewedAt: true, shippingRefund: true, items: { select: { orderItemId: true, quantity: true } } },
        })
      : [];
    const partialsOf = (order: Parameters<typeof partialReversalLinesOf>[0]) =>
      partialReversalLinesOf(
        order,
        partialRows.filter((r) => r.orderId === order.id),
      );
    const notStored = (stored: { kind: string; refKey: string }[]) => (l: SettlementLine) =>
      !stored.some((x) => x.kind === l.kind && x.refKey === l.refKey);

    const consignment = await this.consignmentStatement(storefrontId, cutoff, holdDays, db, defaultCommissionPct);
    const lines: SettlementLine[] = [
      // SALE vừa đủ hạn đi cùng phiếu với các lần trả một phần của nó (đối tác không được tính tiền hàng khách đã trả).
      ...sales.flatMap((o) => [saleLineOf(o), ...partialsOf(o)]),
      ...settled.flatMap((o) => partialsOf(o).filter(notStored(o.merchantPayoutLines))),
      ...returned.flatMap((o) => {
        const sale = o.merchantPayoutLines.find((l) => l.kind === 'SALE') ?? null;
        if (!sale) return reversalLineOf(o, null) ?? [];
        const partials = partialsOf(o);
        const whole = reversalLineOf(o, sale, partials);
        return [...partials.filter(notStored(o.merchantPayoutLines)), ...(whole ? [whole] : [])];
      }),
      ...consignment.lines,
    ];
    return {
      holdDays,
      lines,
      total: lines.reduce((s, l) => s + l.netAmount, 0),
      // Sắp đủ hạn: tiền bán kèm các lần trả một phần đã duyệt (đối tác thấy đúng số sẽ nhận, R2-LIFECYCLE-8).
      upcoming: [
        ...upcoming.flatMap((o) => {
          const availableAt = o.deliveredAt ? new Date(o.deliveredAt.getTime() + holdDays * DAY) : null;
          return [saleLineOf(o), ...partialsOf(o)].map((l) => ({ ...l, availableAt }));
        }),
        ...consignment.upcoming,
      ],
      /** Mức phí hiện tại cho hàng "Tubu giao hộ" của gian hàng (áp cho đơn đặt từ giờ); null = gian hàng chưa có liên kết. */
      consignmentTerms: consignment.terms,
    };
  }

  /** Phí sàn (cùng mức đơn tự giao) và phí Tubu giao hộ hiện tại của gian hàng; phí sàn null = merchant.commission_pct. */
  async consignmentTerms(storefrontId: string, db: Db = this.prisma, defaultCommissionPct?: number): Promise<ConsignmentTerms> {
    const [sf, defaultPct] = await Promise.all([
      db.storefront.findUnique({
        where: { id: storefrontId },
        select: { commissionPct: true, consignmentFeePct: true, consignmentFeeFixed: true },
      }),
      defaultCommissionPct ?? this.num('merchant.commission_pct', DEFAULT_MERCHANT_COMMISSION_PCT),
    ]);
    return {
      commissionPct: sf?.commissionPct != null ? Number(sf.commissionPct) : defaultPct,
      feePct: sf ? Number(sf.consignmentFeePct) : 0,
      feeFixed: sf?.consignmentFeeFixed ?? 0,
    };
  }

  /** Lịch sử mức phí của gian hàng (mỗi lần admin sửa thêm một dòng) để chốt phí theo lúc đặt đơn. */
  private async termsHistory(storefrontId: string, db: Db, defaultPct: number): Promise<ConsignmentTermsRow[]> {
    const rows = await db.storefrontTermsHistory.findMany({
      where: { storefrontId },
      select: { commissionPct: true, consignmentFeePct: true, consignmentFeeFixed: true, effectiveFrom: true },
    });
    return rows.map((r) => ({
      commissionPct: r.commissionPct != null ? Number(r.commissionPct) : defaultPct,
      feePct: Number(r.consignmentFeePct),
      feeFixed: r.consignmentFeeFixed,
      effectiveFrom: r.effectiveFrom,
    }));
  }

  /**
   * Phần "Tubu giao hộ" của bảng kê. Dòng hàng chờ đối soát (lọc hết trong SQL): đơn kho Tubu đã giao, Tubu đã thu tiền (PAID
   * hoặc COD), đặt từ mốc merchant.consignment_settle_from, biến thể đang liên kết với gian hàng lúc đặt ([linkedAt,
   * unlinkedAt); liên kết takeover chỉ tính đơn đặt từ lúc admin xác nhận hàng ký gửi), chưa có SALE. Mốc giao = deliveredAt,
   * thiếu thì lần chuyển DELIVERED trong sổ trạng thái, không có nữa thì updatedAt; đủ hạn → bảng kê, chưa → sắp đủ hạn (kèm
   * các lần trả một phần đã duyệt). Phí lấy theo mức hiệu lực lúc đặt đơn. Dòng đã có SALE ở phiếu của gian hàng thì thêm dòng
   * đảo cho lần trả một phần mới duyệt và cho đơn bị trả; dòng đảo dùng số đã lưu ở SALE.
   */
  private async consignmentStatement(storefrontId: string, cutoff: Date, holdDays: number, db: Db, defaultCommissionPct: number) {
    const anyLink = await db.merchantPancakeLink.findMany({ where: { storefrontId }, select: { id: true }, take: 1 });
    if (anyLink.length === 0) {
      return { terms: null, lines: [] as SettlementLine[], upcoming: [] as (SettlementLine & { availableAt: Date | null })[] };
    }
    const itemSelect = { id: true, variationId: true, productName: true, variationName: true, quantity: true, total: true } as const;
    const [terms, history, pendingRows, returnedRows, partialRows] = await Promise.all([
      this.consignmentTerms(storefrontId, db, defaultCommissionPct),
      this.termsHistory(storefrontId, db, defaultCommissionPct),
      db.$queryRaw<{ orderItemId: string; orderId: string; code: string; total: number; shippingFee: number; createdAt: Date; deliveredAt: Date }[]>`
        SELECT oi."id" AS "orderItemId", o."id" AS "orderId", o."code", o."total", o."shippingFee", o."createdAt",
               COALESCE(
                 o."deliveredAt",
                 (SELECT MAX(h."createdAt") FROM "order_status_history" h WHERE h."orderId" = o."id" AND h."toStatus" = 'DELIVERED'),
                 o."updatedAt") AS "deliveredAt"
          FROM "order_items" oi
          JOIN "orders" o ON o."id" = oi."orderId"
         WHERE ${consignmentPendingSql(Prisma.sql`${storefrontId}`)}`,
      db.orderItem.findMany({
        where: {
          order: { status: 'RETURNED' },
          merchantPayoutLines: {
            some: { kind: 'SALE', payout: { storefrontId } },
            none: { kind: 'REVERSAL', refKey: { startsWith: ITEM_REF_PREFIX } },
          },
        },
        select: { id: true },
      }),
      // Dòng đã vào phiếu của gian hàng còn lần trả một phần đã duyệt chưa có dòng đảo.
      db.$queryRaw<{ orderItemId: string }[]>`
        SELECT DISTINCT ri."orderItemId" FROM "return_request_items" ri
          JOIN "return_requests" rr ON rr."id" = ri."returnRequestId"
          JOIN "merchant_payout_lines" s ON s."orderItemId" = ri."orderItemId" AND s."kind" = 'SALE'
          JOIN "merchant_payouts" p ON p."id" = s."payoutId"
         WHERE p."storefrontId" = ${storefrontId} AND rr."status" = 'APPROVED' AND rr."fullReturn" = false
           AND NOT EXISTS (
             SELECT 1 FROM "merchant_payout_lines" l
              WHERE l."orderItemId" = ri."orderItemId" AND l."kind" = 'REVERSAL'
                AND l."refKey" = ${RETURN_REF_PREFIX} || rr."id" || ${`:${ITEM_REF_PREFIX}`} || ri."orderItemId")`,
    ]);

    const pendingIds = new Set(pendingRows.map((r) => r.orderItemId));
    const orderIds = [...new Set(pendingRows.map((r) => r.orderId))];
    const settledIds = [...new Set([...returnedRows.map((r) => r.id), ...partialRows.map((r) => r.orderItemId)])];
    const [orderItems, settled] = await Promise.all([
      orderIds.length
        ? db.orderItem.findMany({ where: { orderId: { in: orderIds } }, select: { ...itemSelect, orderId: true } })
        : Promise.resolve([]),
      settledIds.length
        ? db.orderItem.findMany({
            where: { id: { in: settledIds } },
            select: {
              ...itemSelect,
              order: { select: { id: true, code: true, status: true } },
              merchantPayoutLines: { select: { kind: true, refKey: true, goodsAmount: true, commissionAmount: true, opsFeeAmount: true } },
            },
          })
        : Promise.resolve([]),
    ]);
    const orders = new Map<string, ConsignmentOrder>();
    for (const r of pendingRows) {
      if (orders.has(r.orderId)) continue;
      orders.set(r.orderId, {
        id: r.orderId,
        code: r.code,
        total: Number(r.total),
        shippingFee: Number(r.shippingFee),
        createdAt: r.createdAt,
        deliveredAt: r.deliveredAt,
        items: orderItems.filter((it) => it.orderId === r.orderId),
      });
    }
    const itemIds = [...pendingIds, ...settled.map((i) => i.id)];
    const requestRows = itemIds.length
      ? await db.returnRequestItem.findMany({
          where: { orderItemId: { in: itemIds }, returnRequest: { status: 'APPROVED', fullReturn: false } },
          select: { orderItemId: true, quantity: true, returnRequest: { select: { id: true, reviewedAt: true } } },
        })
      : [];
    const requestsOf = (orderItemId: string) =>
      requestRows
        .filter((r) => r.orderItemId === orderItemId)
        .map((r) => ({ id: r.returnRequest.id, reviewedAt: r.returnRequest.reviewedAt, quantity: r.quantity }));

    const lines: SettlementLine[] = [];
    const upcoming: (SettlementLine & { availableAt: Date | null })[] = [];
    const mine = (it: ConsignmentItem) => pendingIds.has(it.id);
    for (const order of [...orders.values()].sort((a, b) => (a.deliveredAt?.getTime() ?? 0) - (b.deliveredAt?.getTime() ?? 0))) {
      const due = order.deliveredAt !== null && order.deliveredAt <= cutoff;
      const availableAt = order.deliveredAt ? new Date(order.deliveredAt.getTime() + holdDays * DAY) : null;
      for (const sale of consignmentSaleLines(order, mine, termsAt(history, terms, order.createdAt))) {
        const withReturns = [sale, ...consignmentPartialReversals(saleOf(sale), requestsOf(sale.orderItemId ?? ''))];
        if (due) lines.push(...withReturns);
        else upcoming.push(...withReturns.map((l) => ({ ...l, availableAt })));
      }
    }
    for (const it of settled) {
      const stored = it.merchantPayoutLines.find((l) => l.kind === 'SALE');
      if (!stored) continue;
      const sale: ConsignmentSale = {
        orderId: it.order.id,
        orderCode: it.order.code,
        orderItemId: it.id,
        quantity: it.quantity,
        goodsAmount: stored.goodsAmount,
        commissionAmount: stored.commissionAmount,
        opsFeeAmount: stored.opsFeeAmount,
        item: { productName: it.productName, variationName: it.variationName, quantity: it.quantity },
      };
      const partials = consignmentPartialReversals(sale, requestsOf(it.id));
      const isStored = (l: SettlementLine) => it.merchantPayoutLines.some((x) => x.kind === l.kind && x.refKey === l.refKey);
      lines.push(...partials.filter((l) => !isStored(l)));
      if (it.order.status === 'RETURNED') {
        const whole = consignmentWholeReversal(sale, partials);
        if (whole && !isStored(whole)) lines.push(whole);
      }
    }
    return { terms, lines, upcoming };
  }

  async myStatement(userId: string) {
    const store = await this.merchantStore(userId);
    const [statement, payouts, dueDays, tubuAccount] = await Promise.all([
      this.statementFor(store.id),
      this.prisma.merchantPayout.findMany({
        where: { storefrontId: store.id, status: { not: 'CANCELLED' } },
        orderBy: { createdAt: 'desc' },
        take: 50,
        include: { lines: PAYOUT_LINES_INCLUDE },
      }),
      this.negativeDueDays(),
      this.tubuAccount(),
    ]);
    return {
      ...statement,
      payouts: payouts.map((p) => payoutView(withLineItems(p), dueDays)),
      negativeDueDays: dueDays,
      tubuAccount,
    };
  }

  private negativeDueDays(): Promise<number> {
    return this.num('merchant.negative_payout_due_days', DEFAULT_MERCHANT_NEGATIVE_PAYOUT_DUE_DAYS);
  }

  /** Tài khoản Tubu nhận tiền (cùng tài khoản nhận chuyển khoản của khách) — nơi đối tác nộp phiếu âm. */
  private async tubuAccount(): Promise<{ bankName: string; accountNo: string; accountName: string } | null> {
    if (!this.config) return null;
    const [bankName, accountNo, accountName] = await Promise.all([
      this.config.get<string>('payment.bank_name', ''),
      this.config.get<string>('payment.bank_account_no', ''),
      this.config.get<string>('payment.bank_account_name', ''),
    ]);
    return accountNo ? { bankName, accountNo, accountName } : null;
  }

  /** Khoá theo gian hàng cho tới hết transaction: lập và huỷ phiếu của cùng gian hàng chạy lần lượt. */
  private async lockStorePayouts(tx: Db, storefrontId: string) {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`merchant-payout:${storefrontId}`}))`;
  }

  /**
   * Lập phiếu đối soát gồm mọi dòng đủ điều kiện (đơn tự giao và hàng Tubu giao hộ). Bảng kê tính lại trong transaction sau khi
   * khoá gian hàng (huỷ phiếu cùng lúc phải chờ), nên phiếu không thể chứa dòng đảo của một SALE vừa bị huỷ. `expectedTotal` là
   * tổng admin vừa xem: lệch thì từ chối để admin xem lại. Unique (orderId, kind, refKey) vẫn là chốt chặn cuối.
   */
  async createPayout(adminId: string, storefrontId: string, note?: string, expectedTotal?: number) {
    const store = await this.prisma.storefront.findUnique({
      where: { id: storefrontId },
      select: { id: true, type: true, title: true, ownerUserId: true, bankName: true, bankAccountNo: true, bankAccountName: true },
    });
    if (!store || store.type !== 'MERCHANT') throw new NotFoundException('Không tìm thấy gian hàng đối tác.');
    const cfg = await this.settlementConfig();
    let payout;
    try {
      payout = await this.prisma.$transaction(
        async (tx) => {
          await this.lockStorePayouts(tx, store.id);
          const { lines, total } = await this.statementFor(store.id, new Date(), tx, cfg);
          if (lines.length === 0) throw new BadRequestException('Không có đơn nào đủ điều kiện đối soát.');
          if (expectedTotal !== undefined && expectedTotal !== total) {
            throw new ConflictException(
              `Số tiền chờ đối soát vừa thay đổi (${expectedTotal.toLocaleString('vi-VN')}đ → ${total.toLocaleString('vi-VN')}đ). Tải lại bảng kê rồi lập phiếu.`,
            );
          }
          return tx.merchantPayout.create({
            data: {
              storefrontId: store.id,
              amount: total,
              bankInfo: { bankName: store.bankName, accountNo: store.bankAccountNo, accountName: store.bankAccountName },
              createdBy: adminId,
              note: note?.trim() || null,
              lines: {
                create: lines.map((l) => ({
                  orderId: l.orderId,
                  orderCode: l.orderCode,
                  kind: l.kind,
                  refKey: l.refKey,
                  goodsAmount: l.goodsAmount,
                  shippingFee: l.shippingFee,
                  commissionAmount: l.commissionAmount,
                  opsFeeAmount: l.opsFeeAmount,
                  codCollected: l.codCollected,
                  netAmount: l.netAmount,
                  orderItemId: l.orderItemId,
                })),
              },
            },
            include: { lines: true },
          });
        },
        { maxWait: 15_000, timeout: 60_000 },
      );
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        throw new ConflictException('Một phiếu đối soát khác vừa được lập cho các đơn này. Tải lại để xem phiếu mới.');
      }
      throw err;
    }
    await this.notifyOwner(store.ownerUserId, 'MERCHANT_PAYOUT_CREATED', {
      amount: payout.amount.toLocaleString('vi-VN'),
      count: String(payout.lines.length),
    });
    return payout;
  }

  async markPayoutPaid(adminId: string, payoutId: string, bankRef: string) {
    const ref = bankRef.trim();
    if (!ref) throw new BadRequestException('Cần nhập mã giao dịch ngân hàng.');
    const flipped = await this.prisma.merchantPayout.updateMany({
      where: { id: payoutId, status: 'PENDING' },
      data: { status: 'PAID', paidAt: new Date(), paidBy: adminId, bankRef: ref },
    });
    const payout = await this.prisma.merchantPayout.findUnique({
      where: { id: payoutId },
      include: { storefront: { select: { ownerUserId: true } } },
    });
    if (!payout) throw new NotFoundException('Không tìm thấy phiếu đối soát.');
    if (flipped.count === 0) {
      if (payout.status === 'PAID') return payout;
      throw new ConflictException('Phiếu đã bị huỷ, không đánh dấu đã chuyển được.');
    }
    await this.notifyOwner(payout.storefront.ownerUserId, 'MERCHANT_PAYOUT_PAID', {
      amount: payout.amount.toLocaleString('vi-VN'),
      bank_ref: ref,
    });
    return payout;
  }

  /**
   * Huỷ phiếu chưa chuyển: các đơn trong phiếu quay lại bảng kê. Không huỷ được phiếu chứa dòng SALE của đơn đã có dòng đảo ở
   * phiếu khác: huỷ thì đối tác bị trừ lại tiền của một đơn chưa từng được trả. Cùng khoá gian hàng với lập phiếu.
   */
  async cancelPayout(adminId: string, payoutId: string) {
    const target = await this.prisma.merchantPayout.findUnique({ where: { id: payoutId }, select: { storefrontId: true } });
    if (!target) throw new ConflictException('Chỉ huỷ được phiếu chưa chuyển tiền.');
    const done = await this.prisma.$transaction(async (tx) => {
      await this.lockStorePayouts(tx, target.storefrontId);
      const flipped = await tx.merchantPayout.updateMany({
        where: { id: payoutId, status: 'PENDING' },
        data: { status: 'CANCELLED', note: `Huỷ bởi ${adminId}` },
      });
      if (flipped.count === 0) return false;
      const sales = await tx.merchantPayoutLine.findMany({ where: { payoutId, kind: 'SALE' }, select: { orderId: true, orderItemId: true } });
      if (sales.length > 0) {
        // Đơn tự giao khoá theo đơn; hàng Tubu giao hộ theo dòng hàng (đơn kho Tubu có thể có hàng của nhiều gian hàng).
        const orderIds = sales.filter((l) => !l.orderItemId).map((l) => l.orderId);
        const itemIds = sales.flatMap((l) => (l.orderItemId ? [l.orderItemId] : []));
        const elsewhere = await tx.merchantPayoutLine.findFirst({
          where: {
            kind: 'REVERSAL',
            payoutId: { not: payoutId },
            OR: [{ orderId: { in: orderIds }, orderItemId: null }, { orderItemId: { in: itemIds } }],
          },
          select: { orderCode: true },
        });
        if (elsewhere) {
          throw new ConflictException(
            `Đơn ${elsewhere.orderCode} trong phiếu này đã có dòng đảo ở phiếu khác — huỷ phiếu chứa dòng đảo trước.`,
          );
        }
      }
      await tx.merchantPayoutLine.deleteMany({ where: { payoutId } });
      return true;
    });
    if (!done) throw new ConflictException('Chỉ huỷ được phiếu chưa chuyển tiền.');
    return this.prisma.merchantPayout.findUniqueOrThrow({ where: { id: payoutId } });
  }

  async listPayouts(storefrontId: string | undefined, page = 1, limit = 20) {
    const where: Prisma.MerchantPayoutWhereInput = storefrontId ? { storefrontId } : {};
    const [total, rows, dueDays] = await Promise.all([
      this.prisma.merchantPayout.count({ where }),
      this.prisma.merchantPayout.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        include: { storefront: { select: { id: true, title: true } }, lines: PAYOUT_LINES_INCLUDE },
        ...skipTake(page, limit),
      }),
      this.negativeDueDays(),
    ]);
    return paginated(
      rows.map((p) => payoutView(withLineItems(p), dueDays)),
      page,
      limit,
      total,
    );
  }

  /**
   * Gian hàng có thể có khoản chờ đối soát (đủ hạn hay chưa) — một câu SQL, có thể dư nhưng không sót: chỉ những gian hàng
   * này mới phải dựng bảng kê ở tổng quan admin.
   */
  private async storesWithPending(): Promise<Set<string>> {
    const rows = await this.prisma.$queryRaw<{ id: string }[]>`
      SELECT o."fulfillerStorefrontId" AS "id" FROM "orders" o
       WHERE o."fulfiller" = 'MERCHANT' AND o."fulfillerStorefrontId" IS NOT NULL AND (
         (o."status" = 'DELIVERED' AND (o."paymentStatus" = 'PAID' OR o."paymentMethod" = 'COD')
           AND NOT EXISTS (SELECT 1 FROM "merchant_payout_lines" s WHERE s."orderId" = o."id" AND s."kind" = 'SALE' AND s."orderItemId" IS NULL))
         OR (o."status" = 'RETURNED'
           AND NOT EXISTS (SELECT 1 FROM "merchant_payout_lines" r WHERE r."orderId" = o."id" AND r."kind" = 'REVERSAL' AND r."refKey" = '')
           AND (EXISTS (SELECT 1 FROM "merchant_payout_lines" s WHERE s."orderId" = o."id" AND s."kind" = 'SALE' AND s."orderItemId" IS NULL)
                OR (o."paymentMethod" = 'COD' AND o."paymentStatus" = 'REFUNDED')))
         OR EXISTS (
           SELECT 1 FROM "return_requests" rr
            WHERE rr."orderId" = o."id" AND rr."status" = 'APPROVED' AND rr."fullReturn" = false
              AND NOT EXISTS (SELECT 1 FROM "merchant_payout_lines" r WHERE r."orderId" = o."id" AND r."kind" = 'REVERSAL' AND r."refKey" = ${RETURN_REF_PREFIX} || rr."id")))
      UNION
      SELECT lk."storefrontId" FROM "merchant_pancake_links" lk
        JOIN "order_items" oi ON oi."variationId" = lk."variationId"
        JOIN "orders" o ON o."id" = oi."orderId"
       WHERE ${consignmentPendingSql(Prisma.raw('lk."storefrontId"'))}
      UNION
      SELECT p."storefrontId" FROM "merchant_payout_lines" s
        JOIN "merchant_payouts" p ON p."id" = s."payoutId"
        JOIN "orders" o ON o."id" = s."orderId"
       WHERE s."kind" = 'SALE' AND s."orderItemId" IS NOT NULL AND (
         (o."status" = 'RETURNED' AND NOT EXISTS (
            SELECT 1 FROM "merchant_payout_lines" r WHERE r."orderItemId" = s."orderItemId" AND r."kind" = 'REVERSAL' AND r."refKey" = s."refKey"))
         OR EXISTS (
            SELECT 1 FROM "return_request_items" ri JOIN "return_requests" rr ON rr."id" = ri."returnRequestId"
             WHERE ri."orderItemId" = s."orderItemId" AND rr."status" = 'APPROVED' AND rr."fullReturn" = false
               AND NOT EXISTS (
                 SELECT 1 FROM "merchant_payout_lines" r
                  WHERE r."orderItemId" = s."orderItemId" AND r."kind" = 'REVERSAL'
                    AND r."refKey" = ${RETURN_REF_PREFIX} || rr."id" || ${`:${ITEM_REF_PREFIX}`} || s."orderItemId")))`;
    return new Set(rows.map((r) => r.id));
  }

  /**
   * Tổng quan cho admin: mỗi gian hàng đối tác có đơn tự giao hoặc hàng "Tubu giao hộ" — số đơn đang xử lý, quá hạn, số khoản
   * và số tiền chờ đối soát (kèm số khoản giao hộ), mức phí sàn/phí giao hộ để admin sửa. Bảng kê chỉ dựng cho gian hàng có
   * khoản chờ (storesWithPending), số đơn đang xử lý đếm gộp một lần.
   */
  async adminOverview(now = new Date()) {
    const [sla, linked, defaultCommissionPct, pendingStores] = await Promise.all([
      this.slaConfig(),
      this.prisma.merchantPancakeLink.findMany({ distinct: ['storefrontId'], select: { storefrontId: true } }),
      this.num('merchant.commission_pct', DEFAULT_MERCHANT_COMMISSION_PCT),
      this.storesWithPending(),
    ]);
    const stores = await this.prisma.storefront.findMany({
      where: { type: 'MERCHANT', OR: [{ fulfilledOrders: { some: {} } }, { id: { in: linked.map((l) => l.storefrontId) } }] },
      select: {
        id: true,
        title: true,
        owner: { select: { fullName: true, phone: true } },
        commissionPct: true,
        consignmentFeePct: true,
        consignmentFeeFixed: true,
      },
      orderBy: { title: 'asc' },
      take: 200,
    });
    const [overdue, activeRows] = await Promise.all([
      this.overdueOrders(sla, now),
      this.prisma.order.groupBy({
        by: ['fulfillerStorefrontId'],
        where: { fulfiller: 'MERCHANT', fulfillerStorefrontId: { in: stores.map((s) => s.id) }, status: { in: ['CONFIRMED', 'PACKED', 'SHIPPING'] } },
        _count: { _all: true },
      }),
    ]);
    const overdueByStore = new Map<string, number>();
    for (const o of overdue) {
      if (o.fulfillerStorefrontId) overdueByStore.set(o.fulfillerStorefrontId, (overdueByStore.get(o.fulfillerStorefrontId) ?? 0) + 1);
    }
    const activeByStore = new Map(activeRows.map((r) => [r.fulfillerStorefrontId, r._count._all]));
    const out = [];
    for (const sf of stores) {
      const statement = pendingStores.has(sf.id) ? await this.statementFor(sf.id, now) : null;
      const lines = statement?.lines ?? [];
      out.push({
        storefrontId: sf.id,
        title: sf.title,
        owner: sf.owner,
        activeOrders: activeByStore.get(sf.id) ?? 0,
        overdueOrders: overdueByStore.get(sf.id) ?? 0,
        settleableLines: lines.length,
        settleableAmount: statement?.total ?? 0,
        consignmentLines: lines.filter((l) => l.orderItemId).length,
        commissionPct: sf.commissionPct == null ? null : Number(sf.commissionPct),
        consignmentFeePct: Number(sf.consignmentFeePct),
        consignmentFeeFixed: sf.consignmentFeeFixed,
      });
    }
    return {
      slaConfig: sla,
      defaultCommissionPct,
      stores: out,
      overdue: overdue.map((o) => ({ ...o, sla: slaStateOf(o, sla, now) })),
    };
  }

  /**
   * Admin sửa phí sàn riêng của gian hàng (null = theo merchant.commission_pct) và phí "Tubu giao hộ" (% và cố định mỗi đơn).
   * Mỗi lần sửa ghi một dòng lịch sử có hiệu lực từ bây giờ: hàng giao hộ tính theo mức hiệu lực lúc đặt đơn, nên mức mới chỉ
   * áp cho đơn đặt từ giờ (đơn tự giao vốn đã chốt phí sàn trên đơn). Gian hàng chưa có lịch sử thì ghi mức cũ làm mốc gốc.
   */
  async updateStoreTerms(
    adminId: string,
    storefrontId: string,
    dto: { commissionPct?: number | null; consignmentFeePct?: number; consignmentFeeFixed?: number },
  ) {
    return this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`merchant-terms:${storefrontId}`}))`;
      const before = await tx.storefront.findUnique({
        where: { id: storefrontId },
        select: { type: true, commissionPct: true, consignmentFeePct: true, consignmentFeeFixed: true },
      });
      if (!before || before.type !== 'MERCHANT') throw new NotFoundException('Không tìm thấy gian hàng đối tác.');
      if ((await tx.storefrontTermsHistory.count({ where: { storefrontId } })) === 0) {
        await tx.storefrontTermsHistory.create({
          data: {
            storefrontId,
            commissionPct: before.commissionPct,
            consignmentFeePct: before.consignmentFeePct,
            consignmentFeeFixed: before.consignmentFeeFixed,
            effectiveFrom: new Date(0),
          },
        });
      }
      const updated = await tx.storefront.update({
        where: { id: storefrontId },
        data: {
          ...(dto.commissionPct !== undefined ? { commissionPct: dto.commissionPct } : {}),
          ...(dto.consignmentFeePct !== undefined ? { consignmentFeePct: dto.consignmentFeePct } : {}),
          ...(dto.consignmentFeeFixed !== undefined ? { consignmentFeeFixed: dto.consignmentFeeFixed } : {}),
        },
        select: { id: true, commissionPct: true, consignmentFeePct: true, consignmentFeeFixed: true },
      });
      await tx.storefrontTermsHistory.create({
        data: {
          storefrontId,
          commissionPct: updated.commissionPct,
          consignmentFeePct: updated.consignmentFeePct,
          consignmentFeeFixed: updated.consignmentFeeFixed,
          effectiveFrom: new Date(),
          changedById: adminId,
        },
      });
      return updated;
    });
  }

  /**
   * Admin xác nhận hàng đang bán của biến thể nhận lại (liên kết takeover) là hàng ký gửi của gian hàng: từ lúc này đơn mới
   * vào đối soát tự động. Bấm lại không đổi mốc.
   */
  async confirmConsignment(adminId: string, linkId: string) {
    const link = await this.prisma.merchantPancakeLink.findUnique({
      where: { id: linkId },
      select: { takeover: true, unlinkedAt: true },
    });
    if (!link) throw new NotFoundException('Không tìm thấy liên kết.');
    if (!link.takeover) throw new BadRequestException('Liên kết này không nhận lại hàng Tubu đang bán nên không cần xác nhận hàng ký gửi.');
    if (link.unlinkedAt) throw new BadRequestException('Liên kết đã gỡ.');
    await this.prisma.merchantPancakeLink.updateMany({
      where: { id: linkId, consignmentConfirmedAt: null },
      data: { consignmentConfirmedAt: new Date(), consignmentConfirmedBy: adminId },
    });
    return this.prisma.merchantPancakeLink.findUniqueOrThrow({
      where: { id: linkId },
      select: { id: true, takeover: true, stockAtLink: true, consignmentConfirmedAt: true, consignmentConfirmedBy: true },
    });
  }

  /** Đơn đối tác đang quá SLA ở bất kỳ bước nào. */
  async overdueOrders(sla: SlaConfig, now: Date, take = 200) {
    return this.prisma.order.findMany({
      where: overdueWhere(sla, now),
      select: {
        id: true,
        code: true,
        userId: true,
        status: true,
        total: true,
        createdAt: true,
        merchantAcceptedAt: true,
        shippedAt: true,
        merchantSlaNotifiedAt: true,
        fulfillerStorefrontId: true,
        fulfillerStorefront: { select: { title: true, ownerUserId: true, owner: { select: { phone: true } } } },
      },
      orderBy: { createdAt: 'asc' },
      take,
    });
  }

  /** Số đơn đối tác đang quá SLA — đếm thẳng, không bị trần `take` như danh sách. */
  async countOverdue(now = new Date()): Promise<number> {
    return this.prisma.order.count({ where: overdueWhere(await this.slaConfig(), now) });
  }

  private async notifyOwner(ownerUserId: string | null, template: string, data: Record<string, string>) {
    if (!ownerUserId || !this.notifications) return;
    await this.notifications
      .notify(ownerUserId, template, data)
      .catch((e: unknown) => this.logger.warn(`Báo đối tác ${template} lỗi: ${e instanceof Error ? e.message : e}`));
  }
}

function overdueWhere(sla: SlaConfig, now: Date): Prisma.OrderWhereInput {
  const confirmCut = new Date(now.getTime() - sla.confirmHours * HOUR);
  const shipCut = new Date(now.getTime() - sla.shipHours * HOUR);
  const deliverCut = new Date(now.getTime() - sla.deliverDays * DAY);
  return {
    fulfiller: 'MERCHANT',
    OR: [
      { status: 'CONFIRMED', merchantAcceptedAt: null, createdAt: { lt: confirmCut } },
      { status: { in: ['CONFIRMED', 'PACKED'] }, createdAt: { lt: shipCut } },
      { status: 'SHIPPING', shippedAt: { lt: deliverCut } },
    ],
  };
}

/**
 * Mốc bắt đầu đối soát giao hộ (system_config merchant.consignment_settle_from, ISO): đơn đặt trước mốc không tự vào bảng kê.
 * Đọc thẳng trong câu SQL để cùng một lần đọc với bảng kê; thiếu hoặc sai định dạng thì không giới hạn.
 */
const CONSIGNMENT_SETTLE_FROM_SQL = Prisma.sql`COALESCE((
  SELECT ((c."value" #>> '{}')::timestamptz AT TIME ZONE 'UTC') FROM "system_configs" c
   WHERE c."key" = 'merchant.consignment_settle_from' AND jsonb_typeof(c."value") = 'string'
     AND (c."value" #>> '{}') ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}'), '-infinity'::timestamp)`;

/**
 * Điều kiện SQL cho dòng hàng `oi` của đơn `o` đang chờ đối soát "Tubu giao hộ" của gian hàng `store`: đơn kho Tubu đã giao,
 * Tubu đã thu tiền (PAID hoặc COD — cùng luật doanh thu admin), đặt từ mốc bắt đầu, biến thể liên kết với gian hàng lúc đặt
 * (liên kết takeover: từ lúc admin xác nhận hàng ký gửi), chưa có SALE.
 */
function consignmentPendingSql(store: Prisma.Sql): Prisma.Sql {
  return Prisma.sql`o."fulfiller" = 'TUBU' AND o."status" = 'DELIVERED'
    AND (o."paymentStatus" = 'PAID' OR o."paymentMethod" = 'COD')
    AND o."createdAt" >= ${CONSIGNMENT_SETTLE_FROM_SQL}
    AND EXISTS (
      SELECT 1 FROM "merchant_pancake_links" l
       WHERE l."storefrontId" = ${store} AND l."variationId" = oi."variationId"
         AND o."createdAt" >= l."linkedAt" AND (l."unlinkedAt" IS NULL OR o."createdAt" < l."unlinkedAt")
         AND (NOT l."takeover" OR (l."consignmentConfirmedAt" IS NOT NULL AND o."createdAt" >= l."consignmentConfirmedAt")))
    AND NOT EXISTS (SELECT 1 FROM "merchant_payout_lines" s WHERE s."orderItemId" = oi."id" AND s."kind" = 'SALE')`;
}
