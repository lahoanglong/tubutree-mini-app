import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import type { Prisma, WasteActorRole, WasteRequestStatus } from '@prisma/client';
import type { WasteConfirmLineInput, WasteConfirmRequest, WasteConfirmResultDTO } from '@tubutree/shared-types';
import { formatPoints } from '../../../common/format-points';
import { vnMonthKey } from '../../../common/vn-time';
import { PrismaService } from '../../../prisma/prisma.service';
import { RewardPointsService } from '../../wallet/reward-points.service';
import { SystemConfigService } from '../../system-config/system-config.service';
import { WasteAccessService } from '../core/waste-access.service';
import { WasteConfigService, type WasteConfigSnapshot } from '../core/waste-config.service';
import { writeWasteEvent, type WasteDeviceMeta } from '../core/waste-events';
import { WasteNotifierService } from '../core/waste-notifier.service';
import { WasteShipLockService } from '../core/waste-ship-lock.service';
import { WASTE_REQUEST_POINTS_MAX } from '../waste.constants';
import { lockWasteStaffCap } from '../waste-locks';
import { validateConfirmLines } from './waste-confirm-lines';
import { evaluateMatch, matchReasonText, type WasteMatchOutcome } from './waste-match';
import { incrementPointUsage, pointUsage, staffConfirmedToday } from './waste-quota';

export interface WasteStaffCall {
  callerUserId: string;
  requestId: string;
  route: 'DESK' | 'ADMIN';
  device: WasteDeviceMeta;
}

type StoredLine = { itemId: string; declaredQty: number; receivedQty: number | null; shortfallReason: string | null };
type StoredRequest = {
  id: string;
  code: string;
  pointId: string;
  status: WasteRequestStatus;
  confirmedByUserId: string | null;
  pointsAwarded: number | null;
  dropsAwarded: number | null;
  lines: StoredLine[];
};
type TxResult = { replay: boolean; result: WasteConfirmResultDTO; userId: string; code: string };

const NOT_FOUND = 'Không tìm thấy mã';
const RETRY = 'Vui lòng thử lại';
const DIFFERENT_FIGURES = 'Yêu cầu đã được xác nhận với số liệu khác';
const PROGRAMME_OFF = 'Tính năng Đổi rác lấy quà đang tắt. Liên hệ quản trị viên.';

function isUniqueViolation(e: unknown): boolean {
  return typeof e === 'object' && e !== null && (e as { code?: unknown }).code === 'P2002';
}

@Injectable()
export class WasteConfirmService {
  private readonly logger = new Logger(WasteConfirmService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: WasteConfigService,
    private readonly access: WasteAccessService,
    private readonly rewards: RewardPointsService,
    private readonly systemConfig: SystemConfigService,
    private readonly notifier: WasteNotifierService,
    private readonly shipLock: WasteShipLockService,
  ) {}

  async confirm(call: WasteStaffCall, body: WasteConfirmRequest): Promise<WasteConfirmResultDTO> {
    const id = call.requestId;
    const caller = call.callerUserId;
    // Everything that reads config or opens a second connection happens before the transaction holds a row lock and a connection.
    const cfg = await this.config.snapshot();
    const expiresAt = await this.rewards.expiresAt();
    const tankCap = await this.systemConfig.get<number>('game.tank_capacity', 500);
    const now = new Date();

    if (call.route === 'DESK') {
      const pre = await this.prisma.wasteRequest.findUnique({ where: { id }, select: { pointId: true } });
      if (!pre) throw new NotFoundException(NOT_FOUND);
      await this.access.assertPointAccess(caller, pre.pointId, { programmeEnabled: cfg.enabled });
    } else {
      await this.access.assertWarehouseActor(caller);
    }

    let done: TxResult;
    try {
      done = await this.prisma.$transaction(async (tx): Promise<TxResult> => {
        await tx.$queryRaw`SELECT "id" FROM "waste_requests" WHERE "id" = ${id} FOR UPDATE`;
        const req = await tx.wasteRequest.findUnique({
          where: { id },
          include: {
            lines: { include: { item: { select: { hazardous: true } } } },
            user: { select: { id: true, phone: true, isBlocked: true } },
            order: { select: { status: true } },
          },
        });
        if (!req) throw new NotFoundException(NOT_FOUND);

        if (req.status === 'COMPLETED') {
          if (!this.sameAsStored(req, caller, body.lines)) throw new ConflictException(DIFFERENT_FIGURES);
          return { replay: true, result: await this.storedResult(tx, req, caller, now, cfg), userId: req.userId, code: req.code };
        }

        let actorRole: WasteActorRole;
        let callerPhone: string | null;
        let pointKind: 'PARTNER' | 'WAREHOUSE';
        let quota: number | null;
        if (call.route === 'DESK') {
          const access = await this.access.assertPointAccess(caller, req.pointId, { programmeEnabled: cfg.enabled, db: tx });
          actorRole = access.actorRole;
          callerPhone = access.caller.phone;
          pointKind = access.kind === 'WAREHOUSE' ? 'WAREHOUSE' : 'PARTNER';
          quota = access.monthlyQuotaPoints;
        } else {
          const staff = await this.access.assertWarehouseActor(caller, tx);
          const wh = await this.access.warehousePoint(tx);
          if (req.pointId !== wh?.id) throw new ConflictException('Yêu cầu này không xác nhận ở kho');
          actorRole = staff.role;
          callerPhone = staff.phone;
          pointKind = 'WAREHOUSE';
          quota = null;
        }

        let m: WasteMatchOutcome | undefined;
        if (req.method === 'DROP_OFF') {
          if (!cfg.enabled) throw new ForbiddenException(PROGRAMME_OFF);
          if (req.status !== 'OPEN') throw new ConflictException('Yêu cầu không ở trạng thái xác nhận được');
        } else {
          if (!['OPEN', 'IN_TRANSIT', 'RECEIVED'].includes(req.status) || pointKind !== 'WAREHOUSE') {
            throw new ConflictException('Yêu cầu không ở trạng thái xác nhận được');
          }
          if (req.method === 'PICKUP' && (!req.orderId || !req.order || !['DELIVERED', 'RETURNED'].includes(req.order.status))) {
            throw new ConflictException('Đơn gắn kèm chưa giao xong, chưa xác nhận được');
          }
          if (req.status !== 'RECEIVED') {
            m = await evaluateMatch(tx, req, body.match);
            if (!m.ok) {
              throw new ConflictException(
                `Căn cứ đối chiếu không hợp lệ: ${matchReasonText(m.reason)}. Dùng Nhận kiện để đưa kiện vào hàng không rõ chủ.`,
              );
            }
          }
        }

        if (caller === req.userId || (callerPhone && callerPhone === req.user.phone)) {
          throw new ForbiddenException('Bạn không thể xác nhận yêu cầu này');
        }
        if (pointKind === 'PARTNER') {
          const colleague = await tx.wastePointStaff.count({ where: { pointId: req.pointId, userId: req.userId, isActive: true } });
          if (colleague > 0) throw new ForbiddenException('Bạn không thể xác nhận yêu cầu này');
        }
        const flags = await tx.wasteUserFlags.findUnique({ where: { userId: req.userId }, select: { blockedAt: true } });
        if (req.user.isBlocked || flags?.blockedAt) {
          throw new ConflictException(
            actorRole === 'POINT_STAFF' ? 'Yêu cầu này đang chờ Tubu xử lý, chưa xác nhận được tại điểm' : 'Khách đang bị khoá, không cộng điểm được',
          );
        }

        if (body.receivedWeightGrams !== undefined && pointKind !== 'WAREHOUSE') {
          throw new BadRequestException('Chỉ kho Tubu mới ghi khối lượng cân');
        }
        const lines = validateConfirmLines(
          req.lines.map((l) => ({
            id: l.id,
            itemId: l.itemId,
            declaredQty: l.declaredQty,
            unitsPerPoint: l.unitsPerPoint,
            pointsPerGroup: l.pointsPerGroup,
            dropsPerUnit: l.dropsPerUnit,
            gramsPerUnit: l.gramsPerUnit,
            hazardous: l.item.hazardous,
          })),
          body.lines,
        );
        const points = lines.reduce((s, l) => s + l.pointsAwarded, 0);
        const bonus = lines.reduce((s, l) => s + l.drops, 0);
        if (points > WASTE_REQUEST_POINTS_MAX) throw new BadRequestException('Số điểm của một yêu cầu không được vượt 2.000.000');
        if (points > req.estimatedPoints) {
          this.logger.error(`Yêu cầu ${req.code}: tính ra ${points} điểm, vượt ${req.estimatedPoints} điểm đã giữ`);
          throw new InternalServerErrorException('Số điểm tính ra vượt số điểm đã giữ, đã báo quản trị viên.');
        }

        await lockWasteStaffCap(tx, caller);
        const staffUsed = await staffConfirmedToday(tx, caller, now);
        if (staffUsed + points > cfg.staffDailyCapPoints) throw new ConflictException('Bạn đã chạm trần điểm xác nhận hôm nay');

        let pointUsed = 0;
        if (pointKind === 'PARTNER') {
          const monthKey = vnMonthKey(now);
          if (points > 0) {
            const newUsed = await incrementPointUsage(tx, req.pointId, monthKey, points, quota as number);
            if (newUsed === null) {
              const u = await pointUsage(tx, req.pointId, monthKey);
              throw new ConflictException(`Điểm đã hết hạn mức tháng, còn ${formatPoints(Math.max(0, (quota as number) - u.pointsUsed))} điểm`);
            }
            pointUsed = newUsed;
          } else {
            pointUsed = (await pointUsage(tx, req.pointId, monthKey)).pointsUsed;
          }
        }

        const allowed: WasteRequestStatus[] = req.method === 'DROP_OFF' ? ['OPEN'] : ['OPEN', 'IN_TRANSIT', 'RECEIVED'];
        const res = await tx.wasteRequest.updateMany({
          where: { id, status: { in: allowed }, ...(req.method === 'PICKUP' ? { orderId: req.orderId } : {}) },
          data: {
            status: 'COMPLETED',
            completedAt: now,
            closedAt: now,
            confirmedByUserId: caller,
            pointsAwarded: points,
            dropsAwarded: bonus > 0 ? undefined : 0,
            ...(body.receivedWeightGrams !== undefined ? { receivedWeightGrams: body.receivedWeightGrams } : {}),
          },
        });
        if (res.count !== 1) throw new ConflictException(RETRY);
        for (const l of lines) {
          await tx.wasteRequestLine.update({
            where: { id: l.lineId },
            data: { receivedQty: l.receivedQty, shortfallReason: l.shortfallReason, pointsAwarded: l.pointsAwarded },
          });
        }

        if (points > 0) {
          const ok = await this.rewards.grant(req.userId, points, `RECYCLE:${req.code}`, 'RECYCLE', req.id, tx, expiresAt);
          if (!ok) {
            this.logger.error(`Yêu cầu ${req.code}: không cộng được ${points} Điểm Xanh cho user ${req.userId}`);
            throw new InternalServerErrorException('Không cộng được Điểm Xanh, đã báo quản trị viên.');
          }
        }

        let dropsAwarded = 0;
        if (bonus > 0) {
          await tx.gameProfile.upsert({ where: { userId: req.userId }, create: { userId: req.userId }, update: {} });
          const [row] = await tx.$queryRaw<{ totalSeeds: number }[]>`SELECT "totalSeeds" FROM "game_profiles" WHERE "userId" = ${req.userId} FOR UPDATE`;
          dropsAwarded = Math.max(0, Math.min(bonus, tankCap - Number(row?.totalSeeds ?? 0)));
          if (dropsAwarded > 0) {
            await tx.gameProfile.update({ where: { userId: req.userId }, data: { totalSeeds: { increment: dropsAwarded } } });
          }
          await tx.wasteRequest.update({ where: { id }, data: { dropsAwarded } });
        }

        await tx.wastePoint.update({ where: { id: req.pointId }, data: { lastConfirmedAt: now } });
        await writeWasteEvent(tx, {
          kind: 'REQUEST_CONFIRMED',
          actorUserId: caller,
          actorRole,
          requestId: id,
          pointId: req.pointId,
          meta: {
            route: call.route,
            device: call.device,
            matchBasis: m?.ok ? m.basis : null,
            subjectUserId: req.userId,
            staffUserId: caller,
            before: { status: req.status },
            after: { status: 'COMPLETED', pointsAwarded: points, dropsAwarded },
            lines: lines.map(({ itemId, declaredQty, receivedQty, shortfallReason }) => ({ itemId, declaredQty, receivedQty, shortfallReason })),
            receivedWeightGrams: body.receivedWeightGrams ?? null,
          },
        });

        const result: WasteConfirmResultDTO = {
          requestId: id,
          code: req.code,
          status: 'COMPLETED',
          pointsAwarded: points,
          dropsAwarded,
          quota: pointKind === 'PARTNER' ? { limit: quota as number, used: pointUsed, remaining: Math.max(0, (quota as number) - pointUsed) } : null,
          staffDailyCapRemaining: Math.max(0, cfg.staffDailyCapPoints - staffUsed - points),
        };
        return { replay: false, result, userId: req.userId, code: req.code };
      });
    } catch (e) {
      if (!isUniqueViolation(e)) throw e;
      const again = await this.prisma.wasteRequest.findUnique({ where: { id }, include: { lines: true } });
      if (again && again.status === 'COMPLETED' && this.sameAsStored(again, caller, body.lines)) {
        return this.storedResult(this.prisma, again, caller, now, cfg);
      }
      throw new ConflictException(RETRY);
    }

    if (!done.replay) {
      try {
        await this.notifier.pointsCredited(done.userId, { id, code: done.code }, done.result.pointsAwarded, done.result.dropsAwarded);
      } catch (e) {
        this.logger.warn(`Không gửi được tin cộng điểm của ${done.code}: ${e instanceof Error ? e.message : String(e)}`);
      }
      try {
        await this.shipLock.evaluateAndLock(done.userId, { shortfallLockPct: cfg.shortfallLockPct, shortfallLockStreak: cfg.shortfallLockStreak });
      } catch (e) {
        this.logger.warn(`Không đánh giá được khoá gửi của user ${done.userId}: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
    return done.result;
  }

  /** declaredQty and receivedWeightGrams are ignored on purpose: a retry after the customer edited or the scale changed is still a replay. */
  private sameAsStored(req: StoredRequest, caller: string, body: ReadonlyArray<WasteConfirmLineInput>): boolean {
    if (req.confirmedByUserId !== caller || body.length !== req.lines.length) return false;
    const byItem = new Map<string, WasteConfirmLineInput>();
    for (const b of body) {
      if (byItem.has(b.itemId)) return false;
      byItem.set(b.itemId, b);
    }
    return req.lines.every((s) => {
      const b = byItem.get(s.itemId);
      if (!b || b.receivedQty !== s.receivedQty) return false;
      const full = s.declaredQty === b.receivedQty;
      return (full ? null : (b.shortfallReason ?? null)) === (s.shortfallReason ?? null);
    });
  }

  private async storedResult(
    db: Prisma.TransactionClient,
    req: StoredRequest,
    caller: string,
    now: Date,
    cfg: Pick<WasteConfigSnapshot, 'staffDailyCapPoints'>,
  ): Promise<WasteConfirmResultDTO> {
    const p = await db.wastePoint.findUnique({ where: { id: req.pointId }, select: { kind: true, monthlyQuotaPoints: true } });
    let quota: WasteConfirmResultDTO['quota'] = null;
    if (p?.kind === 'PARTNER' && p.monthlyQuotaPoints !== null) {
      const u = await pointUsage(db, req.pointId, vnMonthKey(now));
      quota = { limit: p.monthlyQuotaPoints, used: u.pointsUsed, remaining: Math.max(0, p.monthlyQuotaPoints - u.pointsUsed) };
    }
    return {
      requestId: req.id,
      code: req.code,
      status: 'COMPLETED',
      pointsAwarded: req.pointsAwarded ?? 0,
      dropsAwarded: req.dropsAwarded ?? 0,
      quota,
      staffDailyCapRemaining: Math.max(0, cfg.staffDailyCapPoints - (await staffConfirmedToday(db, caller, now))),
    };
  }
}
