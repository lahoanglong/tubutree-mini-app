import { ConflictException } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import type { SystemConfigService } from '../../system-config/system-config.service';
import { assertPickupItemsAllowedForProvince, isHcmProvince } from '../core/waste-pickup-rules';
import { writeWasteEvent } from '../core/waste-events';

export const PICKUP_REQUEST_GONE_MESSAGE = 'Yêu cầu thu rác đã hết hạn hoặc đã huỷ';
export const PICKUP_PAUSED_MESSAGE = 'Thu kèm rác đang tạm dừng với tài khoản của bạn, hãy tắt công tắc để đặt đơn';
// Equal to RECYCLING_NOTE_MAX in pancake-order-body.ts, which cuts the note to the same length.
export const PICKUP_NOTE_MAX = 500;

export interface LockedPickupRequest {
  id: string;
  code: string;
  /** Điểm ước tính lúc khoá: nền để kiểm lại ngưỡng miễn phí giao ngay dưới khoá, không tin số đọc trước tx. */
  estimatedPoints: number;
  lines: { itemName: string; unitLabel: string; declaredQty: number }[];
}

export async function readPickupGate(
  config: Pick<SystemConfigService, 'get'> | undefined,
  gomdonEnabled: () => Promise<boolean>,
): Promise<boolean> {
  if (!config) return false;
  const enabled = await config.get<unknown>('waste.enabled', false);
  const lane = await config.get<unknown>('waste.lane_pickup_enabled', false);
  if (enabled !== true || lane !== true) return false;
  return gomdonEnabled();
}

/**
 * `province` là tỉnh của địa chỉ giao: hàng nguy hại (Pin cũ) trong phiếu chỉ đi kèm đơn khi giao tới TP.HCM, kể cả phiếu tạo từ trước
 * và khách đổi địa chỉ sau đó.
 */
export async function lockPickupRequestForCheckout(
  tx: Prisma.TransactionClient,
  userId: string,
  wasteRequestId: string,
  province: string | null | undefined,
): Promise<LockedPickupRequest> {
  // No expiresAt condition: a request past expiresAt that the cron has not swept yet may still attach (§12.3).
  const rows = await tx.$queryRaw<{ id: string; code: string; estimatedPoints: number }[]>`
    SELECT "id", "code", "estimatedPoints" FROM "waste_requests"
    WHERE "id" = ${wasteRequestId} AND "userId" = ${userId} AND "method" = 'PICKUP' AND "status" = 'OPEN' AND "orderId" IS NULL
    FOR UPDATE`;
  const row = rows[0];
  if (!row) throw new ConflictException(PICKUP_REQUEST_GONE_MESSAGE);
  const lines = await tx.wasteRequestLine.findMany({
    where: { requestId: row.id },
    orderBy: { id: 'asc' },
    select: { itemName: true, unitLabel: true, declaredQty: true },
  });
  const flags = await tx.wasteUserFlags.findUnique({ where: { userId }, select: { blockedAt: true, shipLockedAt: true } });
  if (flags?.blockedAt || flags?.shipLockedAt) throw new ConflictException(PICKUP_PAUSED_MESSAGE);
  if (!isHcmProvince(province)) {
    const hazardous = await tx.wasteRequestLine.findMany({ where: { requestId: row.id, item: { hazardous: true } }, select: { id: true }, take: 1 });
    assertPickupItemsAllowedForProvince(hazardous.map(() => ({ hazardous: true })), province);
  }
  return { id: row.id, code: row.code, estimatedPoints: row.estimatedPoints, lines };
}

/** Ghi chú đóng gói do server dựng (không có chữ khách). `returnWeightGrams` khách khai thì thêm đuôi "gửi lại ~X.Xkg", đuôi này không bị cắt. */
export function buildPickupRecyclingNote(req: Pick<LockedPickupRequest, 'code' | 'lines'>, returnWeightGrams?: number | null): string {
  const suffix = returnWeightGrams && returnWeightGrams > 0 ? `; gửi lại ~${(returnWeightGrams / 1000).toFixed(1)}kg` : '';
  const note = `Thu kèm rác ${req.code}: ${req.lines.map((l) => `${l.itemName}: ${l.declaredQty} ${l.unitLabel}`).join(', ')}`;
  return (note.length > PICKUP_NOTE_MAX - suffix.length ? note.slice(0, PICKUP_NOTE_MAX - suffix.length) : note) + suffix;
}

export async function attachPickupRequest(tx: Prisma.TransactionClient, userId: string, requestId: string, orderId: string): Promise<void> {
  const res = await tx.wasteRequest.updateMany({
    where: { id: requestId, userId, method: 'PICKUP', status: 'OPEN', orderId: null },
    data: { orderId, expiresAt: null },
  });
  if (res.count !== 1) throw new ConflictException(PICKUP_REQUEST_GONE_MESSAGE);
  await writeWasteEvent(tx, {
    kind: 'REQUEST_ATTACHED',
    actorUserId: userId,
    actorRole: 'CUSTOMER',
    requestId,
    meta: { orderId, before: { status: 'OPEN', orderId: null }, after: { status: 'OPEN', orderId } },
  });
}
