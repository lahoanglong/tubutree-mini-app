import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import { Prisma, type MerchantPayoutStatus } from '@prisma/client';
import type { OrderStatus } from '@tubutree/shared-types';
import { PrismaService } from '../../prisma/prisma.service';
import { paginated, skipTake } from '../../common/pagination';
import { formatVnDate } from '../../common/vn-time';
import { NotificationsService } from '../notifications/notifications.service';
import { SystemConfigService } from '../system-config/system-config.service';
import { OrderStatusService, toHttpBadRequest } from '../orders/order-status.service';
import {
  CONSIGNMENT_SETTLE_FROM_KEY,
  DEFAULT_MERCHANT_COMMISSION_PCT,
  DEFAULT_MERCHANT_CONFIRM_SLA_HOURS,
  DEFAULT_MERCHANT_DELIVER_SLA_DAYS,
  DEFAULT_MERCHANT_NEGATIVE_PAYOUT_DUE_DAYS,
  DEFAULT_MERCHANT_SETTLEMENT_HOLD_DAYS,
  DEFAULT_MERCHANT_SHIP_SLA_HOURS,
  parseConsignmentSettleFrom,
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
import { merchantLineBase } from './merchant-line-base';
import { consignmentLinkedSql } from './consignment-link-sql';
import { ADMIN_TOGGLE_MARK, isPartnerStore, lockStoreOwner, PARTNER_STORE_WHERE, storeHasPayouts } from './partner-store';
import { defaultCommissionPctIn, termsLockKey } from './merchant-terms-history';
import { distributeByWeight } from '../orders/refund-allocation';
import { recordUserAdminEvent } from '../../common/user-admin-events';

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

/**
 * Đơn đối tác tự giao: đủ thông tin người nhận vì đối tác phải tự giao (docs/2026-10-14-merchant-fulfilment-design.md mục 5).
 * Không có tài khoản người mua (họ tên, SĐT) và mã nhóm đặt hàng: đơn tặng hay đơn giao hộ người khác thì người nhận ở
 * `shippingAddress` mới là người đối tác cần liên hệ.
 */
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
  items: {
    select: { id: true, productName: true, variationName: true, unitPrice: true, quantity: true, total: true },
  },
} satisfies Prisma.OrderSelect;

const REASON_REQUIRED = 'Cần nhập lý do để báo khách.';
const PAYOUT_CANCEL_REASON_REQUIRED = 'Cần nhập lý do huỷ phiếu để báo gian hàng.';
/** Số phiếu đã huỷ gần nhất hiện ở bảng đối soát của gian hàng. */
const CANCELLED_PAYOUTS_SHOWN = 10;

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
  /** `quantity` là số lượng của cả dòng hàng (OrderItem.quantity), không phải số đơn vị của dòng đảo. */
  item?: { productName: string; variationName: string | null; quantity: number } | null;
  /** Dòng đảo của hàng giao hộ: số đơn vị trả lại; null ở các dòng khác và dòng đảo lập trước khi có cột này. */
  units?: number | null;
}

/**
 * Một dòng đối soát của đơn đã giao (mục 7 thiết kế): tiền hàng + phí giao − phí sàn − tiền COD đối tác đã tự thu. Tiền hàng là
 * tiền khách thực trả cho hàng (merchantLineBase, cùng nền với hàng Tubu giao hộ): mã giảm giá và giảm hạng áp cho hàng của
 * gian hàng do gian hàng chịu (Điểm Xanh không trả cho hàng đối tác); phí sàn vẫn theo mức chốt trên đơn. Dương: Tubu trả đối
 * tác; âm: đối tác nộp lại Tubu (đơn COD: phí sàn).
 */
export function saleLineOf(o: {
  id: string;
  code: string;
  paymentMethod: string;
  total: number;
  shippingFee: number;
  merchantCommissionPct: Prisma.Decimal | number | null;
  deliveredAt: Date | null;
  items: { id: string; total: number; paidTotal?: number | null }[];
}): SettlementLine {
  const goodsAmount = merchantLineBase(o).reduce((s, v) => s + v, 0);
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
 * Tiền hàng từng dòng của đơn tự giao làm nền cho dòng đảo. Đã có SALE thì theo đúng tiền hàng đã lưu ở SALE (phiếu lập trước
 * khi đổi nền giữ số cũ): khớp nền hiện tại thì dùng luôn, khác thì chia số đã lưu theo giá trị dòng, phần dư theo thứ tự id
 * dòng (số không đổi theo thứ tự DB trả về).
 */
function selfShipLineBase(
  o: { total: number; shippingFee: number; items: { id: string; total: number; paidTotal?: number | null }[] },
  saleGoods: number | undefined,
): number[] {
  const base = merchantLineBase(o);
  if (saleGoods === undefined || saleGoods === base.reduce((s, v) => s + v, 0)) return base;
  const sorted = o.items.map((it, idx) => ({ it, idx })).sort((a, b) => a.it.id.localeCompare(b.it.id));
  const shares = distributeByWeight(saleGoods, sorted.map((x) => Math.max(0, x.it.total)));
  const out = new Array<number>(o.items.length).fill(0);
  sorted.forEach((x, k) => {
    out[x.idx] = shares[k] ?? 0;
  });
  return out;
}

/**
 * Dòng REVERSAL cho từng lần trả một phần của đơn đối tác (cùng công thức với dòng đảo cả đơn, áp lên phần hàng trả): đối tác
 * nhận hàng về nên trả lại tiền hàng của các đơn vị trả + phí giao Tubu đã hoàn khách − phí sàn của phần đó. Tiền hàng của đơn
 * vị trả lấy theo nền của dòng (selfShipLineBase; `saleGoods` = tiền hàng ở SALE đã lưu). COD không đảo (tiền mặt đối tác thu đã
 * nằm trong dòng SALE). Tính luỹ kế theo thứ tự duyệt rồi lấy hiệu, nên nhiều lần trả cộng lại đúng bằng trả cả dòng, không lệch
 * làm tròn.
 */
export function partialReversalLinesOf(
  o: {
    id: string;
    code: string;
    total: number;
    shippingFee: number;
    merchantCommissionPct: Prisma.Decimal | number | null;
    items: { id: string; total: number; quantity: number; paidTotal?: number | null }[];
  },
  requests: ApprovedPartialReturn[],
  saleGoods?: number,
): SettlementLine[] {
  if (requests.length === 0) return [];
  const pct = o.merchantCommissionPct == null ? 0 : Number(o.merchantCommissionPct);
  const base = selfShipLineBase(o, saleGoods);
  const items = new Map(o.items.map((i, idx) => [i.id, { quantity: i.quantity, goods: base[idx] ?? 0 }]));
  const returned = new Map<string, number>();
  const goodsOf = () =>
    [...returned].reduce((s, [id, q]) => {
      const it = items.get(id);
      return it && it.quantity > 0 ? s + Math.round((it.goods * Math.min(q, it.quantity)) / it.quantity) : s;
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
      goodsAmount: -goods || 0,
      shippingFee: -ship || 0,
      commissionAmount: -commission || 0,
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

/** Ảnh chụp các dòng của phiếu lúc huỷ (dòng thật đã xoá để đơn quay lại bảng kê). */
interface PayoutCancelSnapshot {
  lineCount: number;
  orderCount: number;
  lines: Record<string, unknown>[];
}

function readCancelSnapshot(raw: unknown): PayoutCancelSnapshot | null {
  if (!raw || typeof raw !== 'object') return null;
  const snap = raw as Partial<PayoutCancelSnapshot>;
  return Array.isArray(snap.lines) ? (snap as PayoutCancelSnapshot) : null;
}

function cancelSnapshotOf(
  lines: ({ id: string; orderItem: SettlementLine['item'] } & Record<string, unknown> & { orderId: string })[],
): Prisma.InputJsonValue {
  return {
    lineCount: lines.length,
    orderCount: new Set(lines.map((l) => l.orderId)).size,
    lines: lines.map(({ orderItem, payoutId: _payoutId, ...l }) => ({ ...l, item: orderItem ?? null })),
  } as unknown as Prisma.InputJsonValue;
}

/** Phiếu kèm dòng ở dạng hiển thị; phiếu đã huỷ không còn dòng thật nên lấy từ ảnh chụp lúc huỷ. */
export function withLineItems<
  P extends { status?: string; cancelSnapshot?: Prisma.JsonValue | null; lines: (Record<string, unknown> & { orderItem: SettlementLine['item'] })[] },
>(p: P) {
  const { cancelSnapshot, ...rest } = p;
  const snapshot = p.status === 'CANCELLED' ? readCancelSnapshot(cancelSnapshot) : null;
  const lines = snapshot ? snapshot.lines : p.lines.map(({ orderItem, ...l }) => ({ ...l, item: orderItem ?? null }));
  return { ...rest, lines, cancelledLineCount: snapshot?.lineCount ?? null, cancelledOrderCount: snapshot?.orderCount ?? null };
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
      select: { id: true, type: true, isPartner: true, title: true, ownerUserId: true },
    });
    if (!store || !isPartnerStore(store)) {
      throw new ForbiddenException('Chỉ gian hàng đối tác tự giao hàng mới có đơn cần giao.');
    }
    return store;
  }

  /**
   * Gian hàng đã tắt cờ chỉ còn thu các dòng REVERSAL đảo tiền Tubu ĐÃ trả: đơn (hoặc dòng hàng giao hộ) có dòng SALE đã lưu trên
   * một phiếu. REVERSAL của đơn chưa từng được trả (trả một phần, trả nguyên đơn, giao hộ) không thu vì Tubu chưa trả đồng nào;
   * SALE và khoản chờ để mở. Gian hàng đối tác: giữ nguyên.
   */
  private async openLinesOf<T extends { kind: string; netAmount: number; orderId: string; orderItemId: string | null }>(
    store: { type: string; isPartner: boolean },
    lines: T[],
    db: Db = this.prisma,
  ) {
    if (isPartnerStore(store)) return { lines, total: lines.reduce((t, l) => t + l.netAmount, 0) };
    const reversals = lines.filter((l) => l.kind === 'REVERSAL');
    const paid = reversals.length
      ? await db.merchantPayoutLine.findMany({
          where: {
            kind: 'SALE',
            OR: [
              { orderId: { in: reversals.filter((l) => !l.orderItemId).map((l) => l.orderId) }, orderItemId: null },
              { orderItemId: { in: reversals.flatMap((l) => (l.orderItemId ? [l.orderItemId] : [])) } },
            ],
          },
          select: { orderId: true, orderItemId: true },
        })
      : [];
    const paidOrders = new Set(paid.filter((l) => !l.orderItemId).map((l) => l.orderId));
    const paidItems = new Set(paid.flatMap((l) => (l.orderItemId ? [l.orderItemId] : [])));
    const open = reversals.filter((l) => (l.orderItemId ? paidItems.has(l.orderItemId) : paidOrders.has(l.orderId)));
    return { lines: open, total: open.reduce((t, l) => t + l.netAmount, 0) };
  }

  /** Gian hàng đã có phiếu đối soát nào chưa (cổng cho chủ gian hàng đã tắt cờ biết có phiếu để xem). */
  async storeHasPayouts(storefrontId: string): Promise<boolean> {
    return storeHasPayouts(this.prisma, storefrontId);
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
    const why = reason.trim();
    if (!why) throw new BadRequestException(REASON_REQUIRED);
    // Giao không thành = hàng quay về gian hàng: đây là luồng hoàn của D1 nên huỷ được dù đã gửi hàng.
    return this.cancelBySeller(userId, store.title, order, `Giao không thành công: ${why}`, true);
  }

  /** Đối tác huỷ trước khi giao cho đơn vị vận chuyển (cùng mốc D1: chưa SHIPPING). */
  async cancel(userId: string, orderId: string, reason: string) {
    const { store, order } = await this.ownOrder(userId, orderId);
    if (order.status === 'CANCELLED') throw new ConflictException('Đơn này đã được huỷ.');
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
    if (!reason) throw new BadRequestException(REASON_REQUIRED);
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
      items: { select: { id: true, total: true, quantity: true, paidTotal: true } },
    } satisfies Prisma.OrderSelect;
    const storedSelect = { kind: true, refKey: true, goodsAmount: true, shippingFee: true, commissionAmount: true, codCollected: true, netAmount: true } as const;
    const base = { fulfiller: 'MERCHANT' as const, fulfillerStorefrontId: storefrontId };
    const collected: Prisma.OrderWhereInput = { OR: [{ paymentStatus: 'PAID' }, { paymentMethod: 'COD' }] };
    const [sales, upcoming, returnedRows, settledWithReturns] = await Promise.all([
      db.order.findMany({
        where: { ...base, ...collected, status: 'DELIVERED', deliveredAt: { lte: cutoff }, merchantPayoutLines: { none: { kind: 'SALE' } } },
        select: saleSelect,
        orderBy: { deliveredAt: 'asc' },
      }),
      db.order.findMany({
        where: { ...base, ...collected, status: 'DELIVERED', deliveredAt: { gt: cutoff }, merchantPayoutLines: { none: { kind: 'SALE' } } },
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
    // Mỗi truy vấn READ COMMITTED đọc một ảnh riêng: đơn vừa lật DELIVERED → RETURNED giữa hai lần đọc có thể nằm ở cả hai danh
    // sách. Lần này coi như đơn còn đã giao (SALE); bảng kê sau thấy SALE đã lưu và đảo đúng phần còn lại.
    const deliveredIds = new Set([...sales, ...upcoming].map((o) => o.id));
    const returned = returnedRows.filter((o) => !deliveredIds.has(o.id));
    const returnedIds = new Set(returnedRows.map((o) => o.id));
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
    const partialsOf = (order: Parameters<typeof partialReversalLinesOf>[0], stored: { kind: string; goodsAmount: number }[] = []) =>
      partialReversalLinesOf(
        order,
        partialRows.filter((r) => r.orderId === order.id),
        stored.find((l) => l.kind === 'SALE')?.goodsAmount,
      );
    const notStored = (stored: { kind: string; refKey: string }[]) => (l: SettlementLine) =>
      !stored.some((x) => x.kind === l.kind && x.refKey === l.refKey);

    const consignment = await this.consignmentStatement(storefrontId, cutoff, holdDays, db, defaultCommissionPct);
    const lines: SettlementLine[] = [
      // SALE vừa đủ hạn đi cùng phiếu với các lần trả một phần của nó (đối tác không được tính tiền hàng khách đã trả).
      ...sales.flatMap((o) => [saleLineOf(o), ...partialsOf(o)]),
      ...settled.flatMap((o) => partialsOf(o, o.merchantPayoutLines).filter(notStored(o.merchantPayoutLines))),
      ...returned.flatMap((o) => {
        const sale = o.merchantPayoutLines.find((l) => l.kind === 'SALE') ?? null;
        if (!sale) return reversalLineOf(o, null) ?? [];
        const partials = partialsOf(o, o.merchantPayoutLines);
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

  /**
   * Mốc bắt đầu đối soát giao hộ (merchant.consignment_settle_from): đơn đặt trước mốc không tự vào bảng kê. Đọc thẳng DB (cùng
   * transaction khi lập phiếu); thiếu thì không giới hạn. Giá trị sai (ghi tay vào DB, 2026-13-01) cũng không giới hạn thay vì làm
   * hỏng bảng kê, kèm cảnh báo một lần để admin sửa.
   */
  private async consignmentSettleFrom(db: Db): Promise<Date | null> {
    const row = await db.systemConfig.findUnique({ where: { key: CONSIGNMENT_SETTLE_FROM_KEY }, select: { value: true } });
    if (row?.value == null) return null;
    const at = parseConsignmentSettleFrom(row.value);
    const raw = JSON.stringify(row.value);
    if (!at && !warnedSettleFrom.has(raw)) {
      warnedSettleFrom.add(raw);
      this.logger.warn(`${CONSIGNMENT_SETTLE_FROM_KEY} = ${raw} không phải thời điểm ISO 8601 có thật — bảng kê giao hộ tạm không giới hạn theo mốc.`);
    }
    return at;
  }

  /**
   * Hàng "Tubu giao hộ" của gian hàng đã bán (kho Tubu giao, Tubu đã thu tiền, biến thể liên kết lúc đặt) mà KHÔNG tự vào bảng
   * kê: đơn đặt trước mốc bắt đầu đối soát tự động, hoặc biến thể nhận lại (takeover) chưa được admin xác nhận là hàng ký gửi lúc
   * đặt. Chỉ để xem — đối tác và admin đối chiếu, xử lý ngoài phiếu. Mới nhất trước, tối đa 200 món (`total` = số món thật).
   */
  async consignmentExcluded(storefrontId: string, db: Db = this.prisma) {
    const settleFrom = await this.consignmentSettleFrom(db);
    const store = Prisma.sql`${storefrontId}`;
    const rows = await db.$queryRaw<
      { orderItemId: string; orderId: string; beforeSettleFrom: boolean; confirmedAt: Date | null; linkPending: boolean; total: number }[]
    >`
      SELECT oi."id" AS "orderItemId", o."id" AS "orderId",
             ${settleFrom ? Prisma.sql`(o."createdAt" < ${settleFrom})` : Prisma.sql`false`} AS "beforeSettleFrom",
             (SELECT MAX(l."consignmentConfirmedAt") FROM "merchant_pancake_links" l
               WHERE l."storefrontId" = ${store} AND l."variationId" = oi."variationId" AND l."takeover"
                 AND o."createdAt" >= l."linkedAt" AND (l."unlinkedAt" IS NULL OR o."createdAt" < l."unlinkedAt")) AS "confirmedAt",
             ${consignmentLinkPendingSql(store)} AS "linkPending",
             COUNT(*) OVER ()::int AS "total"
        FROM "order_items" oi
        JOIN "orders" o ON o."id" = oi."orderId"
       WHERE ${CONSIGNMENT_SOLD_SQL}
         AND ${consignmentLinkedSql(store, false)}
         AND ${CONSIGNMENT_NO_SALE_SQL}
         AND NOT (${settleFrom ? Prisma.sql`o."createdAt" >= ${settleFrom} AND ` : Prisma.empty}${consignmentLinkedSql(store, true)})
       ORDER BY o."createdAt" DESC, oi."id"
       LIMIT 200`;
    const orders = rows.length
      ? await db.order.findMany({
          where: { id: { in: [...new Set(rows.map((r) => r.orderId))] } },
          select: {
            id: true,
            code: true,
            total: true,
            shippingFee: true,
            createdAt: true,
            deliveredAt: true,
            items: { select: { id: true, productName: true, variationName: true, quantity: true, total: true, paidTotal: true } },
          },
        })
      : [];
    const byId = new Map(orders.map((o) => [o.id, { order: o, base: merchantLineBase(o) }]));
    const lines = rows.flatMap((r) => {
      const found = byId.get(r.orderId);
      const idx = found?.order.items.findIndex((i) => i.id === r.orderItemId) ?? -1;
      if (!found || idx < 0) return [];
      const it = found.order.items[idx]!;
      return [
        {
          orderId: found.order.id,
          orderCode: found.order.code,
          orderItemId: it.id,
          productName: it.productName,
          variationName: it.variationName,
          quantity: it.quantity,
          goodsAmount: found.base[idx] ?? 0,
          createdAt: found.order.createdAt,
          deliveredAt: found.order.deliveredAt,
          reason: excludedReason(r),
          confirmedAt: r.confirmedAt,
          linkPending: r.linkPending,
        },
      ];
    });
    return { settleFrom, total: rows[0]?.total ?? 0, lines };
  }

  /** Bảng kê kèm danh sách hàng giao hộ chưa vào đối soát tự động — màn admin xem trước khi lập phiếu. */
  async adminStatement(storefrontId: string) {
    const [statement, consignmentExcluded, store] = await Promise.all([
      this.statementFor(storefrontId),
      this.consignmentExcluded(storefrontId),
      this.prisma.storefront.findUnique({ where: { id: storefrontId }, select: { type: true, isPartner: true } }),
    ]);
    // Gian hàng đã tắt cờ: màn admin hiện đúng những dòng sẽ lên phiếu.
    if (store && !isPartnerStore(store)) return { ...statement, ...(await this.openLinesOf(store, statement.lines)), upcoming: [], consignmentExcluded };
    return { ...statement, consignmentExcluded };
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
    const itemSelect = { id: true, variationId: true, productName: true, variationName: true, quantity: true, total: true, paidTotal: true } as const;
    const settleFrom = await this.consignmentSettleFrom(db);
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
         WHERE ${consignmentPendingSql(Prisma.sql`${storefrontId}`, settleFrom)}`,
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
    const owned = await this.prisma.storefront.findFirst({
      where: { ownerUserId: userId },
      select: { id: true, type: true, isPartner: true, title: true, ownerUserId: true },
    });
    // Chủ gian hàng đã tắt cờ vẫn xem được phiếu đã lập cho mình (thông báo phiếu trỏ tới đây); chỉ đọc, mọi thao tác khác vẫn từ chối.
    const hasPayout = owned && !isPartnerStore(owned) ? (await this.prisma.merchantPayout.count({ where: { storefrontId: owned.id } })) > 0 : false;
    const store = hasPayout && owned ? owned : await this.merchantStore(userId);
    const [fullStatement, live, cancelled, dueDays, tubuAccount, consignmentExcluded] = await Promise.all([
      this.statementFor(store.id),
      this.prisma.merchantPayout.findMany({
        where: { storefrontId: store.id, status: { not: 'CANCELLED' } },
        orderBy: { createdAt: 'desc' },
        take: 50,
        include: { lines: PAYOUT_LINES_INCLUDE },
      }),
      // Phiếu đã huỷ vẫn hiện (kèm lý do và các khoản lúc huỷ) để gian hàng đã được báo "đã lập phiếu" biết chuyện gì xảy ra.
      // Phiếu huỷ trước khi có cột cancelledAt (NULL) xuống cuối: Postgres xếp NULL lên đầu khi DESC, đủ 10 phiếu cũ là che mất
      // phiếu vừa huỷ.
      this.prisma.merchantPayout.findMany({
        where: { storefrontId: store.id, status: 'CANCELLED' },
        orderBy: [{ cancelledAt: { sort: 'desc', nulls: 'last' } }, { createdAt: 'desc' }],
        take: CANCELLED_PAYOUTS_SHOWN,
        include: { lines: PAYOUT_LINES_INCLUDE },
      }),
      this.negativeDueDays(),
      this.tubuAccount(),
      this.consignmentExcluded(store.id),
    ]);
    const payouts = [...live, ...cancelled].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
    const statement = isPartnerStore(store) ? fullStatement : { ...fullStatement, ...(await this.openLinesOf(store, fullStatement.lines)), upcoming: [] };
    return {
      ...statement,
      // Id admin lập/chuyển/huỷ phiếu là dữ liệu nội bộ, không trả cho gian hàng.
      payouts: payouts.map(({ createdBy: _c, paidBy: _p, cancelledBy: _x, ...p }) => payoutView(withLineItems(p), dueDays)),
      negativeDueDays: dueDays,
      tubuAccount,
      consignmentExcluded,
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
   * Gian hàng đã tắt cờ đối tác vẫn lập được khi bảng kê còn dòng mở (vd. REVERSAL do khách trả hàng sau khi tắt cờ): "còn dư
   * nợ" = có ít nhất một dòng trong bảng kê (chưa nằm trên phiếu nào), tổng có thể âm. Không còn dòng nào thì 404 như cũ.
   */
  async createPayout(adminId: string, storefrontId: string, note?: string, expectedTotal?: number) {
    const store = await this.prisma.storefront.findUnique({
      where: { id: storefrontId },
      select: {
        id: true, type: true, isPartner: true, title: true, ownerUserId: true, bankName: true, bankAccountNo: true, bankAccountName: true,
      },
    });
    if (!store) throw new NotFoundException('Không tìm thấy gian hàng đối tác.');
    const partner = isPartnerStore(store);
    const cfg = await this.settlementConfig();
    let payout;
    try {
      payout = await this.prisma.$transaction(
        async (tx) => {
          await this.lockStorePayouts(tx, store.id);
          const { lines, total } = await this.openLinesOf(store, (await this.statementFor(store.id, new Date(), tx, cfg)).lines, tx);
          if (lines.length === 0) {
            if (!partner) throw new NotFoundException('Không tìm thấy gian hàng đối tác.');
            throw new BadRequestException('Không có đơn nào đủ điều kiện đối soát.');
          }
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
                  units: l.units ?? null,
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
    // Số đơn khác nhau (một đơn có thể có nhiều dòng: SALE, dòng đảo, từng món giao hộ).
    const orderCount = String(new Set(payout.lines.map((l) => l.orderId)).size);
    if (payout.amount < 0) {
      const view = payoutView(payout, await this.negativeDueDays());
      await this.notifyOwner(store.ownerUserId, 'MERCHANT_PAYOUT_CREATED_TO_TUBU', {
        amount: (-payout.amount).toLocaleString('vi-VN'),
        count: orderCount,
        due_date: view.dueAt ? formatVnDate(view.dueAt) : '',
        memo: view.transferMemo,
      });
    } else {
      await this.notifyOwner(store.ownerUserId, 'MERCHANT_PAYOUT_CREATED', {
        amount: payout.amount.toLocaleString('vi-VN'),
        count: orderCount,
      });
    }
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
      amount: Math.abs(payout.amount).toLocaleString('vi-VN'),
      bank_ref: ref,
    });
    return payout;
  }

  /**
   * Huỷ phiếu chưa chuyển: các đơn trong phiếu quay lại bảng kê. Không huỷ được phiếu chứa dòng SALE của đơn đã có dòng đảo ở
   * phiếu khác: huỷ thì đối tác bị trừ lại tiền của một đơn chưa từng được trả. Cùng khoá gian hàng với lập phiếu. Lý do bắt
   * buộc và gửi cho gian hàng; ghi chú lúc lập phiếu giữ nguyên. Dòng thật phải xoá (unique (orderId, kind, refKey) để đơn vào
   * phiếu mới) nên phiếu giữ ảnh chụp các dòng lúc huỷ.
   */
  async cancelPayout(adminId: string, payoutId: string, reason: string) {
    const why = reason?.trim();
    if (!why) throw new BadRequestException(PAYOUT_CANCEL_REASON_REQUIRED);
    const target = await this.prisma.merchantPayout.findUnique({
      where: { id: payoutId },
      select: { storefrontId: true, amount: true, createdAt: true, storefront: { select: { ownerUserId: true } } },
    });
    if (!target) throw new ConflictException('Chỉ huỷ được phiếu chưa chuyển tiền.');
    const done = await this.prisma.$transaction(async (tx) => {
      await this.lockStorePayouts(tx, target.storefrontId);
      const lines = await tx.merchantPayoutLine.findMany({ where: { payoutId }, ...PAYOUT_LINES_INCLUDE });
      const flipped = await tx.merchantPayout.updateMany({
        where: { id: payoutId, status: 'PENDING' },
        data: {
          status: 'CANCELLED',
          cancelledAt: new Date(),
          cancelledBy: adminId,
          cancelReason: why,
          cancelSnapshot: cancelSnapshotOf(lines),
        },
      });
      if (flipped.count === 0) return false;
      const sales = lines.filter((l) => l.kind === 'SALE');
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
    await this.notifyOwner(target.storefront.ownerUserId, target.amount < 0 ? 'MERCHANT_PAYOUT_CANCELLED_TO_TUBU' : 'MERCHANT_PAYOUT_CANCELLED', {
      amount: Math.abs(target.amount).toLocaleString('vi-VN'),
      created: formatVnDate(target.createdAt),
      reason: why,
    });
    const view = await this.prisma.merchantPayout.findUniqueOrThrow({ where: { id: payoutId }, include: { lines: PAYOUT_LINES_INCLUDE } });
    return payoutView(withLineItems(view), await this.negativeDueDays());
  }

  async listPayouts(storefrontId: string | undefined, page = 1, limit = 20, status?: MerchantPayoutStatus) {
    const where: Prisma.MerchantPayoutWhereInput = { ...(storefrontId ? { storefrontId } : {}), ...(status ? { status } : {}) };
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
    const settleFrom = await this.consignmentSettleFrom(this.prisma);
    const rows = await this.prisma.$queryRaw<{ id: string }[]>`
      SELECT o."fulfillerStorefrontId" AS "id" FROM "orders" o
       WHERE o."fulfiller" = 'MERCHANT' AND o."fulfillerStorefrontId" IS NOT NULL AND (
         (o."status" = 'DELIVERED' AND (o."paymentStatus" = 'PAID' OR o."paymentMethod" = 'COD')
           AND EXISTS (SELECT 1 FROM "storefronts" sf WHERE sf."id" = o."fulfillerStorefrontId" AND (sf."type" = 'MERCHANT' OR sf."isPartner"))
           AND NOT EXISTS (SELECT 1 FROM "merchant_payout_lines" s WHERE s."orderId" = o."id" AND s."kind" = 'SALE' AND s."orderItemId" IS NULL))
         OR (o."status" = 'RETURNED'
           AND NOT EXISTS (SELECT 1 FROM "merchant_payout_lines" r WHERE r."orderId" = o."id" AND r."kind" = 'REVERSAL' AND r."refKey" = '')
           AND (EXISTS (SELECT 1 FROM "merchant_payout_lines" s WHERE s."orderId" = o."id" AND s."kind" = 'SALE' AND s."orderItemId" IS NULL)
                OR (o."paymentMethod" = 'COD' AND o."paymentStatus" = 'REFUNDED'
                    AND EXISTS (SELECT 1 FROM "storefronts" sf WHERE sf."id" = o."fulfillerStorefrontId" AND (sf."type" = 'MERCHANT' OR sf."isPartner")))))
         OR EXISTS (
           SELECT 1 FROM "return_requests" rr
            WHERE rr."orderId" = o."id" AND rr."status" = 'APPROVED' AND rr."fullReturn" = false
              AND EXISTS (SELECT 1 FROM "merchant_payout_lines" s WHERE s."orderId" = o."id" AND s."kind" = 'SALE' AND s."orderItemId" IS NULL)
              AND NOT EXISTS (SELECT 1 FROM "merchant_payout_lines" r WHERE r."orderId" = o."id" AND r."kind" = 'REVERSAL' AND r."refKey" = ${RETURN_REF_PREFIX} || rr."id")))
      UNION
      SELECT lk."storefrontId" FROM "merchant_pancake_links" lk
        JOIN "order_items" oi ON oi."variationId" = lk."variationId"
        JOIN "orders" o ON o."id" = oi."orderId"
       WHERE ${consignmentPendingSql(Prisma.raw('lk."storefrontId"'), settleFrom)}
         AND EXISTS (SELECT 1 FROM "storefronts" sf WHERE sf."id" = lk."storefrontId" AND (sf."type" = 'MERCHANT' OR sf."isPartner"))
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
   * Tổng quan cho admin: mỗi gian hàng đang bật cờ đối tác, hoặc có đơn tự giao / hàng "Tubu giao hộ" — số đơn đang xử lý, quá hạn, số khoản
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
    // Không giới hạn số dòng: bộ lọc đã ở trong truy vấn, nên cắt trước khi lọc sẽ làm rơi gian hàng đối tác xếp sau theo tên.
    const stores = await this.prisma.storefront.findMany({
      where: {
        AND: [
          // Gian hàng đã tắt cờ vẫn hiện khi có thể còn dòng mở (lọc chính xác bằng bảng kê bên dưới) để admin lập phiếu thu.
          { OR: [PARTNER_STORE_WHERE, { id: { in: [...pendingStores] } }] },
          // Gian hàng đang bật cờ luôn có dòng (kể cả chưa có gì) để admin còn nút tắt cờ.
          { OR: [{ isPartner: true }, { fulfilledOrders: { some: {} } }, { id: { in: linked.map((l) => l.storefrontId) } }] },
        ],
      },
      select: {
        id: true,
        title: true,
        type: true,
        isPartner: true,
        owner: { select: { fullName: true, phone: true } },
        commissionPct: true,
        consignmentFeePct: true,
        consignmentFeeFixed: true,
      },
      orderBy: { title: 'asc' },
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
      const { lines, total } = await this.openLinesOf(sf, statement?.lines ?? []);
      if (!isPartnerStore(sf) && lines.length === 0) continue;
      out.push({
        storefrontId: sf.id,
        title: sf.title,
        type: sf.type,
        isPartner: sf.isPartner,
        owner: sf.owner,
        activeOrders: activeByStore.get(sf.id) ?? 0,
        overdueOrders: overdueByStore.get(sf.id) ?? 0,
        settleableLines: lines.length,
        settleableAmount: total,
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
   * Phí sàn theo mặc định lưu vào lịch sử bằng số mặc định lúc đó; đổi mặc định sau này ghi dòng mới
   * (freezeDefaultCommissionChange), nên đơn đã đặt không bị tính lại theo mặc định mới.
   */
  async updateStoreTerms(
    adminId: string,
    storefrontId: string,
    dto: { commissionPct?: number | null; consignmentFeePct?: number; consignmentFeeFixed?: number },
  ) {
    return this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${termsLockKey(storefrontId)}))`;
      const before = await tx.storefront.findUnique({
        where: { id: storefrontId },
        select: { type: true, isPartner: true, commissionPct: true, consignmentFeePct: true, consignmentFeeFixed: true },
      });
      if (!before || !isPartnerStore(before)) throw new NotFoundException('Không tìm thấy gian hàng đối tác.');
      const defaultPct = await defaultCommissionPctIn(tx);
      if ((await tx.storefrontTermsHistory.count({ where: { storefrontId } })) === 0) {
        await tx.storefrontTermsHistory.create({
          data: {
            storefrontId,
            commissionPct: before.commissionPct ?? defaultPct,
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
          commissionPct: updated.commissionPct ?? defaultPct,
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
   * Admin bật/tắt cờ đối tác của gian hàng CTV (isPartner) thủ công; cờ cũng tự tắt khi chủ rơi xuống CUSTOMER/AFFILIATE (xem
   * clearPartnerOnRoleLoss). Tắt bị từ chối khi gian hàng còn việc đối tác dở dang sẽ mồ côi (chỉ chủ gian hàng đối tác thấy và xử lý chúng ở Cổng
   * người bán), hoặc khi chủ còn là đại lý (lần vào Cổng người bán kế tiếp sẽ tự bật lại). Khoá đối soát của gian hàng giữ suốt
   * lần kiểm để không lập phiếu chen giữa; bấm lại cùng giá trị không ghi thêm sổ.
   */
  async setStorePartner(adminId: string, storefrontId: string, isPartner: boolean) {
    // Đọc cấu hình đối soát trước khi mở tx (như createPayout): SystemConfigService đọc qua pool, không đọc trong lúc giữ tx.
    const cfg = isPartner ? null : await this.settlementConfig();
    const result = await this.prisma.$transaction(
      async (tx) => {
        await this.lockStorePayouts(tx, storefrontId);
        const [store] = await tx.$queryRaw<{ id: string; type: string; isPartner: boolean; ownerUserId: string | null }[]>`
          SELECT "id", "type"::text AS "type", "isPartner", "ownerUserId" FROM "storefronts" WHERE "id" = ${storefrontId} FOR UPDATE`;
        if (!store) throw new NotFoundException('Không tìm thấy gian hàng.');
        if (isPartner && store.type === 'BRAND') {
          throw new BadRequestException('Gian hàng nhãn hàng không thể là gian hàng đối tác.');
        }
        if (!isPartner && store.type === 'MERCHANT') {
          throw new BadRequestException('Gian hàng loại MERCHANT luôn là gian hàng đối tác, cờ này không áp dụng.');
        }
        if (store.isPartner === isPartner) return { changed: false, ownerUserId: store.ownerUserId };
        if (!isPartner && cfg) {
          const blockers = await this.partnerBlockers(tx, store.id, store.ownerUserId, cfg);
          if (blockers.length) {
            throw new ConflictException(`Chưa thể tắt gian hàng đối tác: ${blockers.join('; ')}. Xử lý xong rồi thử lại.`);
          }
        }
        await tx.storefront.update({ where: { id: store.id }, data: { isPartner } });
        if (store.ownerUserId) {
          await recordUserAdminEvent(tx, {
            userId: store.ownerUserId,
            kind: 'STOREFRONT_PARTNER',
            from: String(!isPartner),
            to: String(isPartner),
            reason: isPartner ? `${store.id}${ADMIN_TOGGLE_MARK}` : store.id,
            actorId: adminId,
          });
        }
        return { changed: true, ownerUserId: store.ownerUserId };
      },
      { maxWait: 15_000, timeout: 60_000 },
    );
    if (result.changed) {
      // Gian hàng không có chủ (ownerUserId null) không có dòng user_admin_events để gắn: dòng log này là dấu vết duy nhất.
      this.logger.warn(
        `Admin ${adminId} ${isPartner ? 'bật' : 'tắt'} cờ đối tác của gian hàng ${storefrontId} (chủ ${result.ownerUserId ?? 'không có — chỉ ghi log'}).`,
      );
    }
    return { id: storefrontId, isPartner };
  }

  /**
   * Gọi trong tx đổi vai trò khi chủ (đang là DEALER/STAFF/ADMIN) rơi xuống CUSTOMER/AFFILIATE, TRƯỚC lúc ghi dòng users: gian hàng
   * đối tác của chủ thôi là đối tác cùng luật với `setStorePartner` (khoá phiếu → dòng gian hàng, kiểm vướng mắc dưới khoá, ghi
   * STOREFRONT_PARTNER) trừ vướng mắc "chủ còn là đại lý" (chính lần đổi này gỡ nó). Gian hàng MERCHANT được chuyển luôn về loại
   * CTV (hàng, tài khoản nhận tiền, điều khoản, lịch sử phiếu giữ nguyên; duyệt lại đại lý rồi vào Cổng người bán thì cờ bật lại như
   * mọi gian hàng CTV). Còn vướng mắc thì ném 409 để cả lần đổi vai trò huỷ. Khoá tư vấn theo chủ lấy trước (chặn lần tạo gian hàng
   * đầu tiên ở Cổng người bán chen vào khi chưa có dòng nào để khoá), rồi mọi gian hàng của chủ đều khoá trước khi đọc cờ dưới khoá,
   * để lần bật lại cờ chạy song song không lọt qua.
   * `spareAdminToggled`: chủ vốn không còn là DEALER/STAFF/ADMIN (CUSTOMER/AFFILIATE được đặt lại vai trò) thì gian hàng CTV có cờ do
   * admin bật tay (lần bật mới nhất mang ADMIN_TOGGLE_MARK) giữ nguyên; gian hàng MERCHANT và cờ theo vai trò (Cổng người bán, duyệt đại lý)
   * vẫn bị tắt/chuyển về CTV sau cùng lần kiểm vướng mắc.
   */
  async clearPartnerOnRoleLoss(
    tx: Db,
    ownerUserId: string,
    actorId: string,
    cfg: SettlementConfig,
    fromRole: string,
    opts: { spareAdminToggled?: boolean } = {},
  ) {
    await lockStoreOwner(tx, ownerUserId);
    const stores = await tx.storefront.findMany({ where: { ownerUserId }, select: { id: true }, orderBy: { id: 'asc' } });
    let cleared = 0;
    for (const { id } of stores) {
      await this.lockStorePayouts(tx, id);
      const [store] = await tx.$queryRaw<{ type: string; isPartner: boolean }[]>`
        SELECT "type"::text AS "type", "isPartner" FROM "storefronts" WHERE "id" = ${id} FOR UPDATE`;
      if (!store || !isPartnerStore(store)) continue;
      if (opts.spareAdminToggled && store.type !== 'MERCHANT' && (await this.isAdminToggled(tx, ownerUserId, id))) continue;
      const blockers = await this.partnerBlockers(tx, id, ownerUserId, cfg, true);
      if (blockers.length) {
        throw new ConflictException(
          fromRole === 'DEALER'
            ? `Chưa thể thu hồi vai trò đại lý vì gian hàng đối tác còn vướng: ${blockers.join('; ')}. Xử lý xong rồi thử lại.`
            : `Chưa thể hạ vai trò vì gian hàng đối tác của người này còn vướng: ${blockers.join('; ')}. Xử lý xong rồi thử lại, hoặc đặt vai trò DEALER để giữ nguyên gian hàng.`,
        );
      }
      await tx.storefront.update({ where: { id }, data: { isPartner: false,...(store.type === 'MERCHANT' ? { type: 'CTV' } : {}) } });
      await recordUserAdminEvent(tx, { userId: ownerUserId, kind: 'STOREFRONT_PARTNER', from: 'true', to: 'false', reason: id, actorId });
      cleared++;
    }
    if (cleared) {
      this.logger.warn(`Đổi vai trò của ${ownerUserId} về khách/CTV: tắt cờ đối tác ${cleared} gian hàng (admin ${actorId}).`);
    }
  }

  /**
   * Khoá của đường ẩn danh tài khoản chủ gian hàng: khoá tư vấn theo chủ rồi khoá phiếu từng gian hàng (id tăng dần), đúng thứ tự
   * clearPartnerOnRoleLoss; dòng gian hàng và users khoá sau, ở người gọi.
   */
  async lockOwnerStores(tx: Db, ownerUserId: string) {
    await lockStoreOwner(tx, ownerUserId);
    const stores = await tx.storefront.findMany({ where: { ownerUserId }, select: { id: true }, orderBy: { id: 'asc' } });
    for (const { id } of stores) await this.lockStorePayouts(tx, id);
  }

  /**
   * Vướng mắc của mọi gian hàng đối tác (MERCHANT hoặc isPartner) của chủ, cùng danh sách với việc thu hồi đại lý (partnerBlockers,
   * trừ "chủ vẫn là đại lý"). Rỗng nghĩa là đã đối soát xong, không còn gì mồ côi khi tài khoản chủ bị ẩn danh.
   */
  async ownerPartnerBlockers(db: Db, ownerUserId: string, cfg: SettlementConfig): Promise<string[]> {
    const stores = await db.storefront.findMany({
      where: { ownerUserId, ...PARTNER_STORE_WHERE },
      select: { id: true, title: true },
      orderBy: { id: 'asc' },
    });
    const out: string[] = [];
    for (const store of stores) out.push(...(await this.partnerBlockers(db, store.id, ownerUserId, cfg, true)));
    return out;
  }

  private async isAdminToggled(tx: Db, ownerUserId: string, storefrontId: string): Promise<boolean> {
    const latest = await tx.userAdminEvent.findFirst({
      where: { userId: ownerUserId, kind: 'STOREFRONT_PARTNER', toValue: 'true', reason: { in: [storefrontId, `${storefrontId}${ADMIN_TOGGLE_MARK}`] } },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      select: { reason: true },
    });
    return latest?.reason === `${storefrontId}${ADMIN_TOGGLE_MARK}`;
  }

  private async partnerBlockers(
    tx: Db,
    storefrontId: string,
    ownerUserId: string | null,
    cfg: SettlementConfig,
    ownerLosingDealer = false,
  ): Promise<string[]> {
    const store = Prisma.sql`${storefrontId}`;
    const settleFrom = await this.consignmentSettleFrom(tx);
    const count = (q: Promise<{ n: bigint }[]>) => q.then((r) => Number(r[0]?.n ?? 0));
    const [owner, openOrders, consignmentOpen, statement, pendingPayouts, activeLinks, pendingReturns, unreceivedReturns, ownProducts] =
      await Promise.all([
        ownerUserId && !ownerLosingDealer ? tx.user.findUnique({ where: { id: ownerUserId }, select: { role: true } }) : null,
        tx.order.count({
          where: { fulfillerStorefrontId: storefrontId, status: { in: ['PENDING_PAYMENT', 'CONFIRMED', 'PACKED', 'SHIPPING'] } },
        }),
        // Đơn kho Tubu có dòng hàng ký gửi của gian hàng (cùng định nghĩa bảng kê: liên kết lúc đặt, takeover tính từ lúc xác nhận,
        // từ mốc bắt đầu đối soát, chưa có SALE) mà chưa thành khoản bán được (chưa giao, hoặc giao mà Tubu chưa thu tiền): khi
        // thành khoản thì gian hàng đã thôi là đối tác, không ai lập phiếu được. Khoản đã bán nằm ở statementFor bên dưới.
        // Năm mã đơn cũ nhất kèm tổng số đơn để admin tìm ra mà xử lý.
        tx.$queryRaw<{ code: string; n: bigint }[]>`
          SELECT t."code", COUNT(*) OVER () AS n FROM (
            SELECT DISTINCT o."code", o."createdAt" FROM "order_items" oi JOIN "orders" o ON o."id" = oi."orderId"
             WHERE o."fulfiller" = 'TUBU' AND o."status" NOT IN ('CANCELLED', 'RETURNED')
               AND NOT (${CONSIGNMENT_SOLD_SQL})
               ${settleFrom ? Prisma.sql`AND o."createdAt" >= ${settleFrom}` : Prisma.empty}
               AND ${consignmentLinkedSql(store, true)}
               AND ${CONSIGNMENT_NO_SALE_SQL}) t
          ORDER BY t."createdAt", t."code" LIMIT 5`,
        this.statementFor(storefrontId, new Date(), tx, cfg),
        tx.merchantPayout.count({ where: { storefrontId, status: 'PENDING' } }),
        tx.merchantPancakeLink.count({ where: { storefrontId, unlinkedAt: null } }),
        count(tx.$queryRaw<{ n: bigint }[]>`
          SELECT COUNT(*) AS n FROM "return_requests" rr JOIN "orders" o ON o."id" = rr."orderId"
           WHERE rr."status" = 'REQUESTED' AND o."fulfillerStorefrontId" = ${storefrontId}`),
        // Đã duyệt trả mà chưa xác nhận nhận hàng về: chỉ chủ gian hàng đối tác xác nhận được (order-returns), tắt cờ thì kẹt.
        count(tx.$queryRaw<{ n: bigint }[]>`
          SELECT COUNT(*) AS n FROM "return_requests" rr JOIN "orders" o ON o."id" = rr."orderId"
           WHERE rr."status" = 'APPROVED' AND rr."receivedAt" IS NULL AND o."fulfillerStorefrontId" = ${storefrontId}`),
        tx.product.count({ where: { storefrontId, fulfilment: 'MERCHANT', isActive: true } }),
      ]);
    const settleLines = statement.lines.length + statement.upcoming.length;
    return [
      owner?.role === 'DEALER' ? 'chủ gian hàng vẫn là đại lý (đổi vai trò trước, nếu không cờ tự bật lại)' : null,
      openOrders ? `${openOrders} đơn tự giao chưa xong` : null,
      consignmentOpen.length
        ? `${Number(consignmentOpen[0]!.n)} đơn có hàng Tubu giao hộ của gian hàng chưa bán xong (${consignmentOpen.map((r) => r.code).join(', ')}${
            Number(consignmentOpen[0]!.n) > consignmentOpen.length ? ', …' : ''
          })`
        : null,
      settleLines ? `${settleLines} khoản chờ đối soát` : null,
      pendingPayouts ? `${pendingPayouts} phiếu đối soát chưa chuyển` : null,
      activeLinks ? `${activeLinks} liên kết hàng Tubu giao hộ đang hiệu lực` : null,
      pendingReturns ? `${pendingReturns} yêu cầu trả hàng chờ xử lý` : null,
      unreceivedReturns ? `${unreceivedReturns} yêu cầu trả đã duyệt chưa xác nhận nhận hàng` : null,
      ownProducts ? `${ownProducts} sản phẩm tự giao đang bán` : null,
    ].filter((b): b is string => b !== null);
  }

  /**
   * Admin xác nhận hàng đang bán của biến thể nhận lại (liên kết takeover) là hàng ký gửi của gian hàng: từ lúc này đơn mới
   * vào đối soát tự động. Bấm lại không đổi mốc.
   */
  async confirmConsignment(adminId: string, linkId: string) {
    await this.prisma.$transaction(async (tx) => {
      const found = await tx.merchantPancakeLink.findUnique({ where: { id: linkId }, select: { variationId: true } });
      if (!found) throw new NotFoundException('Không tìm thấy liên kết.');
      // Khoá biến thể trước khi lấy mốc: checkout giữ khoá này tới commit và tính hoa hồng CTV sau khi chèn đơn, nên đơn đặt từ
      // mốc xác nhận luôn thấy liên kết đã xác nhận (hoa hồng loại, bảng kê trả), đơn trước mốc thì ngược lại.
      await tx.$queryRaw`SELECT "id" FROM "variations" WHERE "id" = ${found.variationId} FOR NO KEY UPDATE`;
      const link = await tx.merchantPancakeLink.findUnique({ where: { id: linkId }, select: { takeover: true, unlinkedAt: true } });
      if (!link) throw new NotFoundException('Không tìm thấy liên kết.');
      if (!link.takeover) throw new BadRequestException('Liên kết này không nhận lại hàng Tubu đang bán nên không cần xác nhận hàng ký gửi.');
      if (link.unlinkedAt) throw new BadRequestException('Liên kết đã gỡ.');
      await tx.merchantPancakeLink.updateMany({
        where: { id: linkId, consignmentConfirmedAt: null },
        data: { consignmentConfirmedAt: new Date(), consignmentConfirmedBy: adminId },
      });
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

  /**
   * Số gian hàng đang có khoản đã đủ hạn chờ lập phiếu — đúng các dòng "Lập phiếu đối soát" bấm được ở tổng quan admin
   * (settleableLines > 0). Chỉ dựng bảng kê cho gian hàng có khoản chờ (storesWithPending), lần lượt để không chiếm hết pool.
   */
  async countStoresToSettle(now = new Date()): Promise<number> {
    const [candidates, cfg] = await Promise.all([this.storesWithPending(), this.settlementConfig()]);
    const stores = await this.prisma.storefront.findMany({ where: { id: { in: [...candidates] } }, select: { id: true, type: true, isPartner: true } });
    let n = 0;
    for (const sf of stores) {
      const { lines } = await this.openLinesOf(sf, (await this.statementFor(sf.id, now, this.prisma, cfg)).lines);
      if (lines.length > 0) n += 1;
    }
    return n;
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
 * Vì sao dòng hàng giao hộ không tự vào bảng kê: đặt trước mốc bắt đầu đối soát tự động; liên kết nhận lại (takeover) chưa được
 * xác nhận hàng ký gửi; hoặc đã xác nhận nhưng đơn đặt TRƯỚC lúc xác nhận — chỉ đơn mới từ lúc xác nhận tự vào phiếu, phần này
 * không bao giờ tự vào và phải xử lý ngoài phiếu.
 */
function excludedReason(r: { beforeSettleFrom: boolean; confirmedAt: Date | null }) {
  if (r.beforeSettleFrom) return 'BEFORE_SETTLE_FROM' as const;
  return r.confirmedAt ? ('TAKEOVER_BEFORE_CONFIRM' as const) : ('TAKEOVER_UNCONFIRMED' as const);
}

/** Giá trị mốc bắt đầu sai đã cảnh báo — mỗi giá trị sai chỉ ghi log một lần. */
const warnedSettleFrom = new Set<string>();

/** Đơn kho Tubu đã giao mà Tubu đã thu tiền (PAID hoặc COD — cùng luật doanh thu admin). */
const CONSIGNMENT_SOLD_SQL = Prisma.sql`o."fulfiller" = 'TUBU' AND o."status" = 'DELIVERED'
    AND (o."paymentStatus" = 'PAID' OR o."paymentMethod" = 'COD')`;

/** Dòng hàng `oi` chưa có SALE. */
const CONSIGNMENT_NO_SALE_SQL = Prisma.sql`NOT EXISTS (SELECT 1 FROM "merchant_payout_lines" s WHERE s."orderItemId" = oi."id" AND s."kind" = 'SALE')`;

/**
 * Liên kết của dòng `oi` lúc đặt đơn `o` vẫn đang chờ admin xác nhận hàng ký gửi (cùng điều kiện CONSIGNMENT_PENDING_LINK_WHERE
 * của màn "Duyệt SP đối tác" và số "Việc cần xử lý"): còn việc để xác nhận. Liên kết đã xác nhận sau lúc đặt hoặc đã gỡ thì không.
 */
function consignmentLinkPendingSql(store: Prisma.Sql): Prisma.Sql {
  return Prisma.sql`EXISTS (
      SELECT 1 FROM "merchant_pancake_links" l
       WHERE l."storefrontId" = ${store} AND l."variationId" = oi."variationId"
         AND o."createdAt" >= l."linkedAt"
         AND l."takeover" AND l."consignmentConfirmedAt" IS NULL AND l."unlinkedAt" IS NULL)`;
}

/**
 * Điều kiện SQL cho dòng hàng `oi` của đơn `o` đang chờ đối soát "Tubu giao hộ" của gian hàng `store`: đơn kho Tubu đã giao,
 * Tubu đã thu tiền, đặt từ mốc bắt đầu (`settleFrom`, null = không giới hạn), biến thể liên kết với gian hàng lúc đặt (liên kết
 * takeover: từ lúc admin xác nhận hàng ký gửi), chưa có SALE.
 */
function consignmentPendingSql(store: Prisma.Sql, settleFrom: Date | null): Prisma.Sql {
  return Prisma.sql`${CONSIGNMENT_SOLD_SQL}
    ${settleFrom ? Prisma.sql`AND o."createdAt" >= ${settleFrom}` : Prisma.empty}
    AND ${consignmentLinkedSql(store, true)}
    AND ${CONSIGNMENT_NO_SALE_SQL}`;
}
