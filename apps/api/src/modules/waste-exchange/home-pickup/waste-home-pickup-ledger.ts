import type { Prisma, WasteCloseReason } from '@prisma/client';
import { applyPointsDelta } from '../../loyalty/points-ledger';
import { writeWasteEvent, type WasteEventInput } from '../core/waste-events';

/** Sổ điểm trừ phí shipper: refType chung của phiếu đổi rác, reason gắn mã phiếu để tra và để hoàn đúng lô. */
export const WASTE_PICKUP_FEE_REF_TYPE = 'WASTE_REQUEST';
export const wastePickupFeeReason = (code: string): string => `WASTE_PICKUP_FEE:${code}`;
export const wastePickupFeeRefundReason = (code: string): string => `WASTE_PICKUP_FEE_REFUND:${code}`;

type RefundRequest = { id: string; userId: string; code: string; shipFeePointsUsed: number | null };

/**
 * Hoàn Điểm Xanh đã trừ để trả phí shipper, đúng một lần: cột shipFeePointsRefunded là khoá (updateMany có điều kiện IS NULL), nên
 * webhook trùng, cron và nút huỷ chạy chồng nhau cũng không hoàn đôi. Hoàn vào đúng lô đã trừ theo sổ điểm; sổ lệch số trên phiếu thì
 * hoàn đúng số trên phiếu vào lô thường (không để khách mất điểm). Gọi trong transaction đang giữ khoá dòng phiếu.
 */
export async function refundShipFeePoints(tx: Prisma.TransactionClient, req: RefundRequest, expiresAt: Date): Promise<number> {
  const used = req.shipFeePointsUsed ?? 0;
  const claimed = await tx.wasteRequest.updateMany({ where: { id: req.id, shipFeePointsRefunded: null }, data: { shipFeePointsRefunded: used } });
  if (claimed.count !== 1 || used <= 0) return 0;
  const entries = await tx.pointsTransaction.findMany({
    where: { userId: req.userId, refType: WASTE_PICKUP_FEE_REF_TYPE, refId: req.id, reason: wastePickupFeeReason(req.code), delta: { lt: 0 } },
    select: { delta: true, lot: true },
  });
  const byLot = { STANDARD: 0, CONVERTED: 0 };
  for (const e of entries) byLot[e.lot] += -e.delta;
  if (byLot.STANDARD + byLot.CONVERTED !== used) {
    byLot.STANDARD = used;
    byLot.CONVERTED = 0;
  }
  for (const lot of ['STANDARD', 'CONVERTED'] as const) {
    const amount = byLot[lot];
    if (amount <= 0) continue;
    await applyPointsDelta(tx, {
      userId: req.userId,
      delta: amount,
      lot,
      reason: wastePickupFeeRefundReason(req.code),
      refType: WASTE_PICKUP_FEE_REF_TYPE,
      refId: req.id,
      expiresAt: lot === 'STANDARD' ? expiresAt : null,
    });
  }
  return used;
}

export interface HomePickupCloseArgs {
  req: RefundRequest & { pointId?: string };
  from: readonly ('OPEN' | 'IN_TRANSIT')[];
  to: 'CANCELLED' | 'EXPIRED';
  closeReason: WasteCloseReason | null;
  now: Date;
  refundExpiresAt: Date;
  /** Cột gomdon* ghi cùng lúc với việc đóng phiếu (trạng thái vận đơn, lịch sử). */
  data?: Prisma.WasteRequestUpdateManyMutationInput;
  /** Điều kiện thêm cho lần đóng (vd hạn giữ chỗ đã qua): không khớp thì coi như bên khác đã xử lý. */
  where?: Prisma.WasteRequestWhereInput;
  event: Omit<WasteEventInput, 'requestId' | 'pointId'>;
}

/**
 * Đóng phiếu HOME_PICKUP chưa có hàng tới kho (huỷ, hết hạn, bưu tá không lấy được) và hoàn Điểm Xanh phí shipper trong CÙNG transaction.
 * `closed:false` = phiếu đã sang trạng thái khác (bên khác thắng), không ghi gì thêm.
 */
export async function closeHomePickupRequest(tx: Prisma.TransactionClient, a: HomePickupCloseArgs): Promise<{ closed: boolean; refunded: number }> {
  const { count } = await tx.wasteRequest.updateMany({
    where: { id: a.req.id, method: 'HOME_PICKUP', status: { in: [...a.from] }, ...(a.where ?? {}) },
    data: { status: a.to, closedAt: a.now, closeReason: a.closeReason, ...(a.data ?? {}) },
  });
  if (count !== 1) return { closed: false, refunded: 0 };
  const refunded = await refundShipFeePoints(tx, a.req, a.refundExpiresAt);
  await writeWasteEvent(tx, {
    ...a.event,
    requestId: a.req.id,
    pointId: a.req.pointId ?? null,
    meta: { ...(a.event.meta ?? {}), shipFeePointsRefunded: refunded },
  });
  return { closed: true, refunded };
}
