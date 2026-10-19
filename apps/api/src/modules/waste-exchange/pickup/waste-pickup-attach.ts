import { ConflictException } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import type { SystemConfigService } from '../../system-config/system-config.service';
import { writeWasteEvent } from '../core/waste-events';

export const PICKUP_REQUEST_GONE_MESSAGE = 'Yêu cầu thu rác đã hết hạn hoặc đã huỷ';
export const PICKUP_PAUSED_MESSAGE = 'Thu kèm rác đang tạm dừng với tài khoản của bạn, hãy tắt công tắc để đặt đơn';
// Equal to RECYCLING_NOTE_MAX in pancake-order-body.ts, which cuts the note to the same length.
export const PICKUP_NOTE_MAX = 500;

export interface LockedPickupRequest {
  id: string;
  code: string;
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

export async function lockPickupRequestForCheckout(
  tx: Prisma.TransactionClient,
  userId: string,
  wasteRequestId: string,
): Promise<LockedPickupRequest> {
  // No expiresAt condition: a request past expiresAt that the cron has not swept yet may still attach (§12.3).
  const rows = await tx.$queryRaw<{ id: string; code: string }[]>`
    SELECT "id", "code" FROM "waste_requests"
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
  return { id: row.id, code: row.code, lines };
}

export function buildPickupRecyclingNote(req: LockedPickupRequest): string {
  const note = `Thu kèm rác ${req.code}: ${req.lines.map((l) => `${l.itemName}: ${l.declaredQty} ${l.unitLabel}`).join(', ')}`;
  return note.length > PICKUP_NOTE_MAX ? note.slice(0, PICKUP_NOTE_MAX) : note;
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
