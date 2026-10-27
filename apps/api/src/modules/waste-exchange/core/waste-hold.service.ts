import { BadRequestException, ConflictException, ForbiddenException, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { WasteLineInput, WasteMethod, WastePreviewBlockDTO } from '@tubutree/shared-types';
import { vnDateKey, vnMonthKey } from '../../../common/vn-time';
import { requestTotals, type WasteRateSnapshot } from '../waste-points';
import { WASTE_CAP_STATUSES, WASTE_OPEN_STATUSES, WASTE_REQUEST_POINTS_MAX } from '../waste.constants';
import { checkCaps } from './waste-caps';
import type { WasteConfigSnapshot } from './waste-config.service';
import { WasteAccessService } from './waste-access.service';
import { WASTE_MESSAGES } from './waste-messages';

export type WasteHoldPath = 'CREATE' | 'EDIT' | 'REOPEN';
export type WasteHoldConfig = Pick<
  WasteConfigSnapshot,
  'laneDropoff' | 'laneMailin' | 'lanePickup' | 'mailinMinPoints' | 'pickupMinPoints' | 'customerMonthlyCapPoints' | 'maxOpenRequests' | 'requestHoldDays'
>;
export interface WasteHoldInput {
  path: WasteHoldPath;
  userId: string;
  method: WasteMethod;
  lines: WasteLineInput[];
  pointId: string | null;
  existing?: { id: string; pointId: string; capDayKey: string; capMonthKey: string };
  now: Date;
}
export interface WasteLineSnapshot {
  itemId: string;
  itemCode: string;
  itemName: string;
  unitLabel: string;
  unitsPerPoint: number;
  pointsPerGroup: number;
  dropsPerUnit: number;
  gramsPerUnit: number | null;
  declaredQty: number;
  hazardous: boolean;
}
export interface WasteHoldResult {
  pointId: string;
  capDayKey: string;
  capMonthKey: string;
  /** CREATE only (now + requestHoldDays); null for EDIT and REOPEN: callers never write it on those paths. */
  expiresAt: Date | null;
  lines: WasteLineSnapshot[];
  estimatedPoints: number;
  estimatedDrops: number;
}
export interface WasteCapUsage {
  itemDay: Map<string, number>;
  itemMonth: Map<string, number>;
  pointsMonth: number;
  openCount: number;
  pickupPendingCode: string | null;
}

type Mode = 'THROW' | 'COLLECT';
type CheckResult = Omit<WasteHoldResult, 'expiresAt'>;
interface Block { dto: WastePreviewBlockDTO; forbidden?: boolean; message: string }

const DAY_MS = 86_400_000;

function toException(b: Block): ForbiddenException | ConflictException {
  return b.forbidden ? new ForbiddenException(b.message) : new ConflictException(b.message);
}

@Injectable()
export class WasteHoldService {
  constructor(private readonly access: WasteAccessService) {}

  async validateAndHold(tx: Prisma.TransactionClient, input: WasteHoldInput, cfg: WasteHoldConfig): Promise<WasteHoldResult> {
    const { result } = await this.check(tx, input, cfg, 'THROW');
    const expiresAt = input.path === 'CREATE' ? new Date(input.now.getTime() + cfg.requestHoldDays * DAY_MS) : null;
    return { ...result, expiresAt };
  }

  async evaluate(
    db: Prisma.TransactionClient,
    input: WasteHoldInput,
    cfg: WasteHoldConfig,
  ): Promise<{ result: CheckResult; blocks: WastePreviewBlockDTO[] }> {
    const { result, blocks } = await this.check(db, input, cfg, 'COLLECT');
    return { result, blocks: blocks.map((b) => b.dto) };
  }

  async capUsage(
    db: Prisma.TransactionClient,
    userId: string,
    capDayKey: string,
    capMonthKey: string,
    excludeRequestId?: string,
  ): Promise<WasteCapUsage> {
    const statuses = Prisma.join([...WASTE_CAP_STATUSES]);
    const exclude = excludeRequestId ?? null;
    const perItem = await db.$queryRaw<{ itemId: string; day: number; month: number }[]>`
      SELECT l."itemId" AS "itemId",
        COALESCE(SUM(COALESCE(l."receivedQty", l."declaredQty")) FILTER (WHERE r."capDayKey" = ${capDayKey}), 0)::int AS day,
        COALESCE(SUM(COALESCE(l."receivedQty", l."declaredQty")) FILTER (WHERE r."capMonthKey" = ${capMonthKey}), 0)::int AS month
      FROM waste_request_lines l JOIN waste_requests r ON r.id = l."requestId"
      WHERE r."userId" = ${userId} AND r.status::text IN (${statuses})
        AND (r."capDayKey" = ${capDayKey} OR r."capMonthKey" = ${capMonthKey})
        AND (${exclude}::text IS NULL OR r.id <> ${exclude}::text)
      GROUP BY l."itemId"`;
    const [points] = await db.$queryRaw<{ points: number }[]>`
      SELECT COALESCE(SUM(COALESCE(r."pointsAwarded", r."estimatedPoints")), 0)::int AS points
      FROM waste_requests r
      WHERE r."userId" = ${userId} AND r.status::text IN (${statuses}) AND r."capMonthKey" = ${capMonthKey}
        AND (${exclude}::text IS NULL OR r.id <> ${exclude}::text)`;
    const openCount = await db.wasteRequest.count({ where: { userId, status: { in: [...WASTE_OPEN_STATUSES] } } });
    const pending = await db.wasteRequest.findFirst({
      where: { userId, method: 'PICKUP', status: 'OPEN', orderId: null },
      select: { code: true },
      orderBy: { createdAt: 'asc' },
    });
    return {
      itemDay: new Map(perItem.filter((r) => r.day > 0).map((r) => [r.itemId, r.day])),
      itemMonth: new Map(perItem.filter((r) => r.month > 0).map((r) => [r.itemId, r.month])),
      pointsMonth: points?.points ?? 0,
      openCount,
      pickupPendingCode: pending?.code ?? null,
    };
  }

  private async check(
    tx: Prisma.TransactionClient,
    input: WasteHoldInput,
    cfg: WasteHoldConfig,
    mode: Mode,
  ): Promise<{ result: CheckResult; blocks: Block[] }> {
    const { path, userId, method, now } = input;
    const ids = input.lines.map((l) => l.itemId);
    if (new Set(ids).size !== ids.length) throw new BadRequestException(WASTE_MESSAGES.DUPLICATE_LINE);
    const existing = input.existing;
    if (path !== 'CREATE' && !existing) throw new Error('existing required');
    const editsPoint = path !== 'REOPEN';
    if (method === 'DROP_OFF' && editsPoint && input.pointId === null && mode === 'THROW') throw new BadRequestException(WASTE_MESSAGES.NEED_POINT);

    const capDayKey = existing ? existing.capDayKey : vnDateKey(now);
    const capMonthKey = existing ? existing.capMonthKey : vnMonthKey(now);

    const itemRows = await tx.wasteItem.findMany({ where: { id: { in: ids } } });
    const itemById = new Map(itemRows.map((i) => [i.id, i]));
    let stored: Map<string, WasteRateSnapshot> | null = null;
    if (path === 'REOPEN') {
      const rows = await tx.wasteRequestLine.findMany({
        where: { requestId: existing!.id },
        select: { itemId: true, unitsPerPoint: true, pointsPerGroup: true, dropsPerUnit: true, gramsPerUnit: true },
      });
      stored = new Map(rows.map((r) => [r.itemId, r]));
    }

    const priced: { line: WasteLineInput; snapshot: WasteLineSnapshot }[] = [];
    for (const line of input.lines) {
      const s = stored?.get(line.itemId);
      if (stored && !s) throw new Error('REOPEN line without stored snapshot');
      const item = itemById.get(line.itemId);
      if (!item) continue;
      const rates: WasteRateSnapshot = s ?? item;
      priced.push({
        line,
        snapshot: {
          itemId: item.id,
          itemCode: item.code,
          itemName: item.name,
          unitLabel: item.unitLabel,
          unitsPerPoint: rates.unitsPerPoint,
          pointsPerGroup: rates.pointsPerGroup,
          dropsPerUnit: rates.dropsPerUnit,
          gramsPerUnit: rates.gramsPerUnit,
          declaredQty: line.declaredQty,
          hazardous: item.hazardous,
        },
      });
    }
    const totals = requestTotals(priced.map((p) => ({ qty: p.line.declaredQty, snap: p.snapshot })));
    const estimatedPoints = totals.points;
    if (estimatedPoints > WASTE_REQUEST_POINTS_MAX) throw new ConflictException(WASTE_MESSAGES.REQUEST_POINTS_MAX);

    let shipLockedAt: Date | null = null;
    if (editsPoint) {
      const flags = await tx.wasteUserFlags.findUnique({ where: { userId }, select: { shipLockedAt: true, blockedAt: true } });
      if (flags?.blockedAt) throw new ForbiddenException(WASTE_MESSAGES.BLOCKED);
      shipLockedAt = flags?.shipLockedAt ?? null;
    }

    const usage = await this.capUsage(tx, userId, capDayKey, capMonthKey, existing?.id);

    let pointId: string | null = null;
    if (path === 'REOPEN') pointId = existing!.pointId;
    else if (method === 'DROP_OFF') pointId = input.pointId;
    else pointId = (await this.access.warehousePoint(tx))?.id ?? null;

    const blocks: Block[] = [];
    const add = (b: Block) => {
      if (mode === 'THROW') throw toException(b);
      blocks.push(b);
    };

    if (editsPoint && method !== 'DROP_OFF' && shipLockedAt) add({ dto: { code: 'SHIP_LOCKED' }, forbidden: true, message: WASTE_MESSAGES.SHIP_LOCKED });
    if (path === 'CREATE') {
      const laneOn = method === 'DROP_OFF' ? cfg.laneDropoff : method === 'MAIL_IN' ? cfg.laneMailin : cfg.lanePickup;
      if (!laneOn) add({ dto: { code: 'LANE_DISABLED' }, message: WASTE_MESSAGES.LANE_DISABLED });
      if (usage.openCount >= cfg.maxOpenRequests) {
        add({ dto: { code: 'MAX_OPEN', openCount: usage.openCount }, message: WASTE_MESSAGES.MAX_OPEN(cfg.maxOpenRequests) });
      }
      if (method === 'PICKUP' && usage.pickupPendingCode !== null) {
        add({ dto: { code: 'PICKUP_PENDING', pickupRequestCode: usage.pickupPendingCode }, message: WASTE_MESSAGES.PICKUP_PENDING(usage.pickupPendingCode) });
      }
    }
    if (editsPoint) {
      const inactive = input.lines.find((l) => {
        const item = itemById.get(l.itemId);
        return !item || item.status !== 'ACTIVE';
      });
      if (inactive) add({ dto: { code: 'ITEM_NOT_ACTIVE', itemId: inactive.itemId }, message: WASTE_MESSAGES.ITEM_NOT_ACTIVE });
    }
    // Món cần xử lý riêng (hazardous, như pin) chỉ nhận khi khách mang tới điểm nhận: không đi đường bưu điện hay thu kèm đơn.
    if (editsPoint && method !== 'DROP_OFF') {
      const dropOffOnly = input.lines.filter((l) => itemById.get(l.itemId)?.hazardous);
      const first = dropOffOnly[0];
      if (first) {
        add({
          dto: { code: 'ITEM_DROPOFF_ONLY', itemId: first.itemId },
          message: WASTE_MESSAGES.ITEM_DROPOFF_ONLY(dropOffOnly.map((l) => itemById.get(l.itemId)!.name)),
        });
      }
    }

    if (editsPoint && (pointId !== null || method !== 'DROP_OFF')) {
      const point = pointId === null ? null : await tx.wastePoint.findUnique({ where: { id: pointId }, select: { id: true, kind: true, monthlyQuotaPoints: true } });
      // A kept point stays valid on EDIT even if it has gone unavailable since; only a switch re-checks it.
      const recheck = path === 'CREATE' || pointId !== existing!.pointId;
      if (!point || pointId === null) {
        add({ dto: { code: 'POINT_UNAVAILABLE' }, message: WASTE_MESSAGES.POINT_UNAVAILABLE });
      } else {
        if (recheck && !(await this.access.availablePointIds(tx, [pointId])).has(pointId)) {
          add({ dto: { code: 'POINT_UNAVAILABLE' }, message: WASTE_MESSAGES.POINT_UNAVAILABLE });
        }
        if (recheck && point.kind === 'PARTNER' && point.monthlyQuotaPoints !== null) {
          const row = await tx.wastePointUsage.findUnique({
            where: { pointId_monthKey: { pointId, monthKey: vnMonthKey(now) } },
            select: { pointsUsed: true },
          });
          if ((row?.pointsUsed ?? 0) >= point.monthlyQuotaPoints) add({ dto: { code: 'POINT_QUOTA_FULL' }, message: WASTE_MESSAGES.POINT_QUOTA_FULL });
        }
        if (point.kind === 'PARTNER') {
          const links = new Set((await tx.wastePointItem.findMany({ where: { pointId }, select: { itemId: true } })).map((l) => l.itemId));
          const missing = input.lines.filter((l) => itemById.has(l.itemId) && (!links.has(l.itemId) || itemById.get(l.itemId)!.warehouseOnly));
          const first = missing[0];
          if (first) {
            add({
              dto: { code: 'POINT_MISSING_ITEMS', itemId: first.itemId },
              message: WASTE_MESSAGES.POINT_MISSING_ITEMS(missing.map((l) => itemById.get(l.itemId)!.name)),
            });
          }
        }
      }
    }

    const violations = checkCaps({
      lines: priced.map((p) => p.line),
      items: itemById,
      usage,
      estimatedPoints,
      monthlyCapPoints: cfg.customerMonthlyCapPoints,
      checkDay: method === 'DROP_OFF' && path !== 'REOPEN',
    });
    for (const v of violations) {
      if (v.code === 'POINTS_MONTH_CAP') {
        const pointsRemaining = Math.max(0, cfg.customerMonthlyCapPoints - usage.pointsMonth);
        add({ dto: { code: 'POINTS_MONTH_CAP', pointsRemaining }, message: WASTE_MESSAGES.POINTS_MONTH_CAP(v.remaining) });
        continue;
      }
      const item = itemById.get(v.itemId)!;
      const text = v.code === 'ITEM_DAY_CAP' ? WASTE_MESSAGES.ITEM_DAY_CAP : WASTE_MESSAGES.ITEM_MONTH_CAP;
      add({ dto: { code: v.code, itemId: v.itemId }, message: text(item.name, v.remaining, item.unitLabel) });
    }

    if (editsPoint && (method === 'MAIL_IN' || method === 'PICKUP')) {
      const min = method === 'MAIL_IN' ? cfg.mailinMinPoints : cfg.pickupMinPoints;
      if (estimatedPoints < min) {
        const capLeft = cfg.customerMonthlyCapPoints - usage.pointsMonth;
        if (capLeft < min) {
          add({ dto: { code: 'MONTH_CAP_FOR_MIN', pointsRemaining: Math.max(0, capLeft) }, message: WASTE_MESSAGES.MONTH_CAP_FOR_MIN(method) });
        } else {
          const missingPoints = min - estimatedPoints;
          add({ dto: { code: 'BELOW_MIN', missingPoints }, message: WASTE_MESSAGES.BELOW_MIN(method, min, missingPoints) });
        }
      }
    }

    return {
      result: { pointId: pointId ?? '', capDayKey, capMonthKey, lines: priced.map((p) => p.snapshot), estimatedPoints, estimatedDrops: totals.drops },
      blocks,
    };
  }
}
