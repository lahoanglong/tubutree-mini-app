import { BadRequestException, ConflictException, ForbiddenException, Injectable, Logger, NotFoundException, Optional } from '@nestjs/common';
import type { ExternalClaimState, Prisma } from '@prisma/client';
import type {
  AdminExternalAttemptListResponse,
  AdminExternalAttemptOtherSubmitter,
  AdminExternalClaimDetail,
  AdminExternalClaimListResponse,
  AdminExternalClaimRow,
  AdminReverseClaimResponse,
} from '@tubutree/shared-types';
import { formatPoints } from '../../common/format-points';
import { maskPhoneOrNull, maskVnPhonesInText } from '../../common/mask-pii';
import { paginated, skipTake } from '../../common/pagination';
import { parseTypedVnPhone } from '../../common/phone';
import { startOfNextVnMonth, startOfVnMonth, vnDateKey } from '../../common/vn-time';
import { PrismaService } from '../../prisma/prisma.service';
import { LoyaltyService } from '../loyalty/loyalty.service';
import { NotificationsService } from '../notifications/notifications.service';
import { SystemConfigService } from '../system-config/system-config.service';
import { loadClaimConfig } from './external-claim.config';
import { advisoryPhoneLock, chatMonthPoints, tierMultiplierOf } from './external-chat.claim';
import { loadChatConfig, loadStaffMap } from './external-chat.config';
import { MIN_NOTE_CHARS, noteContentLength, stripInvisible } from './external-claim-note';
import { isSameAsPancakeCreator, phoneVerifiedFresh, STALE_APPROVE_MARK } from './external-chat.rules';
import { canonicalUserId, claimIntroducers, recordClaimEvent } from './external-claim-audit';
import { lockOrderThenClaim, reverseCreditedClaim } from './external-claim-status';
import { evaluateClaimRules, settlePoints } from './external-claim.rules';
import { advisoryUserLock, type CreatedClaim, ExternalClaimService, rejectionOf, USER_SELECT } from './external-claim.service';
import { closedCreditedWhere, stalePendingWhere, UNMATCHED_RETRY_DAYS_FOR_ATTENTION } from './external-points-attention';
import { normalizeTrackingCode, pancakeCreatorRefs } from './external-order.mapper';
import { claimCodeLabel, claimPoints, maskClaimCode } from './external-points-rate';

/** Người gửi trùng mã còn được liệt kê cho CSKH trong chừng này ngày, kể cả lượt đã đóng. */
const OTHER_SUBMITTER_DAYS = 30;

const UNPAID: ExternalClaimState[] = ['PENDING', 'REVIEW', 'HELD_NO_MEMBER'];

interface MemberInfo {
  name: string | null;
  phone: string | null;
  phoneVerifiedAt: Date | null;
  createdAt: Date;
  deliveredAppOrders: number;
}

export interface AdminClaimListQuery {
  page: number;
  limit: number;
  state?: ExternalClaimState;
  /** SCAN = đơn sàn khách tự nhập mã; PHONE = đơn chat/điện thoại tự cộng theo SĐT. Bỏ trống = cả hai. */
  kind?: 'SCAN' | 'PHONE';
  /** Lọc đúng các dòng "Cần xử lý" đang đếm: claim đã cộng mà đơn đã đóng, hoặc PENDING không tới hạn. */
  attention?: 'closed_credited' | 'stale';
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
    // Đơn chat tính vào xét hạng: đảo điểm xong thì tính lại hạng. Thiếu thì chỉ cron đêm tính lại.
    @Optional() private readonly loyalty?: LoyaltyService,
  ) {}

  private rowOf(c: Prisma.ExternalPointsClaimGetPayload<{ include: { externalOrder: true } }>, user: MemberInfo | null, staleAfterMs: number, now: Date): AdminExternalClaimRow {
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
      kind: c.kind,
      state: c.state,
      holdUntil: c.holdUntil?.toISOString() ?? null,
      orderStatus: o.status,
      reviewReason: c.reviewReason,
      voidReason: c.voidReason,
      decidedById: c.decidedById,
      deliveredAt: o.deliveredAt?.toISOString() ?? null,
      creditedAt: c.creditedAt?.toISOString() ?? null,
      createdAt: c.createdAt.toISOString(),
      // Chỉ claim PHONE đã có thành viên: người kiểm đối chiếu người nhận với lý do REVIEW (SĐT cũ, nhân viên...).
      memberPhoneVerifiedAt: c.kind === 'PHONE' && user ? (user.phoneVerifiedAt?.toISOString() ?? null) : null,
      memberPhoneStale: c.kind === 'PHONE' && !!user && (!user.phoneVerifiedAt || now.getTime() - user.phoneVerifiedAt.getTime() > staleAfterMs),
      memberCreatedAt: c.kind === 'PHONE' && user ? user.createdAt.toISOString() : null,
      memberDeliveredAppOrders: c.kind === 'PHONE' && user ? user.deliveredAppOrders : null,
    };
  }

  private async usersById(ids: (string | null)[]): Promise<Map<string, MemberInfo>> {
    const unique = [...new Set(ids.filter((i): i is string => !!i))];
    if (unique.length === 0) return new Map();
    const [users, delivered] = await Promise.all([
      this.prisma.user.findMany({ where: { id: { in: unique } }, select: { id: true, fullName: true, phone: true, phoneVerifiedAt: true, createdAt: true } }),
      // Đơn mua trong app đã giao: thành viên đã mua thật thì SĐT đáng tin hơn khi người kiểm xét lý do SĐT cũ.
      this.prisma.order.groupBy({ by: ['userId'], where: { userId: { in: unique }, status: 'DELIVERED' }, _count: { _all: true } }),
    ]);
    const counts = new Map(delivered.map((d) => [d.userId, d._count._all]));
    return new Map(
      users.map((u) => [u.id, { name: u.fullName, phone: u.phone, phoneVerifiedAt: u.phoneVerifiedAt, createdAt: u.createdAt, deliveredAppOrders: counts.get(u.id) ?? 0 }]),
    );
  }

  async list(q: AdminClaimListQuery): Promise<AdminExternalClaimListResponse> {
    const and: Prisma.ExternalPointsClaimWhereInput[] = [];
    if (q.attention === 'closed_credited') and.push(closedCreditedWhere);
    if (q.attention === 'stale') and.push(stalePendingWhere(new Date()));
    const where: Prisma.ExternalPointsClaimWhereInput = { ...(q.state ? { state: q.state } : {}), ...(q.kind ? { kind: q.kind } : {}), ...(and.length ? { AND: and } : {}) };
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
    const staleAfterMs = (await loadChatConfig(this.config)).phoneVerifiedMaxDays * 864e5;
    const now = new Date();
    return paginated(rows.map((r) => this.rowOf(r, users.get(r.userId ?? '') ?? null, staleAfterMs, now)), q.page, q.limit, total);
  }

  async detail(id: string): Promise<AdminExternalClaimDetail> {
    const c = await this.prisma.externalPointsClaim.findUnique({ where: { id }, include: { externalOrder: true } });
    if (!c) throw new NotFoundException('Không tìm thấy claim.');
    const [users, events] = await Promise.all([
      this.usersById([c.userId]),
      this.prisma.externalClaimEvent.findMany({ where: { claimId: id }, orderBy: { createdAt: 'asc' } }),
    ]);
    const staleAfterMs = (await loadChatConfig(this.config)).phoneVerifiedMaxDays * 864e5;
    return {
      ...this.rowOf(c, users.get(c.userId ?? '') ?? null, staleAfterMs, new Date()),
      events: events.map((e) => ({
        id: e.id,
        action: e.action,
        actorId: e.actorId,
        fromState: e.fromState,
        toState: e.toState,
        userIdBefore: e.userIdBefore,
        userIdAfter: e.userIdAfter,
        note: e.note,
        orderStatus: e.orderStatus,
        createdAt: e.createdAt.toISOString(),
      })),
    };
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
    // Người khác cùng gửi mã (lượt NOT_FOUND của họ không nằm trong hàng đợi): hiện ở dòng chờ của người gửi đầu để CSKH biết gắn cho ai.
    const since = new Date(now.getTime() - OTHER_SUBMITTER_DAYS * 864e5);
    const others = rows.length
      ? await this.prisma.externalClaimAttempt.findMany({
          where: { code: { in: [...new Set(rows.map((r) => r.code))] }, result: { in: ['UNMATCHED', 'NOT_FOUND'] }, createdAt: { gte: since } },
          orderBy: { createdAt: 'desc' },
          select: { code: true, userId: true, createdAt: true },
        })
      : [];
    const users = await this.usersById([...rows.map((r) => r.userId), ...others.map((o) => o.userId)]);
    const otherOf = (r: (typeof rows)[number]) => {
      const seen = new Set<string>();
      const list: AdminExternalAttemptOtherSubmitter[] = [];
      for (const o of others) {
        if (o.code !== r.code || o.userId === r.userId || seen.has(o.userId)) continue;
        seen.add(o.userId);
        list.push({ userId: o.userId, userName: users.get(o.userId)?.name ?? null, userPhoneMasked: maskPhoneOrNull(users.get(o.userId)?.phone), createdAt: o.createdAt.toISOString() });
      }
      return list;
    };
    return paginated(
      rows.map((r) => {
        const list = otherOf(r);
        return {
          id: r.id,
          userId: r.userId,
          userName: users.get(r.userId)?.name ?? null,
          userPhoneMasked: maskPhoneOrNull(users.get(r.userId)?.phone),
          maskedCode: maskClaimCode(r.code),
          result: r.result,
          externalOrderId: r.externalOrderId,
          note: r.note,
          createdAt: r.createdAt.toISOString(),
          otherSubmittersCount: list.length,
          otherSubmitters: list.slice(0, 10),
        };
      }),
      page,
      limit,
      total,
    );
  }

  /** So hai phía sau khi quy về user gốc (`mergedIntoId`): người làm là tài khoản đã gộp của chủ claim cũng bị chặn. */
  private async forbidSelf(actorId: string, ownerId: string | null, db: Pick<Prisma.TransactionClient, 'user'> = this.prisma): Promise<void> {
    if (!ownerId) return;
    if (ownerId === actorId || (await canonicalUserId(db, ownerId)) === (await canonicalUserId(db, actorId))) throw new ForbiddenException({ code: 'SELF_ACTION', message: 'Bạn không được xử lý claim hay lần gửi mã của chính mình.' });
  }

  /**
   * Người tạo hoặc phụ trách đơn trên Pancake không được duyệt điểm cho đơn đó. Chắc chắn khi chủ shop khai báo `pancake.staff_map`
   * (id tài khoản Pancake → userId); chưa khai báo thì chỉ so tên đã bỏ dấu với người tạo trong payload. Payload không có người tạo thì
   * không chặn được (giới hạn, xem tài liệu chatpts).
   */
  private async forbidPancakeCreator(tx: Pick<Prisma.TransactionClient, 'user'>, actorId: string, payload: Prisma.JsonValue): Promise<void> {
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return;
    const refs = pancakeCreatorRefs(payload as Record<string, unknown>);
    if (refs.length === 0) return;
    const actor = await tx.user.findUnique({ where: { id: actorId }, select: { id: true, fullName: true } });
    if (actor && isSameAsPancakeCreator(actor, refs, await loadStaffMap(this.config))) {
      throw new ForbiddenException({ code: 'PANCAKE_CREATOR_SELF', message: 'Người tạo hoặc phụ trách đơn trên Pancake không được tự duyệt điểm của đơn đó.' });
    }
  }

  /**
   * REVIEW sang PENDING. Người duyệt không được là chủ claim, người gắn đơn hay người đã đưa claim vào REVIEW. Điểm tính lại theo tiền
   * hàng mới nhất và kiểm lại trần tháng; đơn hoàn một phần được duyệt thì đặt mốc cộng = bây giờ + hạn giữ để cron cộng được.
   */
  async approve(id: string, actorId: string, now: Date = new Date(), note?: string): Promise<{ id: string; state: 'PENDING' }> {
    const cfg = await loadClaimConfig(this.config);
    const chatCfg = await loadChatConfig(this.config);
    const head = await this.prisma.externalPointsClaim.findUnique({ where: { id }, select: { userId: true, kind: true, orderPhone: true, externalOrder: { select: { phone: true } } } });
    if (!head) throw new NotFoundException('Không tìm thấy claim.');
    await this.forbidSelf(actorId, head.userId);
    const out = await this.prisma.$transaction(async (tx) => {
      // Claim chat khoá theo SĐT (trần tháng tính theo SĐT), claim đơn sàn khoá theo khách như cũ.
      if (head.kind === 'PHONE') {
        const lockPhone = head.orderPhone ?? head.externalOrder.phone;
        if (lockPhone) await advisoryPhoneLock(tx, lockPhone);
      } else if (head.userId) {
        await advisoryUserLock(tx, head.userId);
      }
      if (!(await lockOrderThenClaim(tx, id))) throw new NotFoundException('Không tìm thấy claim.');
      await tx.$queryRaw`SELECT "id" FROM "external_points_claims" WHERE "id" = ${id} FOR UPDATE`;
      const c = await tx.externalPointsClaim.findUniqueOrThrow({ where: { id }, include: { externalOrder: true } });
      if (c.state !== 'REVIEW') throw new ConflictException('Claim không ở trạng thái chờ duyệt.');
      // Liên kết và releaseClaim chỉ đọc orderPhone của claim, không đọc SĐT hiện trên đơn (webhook đầy đủ có thể ghi lại SĐT đơn sau khi
      // retention đã xoá): claim chưa có chủ mà orderPhone đã mất thì không ai liên kết được, cron đưa về REVIEW mỗi lần và duyệt chỉ lặp vô ích.
      if (c.kind === 'PHONE' && !c.userId && !c.orderPhone) {
        throw new BadRequestException('Claim chưa có chủ và không còn SĐT để liên kết nên không có ai để cộng điểm. Hãy huỷ claim.');
      }
      await this.forbidSelf(actorId, c.userId, tx);
      const actorRoot = await canonicalUserId(tx, actorId);
      let introduced = false;
      for (const i of await claimIntroducers(tx, id)) if (i === actorId || (await canonicalUserId(tx, i)) === actorRoot) introduced = true;
      if (introduced) throw new ForbiddenException({ code: 'SAME_INTRODUCER', message: 'Người gắn đơn hoặc đưa claim vào chờ duyệt không được tự duyệt claim đó.' });
      const o = c.externalOrder;
      if (['RETURNED', 'CANCELLED', 'DELETED'].includes(o.status)) throw new BadRequestException('Đơn đã bị huỷ hoặc hoàn trên sàn nên không duyệt được.');
      if (c.kind === 'PHONE') await this.forbidPancakeCreator(tx, actorId, o.lastPayload);
      // Duyệt là một lần kiểm: điểm tính lại theo tiền hàng và hạng HIỆN TẠI, rồi lưu cả hai làm mốc đã kiểm để releaseClaim cộng đúng
      // số này (không tính lại lên). Claim chưa có chủ giữ hệ số cũ.
      let multiplier = Number(c.multiplier);
      let staleNote: string | null = null;
      if (c.kind === 'PHONE' && c.userId) {
        const m = await tx.user.findUnique({ where: { id: c.userId }, select: { phoneVerifiedAt: true, tier: { select: { pointMultiplier: true } } } });
        if (m) {
          multiplier = tierMultiplierOf(m);
          // Mốc xác minh vẫn cũ lúc duyệt (bất kể lý do REVIEW): người duyệt phải ghi đã xác nhận người nhận bằng cách nào (Mini App không tự
          // xin lại số), nếu không claim đã duyệt vẫn bị kiểm lại SĐT lúc cộng. Ký tự vô hình không tính; SĐT đầy đủ trong ghi chú bị che.
          if (!phoneVerifiedFresh(m.phoneVerifiedAt, { now, maxDays: chatCfg.phoneVerifiedMaxDays })) {
            const clean = stripInvisible(note ?? '').trim();
            if (noteContentLength(clean) < MIN_NOTE_CHARS) throw new BadRequestException({ code: 'NOTE_REQUIRED', message: 'SĐT xác minh của thành viên đã cũ: cần ghi chú cách bạn đã xác nhận người nhận.' });
            staleNote = `${STALE_APPROVE_MARK}: ${maskVnPhonesInText(clean)}`;
          }
        }
      }
      const fullPoints = claimPoints(o.goodsValue, Number(c.ratePct), multiplier);
      if (fullPoints === null || fullPoints <= 0) throw new BadRequestException('Đơn chưa có tiền hàng hợp lệ để tính điểm.');
      let points = fullPoints;
      if (c.kind === 'PHONE') {
        // Trần tháng theo SĐT. Không có SĐT (đã xoá khỏi đơn) thì không còn gì để cộng dồn: duyệt nguyên điểm.
        const capPhone = c.orderPhone ?? o.phone;
        if (capPhone) {
          const others = await chatMonthPoints(tx, { phone: capPhone, userId: c.userId, since: startOfVnMonth(c.createdAt), until: startOfNextVnMonth(c.createdAt), excludeClaimId: id });
          points = settlePoints({ newPoints: fullPoints, checkedPoints: c.points, others, cap: chatCfg.monthlyPointsCap });
          if (points <= 0) throw rejectionOf('MONTHLY_CAP');
        }
      } else if (c.userId) {
        const month = await tx.externalPointsClaim.aggregate({
          where: { userId: c.userId, kind: 'SCAN', id: { not: id }, createdAt: { gte: startOfVnMonth(c.createdAt), lt: startOfNextVnMonth(c.createdAt) }, state: { in: ['PENDING', 'REVIEW', 'CREDITED'] } },
          _sum: { points: true },
        });
        // Duyệt ở mức chốt thay vì ném lỗi: khách không mất phần điểm hợp lệ. Hết chỗ trần (chốt = 0) thì mới từ chối.
        points = settlePoints({ newPoints: fullPoints, checkedPoints: c.points, others: month._sum.points ?? 0, cap: cfg.monthlyPointsCap });
        if (points <= 0) throw rejectionOf('MONTHLY_CAP');
      }
      const releaseAt =
        o.status === 'DELIVERED' && o.deliveredAt ? new Date(o.deliveredAt.getTime() + cfg.pendingDays * 864e5) : o.status === 'PARTIAL_RETURN' ? new Date(now.getTime() + cfg.pendingDays * 864e5) : null;
      const res = await tx.externalPointsClaim.updateMany({ where: { id, state: 'REVIEW' }, data: { state: 'PENDING', points, releaseAt, decidedById: actorId, reviewReason: null, ...(c.kind === 'PHONE' ? { multiplier, creditedGoodsValue: o.goodsValue } : {}) } });
      if (res.count !== 1) throw new ConflictException('Claim vừa được xử lý bởi người khác.');
      await recordClaimEvent(tx, { claimId: id, action: 'APPROVE', actorId, orderStatus: o.status, fromState: 'REVIEW', toState: 'PENDING', userIdBefore: c.userId, userIdAfter: c.userId, note: [points < fullPoints ? `Chốt theo trần tháng: ${points} thay vì ${fullPoints} điểm` : `${points} điểm`, staleNote].filter(Boolean).join(' | ') });
      return { userId: c.userId, points, channel: o.channel, trackingCode: o.trackingCode, releaseAt, kind: c.kind };
    });
    // Đơn chat không có chuyện báo "điểm chờ" ở bước duyệt: khách chỉ được báo khi điểm đã cộng (hoặc lúc liên kết SĐT).
    if (out.userId && out.kind === 'SCAN') {
      await this.claims.notifyPending(out.userId, { claimId: id, state: 'PENDING', points: out.points, channel: out.channel, maskedCode: maskClaimCode(out.trackingCode), expectedCreditAt: out.releaseAt } satisfies CreatedClaim);
    }
    return { id, state: 'PENDING' };
  }

  /** Huỷ claim chưa cộng. `reopen`: giải phóng mã để đơn được tích lại; claim giữ userId cũ làm dấu vết, nhật ký ghi ai huỷ và (sau này) ai nhận lại. */
  async voidClaim(id: string, actorId: string, reason: string, reopen: boolean): Promise<{ id: string; state: 'VOIDED' }> {
    const head = await this.prisma.externalPointsClaim.findUnique({ where: { id }, select: { userId: true } });
    if (!head) throw new NotFoundException('Không tìm thấy claim.');
    await this.forbidSelf(actorId, head.userId);
    const c = await this.prisma.$transaction(async (tx) => {
      if (!(await lockOrderThenClaim(tx, id))) throw new NotFoundException('Không tìm thấy claim.');
      await tx.$queryRaw`SELECT "id" FROM "external_points_claims" WHERE "id" = ${id} FOR UPDATE`;
      const cur = await tx.externalPointsClaim.findUniqueOrThrow({ where: { id }, include: { externalOrder: { select: { trackingCode: true } } } });
      if (cur.state === 'CREDITED') throw new ConflictException('Claim đã cộng điểm, hãy dùng "Đảo điểm" (chỉ ADMIN).');
      if (!UNPAID.includes(cur.state)) throw new ConflictException('Claim không còn ở trạng thái chưa cộng.');
      await this.forbidSelf(actorId, cur.userId, tx);
      const res = await tx.externalPointsClaim.updateMany({
        where: { id, state: { in: UNPAID } },
        data: { state: 'VOIDED', voidReason: reopen ? `Huỷ và mở lại mã: ${reason}` : reason, decidedById: actorId, ...(reopen ? { claimedCode: null } : {}) },
      });
      if (res.count !== 1) throw new ConflictException('Claim vừa được xử lý bởi người khác.');
      await recordClaimEvent(tx, { claimId: id, action: reopen ? 'VOID_REOPEN' : 'VOID', actorId, fromState: cur.state, toState: 'VOIDED', userIdBefore: cur.userId, userIdAfter: cur.userId, note: reason });
      return cur;
    });
    if (c.userId) {
      await this.notifications
        .notify(c.userId, 'EXTERNAL_POINTS_VOIDED', { code: claimCodeLabel(c.externalOrder.trackingCode, c.kind), detail: `điểm chờ không được cộng (${reason})` }, { dedupeKey: `ext-void:${id}` })
        .catch((e: unknown) => this.logger.warn(`Gửi EXTERNAL_POINTS_VOIDED lỗi claim=${id}: ${e instanceof Error ? e.message : e}`));
    }
    return { id, state: 'VOIDED' };
  }

  /** Chỉ ADMIN (controller): thu hồi điểm đã cộng theo min(điểm, phần lô còn, số dư). */
  async reverse(id: string, actorId: string, reason: string): Promise<AdminReverseClaimResponse> {
    const head = await this.prisma.externalPointsClaim.findUnique({ where: { id }, select: { userId: true, kind: true } });
    if (!head) throw new NotFoundException('Không tìm thấy claim.');
    await this.forbidSelf(actorId, head.userId);
    const res = await reverseCreditedClaim(this.prisma, id, { reason, actorId });
    if (!res) throw new ConflictException('Claim không còn ở trạng thái đã cộng điểm.');
    if (head.kind === 'PHONE' && head.userId && this.loyalty) {
      await this.loyalty.recalcTier(head.userId).catch((e: unknown) => this.logger.warn(`recalcTier sau đảo điểm chat lỗi claim=${id}: ${e instanceof Error ? e.message : e}`));
    }
    const c = await this.prisma.externalPointsClaim.findUnique({ where: { id }, include: { externalOrder: { select: { trackingCode: true } } } });
    if (c?.userId) {
      await this.notifications
        .notify(
          c.userId,
          'EXTERNAL_POINTS_VOIDED',
          { code: claimCodeLabel(c.externalOrder.trackingCode, c.kind), detail: res.reversedPoints > 0 ? `${formatPoints(res.reversedPoints)} Điểm Xanh đã cộng được thu hồi` : 'điểm đã cộng không còn gì để thu hồi' },
          { dedupeKey: `ext-reverse:${id}` },
        )
        .catch((e: unknown) => this.logger.warn(`Gửi EXTERNAL_POINTS_VOIDED lỗi claim=${id}: ${e instanceof Error ? e.message : e}`));
    }
    return res;
  }

  /** Chỉ ADMIN (controller): đơn đã cộng bị hoàn một phần, giữ nguyên điểm và gỡ cờ "Cần xử lý". Không thu hồi một phần. */
  async keepPoints(id: string, actorId: string, note: string): Promise<{ id: string }> {
    const head = await this.prisma.externalPointsClaim.findUnique({ where: { id }, select: { userId: true } });
    if (!head) throw new NotFoundException('Không tìm thấy claim.');
    await this.forbidSelf(actorId, head.userId);
    await this.prisma.$transaction(async (tx) => {
      if (!(await lockOrderThenClaim(tx, id))) throw new NotFoundException('Không tìm thấy claim.');
      await tx.$queryRaw`SELECT "id" FROM "external_points_claims" WHERE "id" = ${id} FOR UPDATE`;
      const res = await tx.externalPointsClaim.updateMany({ where: { id, state: 'CREDITED', reviewReason: { not: null } }, data: { reviewReason: null } });
      if (res.count !== 1) throw new ConflictException({ code: 'NOT_FLAGGED', message: 'Claim không có cờ cần xử lý (đã cộng, đơn hoàn một phần).' });
      await recordClaimEvent(tx, { claimId: id, action: 'KEEP_POINTS', actorId, fromState: 'CREDITED', toState: 'CREDITED', userIdBefore: head.userId, userIdAfter: head.userId, note });
    });
    return { id };
  }

  /**
   * Gắn lần gửi mã chưa thấy đơn vào một đơn Pancake. Chạy đủ luật của một lần gửi mã (tuổi đơn, external_since, trần ngày/tháng,
   * ngưỡng REVIEW, 3 số cuối SĐT) trừ giới hạn lần thử/ngày. Mã của lần gửi phải trùng mã của đơn; không trùng, hoặc đơn nguồn UNKNOWN,
   * thì chỉ ADMIN và phải có ghi chú. REVIEW vẫn là REVIEW: người gắn không tự duyệt được.
   */
  async attach(attemptId: string, pancakeOrderId: string, actor: { id: string; role: string }, note: string | undefined, now: Date = new Date()): Promise<{ claimId: string; state: 'PENDING' | 'REVIEW' }> {
    const cfg = await loadClaimConfig(this.config);
    const reason = note?.trim() || null;
    const isAdmin = actor.role === 'ADMIN';
    const out = await this.prisma.$transaction(async (tx) => {
      const attempt = await tx.externalClaimAttempt.findUnique({ where: { id: attemptId } });
      if (!attempt) throw new NotFoundException('Không tìm thấy lần gửi mã.');
      await this.forbidSelf(actor.id, attempt.userId, tx);
      await advisoryUserLock(tx, attempt.userId);
      const fresh = await tx.externalClaimAttempt.findUnique({ where: { id: attemptId } });
      if (!fresh || fresh.resolvedAt || fresh.result !== 'UNMATCHED') throw new ConflictException('Lần gửi mã này đã được xử lý.');
      const found = await tx.externalOrder.findUnique({ where: { pancakeOrderId }, select: { id: true } });
      if (!found) throw new NotFoundException('Không tìm thấy đơn Pancake này trong "Đơn ngoài app".');
      const user = await tx.user.findUnique({ where: { id: attempt.userId }, select: USER_SELECT });
      const g = await this.claims.gatherFacts(tx, user, attempt.code, cfg, now, { skipAttemptLimits: true, orderId: found.id });
      const order = g.order;
      if (!order || !g.facts.order) throw new NotFoundException('Không tìm thấy đơn Pancake này trong "Đơn ngoài app".');

      const orderCodes = [...order.trackingCodes, order.trackingCode, order.marketplaceOrderSn].map((c) => normalizeTrackingCode(c)).filter((c): c is string => !!c);
      const needsAdmin: string[] = [];
      if (!orderCodes.includes(attempt.code)) needsAdmin.push('mã khách gửi không trùng mã trên đơn');
      if (order.source === 'UNKNOWN') needsAdmin.push('nguồn đơn chưa xác định');
      if (needsAdmin.length > 0) {
        if (!isAdmin) throw new ForbiddenException({ code: 'ATTACH_ADMIN_ONLY', message: `Chỉ ADMIN được gắn khi ${needsAdmin.join(' và ')}.` });
        if (!reason) throw new BadRequestException({ code: 'NOTE_REQUIRED', message: `Cần ghi chú lý do khi ${needsAdmin.join(' và ')}.` });
      }
      // Nguồn UNKNOWN đã được ADMIN xác nhận bằng ghi chú; chỉ đổi cách luật nhìn đơn, không sửa dòng đơn.
      if (g.facts.order.source === 'UNKNOWN') g.facts.order = { ...g.facts.order, source: 'MARKETPLACE' };
      const decision = evaluateClaimRules(g.facts);
      if (decision.kind === 'REJECT') throw rejectionOf(decision.code);
      if (decision.kind !== 'CLAIM') throw new ConflictException('Khách đã có claim cho mã này.');

      const releaseAt = order.status === 'DELIVERED' && order.deliveredAt ? new Date(order.deliveredAt.getTime() + cfg.pendingDays * 864e5) : null;
      const data = {
        userId: attempt.userId,
        kind: 'SCAN' as const,
        state: decision.state,
        ratePct: cfg.earnPct,
        multiplier: 1,
        points: decision.points,
        countsForTier: false,
        claimedCode: attempt.code,
        releaseAt,
        reviewReason: decision.reviewReason,
        voidReason: null,
        // REVIEW chưa có người duyệt: decidedById chỉ đặt khi claim vào thẳng PENDING.
        decidedById: decision.state === 'PENDING' ? actor.id : null,
        dayKey: vnDateKey(now),
      };
      let claimId: string | null = null;
      if (g.existingClaimId) {
        const r = await tx.externalPointsClaim.updateMany({ where: { id: g.existingClaimId, state: 'VOIDED', claimedCode: null }, data: { ...data, createdAt: now, creditedAt: null, pointsTxId: null } });
        if (r.count === 1) claimId = g.existingClaimId;
      } else {
        const rows = await tx.externalPointsClaim.createManyAndReturn({ data: [{ ...data, externalOrderId: order.id }], skipDuplicates: true, select: { id: true } });
        claimId = rows[0]?.id ?? null;
      }
      if (!claimId) throw new ConflictException('Mã này đã được tích cho đơn khác.');
      await recordClaimEvent(tx, {
        claimId,
        action: 'ATTACH',
        actorId: actor.id,
        orderStatus: order.status,
        fromState: g.existingClaimId ? 'VOIDED' : null,
        toState: decision.state,
        userIdBefore: g.existingClaimId ? g.existingClaimOwnerId : null,
        userIdAfter: attempt.userId,
        note: [reason, decision.reviewReason].filter(Boolean).join(' | ') || null,
      });
      await tx.externalClaimAttempt.updateMany({
        where: { id: attemptId, resolvedAt: null },
        data: { result: 'MATCHED', resolvedAt: now, resolvedById: actor.id, externalOrderId: order.id, note: reason ? `Nhân viên gắn đơn: ${reason}` : 'Nhân viên gắn đơn' },
      });
      return { claimId, state: decision.state, userId: attempt.userId, points: decision.points, channel: order.channel, trackingCode: order.trackingCode, releaseAt };
    });
    await this.claims.notifyPending(out.userId, {
      claimId: out.claimId,
      state: out.state,
      points: out.points,
      channel: out.channel,
      maskedCode: maskClaimCode(out.trackingCode),
      expectedCreditAt: out.releaseAt,
    });
    return { claimId: out.claimId, state: out.state };
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
