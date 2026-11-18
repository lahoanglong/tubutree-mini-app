import { Injectable } from '@nestjs/common';
import type { ReturnPackagingSuggestion } from '@tubutree/shared-types';
import { PrismaService } from '../../../prisma/prisma.service';
import { SystemConfigService } from '../../system-config/system-config.service';
import { WasteConfigService } from '../core/waste-config.service';
import { WASTE_CAP_STATUSES } from '../waste.constants';
import {
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
    return this.build(isOwnDeliveredTubuOrder({ ...order, items: [] }, since) ? [order] : []);
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
    return this.build(own.slice(0, RETURN_PACKAGING_MAX_ORDERS));
  }

  /** Lần gửi rác gần nhất còn hiệu lực (mọi cách giao; phiếu huỷ, hết hạn hay bị từ chối không tính vì rác chưa rời nhà khách). */
  private async lastReturnAt(userId: string): Promise<Date | null> {
    const last = await this.prisma.wasteRequest.findFirst({
      where: { userId, status: { in: [...WASTE_CAP_STATUSES] } },
      orderBy: { createdAt: 'desc' },
      select: { createdAt: true },
    });
    return last?.createdAt ?? null;
  }

  private async build(orders: OrderRow[]): Promise<ReturnPackagingSuggestion | null> {
    if (orders.length === 0) return null;
    const variationIds = [...new Set(orders.flatMap((o) => o.items.map((i) => i.variationId)))];
    const variations = await this.prisma.variation.findMany({ where: { id: { in: variationIds } }, select: { id: true, productId: true } });
    const productOf = new Map(variations.map((v) => [v.id, v.productId]));
    const productIds = [...new Set(variations.map((v) => v.productId))];
    const [facts, items, snap] = await Promise.all([
      this.prisma.productEcoFact.findMany({
        where: { kind: 'RETURNABLE_PACKAGING', status: 'APPROVED', productId: { in: productIds } },
        select: { productId: true, variationId: true },
      }),
      this.prisma.wasteItem.findMany({
        where: { code: { in: Object.values(RETURN_PACKAGING_CODES) } },
        select: { id: true, code: true, name: true, unitLabel: true, unitsPerPoint: true, pointsPerGroup: true, dailyCapQty: true, monthlyCapQty: true, status: true, hazardous: true },
      }),
      this.wasteConfig.snapshot(),
    ]);
    const rows: ReturnPackagingOrder[] = orders.map((o) => ({
      ...o,
      items: o.items.map((i) => ({ ...i, productId: productOf.get(i.variationId) ?? null })),
    }));
    return buildReturnPackaging(rows, facts, new Map(items.map((i) => [i.code, i])), snap.pickupMinPoints);
  }
}
