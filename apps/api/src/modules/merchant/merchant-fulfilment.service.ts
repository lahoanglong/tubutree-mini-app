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
  DEFAULT_MERCHANT_CONFIRM_SLA_HOURS,
  DEFAULT_MERCHANT_DELIVER_SLA_DAYS,
  DEFAULT_MERCHANT_SETTLEMENT_HOLD_DAYS,
  DEFAULT_MERCHANT_SHIP_SLA_HOURS,
} from './merchant-config';

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

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
  /** '' = dòng của cả đơn; `RETURN:<id>` = đảo một lần trả một phần (D3). */
  refKey: string;
  goodsAmount: number;
  shippingFee: number;
  commissionAmount: number;
  codCollected: number;
  netAmount: number;
  deliveredAt: Date | null;
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
    codCollected,
    netAmount: goodsAmount + o.shippingFee - commissionAmount - codCollected,
    deliveredAt: o.deliveredAt,
  };
}

type PayoutAmounts = Pick<SettlementLine, 'goodsAmount' | 'shippingFee' | 'commissionAmount' | 'codCollected' | 'netAmount'>;

export const RETURN_REF_PREFIX = 'RETURN:';

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
      codCollected: 0,
      netAmount: -(goods + ship - commission),
      deliveredAt: null,
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
  const base = { orderId: o.id, orderCode: o.code, kind: 'REVERSAL' as const, refKey: '', deliveredAt: null };
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
   * Bảng kê chưa đối soát của một gian hàng, tính từ đơn lúc xem (không lưu sẵn): đơn đã giao qua hạn đổi/trả chưa vào phiếu
   * nào (SALE), mỗi lần trả một phần đã duyệt của đơn đã/đang vào phiếu (REVERSAL `RETURN:<id>`) và đơn bị trả mà đối tác đã
   * được tính tiền hoặc đang giữ tiền COD (REVERSAL của cả đơn, âm, chỉ phần còn lại sau các lần trả một phần).
   */
  async statementFor(storefrontId: string, now = new Date()) {
    const holdDays = await this.holdDays();
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
    const [sales, upcoming, returned, settledWithReturns] = await Promise.all([
      this.prisma.order.findMany({
        where: { ...base, status: 'DELIVERED', deliveredAt: { lte: cutoff }, merchantPayoutLines: { none: { kind: 'SALE' } } },
        select: saleSelect,
        orderBy: { deliveredAt: 'asc' },
      }),
      this.prisma.order.findMany({
        where: { ...base, status: 'DELIVERED', deliveredAt: { gt: cutoff } },
        select: saleSelect,
        orderBy: { deliveredAt: 'asc' },
      }),
      this.prisma.order.findMany({
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
      this.prisma.$queryRaw<{ orderId: string }[]>`
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
      ? await this.prisma.order.findMany({
          where: { id: { in: settledIds }, ...base },
          select: { ...saleSelect, merchantPayoutLines: { select: storedSelect } },
        })
      : [];
    const partialOrderIds = [...sales, ...returned, ...settled].map((o) => o.id);
    const partialRows = partialOrderIds.length
      ? await this.prisma.returnRequest.findMany({
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
    ];
    return {
      holdDays,
      lines,
      total: lines.reduce((s, l) => s + l.netAmount, 0),
      upcoming: upcoming.map((o) => ({
        ...saleLineOf(o),
        availableAt: o.deliveredAt ? new Date(o.deliveredAt.getTime() + holdDays * DAY) : null,
      })),
    };
  }

  async myStatement(userId: string) {
    const store = await this.merchantStore(userId);
    const [statement, payouts] = await Promise.all([
      this.statementFor(store.id),
      this.prisma.merchantPayout.findMany({
        where: { storefrontId: store.id, status: { not: 'CANCELLED' } },
        orderBy: { createdAt: 'desc' },
        take: 50,
        include: { lines: { orderBy: { createdAt: 'asc' } } },
      }),
    ]);
    return { ...statement, payouts };
  }

  /**
   * Lập phiếu đối soát gồm mọi dòng đủ điều kiện. Unique (orderId, kind) của dòng là chốt chặn: hai admin lập cùng lúc thì
   * lần thứ hai đụng unique, rollback cả phiếu, không đơn nào bị trả hai lần.
   */
  async createPayout(adminId: string, storefrontId: string, note?: string) {
    const store = await this.prisma.storefront.findUnique({
      where: { id: storefrontId },
      select: { id: true, type: true, title: true, ownerUserId: true, bankName: true, bankAccountNo: true, bankAccountName: true },
    });
    if (!store || store.type !== 'MERCHANT') throw new NotFoundException('Không tìm thấy gian hàng đối tác.');
    const { lines, total } = await this.statementFor(store.id);
    if (lines.length === 0) throw new BadRequestException('Không có đơn nào đủ điều kiện đối soát.');
    let payout;
    try {
      payout = await this.prisma.merchantPayout.create({
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
              codCollected: l.codCollected,
              netAmount: l.netAmount,
            })),
          },
        },
        include: { lines: true },
      });
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
   * phiếu khác: huỷ thì đối tác bị trừ lại tiền của một đơn chưa từng được trả.
   */
  async cancelPayout(adminId: string, payoutId: string) {
    const done = await this.prisma.$transaction(async (tx) => {
      const flipped = await tx.merchantPayout.updateMany({
        where: { id: payoutId, status: 'PENDING' },
        data: { status: 'CANCELLED', note: `Huỷ bởi ${adminId}` },
      });
      if (flipped.count === 0) return false;
      const sales = await tx.merchantPayoutLine.findMany({ where: { payoutId, kind: 'SALE' }, select: { orderId: true } });
      if (sales.length > 0) {
        const elsewhere = await tx.merchantPayoutLine.findFirst({
          where: { orderId: { in: sales.map((l) => l.orderId) }, kind: 'REVERSAL', payoutId: { not: payoutId } },
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
    const [total, rows] = await Promise.all([
      this.prisma.merchantPayout.count({ where }),
      this.prisma.merchantPayout.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        include: { storefront: { select: { id: true, title: true } }, lines: true },
        ...skipTake(page, limit),
      }),
    ]);
    return paginated(rows, page, limit, total);
  }

  /** Tổng quan cho admin: mỗi gian hàng đối tác có đơn tự giao — số đơn đang xử lý, quá hạn, số tiền chờ đối soát. */
  async adminOverview(now = new Date()) {
    const sla = await this.slaConfig();
    const stores = await this.prisma.storefront.findMany({
      where: { type: 'MERCHANT', fulfilledOrders: { some: {} } },
      select: { id: true, title: true, owner: { select: { fullName: true, phone: true } } },
      orderBy: { title: 'asc' },
      take: 200,
    });
    const overdue = await this.overdueOrders(sla, now);
    const overdueByStore = new Map<string, number>();
    for (const o of overdue) {
      if (o.fulfillerStorefrontId) overdueByStore.set(o.fulfillerStorefrontId, (overdueByStore.get(o.fulfillerStorefrontId) ?? 0) + 1);
    }
    const out = [];
    for (const sf of stores) {
      const [active, statement] = await Promise.all([
        this.prisma.order.count({
          where: { fulfiller: 'MERCHANT', fulfillerStorefrontId: sf.id, status: { in: ['CONFIRMED', 'PACKED', 'SHIPPING'] } },
        }),
        this.statementFor(sf.id, now),
      ]);
      out.push({
        storefrontId: sf.id,
        title: sf.title,
        owner: sf.owner,
        activeOrders: active,
        overdueOrders: overdueByStore.get(sf.id) ?? 0,
        settleableLines: statement.lines.length,
        settleableAmount: statement.total,
      });
    }
    return {
      slaConfig: sla,
      stores: out,
      overdue: overdue.map((o) => ({ ...o, sla: slaStateOf(o, sla, now) })),
    };
  }

  /** Đơn đối tác đang quá SLA ở bất kỳ bước nào. */
  async overdueOrders(sla: SlaConfig, now: Date, take = 200) {
    return this.prisma.order.findMany({
      where: overdueWhere(sla, now),
      select: {
        id: true,
        code: true,
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
