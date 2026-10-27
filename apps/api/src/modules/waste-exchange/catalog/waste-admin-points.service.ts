import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import type { Prisma, WastePoint, WastePointUsage } from '@prisma/client';
import { cashWordingMessage, findCashWording, WASTE_WEEKDAY_VALUES } from '@tubutree/shared-types';
import type {
  AdminWastePointDTO,
  AdminWastePointQuery,
  WastePointStaffAddRequest,
  WastePointUpsertRequest,
  WasteOpeningHours,
  WasteReorderRequest,
} from '@tubutree/shared-types';
import { isRealUser } from '../../../common/real-user';
import { assertActiveAdmin } from '../../../common/staff-access';
import { vnMonthKey } from '../../../common/vn-time';
import { PARTNER_STORE_WHERE } from '../../merchant/partner-store';
import { PrismaService } from '../../../prisma/prisma.service';
import { WasteAccessService } from '../core/waste-access.service';
import { WasteConfigService } from '../core/waste-config.service';
import { writeWasteEvent } from '../core/waste-events';
import { WasteNotifierService } from '../core/waste-notifier.service';
import { WASTE_PERKS_PENDING_WHERE, WASTE_POINTS_PENDING_WHERE } from '../core/waste-queue-filters';
import { WASTE_MAX_STAFF_PER_POINT, WASTE_POINTS_MAX_PER_SITE } from '../waste.constants';
import { lockWastePointCreate } from '../waste-locks';

const WAREHOUSE_ALWAYS_ON = 'Kho Tubu luôn đang nhận. Muốn dừng nhận mới, tắt waste.enabled hoặc cờ waste.lane_* trong cấu hình.';
const NEEDS_ONE_OWNER = 'Điểm đại lý chỉ kích hoạt được khi đã có đúng một chủ điểm hợp lệ.';
const NEEDS_QUOTA = 'Điểm nhận đại lý cần hạn mức điểm tháng.';
const NO_HANDOVER = 'Đợt này chưa bật trao quà tại điểm đại lý.';
const POINT_NOT_FOUND = 'Không tìm thấy điểm nhận.';
const ONE_WAREHOUSE = 'Đã có kho Tubu, không tạo thêm.';
const NO_STAFF_AT_WAREHOUSE = 'Kho Tubu không gắn người ở điểm; nhân viên và quản trị viên thao tác theo vai trò.';
const OWNER_EXISTS = 'Điểm đã có chủ điểm. Bỏ chủ điểm cũ trước khi thêm chủ mới.';
const ALREADY_IN_POINT = 'Người này đã ở điểm nhận.';
const NOT_IN_POINT = 'Người này không ở điểm nhận.';
const NO_PENDING_PERK = 'Không có ưu đãi chờ duyệt.';
const NO_PERK_TO_CLEAR = 'Điểm này chưa có ưu đãi để gỡ.';
const PERK_CHANGED = 'Nội dung ưu đãi vừa thay đổi, tải lại để xem';
const DAY_MS = 86_400_000;
const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

const POINT_INCLUDE = {
  items: { select: { itemId: true, item: { select: { warehouseOnly: true } } } },
  staff: {
    include: { user: { select: { id: true, fullName: true, phone: true } } },
    orderBy: [{ role: 'asc' }, { createdAt: 'asc' }],
  },
} satisfies Prisma.WastePointInclude;

type PointRow = Prisma.WastePointGetPayload<{ include: typeof POINT_INCLUDE }>;

const pick = (o: Record<string, unknown>, keys: string[]): Record<string, unknown> => Object.fromEntries(keys.map((k) => [k, o[k]]));
// Value equality, so a Json, Date or array value is never "changed" by reference.
// jsonb comes back from Postgres with its own key order, so objects are compared with keys sorted.
const canon = (v: unknown): string =>
  JSON.stringify(v, (_k, x) =>
    x && typeof x === 'object' && !Array.isArray(x)
      ? Object.fromEntries(Object.entries(x as Record<string, unknown>).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)))
      : x,
  );
const same = (a: unknown, b: unknown): boolean => canon(a) === canon(b);

/** Only the Tubu warehouse takes items flagged warehouseOnly; the flag lives on the item so the rule is data, not a list of codes. */
async function assertItemsFitKind(tx: Prisma.TransactionClient, kind: WastePoint['kind'], itemIds: string[]): Promise<void> {
  if (kind !== 'PARTNER' || itemIds.length === 0) return;
  const blocked = await tx.wasteItem.findMany({ where: { id: { in: itemIds }, warehouseOnly: true }, select: { name: true } });
  if (blocked.length > 0) {
    // Item names can hold a comma ('Vỏ chai, hộp Tubu Tree'), so the list is joined with ';'.
    throw new BadRequestException(`Điểm đại lý không nhận: ${blocked.map((i) => i.name).join('; ')}. ${blocked.length > 1 ? 'Các món này' : 'Món này'} chỉ kho Tubu HCMC nhận.`);
  }
}
const jsonSafe = (o: Record<string, unknown>): Record<string, unknown> =>
  Object.fromEntries(Object.entries(o).map(([k, v]) => [k, v instanceof Date ? v.toISOString() : v]));
// Prisma reports a raw partial index either by its name or by its field list.
const isWarehouseViolation = (e: unknown): boolean => {
  if ((e as { code?: unknown })?.code !== 'P2002') return false;
  const target = String((e as { meta?: { target?: unknown } }).meta?.target ?? '');
  return target.includes('waste_points_one_warehouse_key') || target.includes('kind');
};

const staffViolation = (e: unknown): string | null => {
  if ((e as { code?: unknown })?.code !== 'P2002') return null;
  const target = String((e as { meta?: { target?: unknown } }).meta?.target ?? '');
  if (target.includes('waste_point_staff_one_owner_key') || target === 'pointId') return OWNER_EXISTS;
  if (target.includes('userId')) return ALREADY_IN_POINT;
  return null;
};

type LockedPoint = { id: string; kind: string; name: string; perkText: string | null; perkPendingText: string | null };

// FOR NO KEY UPDATE: a staff write only takes KEY SHARE on the point row, so without this lock two writers never queue (lock order 19).
export async function lockPoint(tx: Prisma.TransactionClient, id: string): Promise<LockedPoint> {
  const [p] = await tx.$queryRaw<LockedPoint[]>`SELECT "id","kind","name","perkText","perkPendingText" FROM "waste_points" WHERE "id" = ${id} FOR NO KEY UPDATE`;
  if (!p) throw new NotFoundException(POINT_NOT_FOUND);
  return p;
}

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
    // A link left from before the warehouse-only rule is not shown as accepted by a partner point (same as the customer list).
    acceptedItemIds: row.items.filter((i) => row.kind === 'WAREHOUSE' || !i.item.warehouseOnly).map((i) => i.itemId).sort(),
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
        await assertItemsFitKind(tx, kind, ids);

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
        await assertItemsFitKind(tx, cur.kind, ids);
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

  async addStaff(adminUserId: string, pointId: string, body: WastePointStaffAddRequest): Promise<AdminWastePointDTO> {
    const admin = await assertActiveAdmin(this.prisma, adminUserId);
    try {
      await this.prisma.$transaction(async (tx) => {
        const p = await lockPoint(tx, pointId);
        if (p.kind === 'WAREHOUSE') throw new BadRequestException(NO_STAFF_AT_WAREHOUSE);
        const u = await tx.user.findUnique({
          where: { id: body.userId },
          select: { id: true, isBlocked: true, mergedIntoId: true, phone: true, zaloId: true },
        });
        if (!u || u.mergedIntoId) throw new NotFoundException('Không tìm thấy người dùng.');
        if (!isRealUser(u)) throw new BadRequestException('Người này chưa đăng nhập bằng Zalo nên chưa gắn được vào điểm nhận.');
        if (u.isBlocked) throw new BadRequestException('Người này đang bị khoá tài khoản.');
        if ((await tx.wasteUserFlags.findUnique({ where: { userId: u.id } }))?.blockedAt) {
          throw new BadRequestException('Người này đang bị khoá chương trình đổi rác.');
        }
        if (body.role === 'OWNER' && !(await tx.storefront.findFirst({ where: { ownerUserId: u.id, ...PARTNER_STORE_WHERE }, select: { id: true } }))) {
          throw new BadRequestException('Chủ điểm phải là chủ một gian hàng đối tác.');
        }

        const rows = await tx.wastePointStaff.findMany({ where: { pointId } });
        const active = rows.filter((r) => r.isActive);
        if (active.some((r) => r.userId === u.id)) throw new ConflictException(ALREADY_IN_POINT);
        if (active.length >= WASTE_MAX_STAFF_PER_POINT) throw new ConflictException(`Mỗi điểm nhận tối đa ${WASTE_MAX_STAFF_PER_POINT} người.`);
        if (body.role === 'OWNER' && active.some((r) => r.role === 'OWNER')) throw new ConflictException(OWNER_EXISTS);

        const inactive = rows.find((r) => r.userId === u.id && !r.isActive);
        if (inactive) await tx.wastePointStaff.update({ where: { id: inactive.id }, data: { isActive: true, role: body.role } });
        else await tx.wastePointStaff.create({ data: { pointId, userId: u.id, role: body.role } });
        await writeWasteEvent(tx, {
          kind: 'POINT_STAFF_ADDED',
          actorUserId: admin.id,
          actorRole: 'ADMIN',
          pointId,
          meta: { staffUserId: u.id, before: inactive ? { role: inactive.role, isActive: false } : null, after: { role: body.role, isActive: true } },
        });
      });
    } catch (e) {
      const message = staffViolation(e);
      if (message) throw new ConflictException(message);
      throw e;
    }
    return this.getOne(pointId);
  }

  async removeStaff(adminUserId: string, pointId: string, userId: string): Promise<AdminWastePointDTO> {
    const admin = await assertActiveAdmin(this.prisma, adminUserId);
    await this.prisma.$transaction(async (tx) => {
      const p = await lockPoint(tx, pointId);
      if (p.kind === 'WAREHOUSE') throw new BadRequestException(NO_STAFF_AT_WAREHOUSE);
      const row = await tx.wastePointStaff.findFirst({ where: { pointId, userId, isActive: true }, select: { role: true } });
      if (!row) throw new NotFoundException(NOT_IN_POINT);
      const res = await tx.wastePointStaff.updateMany({ where: { pointId, userId, isActive: true }, data: { isActive: false } });
      if (res.count === 0) throw new NotFoundException(NOT_IN_POINT);
      // The perk belongs to the shop of the owner: it must not outlive the owner it was approved for.
      const clearPerk = row.role === 'OWNER' && (p.perkText !== null || p.perkPendingText !== null);
      if (clearPerk) await tx.wastePoint.update({ where: { id: pointId }, data: { perkText: null, perkPendingText: null } });
      await writeWasteEvent(tx, {
        kind: 'POINT_STAFF_REMOVED',
        actorUserId: admin.id,
        actorRole: 'ADMIN',
        pointId,
        meta: {
          staffUserId: userId,
          before: { role: row.role, isActive: true },
          after: { role: row.role, isActive: false },
          ...(clearPerk ? { perkCleared: { perkText: p.perkText, perkPendingText: p.perkPendingText } } : {}),
        },
      });
    });
    return this.getOne(pointId);
  }

  async approvePerk(adminUserId: string, pointId: string, expectedPendingText: string): Promise<AdminWastePointDTO> {
    return this.reviewPerk(adminUserId, pointId, expectedPendingText, true);
  }

  async rejectPerk(adminUserId: string, pointId: string, expectedPendingText: string): Promise<AdminWastePointDTO> {
    return this.reviewPerk(adminUserId, pointId, expectedPendingText, false);
  }

  async clearPerk(adminUserId: string, pointId: string): Promise<AdminWastePointDTO> {
    const admin = await assertActiveAdmin(this.prisma, adminUserId);
    await this.prisma.$transaction(async (tx) => {
      const p = await lockPoint(tx, pointId);
      if (p.perkText === null && p.perkPendingText === null) throw new ConflictException(NO_PERK_TO_CLEAR);
      await tx.wastePoint.update({ where: { id: pointId }, data: { perkText: null, perkPendingText: null } });
      await writeWasteEvent(tx, {
        kind: 'POINT_UPDATED',
        actorUserId: admin.id,
        actorRole: 'ADMIN',
        pointId,
        meta: {
          before: { perkText: p.perkText, perkPendingText: p.perkPendingText },
          after: { perkText: null, perkPendingText: null },
        },
      });
    });
    return this.getOne(pointId);
  }

  private async reviewPerk(adminUserId: string, pointId: string, expectedPendingText: string, approved: boolean): Promise<AdminWastePointDTO> {
    const admin = await assertActiveAdmin(this.prisma, adminUserId);
    const { p, ev, owner } = await this.prisma.$transaction(async (tx) => {
      const locked = await lockPoint(tx, pointId);
      if (!locked.perkPendingText) throw new ConflictException(NO_PENDING_PERK);
      // Exact comparison: the admin approves the text on screen, never one an owner submitted since.
      if (locked.perkPendingText !== expectedPendingText) throw new ConflictException(PERK_CHANGED);
      // Duyệt là lúc chữ này hiện cho khách: chữ gửi từ trước khi có luật vẫn không được qua. Từ chối thì cho qua để gỡ khỏi hàng chờ.
      if (approved && findCashWording(locked.perkPendingText)) throw new BadRequestException(cashWordingMessage(locked.perkPendingText));
      await tx.wastePoint.update({
        where: { id: pointId },
        data: approved ? { perkText: locked.perkPendingText, perkPendingText: null } : { perkPendingText: null },
      });
      const event = await writeWasteEvent(tx, {
        kind: approved ? 'PERK_APPROVED' : 'PERK_REJECTED',
        actorUserId: admin.id,
        actorRole: 'ADMIN',
        pointId,
        meta: approved
          ? {
              before: { perkText: locked.perkText, perkPendingText: locked.perkPendingText },
              after: { perkText: locked.perkPendingText, perkPendingText: null },
            }
          : { before: { perkPendingText: locked.perkPendingText }, after: { perkPendingText: null } },
      });
      const ownerRow = await tx.wastePointStaff.findFirst({ where: { pointId, role: 'OWNER', isActive: true }, select: { userId: true } });
      return { p: locked, ev: event, owner: ownerRow };
    });
    if (owner) await this.notifier.perkReviewed(owner.userId, { id: p.id, name: p.name }, approved, ev.id);
    return this.getOne(pointId);
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
