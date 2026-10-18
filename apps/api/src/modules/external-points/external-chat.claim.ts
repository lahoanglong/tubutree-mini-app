import { Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { formatPoints } from '../../common/format-points';
import { startOfVnMonth, vnDateKey } from '../../common/vn-time';
import type { PrismaService } from '../../prisma/prisma.service';
import type { SystemConfigService } from '../system-config/system-config.service';
import { recordClaimEvent, canonicalUserId } from './external-claim-audit';
import type { ClaimNotifier } from './external-claim-status';
import { loadChatConfig, loadStaffMap } from './external-chat.config';
import { CHAT_SKIP_TEXT, chatCarrierOk, creatorStaffUserId, evaluateChatClaim, holdUntilOf, linkableMemberPhone, phoneVerifiedFresh, releaseAtOf } from './external-chat.rules';
import { pancakeCreatorId, pancakeCreatorRefs } from './external-order.mapper';
import { settlePoints } from './external-claim.rules';

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

/** Khoá advisory theo người tạo đơn Pancake: trần điểm tự cộng theo người tạo chốt tuần tự. Luôn lấy SAU khoá SĐT. */
export const advisoryCreatorLock = (tx: Tx, creatorRef: string) => tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`ext-chat-creator:${creatorRef}`}))`;

/** Khoá nhiều SĐT theo thứ tự chữ để hai giao dịch đổi chéo (đơn A: X→Y, đơn B: Y→X) không khoá ngược chiều. */
async function lockPhones(tx: Tx, phones: (string | null | undefined)[]): Promise<void> {
  for (const ph of [...new Set(phones.filter((x): x is string => !!x))].sort()) await advisoryPhoneLock(tx, ph);
}

export interface ResolvedMember {
  id: string;
  isStaff: boolean;
  tierMultiplier: number;
  /** Mốc xác minh SĐT đã cũ hay chưa có: vẫn là người nhận nhưng claim chờ kiểm (không tự cộng). */
  phoneStale: boolean;
}

const MEMBER_SELECT = { id: true, phone: true, phoneVerifiedAt: true, zaloId: true, isBlocked: true, mergedIntoId: true, role: true, tier: { select: { pointMultiplier: true } } } as const;

export interface PhoneVerify {
  now: Date;
  maxDays: number;
}

/** Hệ số của hạng hiện tại; chưa có hạng thì 1. */
export const tierMultiplierOf = (u: { tier: { pointMultiplier: Prisma.Decimal | number } | null }): number => (u.tier ? Number(u.tier.pointMultiplier) : 1);

/**
 * Thành viên có SĐT trùng, đã quy về tài khoản gốc theo `mergedIntoId` (không khoá). null khi chưa có, hoặc tài khoản không đủ điều
 * kiện nhận điểm: số sai dạng, khách vãng lai, bị khoá. Tài khoản bị khoá coi như chưa là thành viên: điểm được giữ, không mất.
 * Mốc xác minh quá cũ KHÔNG làm mất người nhận (claim sẽ mất chủ rồi hết hạn giữ dù Mini App không bao giờ xin lại số): trả về với
 * `phoneStale`, claim gắn thành viên đó và chờ nhân viên kiểm.
 */
export async function resolveMemberByPhone(tx: Pick<Tx, 'user'>, phone: string, verify: PhoneVerify): Promise<ResolvedMember | null> {
  const u = await tx.user.findUnique({ where: { phone }, select: MEMBER_SELECT });
  if (!u) return null;
  const rootId = await canonicalUserId(tx, u.id);
  const root = rootId === u.id ? u : await tx.user.findUnique({ where: { id: rootId }, select: MEMBER_SELECT });
  if (!root) return null;
  // Dòng đã gộp thì số của nó đã chuyển về tài khoản gốc; dòng chưa gộp phải là số đã xác minh.
  if (rootId === u.id && linkableMemberPhone(u) !== phone) return null;
  if (root.isBlocked || !root.zaloId || root.zaloId.startsWith('guest_')) return null;
  return {
    id: root.id,
    isStaff: root.role === 'STAFF' || root.role === 'ADMIN',
    tierMultiplier: tierMultiplierOf(root),
    phoneStale: !phoneVerifiedFresh(root.phoneVerifiedAt, verify),
  };
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
  a: { phone: string | null; userId: string | null; since: Date; excludeClaimId?: string },
): Promise<number> {
  const agg = await tx.externalPointsClaim.aggregate({
    where: {
      kind: 'PHONE',
      state: { in: [...CAP_STATES] },
      createdAt: { gte: a.since },
      ...(a.excludeClaimId ? { id: { not: a.excludeClaimId } } : {}),
      OR: [...(a.userId ? [{ userId: a.userId }] : []), ...(a.phone ? [{ userId: null, orderPhone: a.phone }] : [])],
    },
    _sum: { points: true },
  });
  return agg._sum.points ?? 0;
}

/**
 * Điểm đã TỰ cộng (chưa qua tay nhân viên: không REVIEW, không do người duyệt) của các đơn chat cùng một người tạo trên Pancake trong
 * tháng VN. Dùng cho trần `loyalty.chat_order_creator_monthly_points`; claim REVIEW chưa tính vì chưa chắc được cộng.
 */
export async function creatorMonthPoints(tx: Pick<Tx, 'externalPointsClaim'>, a: { creatorRef: string; since: Date; excludeClaimId?: string }): Promise<number> {
  const agg = await tx.externalPointsClaim.aggregate({
    where: {
      kind: 'PHONE',
      creatorRef: a.creatorRef,
      state: { in: ['PENDING', 'HELD_NO_MEMBER', 'CREDITED'] },
      decidedById: null,
      createdAt: { gte: a.since },
      ...(a.excludeClaimId ? { id: { not: a.excludeClaimId } } : {}),
    },
    _sum: { points: true },
  });
  return agg._sum.points ?? 0;
}

/** Người tạo đơn trên Pancake (qua pancake.staff_map) là chính thành viên nhận điểm, hoặc có SĐT trùng SĐT đơn. */
async function creatorIsReceiver(tx: Pick<Tx, 'user'>, staffUserId: string | null, memberId: string | null, phone: string | null): Promise<boolean> {
  if (!staffUserId) return false;
  if (memberId && memberId === staffUserId) return true;
  if (!phone) return false;
  const u = await tx.user.findUnique({ where: { id: staffUserId }, select: { phone: true } });
  return u?.phone === phone;
}

export const phoneDiffers = (claimPhone: string | null, orderPhone: string | null): boolean => !!claimPhone && !!orderPhone && claimPhone !== orderPhone;
export const last3 = (ph: string): string => ph.slice(-3);

export type EnsureOutcome = 'CREATED' | 'EXISTS' | 'SKIPPED' | 'ERROR';

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
    const head = await prisma.externalOrder.findUnique({
      where: { pancakeOrderId },
      select: { id: true, source: true, phone: true, claim: { select: { orderPhone: true } } },
    });
    if (!head || head.source !== 'CHAT' || !head.phone) return 'SKIPPED';
    const phone = head.phone;
    const staffMap = await loadStaffMap(deps.config);
    const verify: PhoneVerify = { now, maxDays: cfg.phoneVerifiedMaxDays };
    return await prisma.$transaction(
      async (tx): Promise<EnsureOutcome> => {
        // Cả SĐT mới trên đơn lẫn SĐT lúc tạo claim (nhân viên vừa sửa đơn): liên kết của số cũ phải xếp hàng với việc chuyển REVIEW.
        await lockPhones(tx, [phone, head.claim?.orderPhone]);
        await tx.$queryRaw`SELECT "id" FROM "external_orders" WHERE "id" = ${head.id} FOR SHARE`;
        const order = await tx.externalOrder.findUniqueOrThrow({
          where: { id: head.id },
          include: { claim: { select: { id: true, state: true, orderPhone: true, decidedById: true } } },
        });
        if (order.claim) {
          const c = order.claim;
          // SĐT đổi sau khi có claim: không để điểm chuyển sang số khác. Claim đã có người duyệt thì người đó đã quyết, không đảo lại.
          if (phoneDiffers(c.orderPhone, order.phone) && c.decidedById === null && (c.state === 'PENDING' || c.state === 'HELD_NO_MEMBER')) {
            await tx.$queryRaw`SELECT "id" FROM "external_points_claims" WHERE "id" = ${c.id} FOR UPDATE`;
            const reason = `SĐT trên đơn đã đổi (đuôi ${last3(c.orderPhone!)} thành ${last3(order.phone!)}), cần nhân viên kiểm`;
            const res = await tx.externalPointsClaim.updateMany({
              where: { id: c.id, state: c.state, decidedById: null },
              data: { state: 'REVIEW', reviewReason: reason, holdUntil: null },
            });
            if (res.count === 1) {
              await recordClaimEvent(tx, { claimId: c.id, action: 'PHONE_CHANGED', fromState: c.state, toState: 'REVIEW', orderStatus: order.status, note: reason });
            }
          }
          return 'EXISTS';
        }
        // SĐT hay loại đơn đổi giữa lúc đọc và lúc khoá: lần nạp kế tiếp sẽ quyết lại theo số mới.
        if (order.source !== 'CHAT' || order.phone !== phone) return 'SKIPPED';
        const lastPayload = (order.lastPayload ?? {}) as Record<string, unknown>;
        const refs = [...pancakeCreatorRefs(lastPayload), ...(payload ? pancakeCreatorRefs(payload) : [])];
        const creatorId = (payload ? pancakeCreatorId(payload) : null) ?? pancakeCreatorId(lastPayload);
        if (creatorId) await advisoryCreatorLock(tx, creatorId);
        const [member, phoneIsStaff] = await Promise.all([resolveMemberByPhone(tx, phone, verify), phoneBelongsToStaff(tx, phone)]);
        const since = startOfVnMonth(now);
        const monthPoints = await chatMonthPoints(tx, { phone, userId: member?.id ?? null, since });
        const creatorIsMember = await creatorIsReceiver(tx, creatorStaffUserId(refs, staffMap), member?.id ?? null, phone);
        const creatorPoints = creatorId ? await creatorMonthPoints(tx, { creatorRef: creatorId, since }) : null;
        const decision = evaluateChatClaim({
          now,
          cfg,
          order: {
            status: order.status,
            pancakeStatus: order.pancakeStatus,
            hasExtendCode: (payload ? chatCarrierOk(payload, null) : false) || chatCarrierOk(lastPayload, null),
            hasTrackingCode: order.trackingCode !== null || order.trackingCodes.length > 0,
            goodsValue: order.goodsValue,
            insertedAt: order.pancakeInsertedAt ?? order.firstSeenAt,
            phone,
          },
          member,
          phoneIsStaff,
          monthPoints,
          creatorIsMember,
          creatorMonthPoints: creatorPoints,
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
              orderPhone: phone,
              creatorRef: creatorId,
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
    return 'ERROR';
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
  phoneVerifiedAt: Date | null;
  zaloId: string | null;
  isBlocked: boolean;
  mergedIntoId: string | null;
}

const LINKABLE_USER_SELECT = { id: true, phone: true, phoneVerifiedAt: true, zaloId: true, isBlocked: true, mergedIntoId: true } as const;

/**
 * Gắn mọi claim PHONE chưa có chủ của SĐT này vào thành viên (đủ điều kiện nhận; mốc xác minh cũ thì claim gắn nhưng vào REVIEW). Chạy được song song từ đăng nhập và cron: khoá
 * advisory theo SĐT xếp hàng, mỗi claim chỉ gắn một lần nhờ điều kiện `userId IS NULL` trong UPDATE, nên hai phiên cùng SĐT không gắn
 * đôi, không báo đôi. Claim tìm theo `orderPhone` (SĐT lúc tạo claim), không theo SĐT hiện trên đơn (nhân viên sửa được).
 *
 * Mỗi claim được KIỂM LẠI như lúc tạo (evaluateChatClaim với thành viên này): nhân viên, ngưỡng tự duyệt, hạng nhân điểm. Điểm tăng
 * vì hệ số hạng chỉ được lên tới phần trần tháng còn lại (settlePoints, không dưới điểm đã kiểm), nên `points` luôn là điểm ĐÃ KIỂM
 * và releaseClaim chỉ phải kiểm lại khi điểm lúc cộng vượt mức đó. SĐT trên đơn đã đổi thì không gắn, chuyển REVIEW. HELD_NO_MEMBER còn
 * hạn quay lại PENDING (cron cộng ở lượt kế). Không bao giờ ném.
 */
export async function linkClaimsByPhone(prisma: PrismaService, deps: ChatDeps, user: LinkableUser, now: Date = new Date()): Promise<LinkResult> {
  const none: LinkResult = { linked: 0, pendingPoints: 0 };
  try {
    if (!deps.config) return none;
    const cfg = await loadChatConfig(deps.config);
    if (!cfg.enabled) return none;
    const verify: PhoneVerify = { now, maxDays: cfg.phoneVerifiedMaxDays };
    const phone = linkableMemberPhone(user);
    if (!phone) return none;
    // Đọc nhanh không khoá: phần lớn lượt đăng nhập/refresh không có claim chờ nên không phải mở transaction.
    const waiting = await prisma.externalPointsClaim.findFirst({
      where: { kind: 'PHONE', userId: null, state: { in: [...LINKABLE] }, orderPhone: phone },
      select: { id: true },
    });
    if (!waiting) return none;
    const staffMap = await loadStaffMap(deps.config);

    const out = await prisma.$transaction(
      async (tx) => {
        await advisoryPhoneLock(tx, phone);
        const member = await resolveMemberByPhone(tx, phone, verify);
        if (!member) return { ids: [] as string[], pendingPoints: 0 };
        const phoneIsStaff = await phoneBelongsToStaff(tx, phone);
        const claims = await tx.externalPointsClaim.findMany({
          where: { kind: 'PHONE', userId: null, state: { in: [...LINKABLE] }, orderPhone: phone },
          orderBy: { createdAt: 'asc' },
          take: 100,
          select: { id: true, externalOrderId: true, creatorRef: true },
        });
        // Khoá người tạo của MỌI claim ngay sau khoá SĐT, theo thứ tự chữ: lấy dần theo claim thì hai lần liên kết (SĐT khác nhau, cùng
        // hai người tạo theo thứ tự ngược nhau) khoá ngược chiều và deadlock.
        for (const ref of [...new Set(claims.map((c) => c.creatorRef).filter((r): r is string => !!r))].sort()) await advisoryCreatorLock(tx, ref);
        const ids: string[] = [];
        let pendingPoints = 0;
        for (const c of claims) {
          await tx.$queryRaw`SELECT "id" FROM "external_orders" WHERE "id" = ${c.externalOrderId} FOR SHARE`;
          await tx.$queryRaw`SELECT "id" FROM "external_points_claims" WHERE "id" = ${c.id} FOR UPDATE`;
          const fresh = await tx.externalPointsClaim.findUnique({ where: { id: c.id }, include: { externalOrder: true } });
          if (!fresh || fresh.userId !== null || !(LINKABLE as readonly string[]).includes(fresh.state)) continue;
          if (fresh.state === 'HELD_NO_MEMBER' && (!fresh.holdUntil || fresh.holdUntil.getTime() <= now.getTime())) continue;
          const order = fresh.externalOrder;
          if (phoneDiffers(fresh.orderPhone, order.phone) && fresh.decidedById === null) {
            if (fresh.state !== 'REVIEW') {
              const reason = `SĐT trên đơn đã đổi (đuôi ${last3(fresh.orderPhone!)} thành ${last3(order.phone!)}), cần nhân viên kiểm`;
              const moved = await tx.externalPointsClaim.updateMany({ where: { id: fresh.id, userId: null, state: fresh.state }, data: { state: 'REVIEW', reviewReason: reason, holdUntil: null } });
              if (moved.count === 1) {
                await recordClaimEvent(tx, { claimId: fresh.id, action: 'PHONE_CHANGED', fromState: fresh.state, toState: 'REVIEW', orderStatus: order.status, note: reason });
              }
            }
            continue;
          }
          const lastPayload = (order.lastPayload ?? {}) as Record<string, unknown>;
          const creatorIsMember = await creatorIsReceiver(tx, creatorStaffUserId(pancakeCreatorRefs(lastPayload), staffMap), member.id, phone);
          const since = startOfVnMonth(fresh.createdAt);
          const decision = evaluateChatClaim({
            now,
            cfg,
            order: {
              status: order.status,
              pancakeStatus: order.pancakeStatus,
              hasExtendCode: chatCarrierOk(lastPayload, null),
              hasTrackingCode: order.trackingCode !== null || order.trackingCodes.length > 0,
              goodsValue: order.goodsValue,
              insertedAt: order.pancakeInsertedAt ?? order.firstSeenAt,
              phone,
            },
            member,
            phoneIsStaff,
            // Trần tháng của SĐT được chốt riêng bằng settlePoints bên dưới (chốt xuống thay vì đẩy claim đã qua kiểm sang REVIEW).
            monthPoints: 0,
            creatorIsMember,
            creatorMonthPoints: fresh.creatorRef ? await creatorMonthPoints(tx, { creatorRef: fresh.creatorRef, since, excludeClaimId: fresh.id }) : null,
          });
          // SKIP (đơn đã đóng, quá tuổi, không vận đơn...): không còn đủ điều kiện như lúc tạo, nên người kiểm quyết thay vì cộng thô
          // bỏ qua các luật còn lại (người tạo đơn, trần). Điểm giữ nguyên mức đã kiểm.
          const newReason = decision.kind === 'CLAIM' ? decision.reviewReason : `Kiểm lại khi liên kết SĐT: ${CHAT_SKIP_TEXT[decision.reason]}`;
          const newPoints = decision.kind === 'CLAIM' ? decision.points : fresh.points;
          const toReview = fresh.state === 'REVIEW' || newReason !== null;
          const state = toReview ? 'REVIEW' : 'PENDING';
          const reviewReason = fresh.state === 'REVIEW' ? fresh.reviewReason : newReason;
          // Claim chờ duyệt giữ điểm đã kiểm: duyệt sẽ tính lại và chốt trần theo điểm đó.
          let points = fresh.points;
          let settleNote: string | null = null;
          if (!toReview) {
            if (newPoints > fresh.points) {
              const others = await chatMonthPoints(tx, { phone, userId: member.id, since, excludeClaimId: fresh.id });
              points = settlePoints({ newPoints, checkedPoints: fresh.points, others, cap: cfg.monthlyPointsCap });
              if (points < newPoints) settleNote = `Chốt theo trần tháng: ${points} thay vì ${newPoints} điểm`;
            } else {
              points = newPoints;
            }
          }
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
            note: toReview && fresh.state !== 'REVIEW' ? reviewReason : (settleNote ?? `Liên kết theo SĐT, ${points} điểm`),
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
 * Cron: gom các SĐT đang có claim chờ mà đã có thành viên đủ điều kiện (thành viên đăng ký trước khi claim tới, hoặc đăng nhập đã lỡ)
 * rồi liên kết. Chỉ lấy thành viên có thể nhận (không bị khoá/gộp/vãng lai; SĐT xác minh cũ vẫn lấy, claim sẽ vào REVIEW) và claim còn liên kết được (chưa quá hạn
 * giữ, SĐT đơn chưa bị đổi), lô xếp theo claim chờ lâu nhất, để claim không thể liên kết không chiếm chỗ mãi. Chạy song song với đăng nhập an toàn nhờ khoá SĐT và điều kiện `userId IS NULL`.
 */
export async function linkWaitingClaims(prisma: PrismaService, deps: ChatDeps, now: Date = new Date(), limit: number = SWEEP_BATCH): Promise<number> {
  if (!deps.config) return 0;
  const cfg = await loadChatConfig(deps.config);
  if (!cfg.enabled) return 0;
  const rows = await prisma.$queryRaw<{ id: string }[]>`
    SELECT u."id" FROM "external_points_claims" c
      JOIN "users" u ON u."phone" = c."orderPhone"
      JOIN "external_orders" o ON o."id" = c."externalOrderId"
     WHERE c."kind" = 'PHONE' AND c."userId" IS NULL AND c."state" IN ('PENDING', 'REVIEW', 'HELD_NO_MEMBER')
       AND NOT (c."state" = 'HELD_NO_MEMBER' AND (c."holdUntil" IS NULL OR c."holdUntil" <= ${now}))
       AND (o."phone" IS NULL OR o."phone" = c."orderPhone" OR c."decidedById" IS NOT NULL)
       AND u."isBlocked" = false AND u."mergedIntoId" IS NULL AND u."zaloId" IS NOT NULL AND u."zaloId" NOT LIKE 'guest!_%' ESCAPE '!'
     GROUP BY u."id" ORDER BY MIN(c."createdAt") ASC, u."id" ASC
     LIMIT ${limit}`;
  let linked = 0;
  for (const { id } of rows) {
    const u = await prisma.user.findUnique({ where: { id }, select: LINKABLE_USER_SELECT });
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
    select: { id: true, orderPhone: true },
  });
  let lapsed = 0;
  for (const c of due) {
    try {
      const ok = await prisma.$transaction(async (tx) => {
        if (c.orderPhone) await advisoryPhoneLock(tx, c.orderPhone);
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
 * Đơn chat đã nạp lúc cờ còn tắt (hoặc ingest từng lỗi) mà chưa có claim: tạo bù, tối đa `limit` mỗi lượt. Chỉ đơn còn mở, còn trong
 * tuổi tối đa; `ensureChatClaim` tự kiểm mọi điều kiện còn lại. Đơn đã xét mà bị bỏ qua được đánh dấu `chatCheckedAt = updatedAt`
 * (SQL tay để không đẩy updatedAt): lần sau chỉ xét lại khi đơn thay đổi, nên không chiếm đầu lô mãi.
 */
export async function backfillChatClaims(prisma: PrismaService, deps: ChatDeps, now: Date = new Date(), limit: number = SWEEP_BATCH): Promise<number> {
  if (!deps.config) return 0;
  const cfg = await loadChatConfig(deps.config);
  if (!cfg.enabled) return 0;
  const since = new Date(now.getTime() - cfg.maxAgeDays * 864e5);
  // Tập con thô của điều kiện vận đơn (extend_code luôn là mã vận đơn đầu tiên): đơn chưa có vận đơn không chiếm chỗ của đơn đủ điều kiện.
  const carrier = cfg.requireCarrier ? Prisma.sql`AND ("pancakeStatus" = 16 OR "trackingCode" IS NOT NULL)` : Prisma.empty;
  const orders = await prisma.$queryRaw<{ pancakeOrderId: string }[]>`
    SELECT "pancakeOrderId" FROM "external_orders" o
     WHERE o."source" = 'CHAT' AND o."phone" IS NOT NULL AND o."status" IN ('OPEN', 'DELIVERED', 'PARTIAL_RETURN')
       AND o."firstSeenAt" >= ${since}
       AND NOT EXISTS (SELECT 1 FROM "external_points_claims" c WHERE c."externalOrderId" = o."id")
       AND (o."chatCheckedAt" IS NULL OR o."chatCheckedAt" < o."updatedAt")
       ${carrier}
     ORDER BY o."updatedAt" DESC
     LIMIT ${limit}`;
  let created = 0;
  for (const o of orders) {
    const outcome = await ensureChatClaim(prisma, deps, o.pancakeOrderId, now);
    if (outcome === 'CREATED') created++;
    // Lỗi tạm thời (ERROR) thì xét lại lượt sau; còn lại đã có kết luận cho phiên bản hiện tại của đơn.
    if (outcome !== 'ERROR') await prisma.$executeRaw`UPDATE "external_orders" SET "chatCheckedAt" = "updatedAt" WHERE "pancakeOrderId" = ${o.pancakeOrderId}`;
  }
  return created;
}

export { holdUntilOf, releaseAtOf };
