import type { Prisma } from '@prisma/client';
import type { WasteOpeningHours, WasteRequestDetailDTO, WasteRequestSummaryDTO } from '@tubutree/shared-types';

export const WASTE_REQUEST_SUMMARY_INCLUDE = {
  point: { select: { name: true } },
  order: { select: { code: true } },
  lines: { orderBy: { id: 'asc' } },
} satisfies Prisma.WasteRequestInclude;

export const WASTE_REQUEST_FULL_INCLUDE = {
  point: { select: { id: true, kind: true, name: true, addressLine: true, communeName: true, provinceName: true, phone: true, openingHours: true } },
  order: { select: { code: true } },
  lines: { orderBy: { id: 'asc' } },
} satisfies Prisma.WasteRequestInclude;

export type WasteRequestWithPoint = Prisma.WasteRequestGetPayload<{ include: typeof WASTE_REQUEST_SUMMARY_INCLUDE }>;
export type WasteRequestFull = Prisma.WasteRequestGetPayload<{ include: typeof WASTE_REQUEST_FULL_INCLUDE }>;

const iso = (d: Date | null): string | null => (d ? d.toISOString() : null);

export function toRequestSummary(row: WasteRequestWithPoint): WasteRequestSummaryDTO {
  return {
    id: row.id,
    code: row.code,
    method: row.method,
    status: row.status,
    closeReason: row.closeReason,
    createdAt: row.createdAt.toISOString(),
    expiresAt: iso(row.expiresAt),
    estimatedPoints: row.estimatedPoints,
    pointsAwarded: row.pointsAwarded,
    pointName: row.point.name,
    orderCode: row.order?.code ?? null,
    lines: row.lines.map((l) => ({ itemName: l.itemName, unitLabel: l.unitLabel, declaredQty: l.declaredQty })),
  };
}

export function toRequestDetail(row: WasteRequestFull, pointAvailable: boolean): WasteRequestDetailDTO {
  const weighed = row.status === 'COMPLETED' && row.lines.every((l) => l.gramsPerUnit !== null);
  return {
    id: row.id,
    code: row.code,
    method: row.method,
    status: row.status,
    closeReason: row.closeReason,
    createdAt: row.createdAt.toISOString(),
    expiresAt: iso(row.expiresAt),
    estimatedPoints: row.estimatedPoints,
    pointsAwarded: row.pointsAwarded,
    pointName: row.point.name,
    orderCode: row.order?.code ?? null,
    lines: row.lines.map((l) => ({
      itemId: l.itemId,
      itemName: l.itemName,
      unitLabel: l.unitLabel,
      unitsPerPoint: l.unitsPerPoint,
      pointsPerGroup: l.pointsPerGroup,
      dropsPerUnit: l.dropsPerUnit,
      gramsPerUnit: l.gramsPerUnit,
      declaredQty: l.declaredQty,
      receivedQty: l.receivedQty,
      shortfallReason: l.shortfallReason,
      pointsAwarded: l.pointsAwarded,
    })),
    point: {
      id: row.point.id,
      kind: row.point.kind,
      name: row.point.name,
      addressLine: row.point.addressLine,
      communeName: row.point.communeName,
      provinceName: row.point.provinceName,
      phone: row.point.phone,
      openingHours: row.point.openingHours as unknown as WasteOpeningHours,
    },
    pointAvailable,
    carrier: row.carrier,
    trackingCode: row.trackingCode,
    inTransitAt: iso(row.inTransitAt),
    receivedAt: iso(row.receivedAt),
    completedAt: iso(row.completedAt),
    closedAt: iso(row.closedAt),
    rejectionReason: row.rejectionReason,
    rejectionNote: row.rejectionNote,
    dropsAwarded: row.dropsAwarded,
    impactGrams: weighed ? row.lines.reduce((sum, l) => sum + (l.receivedQty ?? 0) * (l.gramsPerUnit as number), 0) : null,
    reversedPoints: row.status === 'REVERSED' ? (row.pointsAwarded ?? 0) - (row.reversalShortfallPoints ?? 0) : null,
    reversalReason: row.reversalReason,
    editable: row.status === 'OPEN' && row.orderId === null && row.trackingCode === null,
    cancellable: row.status === 'OPEN' && row.orderId === null,
    orderId: row.orderId,
  };
}
