import type { Prisma } from '@prisma/client';

/** Phần đã hoàn ở các lần trả MỘT PHẦN đã duyệt của một đơn (D3). */
export interface PartialReturnTotals {
  /** Tiền hàng + phí ship đã hoàn. */
  money: number;
  shipping: number;
  pointsUsedBack: number;
  convertedBack: number;
  pointsEarnedBack: number;
  commissionReversed: number;
  /** Số đơn vị đã duyệt trả theo dòng (đã hoàn quota flash sale, đã hoàn tiền). */
  approvedQty: Map<string, number>;
  /** Số đơn vị đã nhận hàng về và cộng lại kho theo dòng. */
  restockedQty: Map<string, number>;
}

type Db = Pick<Prisma.TransactionClient, 'returnRequest'>;

/**
 * Lần đảo cả đơn (huỷ/trả từ Pancake, admin đổi trạng thái, lần trả nốt) phải trừ phần này, nếu không khách được hoàn
 * hai lần cho cùng món và kho cộng hai lần. Yêu cầu fullReturn (lần trả nốt, hoặc mọi yêu cầu duyệt trước P5) không
 * tính: chính nó là lần đảo cả đơn.
 */
export async function partialReturnTotals(db: Db, orderId: string, excludeRequestId?: string): Promise<PartialReturnTotals> {
  const rows = await db.returnRequest.findMany({
    where: {
      orderId,
      status: 'APPROVED',
      fullReturn: false,
      ...(excludeRequestId ? { id: { not: excludeRequestId } } : {}),
    },
    include: { items: true },
  });
  const totals: PartialReturnTotals = {
    money: 0,
    shipping: 0,
    pointsUsedBack: 0,
    convertedBack: 0,
    pointsEarnedBack: 0,
    commissionReversed: 0,
    approvedQty: new Map(),
    restockedQty: new Map(),
  };
  for (const r of rows ?? []) {
    totals.money += (r.refundAmount ?? 0) + r.shippingRefund;
    totals.shipping += r.shippingRefund;
    totals.pointsUsedBack += r.pointsRefunded;
    totals.convertedBack += r.convertedPointsRefunded;
    totals.pointsEarnedBack += r.pointsReversed;
    totals.commissionReversed += r.commissionReversed;
    for (const it of r.items ?? []) {
      totals.approvedQty.set(it.orderItemId, (totals.approvedQty.get(it.orderItemId) ?? 0) + it.quantity);
      if (r.receivedAt) totals.restockedQty.set(it.orderItemId, (totals.restockedQty.get(it.orderItemId) ?? 0) + it.quantity);
    }
  }
  return totals;
}

export const NO_PARTIAL_RETURNS: PartialReturnTotals = {
  money: 0,
  shipping: 0,
  pointsUsedBack: 0,
  convertedBack: 0,
  pointsEarnedBack: 0,
  commissionReversed: 0,
  approvedQty: new Map(),
  restockedQty: new Map(),
};
