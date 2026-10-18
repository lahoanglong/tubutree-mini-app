import { BadRequestException, ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import type { ExternalClaimState, Prisma } from '@prisma/client';
import type {
  AdminExternalAttemptListResponse,
  AdminExternalClaimListResponse,
  AdminExternalClaimRow,
  AdminReverseClaimResponse,
} from '@tubutree/shared-types';
import { formatPoints } from '../../common/format-points';
import { maskPhoneOrNull } from '../../common/mask-pii';
import { paginated, skipTake } from '../../common/pagination';
import { parseTypedVnPhone } from '../../common/phone';
import { vnDateKey } from '../../common/vn-time';
import { PrismaService } from '../../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { SystemConfigService } from '../system-config/system-config.service';
import { loadClaimConfig } from './external-claim.config';
import { reverseCreditedClaim } from './external-claim-status';
import { advisoryUserLock, type CreatedClaim, ExternalClaimService } from './external-claim.service';
import { UNMATCHED_RETRY_DAYS_FOR_ATTENTION } from './external-points-attention';
import { normalizeTrackingCode } from './external-order.mapper';
import { claimPoints, maskClaimCode } from './external-points-rate';

const UNPAID: ExternalClaimState[] = ['PENDING', 'REVIEW', 'HELD_NO_MEMBER'];

export interface AdminClaimListQuery {
  page: number;
  limit: number;
  state?: ExternalClaimState;
  q?: string;
}

/**
 * Xử lý claim và lần gửi mã của đơn ngoài app. Mọi thao tác ghi nhận `decidedById`; huỷ có lý do bắt buộc. SĐT luôn che, không trả payload.
 * Quyền do controller giữ (CSKH duyệt/huỷ khi chưa cộng; chỉ ADMIN đảo điểm đã cộng).
 */
@Injectable()
export class ExternalClaimsAdminService {
  private readonly logger = new Logger(ExternalClaimsAdminService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: SystemConfigService,
    private readonly notifications: NotificationsService,
    private readonly claims: ExternalClaimService,
  ) {}

  private rowOf(c: Prisma.ExternalPointsClaimGetPayload<{ include: { externalOrder: true } }>, user: { name: string | null; phone: string | null } | null): AdminExternalClaimRow {
    const o = c.externalOrder;
    return {
      id: c.id,
      externalOrderId: o.id,
      pancakeOrderId: o.pancakeOrderId,
      channel: o.channel,
      source: o.source,
      maskedCode: maskClaimCode(o.trackingCode),
      userId: c.userId,
      userName: user?.name ?? null,
      userPhoneMasked: maskPhoneOrNull(user?.phone),
      orderPhoneMasked: maskPhoneOrNull(o.phone),
      goodsValue: o.goodsValue,
      points: c.points,
      state: c.state,
      orderStatus: o.status,
      reviewReason: c.reviewReason,
      voidReason: c.voidReason,
      decidedById: c.decidedById,
      deliveredAt: o.deliveredAt?.toISOString() ?? null,
      creditedAt: c.creditedAt?.toISOString() ?? null,
      createdAt: c.createdAt.toISOString(),
    };
  }

  private async usersById(ids: (string | null)[]): Promise<Map<string, { name: string | null; phone: string | null }>> {
    const unique = [...new Set(ids.filter((i): i is string => !!i))];
    if (unique.length === 0) return new Map();
    const users = await this.prisma.user.findMany({ where: { id: { in: unique } }, select: { id: true, fullName: true, phone: true } });
    return new Map(users.map((u) => [u.id, { name: u.fullName, phone: u.phone }]));
  }

  async list(q: AdminClaimListQuery): Promise<AdminExternalClaimListResponse> {
    const where: Prisma.ExternalPointsClaimWhereInput = { ...(q.state ? { state: q.state } : {}) };
    const text = q.q?.trim();
    if (text) {
      const code = normalizeTrackingCode(text);
      const phone = parseTypedVnPhone(text);
      const or: Prisma.ExternalPointsClaimWhereInput[] = [{ id: text }, { externalOrder: { pancakeOrderId: text } }];
      if (code) or.push({ claimedCode: code }, { externalOrder: { trackingCodes: { has: code } } });
      if (phone) or.push({ externalOrder: { phone } });
      where.OR = or;
      if (phone) {
        const u = await this.prisma.user.findUnique({ where: { phone }, select: { id: true } });
        if (u) or.push({ userId: u.id });
      }
    }
    const [rows, total] = await Promise.all([
      this.prisma.externalPointsClaim.findMany({ where, include: { externalOrder: true }, orderBy: { createdAt: 'desc' }, ...skipTake(q.page, q.limit) }),
      this.prisma.externalPointsClaim.count({ where }),
    ]);
    const users = await this.usersById(rows.map((r) => r.userId));
    return paginated(rows.map((r) => this.rowOf(r, users.get(r.userId ?? '') ?? null)), q.page, q.limit, total);
  }

  async detail(id: string): Promise<AdminExternalClaimRow> {
    const c = await this.prisma.externalPointsClaim.findUnique({ where: { id }, include: { externalOrder: true } });
    if (!c) throw new NotFoundException('Không tìm thấy claim.');
    const users = await this.usersById([c.userId]);
    return this.rowOf(c, users.get(c.userId ?? '') ?? null);
  }

  /** Lần gửi mã cần người xử lý: đã hết 3 ngày tự ghép mà chưa thấy đơn, hoặc đơn thấy được nhưng nguồn chưa xác định. */
  async listAttempts(page: number, limit: number, now: Date = new Date()): Promise<AdminExternalAttemptListResponse> {
    const where: Prisma.ExternalClaimAttemptWhereInput = {
      result: 'UNMATCHED',
      resolvedAt: null,
      OR: [{ externalOrderId: { not: null } }, { createdAt: { lt: new Date(now.getTime() - UNMATCHED_RETRY_DAYS_FOR_ATTENTION * 864e5) } }],
    };
    const [rows, total] = await Promise.all([
      this.prisma.externalClaimAttempt.findMany({ where, orderBy: { createdAt: 'asc' }, ...skipTake(page, limit) }),
      this.prisma.externalClaimAttempt.count({ where }),
    ]);
    const users = await this.usersById(rows.map((r) => r.userId));
    return paginated(
      rows.map((r) => ({
        id: r.id,
        userId: r.userId,
        userName: users.get(r.userId)?.name ?? null,
        userPhoneMasked: maskPhoneOrNull(users.get(r.userId)?.phone),
        maskedCode: maskClaimCode(r.code),
        result: r.result,
        externalOrderId: r.externalOrderId,
        note: r.note,
        createdAt: r.createdAt.toISOString(),
      })),
      page,
      limit,
      total,
    );
  }

  /** REVIEW sang PENDING. Phải có tiền hàng để tính điểm; điểm tính lại theo tiền hàng mới nhất của đơn. */
  async approve(id: string, actorId: string): Promise<{ id: string; state: 'PENDING' }> {
    const c = await this.prisma.externalPointsClaim.findUnique({ where: { id }, include: { externalOrder: true } });
    if (!c) throw new NotFoundException('Không tìm thấy claim.');
    if (c.state !== 'REVIEW') throw new ConflictException('Claim không ở trạng thái chờ duyệt.');
    if (['RETURNED', 'CANCELLED', 'DELETED'].includes(c.externalOrder.status)) throw new BadRequestException('Đơn đã bị huỷ hoặc hoàn trên sàn nên không duyệt được.');
    const points = claimPoints(c.externalOrder.goodsValue, Number(c.ratePct));
    if (points === null || points <= 0) throw new BadRequestException('Đơn chưa có tiền hàng hợp lệ để tính điểm.');
    const cfg = await loadClaimConfig(this.config);
    const o = c.externalOrder;
    const releaseAt = o.status === 'DELIVERED' && o.deliveredAt ? new Date(o.deliveredAt.getTime() + cfg.pendingDays * 864e5) : null;
    const res = await this.prisma.externalPointsClaim.updateMany({
      where: { id, state: 'REVIEW' },
      data: { state: 'PENDING', points, releaseAt, decidedById: actorId, reviewReason: null },
    });
    if (res.count !== 1) throw new ConflictException('Claim vừa được xử lý bởi người khác.');
    if (c.userId) {
      await this.claims.notifyPending(c.userId, {
        claimId: id,
        state: 'PENDING',
        points,
        channel: o.channel,
        maskedCode: maskClaimCode(o.trackingCode),
        expectedCreditAt: releaseAt,
      } satisfies CreatedClaim);
    }
    return { id, state: 'PENDING' };
  }

  /** Huỷ claim chưa cộng. `reopen`: giải phóng mã để đơn được tích lại (xem ClaimRules: claim VOIDED, mã null, có người quyết). */
  async voidClaim(id: string, actorId: string, reason: string, reopen: boolean): Promise<{ id: string; state: 'VOIDED' }> {
    const c = await this.prisma.externalPointsClaim.findUnique({ where: { id }, include: { externalOrder: { select: { trackingCode: true } } } });
    if (!c) throw new NotFoundException('Không tìm thấy claim.');
    if (c.state === 'CREDITED') throw new ConflictException('Claim đã cộng điểm, hãy dùng "Đảo điểm" (chỉ ADMIN).');
    if (!UNPAID.includes(c.state)) throw new ConflictException('Claim không còn ở trạng thái chưa cộng.');
    const res = await this.prisma.externalPointsClaim.updateMany({
      where: { id, state: { in: UNPAID } },
      data: { state: 'VOIDED', voidReason: reopen ? `Huỷ và mở lại mã: ${reason}` : reason, decidedById: actorId, ...(reopen ? { claimedCode: null } : {}) },
    });
    if (res.count !== 1) throw new ConflictException('Claim vừa được xử lý bởi người khác.');
    if (c.userId) {
      await this.notifications
        .notify(c.userId, 'EXTERNAL_POINTS_VOIDED', { code: maskClaimCode(c.externalOrder.trackingCode), detail: `điểm chờ không được cộng (${reason})` }, { dedupeKey: `ext-void:${id}` })
        .catch((e: unknown) => this.logger.warn(`Gửi EXTERNAL_POINTS_VOIDED lỗi claim=${id}: ${e instanceof Error ? e.message : e}`));
    }
    return { id, state: 'VOIDED' };
  }

  /** Chỉ ADMIN (controller): thu hồi điểm đã cộng theo min(điểm, phần lô còn, số dư). */
  async reverse(id: string, actorId: string, reason: string): Promise<AdminReverseClaimResponse> {
    const res = await reverseCreditedClaim(this.prisma, id, { reason, actorId });
    if (!res) throw new ConflictException('Claim không còn ở trạng thái đã cộng điểm.');
    const c = await this.prisma.externalPointsClaim.findUnique({ where: { id }, include: { externalOrder: { select: { trackingCode: true } } } });
    if (c?.userId) {
      await this.notifications
        .notify(
          c.userId,
          'EXTERNAL_POINTS_VOIDED',
          { code: maskClaimCode(c.externalOrder.trackingCode), detail: res.reversedPoints > 0 ? `${formatPoints(res.reversedPoints)} Điểm Xanh đã cộng được thu hồi` : 'điểm đã cộng không còn gì để thu hồi' },
          { dedupeKey: `ext-reverse:${id}` },
        )
        .catch((e: unknown) => this.logger.warn(`Gửi EXTERNAL_POINTS_VOIDED lỗi claim=${id}: ${e instanceof Error ? e.message : e}`));
    }
    return res;
  }

  /** Gắn lần gửi mã chưa thấy đơn vào một đơn Pancake cụ thể. Nhân viên đã xác minh nên bỏ qua trần ngày/tháng; claim vào thẳng PENDING. */
  async attach(attemptId: string, pancakeOrderId: string, actorId: string, now: Date = new Date()): Promise<{ claimId: string }> {
    const cfg = await loadClaimConfig(this.config);
    const out = await this.prisma.$transaction(async (tx) => {
      const attempt = await tx.externalClaimAttempt.findUnique({ where: { id: attemptId } });
      if (!attempt) throw new NotFoundException('Không tìm thấy lần gửi mã.');
      await advisoryUserLock(tx, attempt.userId);
      const fresh = await tx.externalClaimAttempt.findUnique({ where: { id: attemptId } });
      if (!fresh || fresh.resolvedAt || fresh.result !== 'UNMATCHED') throw new ConflictException('Lần gửi mã này đã được xử lý.');
      const found = await tx.externalOrder.findUnique({ where: { pancakeOrderId }, select: { id: true } });
      if (!found) throw new NotFoundException('Không tìm thấy đơn Pancake này trong "Đơn ngoài app".');
      await tx.$queryRaw`SELECT "id" FROM "external_orders" WHERE "id" = ${found.id} FOR UPDATE`;
      const order = await tx.externalOrder.findUniqueOrThrow({ where: { id: found.id } });
      if (order.source === 'CHAT') throw new BadRequestException('Đơn chat được cộng điểm theo SĐT, không gắn theo mã.');
      if (['RETURNED', 'CANCELLED', 'DELETED'].includes(order.status)) throw new BadRequestException('Đơn đã bị huỷ hoặc hoàn trên sàn.');
      const points = claimPoints(order.goodsValue, cfg.earnPct);
      if (points === null || points <= 0) throw new BadRequestException('Đơn chưa có tiền hàng hợp lệ để tính điểm.');
      const existing = await tx.externalPointsClaim.findUnique({ where: { externalOrderId: order.id }, select: { id: true, state: true, claimedCode: true, decidedById: true } });
      const reopenable = existing && existing.state === 'VOIDED' && existing.claimedCode === null && existing.decidedById !== null;
      if (existing && !reopenable) throw new ConflictException('Đơn này đã có claim.');
      const releaseAt = order.status === 'DELIVERED' && order.deliveredAt ? new Date(order.deliveredAt.getTime() + cfg.pendingDays * 864e5) : null;
      const data = {
        userId: attempt.userId,
        kind: 'SCAN' as const,
        state: 'PENDING' as const,
        ratePct: cfg.earnPct,
        multiplier: 1,
        points,
        countsForTier: false,
        claimedCode: attempt.code,
        releaseAt,
        reviewReason: null,
        voidReason: null,
        decidedById: actorId,
        dayKey: vnDateKey(now),
      };
      let claimId: string | null = null;
      if (existing && reopenable) {
        const r = await tx.externalPointsClaim.updateMany({ where: { id: existing.id, state: 'VOIDED', claimedCode: null }, data: { ...data, createdAt: now, creditedAt: null, pointsTxId: null } });
        if (r.count === 1) claimId = existing.id;
      } else {
        const rows = await tx.externalPointsClaim.createManyAndReturn({ data: [{ ...data, externalOrderId: order.id }], skipDuplicates: true, select: { id: true } });
        claimId = rows[0]?.id ?? null;
      }
      if (!claimId) throw new ConflictException('Mã này đã được tích cho đơn khác.');
      // Nhân viên đã xác minh đơn là đơn sàn: dòng UNKNOWN trở thành đơn sàn để hiện đúng ở các màn khác.
      if (order.source === 'UNKNOWN') await tx.externalOrder.update({ where: { id: order.id }, data: { source: 'MARKETPLACE' } });
      await tx.externalClaimAttempt.updateMany({
        where: { id: attemptId, resolvedAt: null },
        data: { result: 'MATCHED', resolvedAt: now, resolvedById: actorId, externalOrderId: order.id, note: 'Nhân viên gắn đơn' },
      });
      return { claimId, userId: attempt.userId, points, channel: order.channel, trackingCode: order.trackingCode, releaseAt };
    });
    await this.claims.notifyPending(out.userId, {
      claimId: out.claimId,
      state: 'PENDING',
      points: out.points,
      channel: out.channel,
      maskedCode: maskClaimCode(out.trackingCode),
      expectedCreditAt: out.releaseAt,
    });
    return { claimId: out.claimId };
  }

  /** Từ chối lần gửi mã: báo khách "chưa tìm thấy đơn". */
  async rejectAttempt(attemptId: string, actorId: string, note: string | undefined, now: Date = new Date()): Promise<{ id: string }> {
    const attempt = await this.prisma.externalClaimAttempt.findUnique({ where: { id: attemptId } });
    if (!attempt) throw new NotFoundException('Không tìm thấy lần gửi mã.');
    const res = await this.prisma.externalClaimAttempt.updateMany({
      where: { id: attemptId, result: 'UNMATCHED', resolvedAt: null },
      data: { result: 'REJECTED_ADMIN', resolvedAt: now, resolvedById: actorId, note: note?.trim() || 'Nhân viên từ chối' },
    });
    if (res.count !== 1) throw new ConflictException('Lần gửi mã này đã được xử lý.');
    await this.notifications
      .notify(attempt.userId, 'EXTERNAL_POINTS_CLAIM_NOT_FOUND', { code: maskClaimCode(attempt.code), detail: 'Tubu Tree chưa tìm thấy đơn tương ứng' }, { dedupeKey: `ext-nf:${attemptId}` })
      .catch((e: unknown) => this.logger.warn(`Gửi CLAIM_NOT_FOUND lỗi attempt=${attemptId}: ${e instanceof Error ? e.message : e}`));
    return { id: attemptId };
  }
}
