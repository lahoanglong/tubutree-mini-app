import { BadRequestException, ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import type {
  AdminWasteRequestQuery,
  AdminWasteRequestRowDTO,
  WasteCostRequest,
  WasteReopenRequest,
  WasteRequestAdminDetailDTO,
  WasteUserFlagsDTO,
  WasteUserFlagsUpdateRequest,
} from '@tubutree/shared-types';
import { assertActiveAdmin, assertActiveStaff } from '../../../common/staff-access';
import { PrismaService } from '../../../prisma/prisma.service';
import { WasteAccessService } from '../core/waste-access.service';
import { WasteConfigService } from '../core/waste-config.service';
import { WasteHoldService } from '../core/waste-hold.service';
import { writeWasteEvent } from '../core/waste-events';
import { customerView } from '../core/waste-mask';
import { WasteNotifierService } from '../core/waste-notifier.service';
import {
  WASTE_EXPIRED_WHERE,
  WASTE_TO_COUNT_WHERE,
  wasteCustomerBlockedWhere,
  wasteOrderMismatchWhere,
  wasteOrderNotDeliveredWhere,
  wasteTransitOverdueWhere,
} from '../core/waste-queue-filters';
import { lockWasteCustomer } from '../waste-locks';
import { lookupMissMeta, normalizeTracking, normalizeWasteCode } from '../waste-codes';
import { WASTE_OPEN_STATUSES } from '../waste.constants';
import { loadAdminRequestDetail } from './waste-admin-detail.mapper';

const NOT_FOUND = 'Không tìm thấy mã';
const RETRY = 'Vui lòng thử lại';
const NOT_REOPENABLE = 'Chỉ mở lại được yêu cầu gửi kho hoặc thu kèm đơn đã hết hạn';
const UNMATCHED_NOT_OPEN = 'Dòng hàng không rõ chủ không còn mở';
const BAD_CURSOR = 'Con trỏ phân trang không hợp lệ';
const COST_EMPTY = 'Cần nhập phí vận chuyển hoặc khối lượng';
const DROP_OFF_NO_COST = 'Yêu cầu mang tới điểm nhận không có phí vận chuyển';
const USER_NOT_FOUND = 'Không tìm thấy người dùng';
const FLAGS_EMPTY = 'Cần chọn khoá hoặc mở khoá';
const DEFAULT_PAGE = 50;
const MAX_PAGE = 100;

const ROW_INCLUDE = {
  user: { select: { id: true, fullName: true, phone: true, isBlocked: true, wasteFlags: { select: { blockedAt: true } } } },
  point: { select: { name: true } },
  order: { select: { code: true, status: true } },
} satisfies Prisma.WasteRequestInclude;

type QueueRow = Prisma.WasteRequestGetPayload<{ include: typeof ROW_INCLUDE }>;

const iso = (d: Date | null): string | null => (d ? d.toISOString() : null);

function toRow(r: QueueRow, isAdmin: boolean): AdminWasteRequestRowDTO {
  const v = customerView(r.user, isAdmin, isAdmin);
  const open = (WASTE_OPEN_STATUSES as readonly string[]).includes(r.status);
  const waitingReason =
    open && (r.user.isBlocked || r.user.wasteFlags?.blockedAt)
      ? 'CUSTOMER_BLOCKED'
      : r.method === 'PICKUP' && r.orderId && r.status === 'OPEN' && r.order && !['DELIVERED', 'RETURNED', 'CANCELLED'].includes(r.order.status)
        ? 'ORDER_NOT_DELIVERED'
        : null;
  return {
    id: r.id,
    code: r.code,
    method: r.method,
    status: r.status,
    closeReason: r.closeReason,
    createdAt: r.createdAt.toISOString(),
    expiresAt: iso(r.expiresAt),
    inTransitAt: iso(r.inTransitAt),
    receivedAt: iso(r.receivedAt),
    estimatedPoints: r.estimatedPoints,
    pointsAwarded: r.pointsAwarded,
    pointId: r.pointId,
    pointName: r.point.name,
    customerName: v.name,
    customerPhone: v.phone,
    ...(isAdmin ? { userId: r.userId } : {}),
    carrier: r.carrier,
    trackingCode: r.trackingCode,
    trackingConflict: r.trackingConflict,
    orderCode: r.order?.code ?? null,
    waitingReason,
  };
}

// An Invalid Date would reach Prisma and surface as a 500, so the cursor is parsed strictly before the query.
function parseCursor(cursor: string): { createdAt: Date; id: string } {
  const at = cursor.lastIndexOf('|');
  const d = at < 0 ? '' : cursor.slice(0, at);
  const id = at < 0 ? '' : cursor.slice(at + 1);
  const createdAt = new Date(d);
  if (!id || Number.isNaN(createdAt.getTime()) || createdAt.toISOString() !== d) throw new BadRequestException(BAD_CURSOR);
  return { createdAt, id };
}

const flagsDto = (
  userId: string,
  f: { shipLockedAt: Date | null; shipUnlockedAt: Date | null; blockedAt: Date | null; reason: string | null; setByUserId: string | null; updatedAt: Date } | null,
): WasteUserFlagsDTO => ({
  userId,
  shipLockedAt: iso(f?.shipLockedAt ?? null),
  shipUnlockedAt: iso(f?.shipUnlockedAt ?? null),
  blockedAt: iso(f?.blockedAt ?? null),
  reason: f?.reason ?? null,
  setByUserId: f?.setByUserId ?? null,
  updatedAt: iso(f?.updatedAt ?? null),
});

@Injectable()
export class WasteAdminRequestsService {
  private readonly logger = new Logger(WasteAdminRequestsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: WasteConfigService,
    private readonly access: WasteAccessService,
    private readonly hold: WasteHoldService,
    private readonly notifier: WasteNotifierService,
  ) {}

  async reopen(adminUserId: string, id: string, body: WasteReopenRequest): Promise<WasteRequestAdminDetailDTO> {
    await assertActiveAdmin(this.prisma, adminUserId);
    const cfg = await this.config.snapshot();
    const now = new Date();
    const pre = await this.prisma.wasteRequest.findUnique({ where: { id }, select: { userId: true } });
    if (!pre) throw new NotFoundException(NOT_FOUND);

    const done = await this.prisma.$transaction(async (tx) => {
      await lockWasteCustomer(tx, pre.userId);
      await tx.$queryRaw`SELECT "id" FROM "waste_requests" WHERE "id" = ${id} FOR UPDATE`;
      const req = await tx.wasteRequest.findUnique({ where: { id }, include: { lines: true } });
      if (!req) throw new NotFoundException(NOT_FOUND);
      // An account merge moved the request to another customer after the unlocked pre-read.
      if (req.userId !== pre.userId) throw new ConflictException(RETRY);
      if (req.status !== 'EXPIRED' || req.method === 'DROP_OFF' || (req.method === 'PICKUP' && req.orderId === null)) {
        throw new ConflictException(NOT_REOPENABLE);
      }

      await this.hold.validateAndHold(
        tx,
        {
          path: 'REOPEN',
          userId: req.userId,
          method: req.method,
          lines: req.lines.map((l) => ({ itemId: l.itemId, declaredQty: l.declaredQty })),
          pointId: req.pointId,
          existing: { id, pointId: req.pointId, capDayKey: req.capDayKey, capMonthKey: req.capMonthKey },
          now,
        },
        cfg,
      );

      const res = await tx.wasteRequest.updateMany({
        where: { id, status: 'EXPIRED', ...(req.method === 'PICKUP' ? { orderId: req.orderId } : {}) },
        data: { status: 'RECEIVED', receivedAt: now, closedAt: null, closeReason: null },
      });
      if (res.count !== 1) throw new ConflictException(RETRY);

      if (body.unmatchedId) {
        const um = await tx.wasteUnmatchedParcel.updateMany({
          where: { id: body.unmatchedId, status: 'OPEN' },
          data: { status: 'RESOLVED', matchedRequestId: id, resolvedByUserId: adminUserId, resolvedAt: now, resolveNote: body.reason },
        });
        if (um.count !== 1) throw new ConflictException(UNMATCHED_NOT_OPEN);
      }

      const ev = await writeWasteEvent(tx, {
        kind: 'REQUEST_REOPENED',
        actorUserId: adminUserId,
        actorRole: 'ADMIN',
        requestId: id,
        pointId: req.pointId,
        meta: {
          reason: body.reason,
          unmatchedId: body.unmatchedId ?? null,
          subjectUserId: req.userId,
          before: { status: 'EXPIRED', closeReason: req.closeReason },
          after: { status: 'RECEIVED' },
        },
      });
      return { eventId: ev.id, userId: req.userId, code: req.code };
    });

    try {
      await this.notifier.parcelReceived(done.userId, { id, code: done.code }, done.eventId);
    } catch (e) {
      this.logger.warn(`parcelReceived notify failed for ${id}: ${String(e)}`);
    }
    return loadAdminRequestDetail(this.prisma, this.access, id, true);
  }

  async queue(viewerUserId: string, q: AdminWasteRequestQuery): Promise<{ rows: AdminWasteRequestRowDTO[]; nextCursor: string | null }> {
    const adminOnly = q.filter === 'TRANSIT_OVERDUE' || q.filter === 'ORDER_MISMATCH' || q.userId !== undefined;
    const viewer = adminOnly ? await assertActiveAdmin(this.prisma, viewerUserId) : await assertActiveStaff(this.prisma, viewerUserId);
    const isAdmin = viewer.role === 'ADMIN';
    const cursor = q.cursor === undefined ? null : parseCursor(q.cursor);

    const and: Prisma.WasteRequestWhereInput[] = [];
    if (q.method) and.push({ method: q.method });
    if (q.status) and.push({ status: q.status });
    if (q.pointId) and.push({ pointId: q.pointId });
    if (q.userId !== undefined) and.push({ userId: q.userId });
    switch (q.filter) {
      case 'TO_COUNT':
        and.push(WASTE_TO_COUNT_WHERE);
        break;
      case 'EXPIRED':
        and.push(WASTE_EXPIRED_WHERE);
        break;
      case 'CUSTOMER_BLOCKED':
        and.push(wasteCustomerBlockedWhere());
        break;
      case 'ORDER_NOT_DELIVERED':
        and.push(wasteOrderNotDeliveredWhere());
        break;
      case 'TRANSIT_OVERDUE':
        and.push(wasteTransitOverdueWhere(new Date(), (await this.config.snapshot()).inTransitReviewDays));
        break;
      case 'ORDER_MISMATCH':
        and.push(wasteOrderMismatchWhere());
        break;
      default:
        break;
    }
    if (cursor) and.push({ OR: [{ createdAt: { gt: cursor.createdAt } }, { createdAt: cursor.createdAt, id: { gt: cursor.id } }] });

    const pageSize = Math.min(q.limit ?? DEFAULT_PAGE, MAX_PAGE);
    const found = await this.prisma.wasteRequest.findMany({
      where: { AND: and },
      include: ROW_INCLUDE,
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      take: pageSize + 1,
    });
    const page = found.slice(0, pageSize);
    const last = page[page.length - 1];
    const nextCursor = found.length > pageSize && last ? `${last.createdAt.toISOString()}|${last.id}` : null;
    return { rows: page.map((r) => toRow(r, isAdmin)), nextCursor };
  }

  async lookup(viewerUserId: string, code: string): Promise<AdminWasteRequestRowDTO[]> {
    const viewer = await assertActiveStaff(this.prisma, viewerUserId);
    const isAdmin = viewer.role === 'ADMIN';
    const raw = code.trim();
    const n = normalizeWasteCode(raw);
    const t = normalizeTracking(raw);
    // The exact TR- code matches in any status so the warehouse can receive an EXPIRED request; tracking and order matches only while unclosed.
    const rows = await this.prisma.wasteRequest.findMany({
      where: {
        OR: [
          { code: n },
          {
            AND: [
              { status: { in: [...WASTE_OPEN_STATUSES] } },
              {
                OR: [
                  { trackingNorm: t },
                  { order: { code: raw } },
                  { order: { code: n } },
                  { order: { gomdonOrderId: raw } },
                  { order: { gomdonPartnerCode: raw } },
                ],
              },
            ],
          },
        ],
      },
      include: ROW_INCLUDE,
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      take: 20,
    });
    if (rows.length === 0) {
      await writeWasteEvent(this.prisma, {
        kind: 'LOOKUP_MISS',
        actorUserId: viewerUserId,
        actorRole: viewer.role,
        pointId: (await this.access.warehousePoint())?.id ?? null,
        meta: { ...lookupMissMeta(raw), route: 'ADMIN' },
      });
      throw new NotFoundException(NOT_FOUND);
    }
    return rows.map((r) => toRow(r, isAdmin));
  }

  async detail(viewerUserId: string, id: string): Promise<WasteRequestAdminDetailDTO> {
    const viewer = await assertActiveStaff(this.prisma, viewerUserId);
    return loadAdminRequestDetail(this.prisma, this.access, id, viewer.role === 'ADMIN');
  }

  async setCost(adminUserId: string, id: string, body: WasteCostRequest): Promise<WasteRequestAdminDetailDTO> {
    await assertActiveAdmin(this.prisma, adminUserId);
    if (body.carrierCostVnd === undefined && body.receivedWeightGrams === undefined) throw new BadRequestException(COST_EMPTY);

    await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT "id" FROM "waste_requests" WHERE "id" = ${id} FOR UPDATE`;
      const req = await tx.wasteRequest.findUnique({
        where: { id },
        select: { method: true, userId: true, pointId: true, carrierCostVnd: true, receivedWeightGrams: true },
      });
      if (!req) throw new NotFoundException(NOT_FOUND);
      if (req.method === 'DROP_OFF' && body.carrierCostVnd !== undefined) throw new ConflictException(DROP_OFF_NO_COST);

      const data: Prisma.WasteRequestUpdateInput = {};
      if (body.carrierCostVnd !== undefined && body.carrierCostVnd !== req.carrierCostVnd) data.carrierCostVnd = body.carrierCostVnd;
      if (body.receivedWeightGrams !== undefined && body.receivedWeightGrams !== req.receivedWeightGrams) data.receivedWeightGrams = body.receivedWeightGrams;
      if (Object.keys(data).length === 0) return;

      await tx.wasteRequest.update({ where: { id }, data });
      await writeWasteEvent(tx, {
        kind: 'REQUEST_COST_UPDATED',
        actorUserId: adminUserId,
        actorRole: 'ADMIN',
        requestId: id,
        pointId: req.pointId,
        meta: {
          subjectUserId: req.userId,
          before: { carrierCostVnd: req.carrierCostVnd, receivedWeightGrams: req.receivedWeightGrams },
          after: {
            carrierCostVnd: data.carrierCostVnd === undefined ? req.carrierCostVnd : (data.carrierCostVnd as number),
            receivedWeightGrams: data.receivedWeightGrams === undefined ? req.receivedWeightGrams : (data.receivedWeightGrams as number),
          },
        },
      });
    });
    return loadAdminRequestDetail(this.prisma, this.access, id, true);
  }

  async getFlags(adminUserId: string, userId: string): Promise<WasteUserFlagsDTO> {
    await assertActiveAdmin(this.prisma, adminUserId);
    await this.assertUserExists(userId);
    return flagsDto(userId, await this.prisma.wasteUserFlags.findUnique({ where: { userId } }));
  }

  async setFlags(adminUserId: string, userId: string, body: WasteUserFlagsUpdateRequest): Promise<WasteUserFlagsDTO> {
    await assertActiveAdmin(this.prisma, adminUserId);
    if (body.shipLocked === undefined && body.blocked === undefined) throw new BadRequestException(FLAGS_EMPTY);
    await this.assertUserExists(userId);

    return this.prisma.$transaction(async (tx) => {
      // Inserting the flags row holds FOR KEY SHARE on the customer's users row only for this short transaction, which takes no request-row lock (spec 15.6).
      await tx.wasteUserFlags.createMany({ data: [{ userId }], skipDuplicates: true });
      await tx.$queryRaw`SELECT "userId" FROM "waste_user_flags" WHERE "userId" = ${userId} FOR UPDATE`;
      const cur = await tx.wasteUserFlags.findUnique({ where: { userId } });
      if (!cur) throw new NotFoundException(USER_NOT_FOUND);

      const now = new Date();
      const data: Prisma.WasteUserFlagsUncheckedUpdateInput = {};
      if (body.shipLocked === true && !cur.shipLockedAt) data.shipLockedAt = now;
      if (body.shipLocked === false && cur.shipLockedAt) {
        data.shipLockedAt = null;
        data.shipUnlockedAt = now;
      }
      if (body.blocked === true && !cur.blockedAt) data.blockedAt = now;
      if (body.blocked === false && cur.blockedAt) data.blockedAt = null;
      if (Object.keys(data).length === 0) return flagsDto(userId, cur);

      const next = await tx.wasteUserFlags.update({ where: { userId }, data: { ...data, reason: body.reason, setByUserId: adminUserId } });
      await writeWasteEvent(tx, {
        kind: 'USER_FLAGS_UPDATED',
        actorUserId: adminUserId,
        actorRole: 'ADMIN',
        meta: {
          subjectUserId: userId,
          reason: body.reason,
          before: { shipLockedAt: iso(cur.shipLockedAt), shipUnlockedAt: iso(cur.shipUnlockedAt), blockedAt: iso(cur.blockedAt) },
          after: { shipLockedAt: iso(next.shipLockedAt), shipUnlockedAt: iso(next.shipUnlockedAt), blockedAt: iso(next.blockedAt) },
        },
      });
      return flagsDto(userId, next);
    });
  }

  private async assertUserExists(userId: string): Promise<void> {
    const user = await this.prisma.user.findUnique({ where: { id: userId }, select: { id: true } });
    if (!user) throw new NotFoundException(USER_NOT_FOUND);
  }
}
