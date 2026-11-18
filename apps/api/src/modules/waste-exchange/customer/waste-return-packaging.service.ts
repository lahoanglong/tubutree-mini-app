import { Injectable } from '@nestjs/common';
import type { ReturnPackagingSuggestion } from '@tubutree/shared-types';
import { vnDateKey, vnMonthKey } from '../../../common/vn-time';
import { PrismaService } from '../../../prisma/prisma.service';
import { SystemConfigService } from '../../system-config/system-config.service';
import { WasteConfigService } from '../core/waste-config.service';
import { WasteHoldService } from '../core/waste-hold.service';
import { WASTE_CAP_STATUSES } from '../waste.constants';
import {
  RETURN_PACKAGING_BOTTLE_MIN_DAYS,
  RETURN_PACKAGING_CODES,
  RETURN_PACKAGING_MAX_ORDERS,
  RETURN_PACKAGING_NUDGE_KEY,
  buildReturnPackaging,
  isOwnDeliveredTubuOrder,
  returnPackagingSince,
  sameDeliveryPlace,
  type ReturnPackagingOrder,
} from './waste-return-packaging';

const ORDER_SELECT = {
  code: true,
  type: true,
  status: true,
  fulfiller: true,
  source: true,
  placedForCustomer: true,
  deliveredAt: true,
  shippingAddress: true,
  items: { select: { variationId: true, quantity: true } },
} as const;

/** Đọc nhiều hơn số đơn gộp để vẫn đủ đơn sau khi bỏ đơn giao tới nơi khác. */
const ADDRESS_SCAN_LIMIT = 20;

/** Phiếu thất lạc: bao bì đã rời nhà khách dù phiếu đóng ở EXPIRED. */
const LOST_CLOSE_REASONS = ['LOST', 'LOST_AT_WAREHOUSE'] as const;

type OrderRow = Omit<ReturnPackagingOrder, 'items'> & { items: { variationId: string; quantity: number }[] };

/**
 * Bao bì khách còn giữ từ đơn Tubu đã giao, để điền sẵn gói gửi lại kèm đơn sau. Chỉ đọc. Cờ `checkout.return_packaging_nudge_enabled` tắt thì
 * luôn null, không truy vấn gì thêm.
 */
@Injectable()
export class WasteReturnPackagingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly systemConfig: SystemConfigService,
    private readonly wasteConfig: WasteConfigService,
    private readonly hold: WasteHoldService,
  ) {}

  async enabled(): Promise<boolean> {
    return (await this.systemConfig.get<unknown>(RETURN_PACKAGING_NUDGE_KEY, false)) === true;
  }

  /** Bao bì của một đơn của chính khách (thẻ ở chi tiết đơn đã giao). Đơn lạ, đơn chưa giao hay bao bì đã gửi lại thì null. */
  async forOrder(userId: string, orderCode: string, now: Date = new Date()): Promise<ReturnPackagingSuggestion | null> {
    if (!(await this.enabled())) return null;
    const order: OrderRow | null = await this.prisma.order.findFirst({ where: { code: orderCode, userId }, select: ORDER_SELECT });
    if (!order) return null;
    const since = returnPackagingSince(now, await this.lastReturnAt(userId));
    return this.build(userId, now, isOwnDeliveredTubuOrder({ ...order, items: [] }, since) ? [order] : [], {});
  }

  /**
   * Gộp bao bì của tối đa 5 đơn gần nhất đã giao tới đúng địa chỉ của đơn đang thanh toán, giao sau lần gửi rác gần nhất và trong 60 ngày
   * (thẻ "Đổi rác kèm đơn" ở thanh toán).
   */
  async forAddress(
    userId: string,
    address: { street: string; ward: string; wardCode: string },
    now: Date = new Date(),
  ): Promise<ReturnPackagingSuggestion | null> {
    if (!(await this.enabled())) return null;
    const since = returnPackagingSince(now, await this.lastReturnAt(userId));
    const orders: OrderRow[] = await this.prisma.order.findMany({
      where: { userId, status: 'DELIVERED', type: 'RETAIL', fulfiller: 'TUBU', placedForCustomer: false, deliveredAt: { gt: since } },
      orderBy: [{ deliveredAt: 'desc' }, { id: 'desc' }],
      take: ADDRESS_SCAN_LIMIT,
      select: ORDER_SELECT,
    });
    const own = orders.filter((o) => isOwnDeliveredTubuOrder({ ...o, items: [] }, since) && sameDeliveryPlace(o.shippingAddress, address));
    const bottlesDeliveredBefore = new Date(now.getTime() - RETURN_PACKAGING_BOTTLE_MIN_DAYS * 86_400_000);
    return this.build(userId, now, own.slice(0, RETURN_PACKAGING_MAX_ORDERS), { bottlesDeliveredBefore });
  }

  /**
   * Lần gửi rác gần nhất mà bao bì đã rời nhà khách (mọi cách giao): phiếu còn hiệu lực, phiếu kho từ chối (đã gửi đi rồi mới bị từ chối)
   * và phiếu thất lạc. Phiếu huỷ hay hết hạn vì lý do khác không tính vì rác chưa rời nhà khách.
   */
  private async lastReturnAt(userId: string): Promise<Date | null> {
    const last = await this.prisma.wasteRequest.findFirst({
      where: {
        userId,
        OR: [
          { status: { in: [...WASTE_CAP_STATUSES] } },
          { status: 'REJECTED' },
          { status: 'EXPIRED', closeReason: { in: [...LOST_CLOSE_REASONS] } },
        ],
      },
      orderBy: { createdAt: 'desc' },
      select: { createdAt: true },
    });
    return last?.createdAt ?? null;
  }

  private async build(
    userId: string,
    now: Date,
    orders: OrderRow[],
    opts: { bottlesDeliveredBefore?: Date },
  ): Promise<ReturnPackagingSuggestion | null> {
    if (orders.length === 0) return null;
    const variationIds = [...new Set(orders.flatMap((o) => o.items.map((i) => i.variationId)))];
    const variations = await this.prisma.variation.findMany({ where: { id: { in: variationIds } }, select: { id: true, productId: true } });
    const productOf = new Map(variations.map((v) => [v.id, v.productId]));
    const productIds = [...new Set(variations.map((v) => v.productId))];
    const [facts, items, snap, usage] = await Promise.all([
      this.prisma.productEcoFact.findMany({
        where: { kind: 'RETURNABLE_PACKAGING', status: 'APPROVED', productId: { in: productIds } },
        select: { productId: true, variationId: true },
      }),
      this.prisma.wasteItem.findMany({
        where: { code: { in: Object.values(RETURN_PACKAGING_CODES) } },
        select: { id: true, code: true, name: true, unitLabel: true, unitsPerPoint: true, pointsPerGroup: true, monthlyCapQty: true, status: true, hazardous: true },
      }),
      this.wasteConfig.snapshot(),
      this.hold.capUsage(this.prisma, userId, vnDateKey(now), vnMonthKey(now)),
    ]);
    const rows: ReturnPackagingOrder[] = orders.map((o) => ({
      ...o,
      items: o.items.map((i) => ({ ...i, productId: productOf.get(i.variationId) ?? null })),
    }));
    return buildReturnPackaging(rows, facts, new Map(items.map((i) => [i.code, i])), snap.pickupMinPoints, {
      usedMonth: usage.itemMonth,
      bottlesDeliveredBefore: opts.bottlesDeliveredBefore,
    });
  }
}
