import { BadRequestException, Injectable } from '@nestjs/common';
import {
  WASTE_METHOD_VALUES,
  WASTE_REJECTION_REASON_VALUES,
  WASTE_REQUEST_STATUS_VALUES,
  type WasteMethod,
  type WasteMonthMetrics,
  type WasteRejectionReason,
  type WasteRequestStatus,
} from '@tubutree/shared-types';
import { VN_OFFSET_MS } from '../../../common/vn-time';
import { PrismaService } from '../../../prisma/prisma.service';

const DAY_MS = 24 * 60 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;
const REPEAT_WINDOW_MS = 60 * DAY_MS;
const COMPLETED_STATUSES: WasteRequestStatus[] = ['COMPLETED', 'REVERSED'];

export interface WasteMonthRows {
  created: { method: WasteMethod; status: WasteRequestStatus; rejectionReason: WasteRejectionReason | null }[];
  completed: {
    id: string;
    userId: string;
    method: WasteMethod;
    pointId: string;
    pointName: string;
    createdAt: Date;
    completedAt: Date;
    carrierCostVnd: number | null;
    receivedWeightGrams: number | null;
    lines: { itemId: string; itemName: string; unitLabel: string; declaredQty: number; receivedQty: number | null; gramsPerUnit: number | null }[];
  }[];
  issued: { refId: string; delta: number }[];
  reversed: { id: string; pointId: string; pointName: string; taken: number }[];
  expiredCount: number;
  partnerPoints: { id: string; name: string; monthlyQuotaPoints: number | null }[];
  usage: { pointId: string; pointsUsed: number; confirmations: number }[];
  completedLast60d: { userId: string; completedAt: Date }[];
  ordersOfExchangers: number;
  ordersOfNonExchangers: number;
}

export interface WastePointMonthRow {
  pointId: string;
  pointName: string;
  confirmations: number;
  units: number;
  pointsIssued: number;
  pointsReversed: number;
  quotaUsed: number;
}

export interface WasteMonthlyReport {
  month: string;
  pointId: string | null;
  metrics: WasteMonthMetrics;
  perPoint: WastePointMonthRow[];
  confirmations: number;
  quotaUsed: number;
}

const round1 = (x: number): number => Math.round(x * 10) / 10;
const sum = (xs: number[]): number => xs.reduce((s, x) => s + x, 0);

function zeroFilled<K extends string>(keys: readonly K[]): Record<K, number> {
  return Object.fromEntries(keys.map((k) => [k, 0])) as Record<K, number>;
}

function nearestRank(sorted: number[], p: number): number | null {
  const value = sorted[Math.ceil(p * sorted.length) - 1];
  return value === undefined ? null : round1(value);
}

function pct(received: number, declared: number): number | null {
  return declared > 0 ? round1((received * 100) / declared) : null;
}

export function vnMonthRange(month: string): { start: Date; end: Date } {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) throw new BadRequestException('Tháng phải có dạng YYYY-MM.');
  const y = Number(month.slice(0, 4));
  const m = Number(month.slice(5, 7));
  return { start: new Date(Date.UTC(y, m - 1, 1) - VN_OFFSET_MS), end: new Date(Date.UTC(y, m, 1) - VN_OFFSET_MS) };
}

export function buildWasteMonthMetrics(rows: WasteMonthRows): { metrics: WasteMonthMetrics; perPoint: WastePointMonthRow[] } {
  const requestsCreatedByMethod = zeroFilled(WASTE_METHOD_VALUES);
  const requestsByStatus = zeroFilled(WASTE_REQUEST_STATUS_VALUES);
  const rejectionsByReason = zeroFilled(WASTE_REJECTION_REASON_VALUES);
  for (const r of rows.created) {
    requestsCreatedByMethod[r.method] += 1;
    requestsByStatus[r.status] += 1;
    if (r.status === 'REJECTED' && r.rejectionReason) rejectionsByReason[r.rejectionReason] += 1;
  }

  const hours = rows.completed.map((r) => (r.completedAt.getTime() - r.createdAt.getTime()) / HOUR_MS).sort((a, b) => a - b);

  const itemQty = new Map<string, { itemId: string; itemName: string; unitLabel: string; qty: number }>();
  const pointQty = new Map<string, { pointId: string; pointName: string; qty: number }>();
  const byMethod = Object.fromEntries(WASTE_METHOD_VALUES.map((m) => [m, { received: 0, declared: 0 }])) as Record<WasteMethod, { received: number; declared: number }>;
  const byPoint = new Map<string, { received: number; declared: number }>();
  for (const req of rows.completed) {
    const point = pointQty.get(req.pointId) ?? { pointId: req.pointId, pointName: req.pointName, qty: 0 };
    pointQty.set(req.pointId, point);
    const share = byPoint.get(req.pointId) ?? { received: 0, declared: 0 };
    byPoint.set(req.pointId, share);
    for (const line of req.lines) {
      const received = line.receivedQty ?? 0;
      const item = itemQty.get(line.itemId) ?? { itemId: line.itemId, itemName: line.itemName, unitLabel: line.unitLabel, qty: 0 };
      item.qty += received;
      itemQty.set(line.itemId, item);
      point.qty += received;
      byMethod[req.method].received += received;
      byMethod[req.method].declared += line.declaredQty;
      share.received += received;
      share.declared += line.declaredQty;
    }
  }
  const unitsByItem = [...itemQty.values()].sort((a, b) => b.qty - a.qty || a.itemName.localeCompare(b.itemName, 'vi'));
  const unitsByPoint = [...pointQty.values()].sort((a, b) => b.qty - a.qty || a.pointName.localeCompare(b.pointName, 'vi'));

  const completedIds = new Set(rows.completed.map((r) => r.id));
  const issuedByRequest = new Map<string, number>();
  for (const row of rows.issued) {
    if (completedIds.has(row.refId)) issuedByRequest.set(row.refId, (issuedByRequest.get(row.refId) ?? 0) + row.delta);
  }
  const pointsIssued = sum([...issuedByRequest.values()]);
  const pointsReversed = sum(rows.reversed.map((r) => r.taken));

  const pickups = rows.completed.filter((r) => r.method === 'PICKUP');
  const carrierCostVnd = sum(pickups.map((r) => r.carrierCostVnd ?? 0));

  const weighed = rows.completed.filter((r) => r.receivedWeightGrams !== null && r.lines.every((l) => l.gramsPerUnit !== null));
  const receivedWeightGrams = weighed.length ? sum(weighed.map((r) => r.receivedWeightGrams ?? 0)) : null;
  const estimatedWeightGrams = weighed.length ? sum(weighed.flatMap((r) => r.lines.map((l) => (l.receivedQty ?? 0) * (l.gramsPerUnit ?? 0)))) : null;

  const repeaters = new Set<string>();
  for (const e of rows.completed) {
    const t = e.completedAt.getTime();
    const earlier = rows.completedLast60d.some((o) => o.userId === e.userId && o.completedAt.getTime() < t && o.completedAt.getTime() >= t - REPEAT_WINDOW_MS);
    if (earlier) repeaters.add(e.userId);
  }

  const quotaByPoint = rows.partnerPoints.map((p) => {
    const u = rows.usage.find((x) => x.pointId === p.id);
    return { pointId: p.id, pointName: p.name, quota: p.monthlyQuotaPoints, used: u?.pointsUsed ?? 0, confirmations: u?.confirmations ?? 0 };
  });

  const names = new Map<string, string>();
  for (const p of rows.partnerPoints) names.set(p.id, p.name);
  for (const r of rows.reversed) names.set(r.pointId, r.pointName);
  for (const r of rows.completed) names.set(r.pointId, r.pointName);
  const perPointMap = new Map<string, WastePointMonthRow>();
  const rowOf = (pointId: string): WastePointMonthRow => {
    let row = perPointMap.get(pointId);
    if (!row) {
      row = { pointId, pointName: names.get(pointId) ?? pointId, confirmations: 0, units: 0, pointsIssued: 0, pointsReversed: 0, quotaUsed: 0 };
      perPointMap.set(pointId, row);
    }
    return row;
  };
  for (const req of rows.completed) {
    const row = rowOf(req.pointId);
    row.confirmations += 1;
    row.units += sum(req.lines.map((l) => l.receivedQty ?? 0));
    row.pointsIssued += issuedByRequest.get(req.id) ?? 0;
  }
  for (const r of rows.reversed) rowOf(r.pointId).pointsReversed += r.taken;
  for (const u of rows.usage) rowOf(u.pointId).quotaUsed += u.pointsUsed;
  const perPoint = [...perPointMap.values()].sort((a, b) => a.pointName.localeCompare(b.pointName, 'vi'));

  const metrics: WasteMonthMetrics = {
    requestsCreatedByMethod,
    requestsByStatus,
    completeHoursP50: nearestRank(hours, 0.5),
    completeHoursP90: nearestRank(hours, 0.9),
    unitsByItem,
    unitsByPoint,
    pointsIssued,
    pointsReversed,
    receivedDeclaredPctByMethod: Object.fromEntries(WASTE_METHOD_VALUES.map((m) => [m, pct(byMethod[m].received, byMethod[m].declared)])) as Record<WasteMethod, number | null>,
    receivedDeclaredPctByPoint: unitsByPoint.map((p) => {
      const s = byPoint.get(p.pointId)!;
      return { pointId: p.pointId, pct: pct(s.received, s.declared) };
    }),
    rejectionsByReason,
    expiredCount: rows.expiredCount,
    quotaByPoint,
    pickupCount: pickups.length,
    carrierCostVnd,
    receivedWeightGrams,
    estimatedWeightGrams,
    repeatCustomers60d: repeaters.size,
    ordersOfExchangers: rows.ordersOfExchangers,
    ordersOfNonExchangers: rows.ordersOfNonExchangers,
    costVndPer1000PointsIssued: pointsIssued > 0 ? Math.round((carrierCostVnd * 1000) / pointsIssued) : null,
  };
  return { metrics, perPoint };
}

@Injectable()
export class WasteReportsService {
  constructor(private readonly prisma: PrismaService) {}

  async monthly(month: string, pointId?: string): Promise<WasteMonthlyReport> {
    const { start, end } = vnMonthRange(month);
    const range = { gte: start, lt: end };
    const onPoint = pointId ? { pointId } : {};

    const [created, completed, reversedReqs, expiredCount, partnerPoints, usage, lastCompletions] = await Promise.all([
      this.prisma.wasteRequest.findMany({
        where: { createdAt: range, ...onPoint },
        select: { method: true, status: true, rejectionReason: true },
      }),
      this.prisma.wasteRequest.findMany({
        where: { status: { in: COMPLETED_STATUSES }, completedAt: range, ...onPoint },
        select: {
          id: true,
          userId: true,
          method: true,
          pointId: true,
          createdAt: true,
          completedAt: true,
          carrierCostVnd: true,
          receivedWeightGrams: true,
          point: { select: { name: true } },
          lines: { select: { itemId: true, itemName: true, unitLabel: true, declaredQty: true, receivedQty: true, gramsPerUnit: true } },
        },
      }),
      this.prisma.wasteRequest.findMany({
        where: { reversedAt: range, ...onPoint },
        select: { id: true, pointId: true, point: { select: { name: true } } },
      }),
      this.prisma.wasteRequest.count({ where: { status: 'EXPIRED', closedAt: range, ...onPoint } }),
      this.prisma.wastePoint.findMany({
        where: { kind: 'PARTNER', ...(pointId ? { id: pointId } : {}) },
        select: { id: true, name: true, monthlyQuotaPoints: true },
      }),
      this.prisma.wastePointUsage.findMany({ where: { monthKey: month, ...onPoint } }),
      this.prisma.wasteRequest.findMany({
        where: { status: { in: COMPLETED_STATUSES }, completedAt: { gte: new Date(start.getTime() - REPEAT_WINDOW_MS), lt: end }, ...onPoint },
        select: { userId: true, completedAt: true },
      }),
    ]);

    const completedRows = completed.map((r) => ({
      id: r.id,
      userId: r.userId,
      method: r.method,
      pointId: r.pointId,
      pointName: r.point.name,
      createdAt: r.createdAt,
      completedAt: r.completedAt as Date,
      carrierCostVnd: r.carrierCostVnd,
      receivedWeightGrams: r.receivedWeightGrams,
      lines: r.lines,
    }));
    const completedIds = completedRows.map((r) => r.id);
    const reversedIds = reversedReqs.map((r) => r.id);

    const ledger = await this.prisma.pointsTransaction.findMany({
      where: {
        OR: [
          { refType: 'RECYCLE', refId: { in: completedIds } },
          { refType: 'RECYCLE_REVERSED', refId: { in: reversedIds } },
        ],
      },
      select: { refType: true, refId: true, delta: true },
    });
    const issued = ledger.filter((l) => l.refType === 'RECYCLE').map((l) => ({ refId: l.refId as string, delta: l.delta }));
    const reversed = reversedReqs.map((r) => ({
      id: r.id,
      pointId: r.pointId,
      pointName: r.point.name,
      taken: -sum(ledger.filter((l) => l.refType === 'RECYCLE_REVERSED' && l.refId === r.id).map((l) => l.delta)),
    }));

    const exchangerIds = [...new Set(completedRows.map((r) => r.userId))];
    const orderWindow = { createdAt: range, status: { not: 'CANCELLED' as const } };
    const [ordersOfExchangers, ordersOfNonExchangers] = await Promise.all([
      this.prisma.order.count({ where: { ...orderWindow, userId: { in: exchangerIds } } }),
      this.prisma.order.count({ where: { ...orderWindow, userId: { notIn: exchangerIds } } }),
    ]);

    const { metrics, perPoint } = buildWasteMonthMetrics({
      created,
      completed: completedRows,
      issued,
      reversed,
      expiredCount,
      partnerPoints,
      usage,
      completedLast60d: lastCompletions.map((r) => ({ userId: r.userId, completedAt: r.completedAt as Date })),
      ordersOfExchangers,
      ordersOfNonExchangers,
    });
    return {
      month,
      pointId: pointId ?? null,
      metrics,
      perPoint,
      confirmations: completedRows.length,
      quotaUsed: sum(usage.map((u) => u.pointsUsed)),
    };
  }
}
