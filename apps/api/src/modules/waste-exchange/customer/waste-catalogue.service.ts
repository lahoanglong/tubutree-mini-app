import { Injectable } from '@nestjs/common';
import type { WasteItem, WastePoint, WastePointKind } from '@prisma/client';
import type { WasteItemDTO, WasteNearbyRequest, WasteOpeningHours, WastePointDTO } from '@tubutree/shared-types';
import { vnMonthKey } from '../../../common/vn-time';
import { PrismaService } from '../../../prisma/prisma.service';
import { resolveZaloLocation } from '../../staff/attendance/zalo-location';
import { WasteAccessService } from '../core/waste-access.service';
import { WasteConfigService } from '../core/waste-config.service';

const MAX_POINTS = 200;
const DAY_MS = 86_400_000;
const EARTH_RADIUS_KM = 6371;

export function toWasteItemDTO(i: WasteItem): WasteItemDTO {
  return {
    id: i.id,
    code: i.code,
    name: i.name,
    unitLabel: i.unitLabel,
    unitsPerPoint: i.unitsPerPoint,
    pointsPerGroup: i.pointsPerGroup,
    dropsPerUnit: i.dropsPerUnit,
    dailyCapQty: i.dailyCapQty,
    monthlyCapQty: i.monthlyCapQty,
    status: i.status,
    prepInstructions: i.prepInstructions,
    imageUrl: i.imageUrl,
    gramsPerUnit: i.gramsPerUnit,
    hazardous: i.hazardous,
    sortOrder: i.sortOrder,
  };
}

export function toWastePointDTO(p: WastePoint, acceptedItemIds: string[], quotaFull: boolean, distanceKm: number | null): WastePointDTO {
  return {
    id: p.id,
    kind: p.kind,
    name: p.name,
    addressLine: p.addressLine,
    provinceCode: p.provinceCode,
    provinceName: p.provinceName,
    communeCode: p.communeCode,
    communeName: p.communeName,
    lat: p.lat,
    lng: p.lng,
    phone: p.phone,
    openingHours: p.openingHours as unknown as WasteOpeningHours,
    acceptedItemIds,
    perkText: p.perkText,
    quotaFull,
    distanceKm,
  };
}

export function haversineKm(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const rad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.sqrt(h));
}

export function isHiddenInactive(
  p: { kind: WastePointKind; lastConfirmedAt: Date | null; activatedAt: Date | null },
  now: Date,
  inactiveDays: number,
): boolean {
  if (p.kind === 'WAREHOUSE') return false;
  const dates = [p.lastConfirmedAt, p.activatedAt].filter((d): d is Date => d !== null);
  if (dates.length === 0) return false;
  const last = Math.max(...dates.map((d) => d.getTime()));
  return now.getTime() - last > inactiveDays * DAY_MS;
}

@Injectable()
export class WasteCatalogueService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: WasteAccessService,
    private readonly config: WasteConfigService,
  ) {}

  async listItems(): Promise<WasteItemDTO[]> {
    const rows = await this.prisma.wasteItem.findMany({
      where: { status: { in: ['ACTIVE', 'COMING_SOON'] } },
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
    });
    return rows.map(toWasteItemDTO);
  }

  async listPoints(provinceCode?: string): Promise<WastePointDTO[]> {
    const now = new Date();
    const [snapshot, rows] = await Promise.all([
      this.config.snapshot(),
      this.prisma.wastePoint.findMany({
        where: { status: 'ACTIVE', ...(provinceCode ? { provinceCode } : {}) },
        include: { items: { select: { itemId: true } } },
        orderBy: [{ kind: 'asc' }, { sortOrder: 'asc' }, { name: 'asc' }],
      }),
    ]);
    const available = await this.access.availablePointIds(this.prisma, rows.map((p) => p.id));
    const kept = rows.filter((p) => available.has(p.id) && !isHiddenInactive(p, now, snapshot.pointInactiveDays)).slice(0, MAX_POINTS);

    const activeItems = await this.prisma.wasteItem.findMany({
      where: { status: 'ACTIVE' },
      select: { id: true },
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
    });
    const activeIds = activeItems.map((i) => i.id);
    const activeSet = new Set(activeIds);
    const usage = await this.prisma.wastePointUsage.findMany({
      where: { pointId: { in: kept.map((p) => p.id) }, monthKey: vnMonthKey(now) },
      select: { pointId: true, pointsUsed: true },
    });
    const used = new Map(usage.map((u) => [u.pointId, u.pointsUsed]));

    return kept.map((p) => {
      const accepted = p.kind === 'WAREHOUSE' ? activeIds : p.items.map((l) => l.itemId).filter((id) => activeSet.has(id));
      const quotaFull = p.kind === 'PARTNER' && p.monthlyQuotaPoints !== null && (used.get(p.id) ?? 0) >= p.monthlyQuotaPoints;
      return toWastePointDTO(p, accepted, quotaFull, null);
    });
  }

  async nearbyPoints(body: WasteNearbyRequest): Promise<WastePointDTO[]> {
    const list = await this.listPoints(body.provinceCode);
    const loc = await resolveZaloLocation(process.env.ZALO_APP_SECRET, body.locationToken, body.zaloAccessToken).catch(() => null);
    if (!loc) return list;
    const located: WastePointDTO[] = [];
    const rest: WastePointDTO[] = [];
    for (const p of list) {
      if (p.lat !== null && p.lng !== null) {
        located.push({ ...p, distanceKm: Math.round(haversineKm(loc, { lat: p.lat, lng: p.lng }) * 10) / 10 });
      } else rest.push(p);
    }
    located.sort((a, b) => (a.distanceKm as number) - (b.distanceKm as number));
    return [...located, ...rest];
  }
}
