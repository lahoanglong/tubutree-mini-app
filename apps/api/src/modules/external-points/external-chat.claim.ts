import { Logger } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { formatPoints } from '../../common/format-points';
import { startOfVnMonth, vnDateKey } from '../../common/vn-time';
import type { PrismaService } from '../../prisma/prisma.service';
import type { SystemConfigService } from '../system-config/system-config.service';
import { recordClaimEvent, canonicalUserId } from './external-claim-audit';
import type { ClaimNotifier } from './external-claim-status';
import { loadChatConfig } from './external-chat.config';
import { chatCarrierOk, evaluateChatClaim, holdUntilOf, releaseAtOf, verifiedMemberPhone } from './external-chat.rules';
import { claimPoints } from './external-points-rate';

const logger = new Logger('ExternalChat');
type Tx = Prisma.TransactionClient;

const LINKABLE = ['PENDING', 'REVIEW', 'HELD_NO_MEMBER'] as const;
/** Claim chat còn hiệu lực với trần tháng (HELD vẫn tính vì được cộng ngay khi khách liên kết). */
const CAP_STATES = ['PENDING', 'REVIEW', 'HELD_NO_MEMBER', 'CREDITED'] as const;
const SWEEP_BATCH = 50;

export interface ChatDeps {
  notifier?: ClaimNotifier;
  config?: Pick<SystemConfigService, 'get'>;
}

/**
 * Khoá advisory theo SĐT, giữ tới hết transaction. MỌI việc đổi claim chat theo SĐT (tạo, liên kết, giữ điểm, cộng, duyệt) lấy khoá này
 * TRƯỚC khi khoá dòng đơn, claim, users: nhờ vậy trần tháng theo SĐT chốt tuần tự và liên kết không chen vào giữa lúc tạo hay cộng.
 */
export const advisoryPhoneLock = (tx: Tx, phone: string) => tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`ext-chat:${phone}`}))`;

export interface ResolvedMember {
  id: string;
  isStaff: boolean;
  tierMultiplier: number;
}

const MEMBER_SELECT = { id: true, phone: true, zaloId: true, isBlocked: true, mergedIntoId: true, role: true, tier: { select: { pointMultiplier: true } } } as const;

/** Hệ số của hạng hiện tại; chưa có hạng thì 1. */
export const tierMultiplierOf = (u: { tier: { pointMultiplier: Prisma.Decimal | number } | null }): number => (u.tier ? Number(u.tier.pointMultiplier) : 1);

/**
 * Thành viên có SĐT trùng, đã quy về tài khoản gốc theo `mergedIntoId` (không khoá). null khi chưa có, hoặc tài khoản không đủ điều
 * kiện nhận điểm: số chưa xác minh, khách vãng lai, bị khoá. Tài khoản bị khoá coi như chưa là thành viên: điểm được giữ, không mất.
 */
export async function resolveMemberByPhone(tx: Pick<Tx, 'user'>, phone: string): Promise<ResolvedMember | null> {
  const u = await tx.user.findUnique({ where: { phone }, select: MEMBER_SELECT });
  if (!u) return null;
  const rootId = await canonicalUserId(tx, u.id);
  const root = rootId === u.id ? u : await tx.user.findUnique({ where: { id: rootId }, select: MEMBER_SELECT });
  if (!root) return null;
  // Dòng đã gộp thì số của nó đã chuyển về tài khoản gốc; dòng chưa gộp phải là số đã xác minh.
  if (rootId === u.id && verifiedMemberPhone(u) !== phone) return null;
  if (root.isBlocked || !root.zaloId || root.zaloId.startsWith('guest_')) return null;
  return { id: root.id, isStaff: root.role === 'STAFF' || root.role === 'ADMIN', tierMultiplier: tierMultiplierOf(root) };
}

/** SĐT thuộc một nhân viên: tài khoản STAFF/ADMIN, hoặc grant quyền còn hiệu lực (nhân viên chưa đăng nhập lần nào vẫn có grant theo SĐT). */
export async function phoneBelongsToStaff(tx: Pick<Tx, 'user' | 'roleGrant'>, phone: string): Promise<boolean> {
  const [user, grant] = await Promise.all([
    tx.user.findFirst({ where: { phone, role: { in: ['STAFF', 'ADMIN'] } }, select: { id: true } }),
    tx.roleGrant.findFirst({ where: { phone, revokedAt: null }, select: { id: true } }),
  ]);
  return !!user || !!grant;
}

/**
 * Điểm các claim chat còn hiệu lực của một SĐT trong tháng VN. Claim đã liên kết đi theo `userId` (SĐT đơn có thể đã bị xoá sau
 * hạn giữ), claim chưa liên kết đi theo SĐT trên đơn: hai nhóm không giao nhau nên không đếm đôi.
 */
export async function chatMonthPoints(
  tx: Pick<Tx, 'externalPointsClaim'>,
  a: { phone: string; userId: string | null; since: Date; excludeClaimId?: string },
): Promise<number> {
  const agg = await tx.externalPointsClaim.aggregate({
    where: {
      kind: 'PHONE',
      state: { in: [...CAP_STATES] },
      createdAt: { gte: a.since },
      ...(a.excludeClaimId ? { id: { not: a.excludeClaimId } } : {}),
      OR: [...(a.userId ? [{ userId: a.userId }] : []), { userId: null, externalOrder: { phone: a.phone } }],
    },
    _sum: { points: true },
  });
  return agg._sum.points ?? 0;
}

export type EnsureOutcome = 'CREATED' | 'EXISTS' | 'SKIPPED';

/**
 * Tạo claim PHONE cho một đơn chat/điện thoại đã nạp, nếu đủ điều kiện (xem evaluateChatClaim). Idempotent: một đơn một claim (unique
 * externalOrderId), claim đã VOIDED/LAPSED không bao giờ được tạo lại. `payload` là sự kiện vừa nhận (để biết `partner.extend_code`
 * kể cả khi webhook một phần không ghi đè lastPayload); thiếu thì dùng lastPayload. Không bao giờ ném ra đường webhook.
 */
export async function ensureChatClaim(
  prisma: PrismaService,
  deps: ChatDeps,
  pancakeOrderId: string,
  now: Date = new Date(),
  payload?: Record<string, unknown>,
): Promise<EnsureOutcome> {
  try {
    if (!deps.config) return 'SKIPPED';
    const cfg = await loadChatConfig(deps.config);
    if (!cfg.enabled) return 'SKIPPED';
    const head = await prisma.externalOrder.findUnique({ where: { pancakeOrderId }, select: { id: true, source: true, phone: true } });
    if (!head || head.source !== 'CHAT' || !head.phone) return 'SKIPPED';
    const phone = head.phone;
    return await prisma.$transaction(
      async (tx): Promise<EnsureOutcome> => {
        await advisoryPhoneLock(tx, phone);
        await tx.$queryRaw`SELECT "id" FROM "external_orders" WHERE "id" = ${head.id} FOR SHARE`;
        const order = await tx.externalOrder.findUniqueOrThrow({ where: { id: head.id }, include: { claim: { select: { id: true } } } });
        if (order.claim) return 'EXISTS';
        // SĐT hay loại đơn đổi giữa lúc đọc và lúc khoá: lần nạp kế tiếp sẽ quyết lại theo số mới.
        if (order.source !== 'CHAT' || order.phone !== phone) return 'SKIPPED';
        const lastPayload = (order.lastPayload ?? {}) as Record<string, unknown>;
        const [member, phoneIsStaff] = await Promise.all([resolveMemberByPhone(tx, phone), phoneBelongsToStaff(tx, phone)]);
        const monthPoints = await chatMonthPoints(tx, { phone, userId: member?.id ?? null, since: startOfVnMonth(now) });
        const decision = evaluateChatClaim({
          now,
          cfg,
          order: {
            status: order.status,
            pancakeStatus: order.pancakeStatus,
            hasExtendCode: (payload ? chatCarrierOk(payload, null) : false) || chatCarrierOk(lastPayload, null),
            goodsValue: order.goodsValue,
            insertedAt: order.pancakeInsertedAt ?? order.firstSeenAt,
            phone,
          },
          member,
          phoneIsStaff,
          monthPoints,
        });
        if (decision.kind === 'SKIP') return 'SKIPPED';
        const releaseAt = order.status === 'DELIVERED' && order.deliveredAt ? releaseAtOf(order.deliveredAt, cfg) : null;
        const rows = await tx.externalPointsClaim.createManyAndReturn({
          data: [
            {
              externalOrderId: order.id,
              userId: decision.userId,
              kind: 'PHONE',
              state: decision.state,
              ratePct: decision.ratePct,
              multiplier: decision.multiplier,
              points: decision.points,
              countsForTier: true,
              claimedCode: null,
              releaseAt,
              reviewReason: decision.reviewReason,
              dayKey: vnDateKey(now),
            },
          ],
          skipDuplicates: true,
          select: { id: true },
        });
        const created = rows[0];
        if (!created) return 'EXISTS';
        await recordClaimEvent(tx, {
          claimId: created.id,
          action: 'CLAIM_CREATED',
          fromState: null,
          toState: decision.state,
          userIdAfter: decision.userId,
          orderStatus: order.status,
          note: decision.reviewReason ?? `${decision.points} điểm (đơn chat, ${decision.userId ? 'đã có thành viên' : 'chờ khách liên kết'})`,
        });
        return 'CREATED';
      },
      { timeout: 15_000, maxWait: 10_000 },
    );
  } catch (err) {
    logger.error(`ensureChatClaim ${pancakeOrderId} lỗi: ${err instanceof Error ? err.message : err}`);
    return 'SKIPPED';
  }
}

export interface LinkResult {
  linked: number;
  /** Điểm của các claim đang PENDING sau khi liên kết (REVIEW chưa tính vì chưa chắc được cộng). */
  pendingPoints: number;
}

export interface LinkableUser {
  id: string;
  phone: string | null;
  zaloId: string | null;
  isBlocked: boolean;
  mergedIntoId: string | null;
}

/**
 * Gắn mọi claim PHONE chưa có chủ của SĐT này (đã xác minh) vào thành viên. Chạy được song song từ đăng nhập và cron: khoá advisory theo
 * SĐT xếp hàng, mỗi claim chỉ gắn một lần nhờ điều kiện `userId IS NULL` trong UPDATE, nên hai phiên cùng SĐT không gắn đôi, không báo đôi.
 * HELD_NO_MEMBER còn hạn quay lại PENDING (cron cộng ở lượt kế); thành viên là nhân viên thì vào REVIEW. Không bao giờ ném.
 */
export async function linkClaimsByPhone(prisma: PrismaService, deps: ChatDeps, user: LinkableUser, now: Date = new Date()): Promise<LinkResult> {
  const none: LinkResult = { linked: 0, pendingPoints: 0 };
  try {
    if (!deps.config) return none;
    const cfg = await loadChatConfig(deps.config);
    if (!cfg.enabled) return none;
    const phone = verifiedMemberPhone(user);
    if (!phone) return none;
    // Đọc nhanh không khoá: phần lớn lượt đăng nhập/refresh không có claim chờ nên không phải mở transaction.
    const waiting = await prisma.externalPointsClaim.findFirst({
      where: { kind: 'PHONE', userId: null, state: { in: [...LINKABLE] }, externalOrder: { phone } },
      select: { id: true },
    });
    if (!waiting) return none;

    const out = await prisma.$transaction(
      async (tx) => {
        await advisoryPhoneLock(tx, phone);
        const member = await resolveMemberByPhone(tx, phone);
        if (!member) return { ids: [] as string[], pendingPoints: 0 };
        const claims = await tx.externalPointsClaim.findMany({
          where: { kind: 'PHONE', userId: null, state: { in: [...LINKABLE] }, externalOrder: { phone } },
          orderBy: { createdAt: 'asc' },
          take: 100,
          select: { id: true, externalOrderId: true },
        });
        const ids: string[] = [];
        let pendingPoints = 0;
        for (const c of claims) {
          await tx.$queryRaw`SELECT "id" FROM "external_orders" WHERE "id" = ${c.externalOrderId} FOR SHARE`;
          await tx.$queryRaw`SELECT "id" FROM "external_points_claims" WHERE "id" = ${c.id} FOR UPDATE`;
          const fresh = await tx.externalPointsClaim.findUnique({ where: { id: c.id }, include: { externalOrder: { select: { goodsValue: true } } } });
          if (!fresh || fresh.userId !== null || !(LINKABLE as readonly string[]).includes(fresh.state)) continue;
          if (fresh.state === 'HELD_NO_MEMBER' && (!fresh.holdUntil || fresh.holdUntil.getTime() <= now.getTime())) continue;
          const toReview = member.isStaff && fresh.state !== 'REVIEW';
          const state = fresh.state === 'REVIEW' || toReview ? 'REVIEW' : 'PENDING';
          const reviewReason = toReview ? 'Thành viên là nhân viên Tubu Tree, cần người khác duyệt' : fresh.reviewReason;
          const points = claimPoints(fresh.externalOrder.goodsValue, Number(fresh.ratePct), member.tierMultiplier) ?? fresh.points;
          const res = await tx.externalPointsClaim.updateMany({
            where: { id: fresh.id, userId: null, state: fresh.state },
            data: { userId: member.id, state, reviewReason, points, multiplier: member.tierMultiplier, holdUntil: null },
          });
          if (res.count !== 1) continue;
          ids.push(fresh.id);
          if (state === 'PENDING') pendingPoints += points;
          await recordClaimEvent(tx, {
            claimId: fresh.id,
            action: 'LINK_PHONE',
            fromState: fresh.state,
            toState: state,
            userIdBefore: null,
            userIdAfter: member.id,
            note: toReview ? reviewReason : `Liên kết theo SĐT, ${points} điểm`,
          });
        }
        return { ids, pendingPoints };
      },
      { timeout: 30_000, maxWait: 10_000 },
    );
    if (out.ids.length > 0 && out.pendingPoints > 0 && deps.notifier) {
      await deps.notifier
        .notify(user.id, 'CHAT_ORDER_POINTS_LINKED', { points: formatPoints(out.pendingPoints), count: String(out.ids.length) }, { dedupeKey: `chat-link:${out.ids[0]}` })
        .catch((e: unknown) => logger.warn(`Gửi CHAT_ORDER_POINTS_LINKED lỗi user=${user.id}: ${e instanceof Error ? e.message : e}`));
    }
    return { linked: out.ids.length, pendingPoints: out.pendingPoints };
  } catch (err) {
    logger.error(`linkClaimsByPhone user=${user.id} lỗi: ${err instanceof Error ? err.message : err}`);
    return none;
  }
}

/**
 * Cron: gom các SĐT đang có claim chờ mà đã có thành viên (thành viên đăng ký trước khi claim tới, hoặc đăng nhập đã lỡ) rồi liên kết.
 * Chạy song song với đăng nhập an toàn nhờ khoá SĐT và điều kiện `userId IS NULL`.
 */
export async function linkWaitingClaims(prisma: PrismaService, deps: ChatDeps, now: Date = new Date()): Promise<number> {
  if (!deps.config || !(await loadChatConfig(deps.config)).enabled) return 0;
  const rows = await prisma.$queryRaw<{ id: string }[]>`
    SELECT DISTINCT u."id" FROM "external_points_claims" c
      JOIN "external_orders" o ON o."id" = c."externalOrderId"
      JOIN "users" u ON u."phone" = o."phone"
     WHERE c."kind" = 'PHONE' AND c."userId" IS NULL AND c."state" IN ('PENDING', 'REVIEW', 'HELD_NO_MEMBER')
     LIMIT ${SWEEP_BATCH}`;
  let linked = 0;
  for (const { id } of rows) {
    const u = await prisma.user.findUnique({ where: { id }, select: { id: true, phone: true, zaloId: true, isBlocked: true, mergedIntoId: true } });
    if (u) linked += (await linkClaimsByPhone(prisma, deps, u, now)).linked;
  }
  return linked;
}

/**
 * Quá hạn giữ mà vẫn chưa có thành viên: HELD_NO_MEMBER sang LAPSED, không ghi sổ điểm, có nhật ký. Cùng khoá SĐT với liên kết nên
 * khách vừa liên kết đúng lúc hết hạn hoặc nhận điểm hoặc mất điểm, không bao giờ cả hai.
 */
export async function lapseExpiredChatClaims(prisma: PrismaService, config: Pick<SystemConfigService, 'get'>, now: Date = new Date()): Promise<number> {
  if (!(await loadChatConfig(config)).enabled) return 0;
  const due = await prisma.externalPointsClaim.findMany({
    where: { kind: 'PHONE', state: 'HELD_NO_MEMBER', userId: null, holdUntil: { lt: now } },
    orderBy: { holdUntil: 'asc' },
    take: 200,
    select: { id: true, externalOrder: { select: { phone: true } } },
  });
  let lapsed = 0;
  for (const c of due) {
    try {
      const ok = await prisma.$transaction(async (tx) => {
        const phone = c.externalOrder.phone;
        if (phone) await advisoryPhoneLock(tx, phone);
        const head = await tx.externalPointsClaim.findUnique({ where: { id: c.id }, select: { externalOrderId: true } });
        if (!head) return false;
        await tx.$queryRaw`SELECT "id" FROM "external_orders" WHERE "id" = ${head.externalOrderId} FOR SHARE`;
        await tx.$queryRaw`SELECT "id" FROM "external_points_claims" WHERE "id" = ${c.id} FOR UPDATE`;
        const res = await tx.externalPointsClaim.updateMany({
          where: { id: c.id, state: 'HELD_NO_MEMBER', userId: null, holdUntil: { lt: now } },
          data: { state: 'LAPSED', voidReason: 'Quá hạn giữ điểm, chưa có thành viên liên kết SĐT' },
        });
        if (res.count !== 1) return false;
        await recordClaimEvent(tx, { claimId: c.id, action: 'LAPSE', fromState: 'HELD_NO_MEMBER', toState: 'LAPSED', note: 'Quá hạn giữ điểm, không ghi sổ' });
        return true;
      });
      if (ok) lapsed++;
    } catch (err) {
      logger.error(`Lapse claim ${c.id} lỗi: ${err instanceof Error ? err.message : err}`);
    }
  }
  return lapsed;
}

/**
 * Đơn chat đã nạp lúc cờ còn tắt (hoặc ingest từng lỗi) mà chưa có claim: tạo bù, tối đa 50 mỗi lượt. Chỉ đơn còn mở, còn trong tuổi
 * tối đa; `ensureChatClaim` tự kiểm mọi điều kiện còn lại.
 */
export async function backfillChatClaims(prisma: PrismaService, deps: ChatDeps, now: Date = new Date()): Promise<number> {
  if (!deps.config) return 0;
  const cfg = await loadChatConfig(deps.config);
  if (!cfg.enabled) return 0;
  const orders = await prisma.externalOrder.findMany({
    where: {
      source: 'CHAT',
      phone: { not: null },
      status: { in: ['OPEN', 'DELIVERED', 'PARTIAL_RETURN'] },
      claim: { is: null },
      firstSeenAt: { gte: new Date(now.getTime() - cfg.maxAgeDays * 864e5) },
      // Tập con thô của điều kiện vận đơn (extend_code luôn là mã vận đơn đầu tiên): đơn chưa có vận đơn không chiếm chỗ của đơn đủ điều kiện.
      ...(cfg.requireCarrier ? { OR: [{ pancakeStatus: 16 }, { trackingCode: { not: null } }] } : {}),
    },
    orderBy: { updatedAt: 'desc' },
    take: SWEEP_BATCH,
    select: { pancakeOrderId: true },
  });
  let created = 0;
  for (const o of orders) if ((await ensureChatClaim(prisma, deps, o.pancakeOrderId, now)) === 'CREATED') created++;
  return created;
}

export { holdUntilOf, releaseAtOf };
