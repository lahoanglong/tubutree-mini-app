import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { WasteEligibility, WastePointKind, WastePointStaffRole, WastePointStatus } from '@tubutree/shared-types';
import { isRealUser, REAL_USER_REQUIRED_MSG } from '../../../common/real-user';
import { assertActiveStaff, type ActiveStaff } from '../../../common/staff-access';
import { PrismaService } from '../../../prisma/prisma.service';
import { WASTE_MESSAGES } from './waste-messages';

export type WasteGateMode = 'FULL' | 'OWN';

export interface WasteCustomerContext {
  userId: string;
  phone: string;
  blocked: boolean;
  shipLockedAt: Date | null;
  programmeEnabled: boolean;
}

export interface WastePointAccess {
  pointId: string;
  kind: WastePointKind;
  name: string;
  status: WastePointStatus;
  giftHandoverEnabled: boolean;
  monthlyQuotaPoints: number | null;
  actorRole: 'POINT_STAFF' | 'STAFF' | 'ADMIN';
  myRole: WastePointStaffRole;
  caller: { id: string; phone: string | null; role: string };
}

export function eligibilityOf(u: { phone: string | null; zaloId: string | null }): WasteEligibility {
  if (!isRealUser(u)) return 'GUEST';
  if (!u.phone) return 'NEED_PHONE';
  return 'OK';
}

const POINT_SELECT = { id: true, kind: true, name: true, status: true, giftHandoverEnabled: true, monthlyQuotaPoints: true } as const;
const CALLER_SELECT = { id: true, role: true, phone: true, isBlocked: true, mergedIntoId: true, wasteFlags: { select: { blockedAt: true } } } as const;

type PointRow = { id: string; kind: WastePointKind; name: string; status: WastePointStatus; giftHandoverEnabled: boolean; monthlyQuotaPoints: number | null };
type Caller = { id: string; role: string; phone: string | null };

function accessOf(point: PointRow, caller: Caller, actorRole: WastePointAccess['actorRole'], myRole: WastePointStaffRole): WastePointAccess {
  return {
    pointId: point.id,
    kind: point.kind,
    name: point.name,
    status: point.status,
    giftHandoverEnabled: point.giftHandoverEnabled,
    monthlyQuotaPoints: point.monthlyQuotaPoints,
    actorRole,
    myRole,
    caller: { id: caller.id, phone: caller.phone, role: caller.role },
  };
}

@Injectable()
export class WasteAccessService {
  constructor(private readonly prisma: PrismaService) {}

  /** Đọc lại người dùng ở mỗi lần gọi: khoá hay gỡ quyền có hiệu lực ngay lượt sau (spec 15.1). */
  async customerGate(userId: string, mode: WasteGateMode, programmeEnabled: boolean): Promise<WasteCustomerContext> {
    if (mode === 'FULL' && !programmeEnabled) throw new ForbiddenException(WASTE_MESSAGES.PROGRAMME_OFF);
    const row = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, phone: true, zaloId: true, isBlocked: true, mergedIntoId: true, wasteFlags: { select: { blockedAt: true, shipLockedAt: true } } },
    });
    const eligibility = row ? eligibilityOf(row) : 'GUEST';
    if (!row || eligibility === 'GUEST') throw new ForbiddenException(REAL_USER_REQUIRED_MSG);
    if (eligibility === 'NEED_PHONE') throw new ForbiddenException(WASTE_MESSAGES.NEED_PHONE);
    const blockedAt = row.wasteFlags?.blockedAt ?? null;
    if (mode === 'FULL' && blockedAt) throw new ForbiddenException(WASTE_MESSAGES.BLOCKED);
    return { userId: row.id, phone: row.phone as string, blocked: !!blockedAt, shipLockedAt: row.wasteFlags?.shipLockedAt ?? null, programmeEnabled };
  }

  async availablePointIds(db: Prisma.TransactionClient, pointIds?: string[]): Promise<Set<string>> {
    if (pointIds && pointIds.length === 0) return new Set();
    const ids = pointIds ?? null;
    const rows = await db.$queryRaw<{ id: string }[]>`
      SELECT p.id FROM waste_points p
      WHERE p.status::text = 'ACTIVE'
        AND (${ids}::text[] IS NULL OR p.id = ANY(${ids}::text[]))
        AND (p.kind::text = 'WAREHOUSE' OR (
          SELECT count(*) FROM waste_point_staff s
          JOIN users u ON u.id = s."userId"
          LEFT JOIN waste_user_flags f ON f."userId" = u.id
          WHERE s."pointId" = p.id AND s.role::text = 'OWNER' AND s."isActive"
            AND NOT u."isBlocked" AND u."mergedIntoId" IS NULL AND f."blockedAt" IS NULL
            AND EXISTS (SELECT 1 FROM storefronts sf WHERE sf."ownerUserId" = u.id AND (sf.type::text = 'MERCHANT' OR sf."isPartner"))
        ) = 1)`;
    return new Set(rows.map((r) => r.id));
  }

  async assertPointAccess(userId: string, pointId: string, opts: { programmeEnabled: boolean; db?: Prisma.TransactionClient }): Promise<WastePointAccess> {
    const db: Prisma.TransactionClient = opts.db ?? this.prisma;
    const point = await db.wastePoint.findUnique({ where: { id: pointId }, select: POINT_SELECT });
    if (!point) throw new NotFoundException(WASTE_MESSAGES.POINT_NOT_FOUND);
    if (point.status !== 'ACTIVE') throw new ForbiddenException(WASTE_MESSAGES.POINT_INACTIVE);
    const caller = await db.user.findUnique({ where: { id: userId }, select: CALLER_SELECT });
    if (!caller || caller.isBlocked || caller.mergedIntoId) throw new ForbiddenException(WASTE_MESSAGES.ACCOUNT_LOCKED);
    if (caller.wasteFlags?.blockedAt && caller.role !== 'ADMIN') throw new ForbiddenException(WASTE_MESSAGES.BLOCKED);

    if (point.kind === 'WAREHOUSE') {
      const staff = await assertActiveStaff(db, userId);
      return accessOf(point, caller, staff.role, 'STAFF');
    }
    if (!opts.programmeEnabled) throw new ForbiddenException(WASTE_MESSAGES.PROGRAMME_OFF);
    const row = await db.wastePointStaff.findUnique({ where: { pointId_userId: { pointId, userId } } });
    if (!row?.isActive) throw new ForbiddenException(WASTE_MESSAGES.NOT_POINT_STAFF);
    if (!(await this.availablePointIds(db, [pointId])).has(pointId)) throw new ForbiddenException(WASTE_MESSAGES.POINT_OWNER_INVALID);
    return accessOf(point, caller, 'POINT_STAFF', row.role);
  }

  async assertWarehouseActor(userId: string, db?: Prisma.TransactionClient): Promise<ActiveStaff> {
    const d: Prisma.TransactionClient = db ?? this.prisma;
    const staff = await assertActiveStaff(d, userId);
    const flags = await d.wasteUserFlags.findUnique({ where: { userId }, select: { blockedAt: true } });
    if (flags?.blockedAt && staff.role !== 'ADMIN') throw new ForbiddenException(WASTE_MESSAGES.BLOCKED);
    return staff;
  }

  async listOperablePoints(userId: string, programmeEnabled: boolean): Promise<WastePointAccess[]> {
    const caller = await this.prisma.user.findUnique({ where: { id: userId }, select: CALLER_SELECT });
    if (!caller || caller.isBlocked || caller.mergedIntoId) return [];
    if (caller.wasteFlags?.blockedAt && caller.role !== 'ADMIN') return [];

    const out: WastePointAccess[] = [];
    if (caller.role === 'STAFF' || caller.role === 'ADMIN') {
      const wh = await this.prisma.wastePoint.findFirst({ where: { kind: 'WAREHOUSE', status: 'ACTIVE' }, select: POINT_SELECT });
      if (wh) out.push(accessOf(wh, caller, caller.role, 'STAFF'));
    }
    if (programmeEnabled) {
      const rows = await this.prisma.wastePointStaff.findMany({
        where: { userId, isActive: true, point: { kind: 'PARTNER', status: 'ACTIVE' } },
        select: { role: true, point: { select: POINT_SELECT } },
        orderBy: [{ point: { sortOrder: 'asc' } }, { point: { name: 'asc' } }],
      });
      const available = await this.availablePointIds(this.prisma, rows.map((r) => r.point.id));
      for (const r of rows) if (available.has(r.point.id)) out.push(accessOf(r.point, caller, 'POINT_STAFF', r.role));
    }
    return out;
  }

  warehousePoint(db?: Prisma.TransactionClient): Promise<{ id: string } | null> {
    return (db ?? this.prisma).wastePoint.findFirst({ where: { kind: 'WAREHOUSE' }, select: { id: true } });
  }
}
