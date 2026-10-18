import { NotFoundException } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import type { AdminWasteEventDTO, WasteRequestAdminDetailDTO } from '@tubutree/shared-types';
import type { WasteAccessService } from '../core/waste-access.service';
import { customerView } from '../core/waste-mask';
import { WASTE_REQUEST_FULL_INCLUDE, toRequestDetail } from '../customer/waste-request.mapper';

export const WASTE_ADMIN_DETAIL_INCLUDE = {
  ...WASTE_REQUEST_FULL_INCLUDE,
  lines: { orderBy: { id: 'asc' }, include: { item: { select: { hazardous: true } } } },
  user: { select: { id: true, fullName: true, phone: true } },
} satisfies Prisma.WasteRequestInclude;

export type WasteAdminDetailRow = Prisma.WasteRequestGetPayload<{ include: typeof WASTE_ADMIN_DETAIL_INCLUDE }>;

const iso = (d: Date | null): string | null => (d ? d.toISOString() : null);

export function toAdminRequestDetail(
  row: WasteAdminDetailRow,
  viewerIsAdmin: boolean,
  pointAvailable: boolean,
  events?: AdminWasteEventDTO[],
): WasteRequestAdminDetailDTO {
  const v = customerView(row.user, viewerIsAdmin, viewerIsAdmin);
  const base = toRequestDetail(row, pointAvailable);
  return {
    ...base,
    // The live item flag, like the confirm check: the line snapshot does not freeze it.
    lines: base.lines.map((l, i) => ({ ...l, hazardous: row.lines[i]!.item.hazardous })),
    customerName: v.name,
    customerPhone: v.phone,
    ...(viewerIsAdmin ? { userId: row.userId } : {}),
    trackingConflict: row.trackingConflict,
    confirmedByUserId: row.confirmedByUserId,
    receivedWeightGrams: row.receivedWeightGrams,
    carrierCostVnd: row.carrierCostVnd,
    reversedAt: iso(row.reversedAt),
    reversedByUserId: row.reversedByUserId,
    reversalShortfallPoints: row.reversalShortfallPoints,
    capDayKey: row.capDayKey,
    capMonthKey: row.capMonthKey,
    consentAt: row.consentAt.toISOString(),
    consentVersion: row.consentVersion,
    ...(viewerIsAdmin && events ? { events } : {}),
  };
}

export async function loadAdminRequestDetail(
  db: Prisma.TransactionClient,
  access: WasteAccessService,
  id: string,
  viewerIsAdmin: boolean,
): Promise<WasteRequestAdminDetailDTO> {
  const row = await db.wasteRequest.findUnique({ where: { id }, include: WASTE_ADMIN_DETAIL_INCLUDE });
  if (!row) throw new NotFoundException('Không tìm thấy mã');
  const pointAvailable = (await access.availablePointIds(db, [row.pointId])).has(row.pointId);
  let events: AdminWasteEventDTO[] | undefined;
  if (viewerIsAdmin) {
    const rows = await db.wasteEvent.findMany({ where: { requestId: id }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] });
    events = rows.map((e) => ({
      id: e.id,
      createdAt: e.createdAt.toISOString(),
      kind: e.kind,
      actorUserId: e.actorUserId,
      actorRole: e.actorRole,
      requestId: e.requestId,
      pointId: e.pointId,
      giftRedemptionId: e.giftRedemptionId,
      meta: (e.meta as Record<string, unknown> | null) ?? null,
    }));
  }
  return toAdminRequestDetail(row, viewerIsAdmin, pointAvailable, events);
}
