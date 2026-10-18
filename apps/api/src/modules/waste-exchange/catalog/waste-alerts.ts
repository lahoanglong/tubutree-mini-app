import {
  WASTE_ALERT_KIND_VALUES,
  type WasteAlertDTO,
  type WasteAlertKind,
  type WasteAlertThresholds,
  type WasteMethod,
} from '@tubutree/shared-types';
import { startOfVnMonth } from '../../../common/vn-time';
import { PrismaService } from '../../../prisma/prisma.service';

const DAY_MS = 86_400_000;
const DEFAULT_CONFIRMER_NAME = 'Nhân viên';

interface Visit {
  id: string;
  code: string;
  userId: string;
  pointId: string;
  method: WasteMethod;
  completedAt: Date | null;
  inTransitAt: Date | null;
  confirmedByUserId: string | null;
  pointsAwarded: number | null;
  user: { role: string };
  lines: { declaredQty: number; receivedQty: number | null }[];
}

interface Group {
  visits: number;
  full: number;
  units: number;
}

const round1 = (x: number) => Math.round(x * 10) / 10;
const isFullMatch = (v: Visit) => v.lines.every((l) => l.receivedQty === l.declaredQty);
const unitsOf = (v: Visit) => v.lines.reduce((sum, l) => sum + (l.receivedQty ?? 0), 0);

function groupBy(visits: Visit[], keyOf: (v: Visit) => string | null): Map<string, Visit[]> {
  const out = new Map<string, Visit[]>();
  for (const v of visits) {
    const key = keyOf(v);
    if (key === null) continue;
    const list = out.get(key);
    if (list) list.push(v);
    else out.set(key, [v]);
  }
  return out;
}

function summarize(visits: Visit[]): Group {
  return { visits: visits.length, full: visits.filter(isFullMatch).length, units: visits.reduce((s, v) => s + unitsOf(v), 0) };
}

export async function computeWasteAlerts(db: PrismaService, now: Date, t: WasteAlertThresholds): Promise<WasteAlertDTO[]> {
  const monthStart = startOfVnMonth(now);
  const longestWindowMs = Math.max(t.repeatCustomerDays, t.staffDirectDays) * DAY_MS;
  const since = new Date(Math.min(monthStart.getTime(), now.getTime() - longestWindowMs));

  const [points, rows, misses] = await Promise.all([
    db.wastePoint.findMany({ select: { id: true, name: true, kind: true, monthlyQuotaPoints: true } }),
    db.wasteRequest.findMany({
      where: { status: { in: ['COMPLETED', 'REVERSED'] }, completedAt: { gte: since } },
      select: {
        id: true,
        code: true,
        userId: true,
        pointId: true,
        method: true,
        completedAt: true,
        inTransitAt: true,
        confirmedByUserId: true,
        pointsAwarded: true,
        user: { select: { role: true } },
        lines: { select: { declaredQty: true, receivedQty: true } },
      },
    }),
    db.wasteEvent.groupBy({
      by: ['pointId'],
      where: {
        kind: 'LOOKUP_MISS',
        pointId: { not: null },
        createdAt: { gte: new Date(now.getTime() - t.lookupMissDays * DAY_MS) },
      },
      _count: { _all: true },
    }),
  ]);

  const visits: Visit[] = rows;
  const confirmerIds = [...new Set(visits.flatMap((v) => (v.confirmedByUserId ? [v.confirmedByUserId] : [])))];
  const confirmers = confirmerIds.length
    ? await db.user.findMany({ where: { id: { in: confirmerIds } }, select: { id: true, fullName: true } })
    : [];
  const confirmerName = (id: string | null) => (id ? confirmers.find((u) => u.id === id)?.fullName : null) ?? DEFAULT_CONFIRMER_NAME;
  const pointById = new Map(points.map((p) => [p.id, p]));

  const monthVisits = visits.filter((v) => v.completedAt !== null && v.completedAt.getTime() >= monthStart.getTime());
  const visitsByPoint = groupBy(monthVisits, (v) => v.pointId);
  const visitsByConfirmer = groupBy(monthVisits, (v) => v.confirmedByUserId);

  const alerts: WasteAlertDTO[] = [];
  const pointAlert = (kind: WasteAlertKind, pointId: string, value: number, threshold: number | null, detail: string) => {
    const point = pointById.get(pointId);
    if (!point) return;
    alerts.push({ kind, pointId, pointName: point.name, value, threshold, detail });
  };
  const confirmerAlert = (kind: WasteAlertKind, id: string, value: number, threshold: number | null, detail: string) => {
    alerts.push({ kind, confirmerName: confirmerName(id), value, threshold, detail });
  };

  const paceEnd = monthStart.getTime() + t.quotaPaceDays * DAY_MS;
  for (const point of points) {
    const quota = point.monthlyQuotaPoints;
    if (point.kind !== 'PARTNER' || quota === null || quota <= 0) continue;
    const used = (visitsByPoint.get(point.id) ?? [])
      .filter((v) => (v.completedAt as Date).getTime() < paceEnd)
      .reduce((s, v) => s + (v.pointsAwarded ?? 0), 0);
    if (used * 100 > t.quotaPacePct * quota) {
      const value = Math.round((used * 100) / quota);
      pointAlert('QUOTA_PACE', point.id, value, t.quotaPacePct, `Đã dùng ${value}% hạn mức tháng trong ${t.quotaPaceDays} ngày đầu tháng.`);
    }
  }

  const pointGroups = new Map([...visitsByPoint].map(([id, list]) => [id, summarize(list)]));
  const confirmerGroups = new Map([...visitsByConfirmer].map(([id, list]) => [id, summarize(list)]));

  const matchDetail = (value: number, n: number) => `${value}% lượt nhận đủ đúng số khai (${n} lượt trong tháng).`;
  const fullMatchRule = (g: Group): number | null =>
    g.visits >= t.fullMatchMinSample && g.full * 100 >= t.fullMatchPct * g.visits ? Math.round((g.full * 100) / g.visits) : null;
  for (const [id, g] of pointGroups) {
    const value = fullMatchRule(g);
    if (value !== null) pointAlert('FULL_MATCH', id, value, t.fullMatchPct, matchDetail(value, g.visits));
  }
  for (const [id, g] of confirmerGroups) {
    const value = fullMatchRule(g);
    if (value !== null) confirmerAlert('FULL_MATCH_CONFIRMER', id, value, t.fullMatchPct, matchDetail(value, g.visits));
  }

  const avgRule = (groups: Map<string, Group>, emit: (id: string, value: number, threshold: number) => void) => {
    let totalVisits = 0;
    let totalUnits = 0;
    for (const g of groups.values()) {
      totalVisits += g.visits;
      totalUnits += g.units;
    }
    for (const [id, g] of groups) {
      if (totalVisits - g.visits === 0) continue;
      const avg = g.units / g.visits;
      const others = (totalUnits - g.units) / (totalVisits - g.visits);
      if (avg > t.avgUnitsFactor * others) emit(id, round1(avg), round1(t.avgUnitsFactor * others));
    }
  };
  avgRule(pointGroups, (id, value, threshold) =>
    pointAlert('AVG_UNITS', id, value, threshold, `Trung bình ${value} đơn vị mỗi lượt, cao hơn ${t.avgUnitsFactor} lần mức của các điểm khác.`),
  );
  avgRule(confirmerGroups, (id, value, threshold) =>
    confirmerAlert(
      'AVG_UNITS_CONFIRMER',
      id,
      value,
      threshold,
      `Trung bình ${value} đơn vị mỗi lượt, cao hơn ${t.avgUnitsFactor} lần mức của những người xác nhận khác.`,
    ),
  );

  const repeatFrom = now.getTime() - t.repeatCustomerDays * DAY_MS;
  const repeatVisits = visits.filter((v) => v.completedAt !== null && v.completedAt.getTime() >= repeatFrom);
  const perCustomer = new Map<string, { pointId: string; n: number }>();
  for (const v of repeatVisits) {
    const key = `${v.pointId}\u0000${v.userId}`;
    const entry = perCustomer.get(key);
    if (entry) entry.n += 1;
    else perCustomer.set(key, { pointId: v.pointId, n: 1 });
  }
  for (const { pointId, n } of perCustomer.values()) {
    if (n >= t.repeatCustomerCount) {
      pointAlert('REPEAT_CUSTOMER', pointId, n, t.repeatCustomerCount, `Một khách có ${n} lượt ở điểm này trong ${t.repeatCustomerDays} ngày.`);
    }
  }

  for (const m of misses) {
    const n = m._count._all;
    if (m.pointId !== null && n >= t.lookupMissCount) {
      pointAlert('LOOKUP_MISS', m.pointId, n, t.lookupMissCount, `${n} lần tra mã không ra kết quả trong ${t.lookupMissDays} ngày.`);
    }
  }

  for (const v of monthVisits) {
    if ((v.user.role === 'STAFF' || v.user.role === 'ADMIN') && v.confirmedByUserId !== v.userId) {
      const point = pointById.get(v.pointId);
      if (!point) continue;
      alerts.push({
        kind: 'STAFF_ACCOUNT_CONFIRMED',
        pointId: v.pointId,
        pointName: point.name,
        confirmerName: confirmerName(v.confirmedByUserId),
        value: 1,
        threshold: null,
        detail: `Yêu cầu ${v.code} của tài khoản nhân viên do người khác xác nhận.`,
      });
    }
  }

  const directFrom = now.getTime() - t.staffDirectDays * DAY_MS;
  const directVisits = visits.filter(
    (v) =>
      v.completedAt !== null &&
      v.completedAt.getTime() >= directFrom &&
      (v.method === 'MAIL_IN' || v.method === 'PICKUP') &&
      v.inTransitAt === null,
  );
  for (const [id, list] of groupBy(directVisits, (v) => v.confirmedByUserId)) {
    if (list.length >= t.staffDirectCount) {
      confirmerAlert(
        'STAFF_DIRECT',
        id,
        list.length,
        t.staffDirectCount,
        `${list.length} yêu cầu gửi kho hoặc thu kèm được xác nhận thẳng, chưa từng có mã vận đơn, trong ${t.staffDirectDays} ngày.`,
      );
    }
  }

  const kindOrder = new Map(WASTE_ALERT_KIND_VALUES.map((k, i) => [k, i]));
  const labelOf = (a: WasteAlertDTO) => a.pointName ?? a.confirmerName ?? '';
  return alerts.sort(
    (a, b) => (kindOrder.get(a.kind) as number) - (kindOrder.get(b.kind) as number) || b.value - a.value || labelOf(a).localeCompare(labelOf(b)),
  );
}
