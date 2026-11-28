import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import {
  GOODWILL_DAILY_CAP_PER_ADMIN,
  GOODWILL_GIFT_LABEL,
  GOODWILL_MAX_PER_GRANT,
  GOODWILL_POINTS_REASON_CODE,
  GOODWILL_REASON_MAX,
  GOODWILL_REASON_MIN,
  type GoodwillCreditItem,
  type GoodwillCreditList,
  type GoodwillCreditResult,
  type GoodwillKind,
} from '@tubutree/shared-types';
import { formatVndDigits, formatVndText } from '../../common/format-vnd';
import { startOfVnDay } from '../../common/vn-time';
import { PrismaService } from '../../prisma/prisma.service';
import { SystemConfigService } from '../system-config/system-config.service';
import { applyWalletDelta } from '../wallet/wallet-ledger.service';
import { applyPointsDelta } from './points-ledger';
import { DEFAULT_POINT_EXPIRE_MONTHS, pointsExpiryFrom } from './points-expiry-date';

export const GOODWILL_AUDIT_ACTION = 'GOODWILL_CREDIT';
/** refType của dòng sổ Điểm Xanh / Ví do lần tặng ghi (Ví dùng loại ADJUST "điều chỉnh tay của admin", không thêm loại mới). */
export const GOODWILL_REF_TYPE = 'GOODWILL';
const LIST_LIMIT = 20;
const LOCK_NAMESPACE = 'goodwill-credit';

export interface GoodwillCreditInput {
  kind: GoodwillKind;
  amount: number;
  reason: string;
  orderCode?: string | null;
}

/** Dòng admin_audit_logs của một lần tặng: vừa là vết kiểm toán, vừa là khoá chống lặp (idempotencyKey) và nguồn đếm trần ngày. */
interface GoodwillAuditPayload {
  idempotencyKey: string;
  userId: string;
  kind: GoodwillKind;
  amount: number;
  reason: string;
  orderCode: string | null;
  orderId: string | null;
  entryId: string;
}

const isPayload = (p: unknown): p is GoodwillAuditPayload =>
  !!p && typeof p === 'object' && typeof (p as GoodwillAuditPayload).amount === 'number' && typeof (p as GoodwillAuditPayload).kind === 'string';

/**
 * Tặng thiện chí cho khách (bù giao trễ, hàng lỗi…): Điểm Xanh vào lô STANDARD (có hạn như điểm thường, không tính xét hạng) hoặc tiền vào
 * Ví Tubu. Chỉ ADMIN (controller không mở @AllowStaff). Mỗi lần: trần GOODWILL_MAX_PER_GRANT, trần ngày GOODWILL_DAILY_CAP_PER_ADMIN theo
 * người tặng, lý do nội bộ bắt buộc, Idempotency-Key bắt buộc; dòng sổ và dòng admin_audit_logs cùng một transaction.
 */
@Injectable()
export class GoodwillCreditService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: SystemConfigService,
  ) {}

  async grant(actorId: string, userId: string, input: GoodwillCreditInput, idempotencyKey: string, now: Date = new Date()): Promise<GoodwillCreditResult> {
    const reason = input.reason.trim();
    const orderCode = input.orderCode?.trim() || null;
    if (actorId === userId) throw new ForbiddenException('Không tự tặng thiện chí cho tài khoản của chính mình.');
    if (!Number.isSafeInteger(input.amount) || input.amount < 1 || input.amount > GOODWILL_MAX_PER_GRANT) {
      throw new BadRequestException(`Mỗi lần tặng từ 1 tới ${formatVndDigits(GOODWILL_MAX_PER_GRANT)}.`);
    }
    if (reason.length < GOODWILL_REASON_MIN || reason.length > GOODWILL_REASON_MAX) {
      throw new BadRequestException(`Lý do cần từ ${GOODWILL_REASON_MIN} tới ${GOODWILL_REASON_MAX} ký tự.`);
    }
    const request = { userId, kind: input.kind, amount: input.amount, reason, orderCode };
    // Hạn điểm đọc cấu hình qua pool riêng: đọc TRƯỚC khi mở transaction (trong tx thì xin kết nối thứ hai khi đang giữ khoá).
    const expiresAt =
      input.kind === 'POINTS' ? pointsExpiryFrom(now, await this.config.get<number>('loyalty.point_expire_months', DEFAULT_POINT_EXPIRE_MONTHS)) : null;

    return this.prisma.$transaction(async (tx) => {
      // Mọi lần tặng của cùng người tặng đi tuần tự: tra trùng khoá + cộng trần ngày + ghi sổ không đan vào nhau giữa hai tab/hai cú bấm.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${LOCK_NAMESPACE}), hashtext(${actorId}))`;

      const prior = await tx.adminAuditLog.findFirst({
        where: { actorId, action: GOODWILL_AUDIT_ACTION, payload: { path: ['idempotencyKey'], equals: idempotencyKey } },
        select: { id: true, payload: true, createdAt: true },
      });
      if (prior) {
        const p = prior.payload;
        if (!isPayload(p) || p.userId !== request.userId || p.kind !== request.kind || p.amount !== request.amount || p.reason !== request.reason || p.orderCode !== request.orderCode) {
          throw new ConflictException('Idempotency-Key này đã dùng cho một lần tặng khác. Mở lại hộp tặng rồi gửi lại.');
        }
        return {
          id: prior.id,
          kind: p.kind,
          amount: p.amount,
          orderCode: p.orderCode,
          entryId: p.entryId,
          replayed: true,
          dailyUsed: await this.usedToday(tx, actorId, now),
          dailyCap: GOODWILL_DAILY_CAP_PER_ADMIN,
          createdAt: prior.createdAt.toISOString(),
        };
      }

      const target = await tx.user.findUnique({ where: { id: userId }, select: { id: true, role: true, mergedIntoId: true, isBlocked: true } });
      if (!target) throw new NotFoundException('Không tìm thấy tài khoản.');
      if (target.role === 'ADMIN' || target.role === 'STAFF') {
        throw new BadRequestException('Chỉ tặng thiện chí cho khách, không tặng cho tài khoản quản trị hay nhân viên.');
      }
      if (target.mergedIntoId) throw new BadRequestException('Tài khoản này đã gộp vào tài khoản khác. Mở hồ sơ tài khoản chính để tặng.');
      if (target.isBlocked) throw new BadRequestException('Tài khoản đang bị khoá hoặc đã xoá, không tặng được.');

      const order = orderCode ? await tx.order.findUnique({ where: { code: orderCode }, select: { id: true, code: true, userId: true } }) : null;
      if (orderCode && (!order || order.userId !== userId)) throw new BadRequestException(`Không thấy đơn ${orderCode} của khách này.`);

      const used = await this.usedToday(tx, actorId, now);
      if (used + input.amount > GOODWILL_DAILY_CAP_PER_ADMIN) {
        throw new BadRequestException(
          `Vượt trần tặng trong ngày của bạn (${formatVndText(GOODWILL_DAILY_CAP_PER_ADMIN)}, 1 điểm tính 1đ): hôm nay đã tặng ${formatVndText(used)}, còn ${formatVndText(Math.max(0, GOODWILL_DAILY_CAP_PER_ADMIN - used))}.`,
        );
      }

      // refId theo (người tặng, khoá): Ví có unique (userId, type, refId) nên cùng một lần tặng không thể vào sổ Ví hai lần kể cả khi lớp trên lọt.
      const refId = `${actorId}:${idempotencyKey}`;
      let entryId: string;
      if (input.kind === 'POINTS') {
        const r = await applyPointsDelta(tx, {
          userId,
          delta: input.amount,
          lot: 'STANDARD',
          reason: order ? `${GOODWILL_POINTS_REASON_CODE}:${order.code}` : GOODWILL_POINTS_REASON_CODE,
          refType: GOODWILL_REF_TYPE,
          refId,
          expiresAt,
        });
        if (!r.applied || !r.entryId) throw new ConflictException('Không ghi được Điểm Xanh. Thử lại.');
        entryId = r.entryId;
      } else {
        const r = await applyWalletDelta(tx, {
          userId,
          delta: input.amount,
          type: 'ADJUST',
          refType: GOODWILL_REF_TYPE,
          refId,
          reason: order ? `${GOODWILL_GIFT_LABEL} · đơn ${order.code}` : GOODWILL_GIFT_LABEL,
        });
        if (!r.applied) throw new ConflictException('Lần tặng này đã vào Ví trước đó.');
        entryId = r.entryId;
      }

      const payload: GoodwillAuditPayload = { idempotencyKey, ...request, orderId: order?.id ?? null, entryId };
      const log = await tx.adminAuditLog.create({
        data: {
          actorId,
          action: GOODWILL_AUDIT_ACTION,
          targetType: 'USER',
          targetIds: order ? [userId, order.id] : [userId],
          payload: payload as unknown as Prisma.InputJsonValue,
          // Mốc giờ Node, cùng đồng hồ với mốc đầu ngày của trần ngày (đồng hồ DB có thể lệch).
          createdAt: now,
        },
        select: { id: true, createdAt: true },
      });
      return {
        id: log.id,
        kind: input.kind,
        amount: input.amount,
        orderCode: order?.code ?? null,
        entryId,
        replayed: false,
        dailyUsed: used + input.amount,
        dailyCap: GOODWILL_DAILY_CAP_PER_ADMIN,
        createdAt: log.createdAt.toISOString(),
      };
      // Các lần tặng của cùng người tặng xếp hàng sau khoá: lần sau có thể chờ vài lần trước xong mới chạy, nên nới hạn 5 giây mặc định.
    }, { timeout: 15_000, maxWait: 10_000 });
  }

  /** Lần tặng gần nhất cho khách (mọi người tặng) và hạn mức hôm nay của người xem. */
  async list(viewerId: string, userId: string, now: Date = new Date()): Promise<GoodwillCreditList> {
    const [rows, dailyUsed] = await Promise.all([
      this.prisma.adminAuditLog.findMany({
        where: { action: GOODWILL_AUDIT_ACTION, targetIds: { has: userId } },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: LIST_LIMIT,
        select: { id: true, actorId: true, payload: true, createdAt: true },
      }),
      this.usedToday(this.prisma, viewerId, now),
    ]);
    const actorIds = [...new Set(rows.map((r) => r.actorId))];
    const actors = actorIds.length ? await this.prisma.user.findMany({ where: { id: { in: actorIds } }, select: { id: true, fullName: true } }) : [];
    const nameOf = new Map(actors.map((a) => [a.id, a.fullName]));
    const items: GoodwillCreditItem[] = rows.flatMap((r) => {
      const p = r.payload;
      if (!isPayload(p) || p.userId !== userId) return [];
      return [{ id: r.id, kind: p.kind, amount: p.amount, reason: p.reason, orderCode: p.orderCode, actorId: r.actorId, actorName: nameOf.get(r.actorId) ?? null, createdAt: r.createdAt.toISOString() }];
    });
    return { perGrantMax: GOODWILL_MAX_PER_GRANT, dailyCap: GOODWILL_DAILY_CAP_PER_ADMIN, dailyUsed, items };
  }

  /** Tổng đã tặng từ 00:00 giờ VN hôm nay của một người tặng (điểm và tiền cộng chung, 1 điểm = 1đ). */
  private async usedToday(db: Pick<PrismaService, '$queryRaw'> | Prisma.TransactionClient, actorId: string, now: Date): Promise<number> {
    const rows = await db.$queryRaw<{ used: number }[]>`
      SELECT COALESCE(SUM(("payload"->>'amount')::int), 0)::int AS "used"
        FROM "admin_audit_logs"
       WHERE "actorId" = ${actorId} AND "action" = ${GOODWILL_AUDIT_ACTION} AND "createdAt" >= ${startOfVnDay(now)}`;
    return rows[0]?.used ?? 0;
  }
}
