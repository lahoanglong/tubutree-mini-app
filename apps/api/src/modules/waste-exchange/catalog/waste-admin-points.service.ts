import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import type { Prisma, WastePoint, WastePointUsage } from '@prisma/client';
import { WASTE_WEEKDAY_VALUES } from '@tubutree/shared-types';
import type {
  AdminWastePointDTO,
  AdminWastePointQuery,
  WastePointUpsertRequest,
  WasteOpeningHours,
  WasteReorderRequest,
} from '@tubutree/shared-types';
import { assertActiveAdmin } from '../../../common/staff-access';
import { vnMonthKey } from '../../../common/vn-time';
import { PrismaService } from '../../../prisma/prisma.service';
import { WasteAccessService } from '../core/waste-access.service';
import { WasteConfigService } from '../core/waste-config.service';
import { writeWasteEvent } from '../core/waste-events';
import { WasteNotifierService } from '../core/waste-notifier.service';
import { WASTE_PERKS_PENDING_WHERE, WASTE_POINTS_PENDING_WHERE } from '../core/waste-queue-filters';
import { WASTE_POINTS_MAX_PER_SITE } from '../waste.constants';
import { lockWastePointCreate } from '../waste-locks';

const WAREHOUSE_ALWAYS_ON = 'Kho Tubu luôn đang nhận. Muốn dừng nhận mới, tắt waste.enabled hoặc cờ waste.lane_* trong cấu hình.';
const NEEDS_ONE_OWNER = 'Điểm đại lý chỉ kích hoạt được khi đã có đúng một chủ điểm hợp lệ.';
const NEEDS_QUOTA = 'Điểm nhận đại lý cần hạn mức điểm tháng.';
const NO_HANDOVER = 'Đợt này chưa bật trao quà tại điểm đại lý.';
const POINT_NOT_FOUND = 'Không tìm thấy điểm nhận.';
const ONE_WAREHOUSE = 'Đã có kho Tubu, không tạo thêm.';
const DAY_MS = 86_400_000;
const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

const POINT_INCLUDE = {
  items: { select: { itemId: true } },
  staff: {
    include: { user: { select: { id: true, fullName: true, phone: true } } },
    orderBy: [{ role: 'asc' }, { createdAt: 'asc' }],
  },
} satisfies Prisma.WastePointInclude;

type PointRow = Prisma.WastePointGetPayload<{ include: typeof POINT_INCLUDE }>;

const pick = (o: Record<string, unknown>, keys: string[]): Record<string, unknown> => Object.fromEntries(keys.map((k) => [k, o[k]]));
// Value equality, so a Json, Date or array value is never "changed" by reference.
const same = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);
const jsonSafe = (o: Record<string, unknown>): Record<string, unknown> =>
  Object.fromEntries(Object.entries(o).map(([k, v]) => [k, v instanceof Date ? v.toISOString() : v]));
// Prisma reports a raw partial index either by its name or by its field list.
const isWarehouseViolation = (e: unknown): boolean => {
  if ((e as { code?: unknown })?.code !== 'P2002') return false;
  const target = String((e as { meta?: { target?: unknown } }).meta?.target ?? '');
  return target.includes('waste_points_one_warehouse_key') || target.includes('kind');
};

export function assertOpeningHours(h: unknown): void {
  if (h === undefined) return;
  const invalid = () => new BadRequestException('Giờ mở cửa không hợp lệ.');
  if (h === null || typeof h !== 'object' || Array.isArray(h)) throw invalid();
  for (const [day, ranges] of Object.entries(h)) {
    if (!(WASTE_WEEKDAY_VALUES as readonly string[]).includes(day) || !Array.isArray(ranges)) throw invalid();
    for (const r of ranges as unknown[]) {
      const { open, close } = (r ?? {}) as { open?: unknown; close?: unknown };
      if (typeof open !== 'string' || typeof close !== 'string' || !HHMM.test(open) || !HHMM.test(close) || open >= close) throw invalid();
    }
  }
}

export function toAdminPointDTO(row: PointRow, usage: WastePointUsage | undefined, now: Date, inactiveDays: number): AdminWastePointDTO {
  const pointsUsed = usage?.pointsUsed ?? 0;
  const quotaFull = row.monthlyQuotaPoints !== null && pointsUsed >= row.monthlyQuotaPoints;
  const dates = [row.lastConfirmedAt, row.activatedAt].filter((d): d is Date => d !== null);
  const last = dates.length > 0 ? Math.max(...dates.map((d) => d.getTime())) : null;
  const hiddenInactive =
    row.kind === 'PARTNER' && row.status === 'ACTIVE' && last !== null && last < now.getTime() - inactiveDays * DAY_MS;
  return {
    id: row.id,
    kind: row.kind,
    name: row.name,
    addressLine: row.addressLine,
    provinceCode: row.provinceCode,
    provinceName: row.provinceName,
    communeCode: row.communeCode,
    communeName: row.communeName,
    lat: row.lat,
    lng: row.lng,
    phone: row.phone,
    openingHours: row.openingHours as unknown as WasteOpeningHours,
    acceptedItemIds: row.items.map((i) => i.itemId).sort(),
    perkText: row.perkText,
    distanceKm: null,
    status: row.status,
    monthlyQuotaPoints: row.monthlyQuotaPoints,
    monthUsage: { monthKey: vnMonthKey(now), pointsUsed, confirmations: usage?.confirmations ?? 0 },
    quotaFull,
    perkPendingText: row.perkPendingText,
    giftHandoverEnabled: row.giftHandoverEnabled,
    note: row.note,
    sortOrder: row.sortOrder,
    activatedAt: row.activatedAt?.toISOString() ?? null,
    lastConfirmedAt: row.lastConfirmedAt?.toISOString() ?? null,
    hiddenInactive,
    staff: row.staff.map((s) => ({ userId: s.userId, role: s.role, isActive: s.isActive, fullName: s.user.fullName, phone: s.user.phone })),
  };
}

@Injectable()
export class WasteAdminPointsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: WasteAccessService,
    private readonly config: WasteConfigService,
    private readonly notifier: WasteNotifierService,
  ) {}

  async list(adminUserId: string, q: AdminWastePointQuery): Promise<AdminWastePointDTO[]> {
    await assertActiveAdmin(this.prisma, adminUserId);
    const where: Prisma.WastePointWhereInput = {
      AND: [q.status === 'PENDING' ? WASTE_POINTS_PENDING_WHERE : q.status ? { status: q.status } : {}, q.perkPending ? WASTE_PERKS_PENDING_WHERE : {}],
    };
    const rows = await this.prisma.wastePoint.findMany({ where, orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }], include: POINT_INCLUDE });
    return this.toDTOs(rows, new Date());
  }

  async create(adminUserId: string, body: WastePointUpsertRequest): Promise<AdminWastePointDTO> {
    const admin = await assertActiveAdmin(this.prisma, adminUserId);
    const kind = body.kind;
    if (!kind) throw new BadRequestException('Chọn loại điểm nhận.');
    assertOpeningHours(body.openingHours);
    if (kind === 'PARTNER') {
      if (body.monthlyQuotaPoints == null) throw new BadRequestException(NEEDS_QUOTA);
      if (body.status === 'ACTIVE') throw new BadRequestException(NEEDS_ONE_OWNER);
      if (body.giftHandoverEnabled === true) throw new BadRequestException(NO_HANDOVER);
    } else {
      if (body.monthlyQuotaPoints != null) throw new BadRequestException('Kho Tubu không có hạn mức điểm.');
      if (body.status !== undefined && body.status !== 'ACTIVE') throw new BadRequestException(WAREHOUSE_ALWAYS_ON);
    }

    const now = new Date();
    const status = kind === 'WAREHOUSE' ? 'ACTIVE' : (body.status ?? 'PENDING');
    const ids = [...new Set(body.itemIds ?? [])];
    try {
      const createdId = await this.prisma.$transaction(async (tx) => {
        await lockWastePointCreate(tx);
        if ((await tx.wastePoint.count()) >= WASTE_POINTS_MAX_PER_SITE) throw new ConflictException('Đã đủ 200 điểm nhận, không tạo thêm được.');
        if (kind === 'WAREHOUSE' && (await tx.wastePoint.count({ where: { kind: 'WAREHOUSE' } })) > 0) throw new ConflictException(ONE_WAREHOUSE);
        if ((await tx.wasteItem.count({ where: { id: { in: ids } } })) !== ids.length) throw new BadRequestException('Có món không tồn tại.');

        const created = await tx.wastePoint.create({
          data: {
            kind,
            name: body.name,
            addressLine: body.addressLine,
            provinceCode: body.provinceCode,
            provinceName: body.provinceName,
            communeCode: body.communeCode,
            communeName: body.communeName,
            lat: body.lat ?? null,
            lng: body.lng ?? null,
            phone: body.phone ?? null,
            openingHours: (body.openingHours ?? {}) as Prisma.InputJsonObject,
            monthlyQuotaPoints: body.monthlyQuotaPoints ?? null,
            note: body.note ?? null,
            sortOrder: body.sortOrder ?? 0,
            status,
            activatedAt: kind === 'WAREHOUSE' ? now : null,
            giftHandoverEnabled: false,
            items: { create: ids.map((itemId) => ({ itemId })) },
          },
          select: { id: true },
        });
        await writeWasteEvent(tx, {
          kind: 'POINT_CREATED',
          actorUserId: admin.id,
          actorRole: 'ADMIN',
          pointId: created.id,
          meta: { before: null, after: { kind, status, monthlyQuotaPoints: body.monthlyQuotaPoints ?? null, itemIds: ids } },
        });
        return created.id;
      });
      return await this.getOne(createdId, now);
    } catch (e) {
      if (isWarehouseViolation(e)) throw new ConflictException(ONE_WAREHOUSE);
      throw e;
    }
  }

  async update(adminUserId: string, id: string, body: Partial<WastePointUpsertRequest>): Promise<AdminWastePointDTO> {
    const admin = await assertActiveAdmin(this.prisma, adminUserId);
    if ('kind' in body) throw new BadRequestException('Không đổi được loại điểm nhận.');

    const now = new Date();
    await this.prisma.$transaction(async (tx) => {
      // FOR NO KEY UPDATE: same lock as staff add; stays compatible with the KEY SHARE of the confirm FK.
      const [cur] = await tx.$queryRaw<WastePoint[]>`SELECT * FROM "waste_points" WHERE "id" = ${id} FOR NO KEY UPDATE`;
      if (!cur) throw new NotFoundException(POINT_NOT_FOUND);
      if ('openingHours' in body) assertOpeningHours(body.openingHours);
      if (cur.kind === 'WAREHOUSE') {
        if (body.status === 'PAUSED' || body.status === 'PENDING') throw new BadRequestException(WAREHOUSE_ALWAYS_ON);
        if (body.monthlyQuotaPoints != null) throw new BadRequestException('Kho Tubu không có hạn mức điểm.');
      } else {
        if ('monthlyQuotaPoints' in body && body.monthlyQuotaPoints === null) throw new BadRequestException(NEEDS_QUOTA);
        if (body.giftHandoverEnabled === true) throw new BadRequestException(NO_HANDOVER);
      }

      const curRecord = cur as unknown as Record<string, unknown>;
      const bodyRecord = body as Record<string, unknown>;
      const changed = Object.keys(bodyRecord).filter((k) => k !== 'itemIds' && bodyRecord[k] !== undefined && !same(bodyRecord[k], curRecord[k]));
      const data: Record<string, unknown> = Object.fromEntries(changed.map((k) => [k, bodyRecord[k]]));
      if (body.status === 'ACTIVE') {
        data.activatedAt = now;
        if (!changed.includes('activatedAt')) changed.push('activatedAt');
      }

      let itemsBefore: string[] = [];
      let itemsAfter: string[] = [];
      let itemsChanged = false;
      if (body.itemIds !== undefined) {
        const ids = [...new Set(body.itemIds)];
        if ((await tx.wasteItem.count({ where: { id: { in: ids } } })) !== ids.length) throw new BadRequestException('Có món không tồn tại.');
        itemsBefore = (await tx.wastePointItem.findMany({ where: { pointId: id }, select: { itemId: true } })).map((r) => r.itemId).sort();
        itemsAfter = [...ids].sort();
        itemsChanged = !same(itemsAfter, itemsBefore);
        if (itemsChanged) {
          await tx.wastePointItem.deleteMany({ where: { pointId: id } });
          if (ids.length > 0) await tx.wastePointItem.createMany({ data: ids.map((itemId) => ({ pointId: id, itemId })) });
        }
      }
      if (changed.length === 0 && !itemsChanged) return;

      const next =
        Object.keys(data).length > 0
          ? ((await tx.wastePoint.update({ where: { id }, data: data as Prisma.WastePointUncheckedUpdateInput })) as unknown as Record<string, unknown>)
          : curRecord;
      if (cur.kind === 'PARTNER' && body.status === 'ACTIVE' && !(await this.access.availablePointIds(tx, [id])).has(id)) {
        throw new BadRequestException(NEEDS_ONE_OWNER);
      }

      const before = jsonSafe(pick(curRecord, changed));
      const after = jsonSafe(pick(next, changed));
      if (itemsChanged) {
        before.itemIds = itemsBefore;
        after.itemIds = itemsAfter;
      }
      await writeWasteEvent(tx, {
        kind: 'POINT_UPDATED',
        actorUserId: admin.id,
        actorRole: 'ADMIN',
        pointId: id,
        meta: { before: before as Prisma.InputJsonObject, after: after as Prisma.InputJsonObject },
      });
    });
    return this.getOne(id);
  }

  async reorder(adminUserId: string, body: WasteReorderRequest): Promise<AdminWastePointDTO[]> {
    const admin = await assertActiveAdmin(this.prisma, adminUserId);
    const ids = body.ids;
    await this.prisma.$transaction(async (tx) => {
      // Every row locked in one global order, so two concurrent reorders queue instead of deadlocking.
      await tx.$queryRaw`SELECT "id" FROM "waste_points" ORDER BY "id" FOR NO KEY UPDATE`;
      const all = await tx.wastePoint.findMany({ orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }], select: { id: true } });
      const known = new Set(all.map((p) => p.id));
      if (new Set(ids).size !== ids.length || ids.length !== all.length || !ids.every((i) => known.has(i))) {
        throw new BadRequestException('Danh sách sắp xếp phải gồm đủ mọi điểm nhận, mỗi điểm một lần.');
      }
      for (const [i, pointId] of ids.entries()) {
        await tx.wastePoint.update({ where: { id: pointId }, data: { sortOrder: (i + 1) * 10 } });
      }
      await writeWasteEvent(tx, {
        kind: 'POINTS_REORDERED',
        actorUserId: admin.id,
        actorRole: 'ADMIN',
        meta: { before: { ids: all.map((p) => p.id) }, after: { ids } },
      });
    });
    return this.list(adminUserId, {});
  }

  private async getOne(id: string, now: Date = new Date()): Promise<AdminWastePointDTO> {
    const rows = await this.prisma.wastePoint.findMany({ where: { id }, include: POINT_INCLUDE });
    const [dto] = await this.toDTOs(rows, now);
    if (!dto) throw new NotFoundException(POINT_NOT_FOUND);
    return dto;
  }

  private async toDTOs(rows: PointRow[], now: Date): Promise<AdminWastePointDTO[]> {
    const usage = await this.prisma.wastePointUsage.findMany({ where: { monthKey: vnMonthKey(now), pointId: { in: rows.map((r) => r.id) } } });
    const byPoint = new Map(usage.map((u) => [u.pointId, u]));
    const { pointInactiveDays } = await this.config.snapshot();
    return rows.map((r) => toAdminPointDTO(r, byPoint.get(r.id), now, pointInactiveDays));
  }
}
