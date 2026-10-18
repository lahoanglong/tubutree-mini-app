import { HttpException, HttpStatus, Injectable, Logger } from '@nestjs/common';
import type { ExternalOrderStatus, Prisma } from '@prisma/client';
import type {
  ExternalClaimRejectCode,
  MyExternalClaimItem,
  MyExternalClaimsResponse,
  SubmitExternalClaimResponse,
} from '@tubutree/shared-types';
import { formatPoints } from '../../common/format-points';
import { paginated, skipTake } from '../../common/pagination';
import { isRealUser } from '../../common/real-user';
import { startOfVnMonth, vnDateKey } from '../../common/vn-time';
import { PrismaService } from '../../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { SystemConfigService } from '../system-config/system-config.service';
import { loadClaimConfig, type ClaimConfig } from './external-claim.config';
import { ExternalClaimLookupService } from './external-claim-lookup.service';
import { evaluateClaimRules, lockedUntil, type ClaimDecision, type ClaimFacts } from './external-claim.rules';
import { normalizeTrackingCode } from './external-order.mapper';
import { UNMATCHED_RETRY_DAYS_FOR_ATTENTION } from './external-points-attention';
import { maskClaimCode } from './external-points-rate';

const DAY_MS = 864e5;
export const UNMATCHED_RETRY_DAYS = UNMATCHED_RETRY_DAYS_FOR_ATTENTION;
const REMATCH_BATCH = 50;

type Tx = Prisma.TransactionClient;

/** Lý do không ghi vào attempt: khách chưa được tính là "đã thử" (cờ tắt, không đủ điều kiện, đang bị khoá, hết lần). */
const UNRECORDED: readonly ExternalClaimRejectCode[] = ['DISABLED', 'NOT_ELIGIBLE_USER', 'LOCKED', 'DAILY_ATTEMPTS'];

export const REJECT_HTTP: Record<ExternalClaimRejectCode, { status: HttpStatus; message: string }> = {
  DISABLED: { status: HttpStatus.NOT_FOUND, message: 'Tính năng tích điểm đơn mua ngoài app chưa mở.' },
  NOT_ELIGIBLE_USER: { status: HttpStatus.FORBIDDEN, message: 'Bạn cần đăng nhập Zalo và cung cấp số điện thoại để tích điểm đơn mua ngoài app.' },
  INVALID_CODE: { status: HttpStatus.BAD_REQUEST, message: 'Mã không hợp lệ. Hãy nhập mã vận đơn hoặc mã đơn trên sàn (8 đến 30 chữ và số).' },
  LOCKED: { status: HttpStatus.TOO_MANY_REQUESTS, message: 'Bạn đã nhập mã chưa tìm thấy quá nhiều lần. Vui lòng thử lại sau 24 giờ hoặc liên hệ Tubu Tree.' },
  DAILY_ATTEMPTS: { status: HttpStatus.TOO_MANY_REQUESTS, message: 'Hôm nay bạn đã nhập mã quá số lần cho phép. Hãy thử lại vào ngày mai.' },
  APP_ORDER: { status: HttpStatus.CONFLICT, message: 'Đây là đơn bạn mua trong Mini App, điểm đã được tích tự động khi đơn giao thành công.' },
  CHAT_ORDER: { status: HttpStatus.CONFLICT, message: 'Đơn đặt qua tư vấn viên được cộng điểm tự động theo số điện thoại, bạn không cần nhập mã.' },
  TOO_OLD: { status: HttpStatus.BAD_REQUEST, message: 'Đơn này đã quá thời hạn được tích điểm.' },
  BEFORE_SINCE: { status: HttpStatus.BAD_REQUEST, message: 'Đơn này được đặt trước thời điểm bắt đầu chương trình tích điểm.' },
  CLOSED: { status: HttpStatus.BAD_REQUEST, message: 'Đơn này đã bị huỷ hoặc hoàn nên không được tích điểm.' },
  ALREADY_CLAIMED: { status: HttpStatus.CONFLICT, message: 'Mã này đã được tích điểm.' },
  DAILY_MAX: { status: HttpStatus.TOO_MANY_REQUESTS, message: 'Hôm nay bạn đã tích đủ số đơn cho phép. Hãy quay lại vào ngày mai.' },
  MONTHLY_CAP: { status: HttpStatus.TOO_MANY_REQUESTS, message: 'Bạn đã đạt mức điểm tối đa từ đơn mua ngoài app trong tháng này.' },
  ZERO_POINTS: { status: HttpStatus.BAD_REQUEST, message: 'Giá trị đơn quá nhỏ để quy ra Điểm Xanh.' },
};

export function rejectionOf(code: ExternalClaimRejectCode): HttpException {
  const r = REJECT_HTTP[code];
  return new HttpException({ statusCode: r.status, error: code, code, message: r.message }, r.status);
}

interface UserRow {
  id: string;
  phone: string | null;
  zaloId: string | null;
  isBlocked: boolean;
}

export interface ClaimOrderRow {
  id: string;
  pancakeOrderId: string;
  source: 'MARKETPLACE' | 'CHAT' | 'UNKNOWN';
  channel: string | null;
  status: ExternalOrderStatus;
  trackingCode: string | null;
  goodsValue: number | null;
  phoneLast3: string | null;
  pancakeInsertedAt: Date | null;
  firstSeenAt: Date;
  deliveredAt: Date | null;
}

export interface CreatedClaim {
  claimId: string;
  state: 'PENDING' | 'REVIEW';
  points: number;
  channel: string | null;
  maskedCode: string;
  expectedCreditAt: Date | null;
}

export type Persisted =
  | { kind: 'REJECT'; code: ExternalClaimRejectCode }
  | { kind: 'SEARCHING' }
  | { kind: 'UNKNOWN_SOURCE' }
  | { kind: 'CLAIM'; created: CreatedClaim };

const last3 = (phone: string | null): string | null => (phone && phone.length >= 3 ? phone.slice(-3) : null);

/** Tìm đơn ngoài theo mã đã chuẩn hoá: mã vận đơn hoặc mã đơn sàn. Đơn sàn thắng khi một mã khớp nhiều dòng. */
export function findExternalOrderByCode(db: Pick<Tx, 'externalOrder'>, code: string) {
  return db.externalOrder.findFirst({
    where: { OR: [{ trackingCodes: { has: code } }, { marketplaceOrderSn: code }] },
    orderBy: [{ source: 'asc' }, { firstSeenAt: 'desc' }],
  });
}

export const advisoryUserLock = (tx: Tx, userId: string) => tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`ext-claim:${userId}`}))`;

const USER_SELECT = { id: true, phone: true, zaloId: true, isBlocked: true } as const;

@Injectable()
export class ExternalClaimService {
  private readonly logger = new Logger(ExternalClaimService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: SystemConfigService,
    private readonly lookup: ExternalClaimLookupService,
    private readonly notifications: NotificationsService,
  ) {}

  /** Khách gửi mã. Toàn bộ luật chạy trong một transaction giữ khoá advisory theo khách nên gửi song song nhiều mã không vượt trần. */
  async submit(userId: string, rawCode: unknown): Promise<SubmitExternalClaimResponse> {
    const cfg = await loadClaimConfig(this.config);
    if (!cfg.enabled) throw rejectionOf('DISABLED');
    const code = normalizeTrackingCode(rawCode);
    if (!code) throw rejectionOf('INVALID_CODE');
    const now = new Date();

    // Tra Pancake nằm NGOÀI transaction (tối đa 5 giây, không giữ khoá DB) và chỉ khi khách còn được phép thử.
    if (!(await findExternalOrderByCode(this.prisma, code)) && (await this.mayTry(userId, cfg, now))) {
      await this.lookup.lookupAndIngest(code, now);
    }

    const persisted = await this.prisma.$transaction(
      async (tx) => {
        await advisoryUserLock(tx, userId);
        const user = await tx.user.findUnique({ where: { id: userId }, select: USER_SELECT });
        const g = await this.gatherFacts(tx, user, code, cfg, now);
        return this.persist(tx, { userId, code, cfg, now, decision: evaluateClaimRules(g.facts), order: g.order, existingClaimId: g.existingClaimId, attemptId: null });
      },
      { timeout: 15_000, maxWait: 10_000 },
    );

    if (persisted.kind === 'REJECT') throw rejectionOf(persisted.code);
    const masked = maskClaimCode(code);
    if (persisted.kind === 'SEARCHING') {
      return {
        status: 'SEARCHING',
        claimId: null,
        channel: null,
        maskedCode: masked,
        points: null,
        expectedCreditAt: null,
        message: 'Chưa thấy đơn này. Đơn sàn có thể mất vài giờ để về hệ thống, Tubu Tree sẽ tự tìm lại trong 3 ngày và báo bạn khi thấy.',
      };
    }
    if (persisted.kind === 'UNKNOWN_SOURCE') {
      return {
        status: 'REVIEW',
        claimId: null,
        channel: null,
        maskedCode: masked,
        points: null,
        expectedCreditAt: null,
        message: 'Đơn này cần nhân viên Tubu Tree kiểm tra trước khi tích điểm. Bạn không cần làm gì thêm.',
      };
    }
    await this.notifyPending(userId, persisted.created);
    return this.toSubmitResponse(persisted.created, cfg);
  }

  /** "Đơn ngoài app của bạn": không trả SĐT hay payload, mã che bớt. */
  async listMine(userId: string, page: number, limit: number): Promise<MyExternalClaimsResponse> {
    const cfg = await loadClaimConfig(this.config);
    const where: Prisma.ExternalPointsClaimWhereInput = { userId, kind: 'SCAN' };
    const [rows, total, attempts] = await Promise.all([
      this.prisma.externalPointsClaim.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        ...skipTake(page, limit),
        include: { externalOrder: { select: { channel: true, trackingCode: true, status: true, deliveredAt: true } } },
      }),
      this.prisma.externalPointsClaim.count({ where }),
      page === 1
        ? this.prisma.externalClaimAttempt.findMany({
            where: { userId, result: 'UNMATCHED', resolvedAt: null },
            orderBy: { createdAt: 'desc' },
            take: 20,
            select: { code: true, createdAt: true },
          })
        : Promise.resolve([] as { code: string; createdAt: Date }[]),
    ]);
    const data: MyExternalClaimItem[] = rows.map((r) => {
      const open = r.state === 'PENDING' || r.state === 'REVIEW';
      const o = r.externalOrder;
      return {
        id: r.id,
        channel: o.channel,
        maskedCode: maskClaimCode(o.trackingCode),
        state: r.state,
        points: r.state === 'REVIEW' && r.points === 0 ? null : r.points,
        expectedCreditAt: open && o.status === 'DELIVERED' && o.deliveredAt ? new Date(o.deliveredAt.getTime() + cfg.pendingDays * DAY_MS).toISOString() : null,
        creditedAt: r.creditedAt?.toISOString() ?? null,
        createdAt: r.createdAt.toISOString(),
      };
    });
    return {
      ...paginated(data, page, limit, total),
      searching: attempts.map((a) => ({ maskedCode: maskClaimCode(a.code), createdAt: a.createdAt.toISOString() })),
    };
  }

  /** Đọc không khoá để biết có nên tốn một lượt tra Pancake không. Quyết định thật vẫn nằm trong transaction. */
  private async mayTry(userId: string, cfg: ClaimConfig, now: Date): Promise<boolean> {
    const [times, today] = await Promise.all([
      this.prisma.externalClaimAttempt.findMany({
        where: { userId, result: { in: ['UNMATCHED', 'NOT_FOUND'] }, createdAt: { gte: new Date(now.getTime() - 2 * DAY_MS) } },
        select: { createdAt: true },
      }),
      this.prisma.externalClaimAttempt.count({ where: { userId, dayKey: vnDateKey(now) } }),
    ]);
    return lockedUntil(times.map((t) => t.createdAt), now) === null && today < cfg.dailyAttempts;
  }

  /** Mọi dữ kiện luật cần. Khoá dòng đơn ngoài (nếu có) TRƯỚC khi đọc claim để hai khách gửi cùng mã xếp hàng ở đây. */
  async gatherFacts(
    tx: Tx,
    user: UserRow | null,
    code: string,
    cfg: ClaimConfig,
    now: Date,
    opts: { skipAttemptLimits?: boolean } = {},
  ): Promise<{ facts: ClaimFacts; order: ClaimOrderRow | null; existingClaimId: string | null }> {
    const userId = user?.id ?? '';
    const sinceNotFound = new Date(now.getTime() - 2 * DAY_MS);
    const [notFound, attemptsToday, appOrder, found] = await Promise.all([
      opts.skipAttemptLimits
        ? Promise.resolve([] as { createdAt: Date }[])
        : tx.externalClaimAttempt.findMany({ where: { userId, result: { in: ['UNMATCHED', 'NOT_FOUND'] }, createdAt: { gte: sinceNotFound } }, select: { createdAt: true } }),
      opts.skipAttemptLimits ? Promise.resolve(0) : tx.externalClaimAttempt.count({ where: { userId, dayKey: vnDateKey(now) } }),
      tx.order.findFirst({
        where: { OR: [{ shippingCode: { equals: code, mode: 'insensitive' } }, { gomdonPartnerCode: { equals: code, mode: 'insensitive' } }] },
        select: { id: true },
      }),
      findExternalOrderByCode(tx, code),
    ]);

    let order: ClaimOrderRow | null = null;
    let claim: { id: string; reopenable: boolean } | null = null;
    if (found) {
      await tx.$queryRaw`SELECT "id" FROM "external_orders" WHERE "id" = ${found.id} FOR UPDATE`;
      order = (await tx.externalOrder.findUniqueOrThrow({ where: { id: found.id } })) as ClaimOrderRow;
      const existing = await tx.externalPointsClaim.findUnique({
        where: { externalOrderId: found.id },
        select: { id: true, state: true, claimedCode: true, decidedById: true },
      });
      if (existing) claim = { id: existing.id, reopenable: existing.state === 'VOIDED' && existing.claimedCode === null && existing.decidedById !== null };
    }

    const [claimsToday, month] = await Promise.all([
      tx.externalPointsClaim.count({ where: { userId, kind: 'SCAN', dayKey: vnDateKey(now) } }),
      tx.externalPointsClaim.aggregate({
        where: { userId, kind: 'SCAN', createdAt: { gte: startOfVnMonth(now) }, state: { in: ['PENDING', 'REVIEW', 'CREDITED'] } },
        _sum: { points: true },
      }),
    ]);

    const facts: ClaimFacts = {
      now,
      cfg,
      userOk: !!user && isRealUser(user) && !!user.phone && !user.isBlocked,
      userPhoneLast3: last3(user?.phone ?? null),
      lockedUntil: lockedUntil(notFound.map((n) => n.createdAt), now),
      attemptsToday,
      isAppOrder: !!appOrder,
      order: order
        ? { source: order.source, status: order.status, insertedAt: order.pancakeInsertedAt ?? order.firstSeenAt, goodsValue: order.goodsValue, phoneLast3: order.phoneLast3 }
        : null,
      claim: claim ? { reopenable: claim.reopenable } : null,
      claimsToday,
      monthPoints: month._sum.points ?? 0,
    };
    return { facts, order, existingClaimId: claim?.reopenable ? claim.id : null };
  }

  /** Ghi kết quả quyết định (attempt, claim). Không ném trong transaction: lỗi nghiệp vụ trả về để commit attempt rồi mới ném ra ngoài. */
  async persist(
    tx: Tx,
    a: {
      userId: string;
      code: string;
      cfg: ClaimConfig;
      now: Date;
      decision: ClaimDecision;
      order: ClaimOrderRow | null;
      existingClaimId: string | null;
      /** Rematch: attempt UNMATCHED đã có, cập nhật thay vì thêm dòng mới. */
      attemptId: string | null;
    },
  ): Promise<Persisted> {
    const { userId, code, now, decision, order } = a;
    const dayKey = vnDateKey(now);
    const addAttempt = async (result: string, extra: { externalOrderId?: string | null; note?: string | null } = {}): Promise<void> => {
      if (a.attemptId) return;
      await tx.externalClaimAttempt.create({ data: { userId, code, result, dayKey, externalOrderId: extra.externalOrderId ?? null, note: extra.note ?? null } });
    };

    if (decision.kind === 'REJECT') {
      if (!UNRECORDED.includes(decision.code)) await addAttempt(`REJECTED_${decision.code}`, { externalOrderId: order?.id ?? null });
      return { kind: 'REJECT', code: decision.code };
    }
    if (decision.kind === 'UNMATCHED' || decision.kind === 'UNKNOWN_SOURCE') {
      const unknown = decision.kind === 'UNKNOWN_SOURCE';
      const externalOrderId = unknown ? (order?.id ?? null) : null;
      const note = unknown ? 'Nguồn đơn chưa xác định' : null;
      if (a.attemptId) {
        if (unknown) await tx.externalClaimAttempt.updateMany({ where: { id: a.attemptId, resolvedAt: null }, data: { externalOrderId, note } });
      } else {
        // createMany skipDuplicates: unique một phần theo mã (một lần chờ mỗi mã). Trùng thì ghi NOT_FOUND mà không làm hỏng transaction (25P02).
        const res = await tx.externalClaimAttempt.createMany({ data: [{ userId, code, result: 'UNMATCHED', dayKey, externalOrderId, note }], skipDuplicates: true });
        if (res.count === 0) await addAttempt('NOT_FOUND', { externalOrderId, note });
      }
      return unknown ? { kind: 'UNKNOWN_SOURCE' } : { kind: 'SEARCHING' };
    }

    if (!order) throw new Error('persist: quyết định CLAIM nhưng không có đơn');
    const releaseAt = order.status === 'DELIVERED' && order.deliveredAt ? new Date(order.deliveredAt.getTime() + a.cfg.pendingDays * DAY_MS) : null;
    const data = {
      userId,
      kind: 'SCAN' as const,
      state: decision.state,
      ratePct: a.cfg.earnPct,
      multiplier: 1,
      points: decision.points,
      countsForTier: false,
      claimedCode: code,
      releaseAt,
      reviewReason: decision.reviewReason,
      voidReason: null,
      decidedById: null,
      dayKey,
    };
    let claimId: string | null = null;
    if (a.existingClaimId) {
      const res = await tx.externalPointsClaim.updateMany({
        where: { id: a.existingClaimId, state: 'VOIDED', claimedCode: null },
        data: { ...data, createdAt: now, creditedAt: null, pointsTxId: null },
      });
      if (res.count === 1) claimId = a.existingClaimId;
    } else {
      const rows = await tx.externalPointsClaim.createManyAndReturn({ data: [{ ...data, externalOrderId: order.id }], skipDuplicates: true, select: { id: true } });
      claimId = rows[0]?.id ?? null;
    }
    if (!claimId) {
      await addAttempt('REJECTED_ALREADY_CLAIMED', { externalOrderId: order.id });
      return { kind: 'REJECT', code: 'ALREADY_CLAIMED' };
    }
    if (a.attemptId) {
      await tx.externalClaimAttempt.updateMany({
        where: { id: a.attemptId, resolvedAt: null },
        data: { result: 'MATCHED', resolvedAt: now, externalOrderId: order.id, note: 'Ghép tự động' },
      });
    } else {
      await addAttempt('MATCHED', { externalOrderId: order.id });
    }
    return {
      kind: 'CLAIM',
      created: { claimId, state: decision.state, points: decision.points, channel: order.channel, maskedCode: maskClaimCode(code), expectedCreditAt: releaseAt },
    };
  }

  private toSubmitResponse(c: CreatedClaim, cfg: ClaimConfig): SubmitExternalClaimResponse {
    const review = c.state === 'REVIEW';
    return {
      status: review ? 'REVIEW' : 'CLAIMED',
      claimId: c.claimId,
      channel: c.channel,
      maskedCode: c.maskedCode,
      points: c.points > 0 ? c.points : null,
      expectedCreditAt: c.expectedCreditAt?.toISOString() ?? null,
      message: review
        ? 'Đơn của bạn đang được nhân viên Tubu Tree kiểm tra. Điểm sẽ được cộng sau khi duyệt và đơn giao xong.'
        : `Đã ghi nhận ${formatPoints(c.points)} Điểm Xanh chờ cộng. Điểm được cộng sau khi đơn giao thành công ${cfg.pendingDays} ngày.`,
    };
  }

  async notifyPending(userId: string, c: CreatedClaim): Promise<void> {
    if (c.state !== 'PENDING') return;
    try {
      await this.notifications.notify(userId, 'EXTERNAL_POINTS_PENDING', { points: formatPoints(c.points), code: c.maskedCode }, { dedupeKey: `ext-pending:${c.claimId}` });
    } catch (err) {
      this.logger.warn(`Gửi EXTERNAL_POINTS_PENDING lỗi claim=${c.claimId}: ${err instanceof Error ? err.message : err}`);
    }
  }

  /**
   * Cron 30 phút: thử ghép lại các lần gửi mã chưa thấy đơn, tối đa 50 mỗi lượt, trong 3 ngày. Hết 3 ngày không ghép được thì ngừng thử
   * và nằm ở "Cần xử lý" của admin (gắn tay hoặc từ chối).
   */
  async rematchUnmatched(now: Date = new Date()): Promise<{ matched: number; resolved: number }> {
    const cfg = await loadClaimConfig(this.config);
    if (!cfg.enabled) return { matched: 0, resolved: 0 };
    const attempts = await this.prisma.externalClaimAttempt.findMany({
      where: { result: 'UNMATCHED', resolvedAt: null, externalOrderId: null, createdAt: { gte: new Date(now.getTime() - UNMATCHED_RETRY_DAYS * DAY_MS) } },
      orderBy: { createdAt: 'asc' },
      take: REMATCH_BATCH,
      select: { id: true },
    });
    let matched = 0;
    let resolved = 0;
    for (const { id } of attempts) {
      try {
        const res = await this.rematchOne(id, cfg, now);
        if (res === 'MATCHED') matched++;
        if (res === 'MATCHED' || res === 'RESOLVED') resolved++;
      } catch (err) {
        this.logger.error(`rematch attempt=${id} lỗi: ${err instanceof Error ? err.message : err}`);
      }
    }
    return { matched, resolved };
  }

  private async rematchOne(attemptId: string, cfg: ClaimConfig, now: Date): Promise<'NONE' | 'MATCHED' | 'RESOLVED'> {
    const out = await this.prisma.$transaction(async (tx) => {
      const attempt = await tx.externalClaimAttempt.findUnique({ where: { id: attemptId } });
      if (!attempt || attempt.resolvedAt || attempt.result !== 'UNMATCHED' || attempt.externalOrderId) return null;
      await advisoryUserLock(tx, attempt.userId);
      const again = await tx.externalClaimAttempt.findUnique({ where: { id: attemptId }, select: { resolvedAt: true } });
      if (again?.resolvedAt) return null;
      if (!(await findExternalOrderByCode(tx, attempt.code))) return null;
      const user = await tx.user.findUnique({ where: { id: attempt.userId }, select: USER_SELECT });
      const g = await this.gatherFacts(tx, user, attempt.code, cfg, now, { skipAttemptLimits: true });
      const persisted = await this.persist(tx, {
        userId: attempt.userId,
        code: attempt.code,
        cfg,
        now,
        decision: evaluateClaimRules(g.facts),
        order: g.order,
        existingClaimId: g.existingClaimId,
        attemptId,
      });
      if (persisted.kind === 'REJECT') {
        await tx.externalClaimAttempt.updateMany({
          where: { id: attemptId, resolvedAt: null },
          data: { result: `REJECTED_${persisted.code}`, resolvedAt: now, externalOrderId: g.order?.id ?? null, note: 'Ghép tự động nhưng không đủ điều kiện' },
        });
      }
      return { persisted, userId: attempt.userId, code: attempt.code };
    });
    if (!out) return 'NONE';
    if (out.persisted.kind === 'CLAIM') {
      await this.notifyPending(out.userId, out.persisted.created);
      return 'MATCHED';
    }
    if (out.persisted.kind === 'REJECT') {
      const detail = REJECT_HTTP[out.persisted.code].message.replace(/\.$/, '');
      await this.notifications
        .notify(out.userId, 'EXTERNAL_POINTS_CLAIM_NOT_FOUND', { code: maskClaimCode(out.code), detail }, { dedupeKey: `ext-nf:${attemptId}` })
        .catch((e: unknown) => this.logger.warn(`Gửi CLAIM_NOT_FOUND lỗi attempt=${attemptId}: ${e instanceof Error ? e.message : e}`));
      return 'RESOLVED';
    }
    return 'NONE';
  }
}
