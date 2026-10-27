import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { cashWordingMessage, findCashWording } from '@tubutree/shared-types';
import type { WasteDeskLookupDTO, WasteDeskPointDTO, WastePerkSubmitRequest } from '@tubutree/shared-types';
import { vnMonthKey } from '../../../common/vn-time';
import { PrismaService } from '../../../prisma/prisma.service';
import { lockPoint } from '../catalog/waste-admin-points.service';
import { WasteAccessService, type WastePointAccess } from '../core/waste-access.service';
import { WasteConfigService, type WasteConfigSnapshot } from '../core/waste-config.service';
import { writeWasteEvent } from '../core/waste-events';
import { customerView } from '../core/waste-mask';
import { lookupMissMeta, normalizeWasteCode } from '../waste-codes';
import { WASTE_DESK_RECENT_MS, WASTE_LOOKUP_PATTERN } from '../waste.constants';
import { pointUsage, staffConfirmedToday } from './waste-quota';

const NOT_FOUND = 'Không tìm thấy mã';
const NO_POINT = 'Bạn chưa được gắn với điểm nhận nào đang hoạt động';
const PROGRAMME_OFF = 'Tính năng Đổi rác lấy quà đang tắt. Liên hệ quản trị viên.';
const PERK_OWNER_ONLY = 'Chỉ chủ điểm nhận mới gửi được ưu đãi riêng';
const PERK_EMPTY = 'Nội dung ưu đãi không được để trống';

const OPEN_MAIL_STATUSES = ['OPEN', 'IN_TRANSIT', 'RECEIVED'];
const CLOSED_BY_CALLER_STATUSES = ['COMPLETED', 'REJECTED'];

@Injectable()
export class WasteDeskService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: WasteConfigService,
    private readonly access: WasteAccessService,
  ) {}

  async points(userId: string): Promise<WasteDeskPointDTO[]> {
    const cfg = await this.config.snapshot();
    const list = await this.access.listOperablePoints(userId, cfg.enabled);
    return this.toDtos(userId, cfg, list);
  }

  async lookup(userId: string, code: string): Promise<WasteDeskLookupDTO> {
    const cfg = await this.config.snapshot();
    const points = await this.access.listOperablePoints(userId, cfg.enabled);
    if (points.length === 0) throw new ForbiddenException(cfg.enabled ? NO_POINT : PROGRAMME_OFF);
    const norm = normalizeWasteCode(code);
    const now = new Date();

    if (WASTE_LOOKUP_PATTERN.test(norm)) {
      const found = norm.startsWith('TR-') ? await this.findRequest(userId, norm, points, now) : await this.findGift(norm, points);
      if (found) return found;
    }

    const partnerId = points.find((p) => p.kind === 'PARTNER')?.pointId;
    await writeWasteEvent(this.prisma, {
      kind: 'LOOKUP_MISS',
      actorUserId: userId,
      actorRole: points[0]!.actorRole,
      pointId: points.length === 1 ? points[0]!.pointId : (partnerId ?? points[0]!.pointId),
      meta: { ...lookupMissMeta(code), route: 'DESK', pointIds: points.map((p) => p.pointId) },
    });
    throw new NotFoundException(NOT_FOUND);
  }

  async submitPerk(userId: string, pointId: string, body: WastePerkSubmitRequest): Promise<WasteDeskPointDTO> {
    const cfg = await this.config.snapshot();
    const access = await this.access.assertPointAccess(userId, pointId, { programmeEnabled: cfg.enabled });
    if (access.kind !== 'PARTNER' || access.myRole !== 'OWNER') throw new ForbiddenException(PERK_OWNER_ONLY);
    const text = body.perkText.trim();
    if (!text) throw new BadRequestException(PERK_EMPTY);
    if (findCashWording(text)) throw new BadRequestException(cashWordingMessage(text));

    await this.prisma.$transaction(async (tx) => {
      // Same point lock as removeStaff, so an owner removed after the access check above cannot put a perk back.
      const locked = await lockPoint(tx, pointId);
      const stillOwner = await tx.wastePointStaff.findFirst({ where: { pointId, userId, role: 'OWNER', isActive: true }, select: { id: true } });
      if (!stillOwner) throw new ForbiddenException(PERK_OWNER_ONLY);
      const before = locked.perkPendingText;
      await tx.wastePoint.update({ where: { id: pointId }, data: { perkPendingText: text } });
      await writeWasteEvent(tx, {
        kind: 'PERK_SUBMITTED',
        actorUserId: userId,
        actorRole: access.actorRole,
        pointId,
        meta: { before: { perkPendingText: before }, after: { perkPendingText: text } },
      });
    });

    const [dto] = await this.toDtos(userId, cfg, [access]);
    return dto!;
  }

  private async toDtos(userId: string, cfg: WasteConfigSnapshot, list: WastePointAccess[]): Promise<WasteDeskPointDTO[]> {
    if (list.length === 0) return [];
    const now = new Date();
    const perks = await this.prisma.wastePoint.findMany({
      where: { id: { in: list.map((p) => p.pointId) } },
      select: { id: true, perkText: true, perkPendingText: true },
    });
    const perkById = new Map(perks.map((p) => [p.id, p]));
    const used = await staffConfirmedToday(this.prisma, userId, now);
    const monthKey = vnMonthKey(now);

    const out: WasteDeskPointDTO[] = [];
    for (const p of list) {
      let quota: WasteDeskPointDTO['quota'] = null;
      if (p.kind === 'PARTNER') {
        const limit = p.monthlyQuotaPoints ?? 0;
        const u = await pointUsage(this.prisma, p.pointId, monthKey);
        quota = { limit, used: u.pointsUsed, remaining: Math.max(0, limit - u.pointsUsed) };
      }
      const perk = perkById.get(p.pointId);
      out.push({
        id: p.pointId,
        kind: p.kind,
        name: p.name,
        giftHandoverEnabled: p.kind === 'WAREHOUSE' ? true : p.giftHandoverEnabled,
        myRole: p.myRole,
        quota,
        perkText: perk?.perkText ?? null,
        perkPendingText: perk?.perkPendingText ?? null,
        staffDailyCapRemaining: Math.max(0, cfg.staffDailyCapPoints - used),
      });
    }
    return out;
  }

  private async findRequest(userId: string, norm: string, points: WastePointAccess[], now: Date): Promise<WasteDeskLookupDTO | null> {
    const req = await this.prisma.wasteRequest.findUnique({
      where: { code: norm },
      include: {
        lines: { include: { item: { select: { hazardous: true } } } },
        user: { select: { id: true, fullName: true, phone: true } },
      },
    });
    if (!req || !points.some((p) => p.pointId === req.pointId)) return null;

    const recentlyClosedByCaller =
      req.confirmedByUserId === userId &&
      CLOSED_BY_CALLER_STATUSES.includes(req.status) &&
      req.closedAt !== null &&
      now.getTime() - req.closedAt.getTime() < WASTE_DESK_RECENT_MS;
    const visible =
      recentlyClosedByCaller ||
      (req.method === 'DROP_OFF' ? req.status === 'OPEN' : OPEN_MAIL_STATUSES.includes(req.status));
    if (!visible) return null;

    const who = customerView(req.user, false);
    return {
      type: 'REQUEST',
      request: {
        id: req.id,
        code: req.code,
        method: req.method,
        status: req.status,
        pointId: req.pointId,
        customerName: who.name,
        customerPhone: who.phone,
        estimatedPoints: req.estimatedPoints,
        lines: req.lines.map((l) => ({
          itemId: l.itemId,
          itemName: l.itemName,
          unitLabel: l.unitLabel,
          unitsPerPoint: l.unitsPerPoint,
          pointsPerGroup: l.pointsPerGroup,
          declaredQty: l.declaredQty,
          receivedQty: l.receivedQty,
          hazardous: l.item.hazardous,
        })),
      },
    };
  }

  private async findGift(norm: string, points: WastePointAccess[]): Promise<WasteDeskLookupDTO | null> {
    const r = await this.prisma.wasteGiftRedemption.findUnique({
      where: { code: norm },
      include: { user: { select: { id: true, fullName: true, phone: true } } },
    });
    if (!r || r.status !== 'READY') return null;
    if (!points.some((p) => p.status === 'ACTIVE' && (p.kind === 'WAREHOUSE' || p.giftHandoverEnabled))) return null;
    return {
      type: 'GIFT',
      redemption: {
        id: r.id,
        giftName: r.giftName,
        customerName: customerView(r.user, false).name,
        status: r.status,
        claimExpiresAt: r.claimExpiresAt === null ? null : r.claimExpiresAt.toISOString(),
      },
    };
  }
}
