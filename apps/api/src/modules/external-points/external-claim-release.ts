import { Logger } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { formatPoints } from '../../common/format-points';
import type { PrismaService } from '../../prisma/prisma.service';
import { pointsExpiryFrom } from '../loyalty/points-expiry-date';
import { applyPointsDelta } from '../loyalty/points-ledger';
import type { SystemConfigService } from '../system-config/system-config.service';
import { loadClaimConfig } from './external-claim.config';
import type { ClaimNotifier } from './external-claim-status';
import { advisoryPhoneLock, last3, phoneDiffers, tierMultiplierOf } from './external-chat.claim';
import { loadChatConfig, type ChatConfig } from './external-chat.config';
import { holdUntilOf, PHONE_STALE_REASON, phoneVerifiedFresh, releaseAtOf, STALE_APPROVE_MARK } from './external-chat.rules';
import { startOfNextVnMonth, startOfVnMonth } from '../../common/vn-time';
import { decidedAtPartialReturn, recordClaimEvent } from './external-claim-audit';
import { recordExtClaimEvent } from './external-claim-events';
import { advisoryUserLock } from './external-claim.service';
import { lockOrderThenClaim } from './external-claim-status';
import { settlePoints } from './external-claim.rules';
import { claimPoints, maskClaimCode } from './external-points-rate';

const logger = new Logger('ExternalClaimRelease');
const BATCH = 100;
const MAX_BATCHES = 20;
const RELEASE_LOCK = 'external-points.release';

export type ReleaseOutcome = 'CREDITED' | 'SKIPPED' | 'TO_REVIEW' | 'HELD';

/** Claim đã được duyệt kèm ghi chú khi mốc xác minh SĐT còn cũ (xem approve): người duyệt đã kiểm người nhận nên không bắt kiểm lại. */
async function approvedDespiteStale(tx: Pick<Prisma.TransactionClient, 'externalClaimEvent'>, row: { id: string; decidedById: string | null }): Promise<boolean> {
  if (row.decidedById === null) return false;
  const e = await tx.externalClaimEvent.findFirst({ where: { claimId: row.id, action: 'APPROVE', note: { contains: STALE_APPROVE_MARK } }, select: { id: true } });
  return !!e;
}

/**
 * Cộng điểm một claim tới hạn trong MỘT transaction: khoá claim rồi users, chuyển PENDING sang CREDITED có điều kiện trạng thái, kiểm
 * lại đơn vẫn DELIVERED đủ hạn, ghi đúng một dòng sổ (skipDuplicates + unique (reason, refId)). Hai lượt cộng song song cùng claim
 * thì một lượt thấy claim đã rời PENDING và bỏ qua; điểm chốt theo tiền hàng mới nhất của đơn lúc cộng.
 *
 * Claim PHONE (đơn chat): chỉ chạy khi `opts.chat` bật (cờ tắt thì không cộng, không giữ). Khoá theo SĐT thay vì theo khách (trần tháng
 * tính theo SĐT). Chưa có thành viên thì tới hạn chuyển HELD_NO_MEMBER thay vì cộng; có thành viên thì điểm chốt theo hệ số hạng LÚC CỘNG.
 */
export async function releaseClaim(
  prisma: PrismaService,
  claimId: string,
  opts: { pendingDays: number; expiryMonths: unknown; now?: Date; reviewAboveVnd?: number; monthlyPointsCap?: number; chat?: ChatConfig },
): Promise<{ outcome: ReleaseOutcome; userId: string | null; points: number; code: string; kind?: 'SCAN' | 'PHONE'; countsForTier?: boolean }> {
  const now = opts.now ?? new Date();
  const skipped = { outcome: 'SKIPPED' as const, userId: null, points: 0, code: '' };
  return prisma.$transaction(async (tx) => {
    // Khoá đơn (FOR SHARE) TRƯỚC khi đọc trạng thái: webhook huỷ/hoàn đang ghi đơn phải xong, hoặc ta xong trước rồi nó thấy claim CREDITED và đảo.
    // Thứ tự khoá: advisory theo khách (cùng đường duyệt, để trần tháng chốt tuần tự), đơn, claim, users.
    const head = await tx.externalPointsClaim.findUnique({ where: { id: claimId }, select: { userId: true, kind: true, orderPhone: true } });
    if (!head) return skipped;
    const chat = head.kind === 'PHONE';
    if (chat) {
      if (!opts.chat?.enabled) return skipped;
      // Khoá theo SĐT lúc tạo claim (trần tháng tính theo SĐT, liên kết dùng cùng khoá). Claim đã gắn thành viên mà SĐT đơn đã bị xoá thì
      // dùng SĐT hiện tại của thành viên; claim chưa có chủ và không còn SĐT không có ai liên kết được nên không cần khoá.
      let lockPhone = head.orderPhone;
      if (!lockPhone && head.userId) lockPhone = (await tx.user.findUnique({ where: { id: head.userId }, select: { phone: true } }))?.phone ?? null;
      if (lockPhone) await advisoryPhoneLock(tx, lockPhone);
      else if (head.userId) await advisoryUserLock(tx, head.userId);
    } else {
      if (!head.userId) return skipped;
      await advisoryUserLock(tx, head.userId);
    }
    if (!(await lockOrderThenClaim(tx, claimId))) return skipped;
    const [row] = await tx.$queryRaw<{ id: string; userId: string | null; externalOrderId: string; ratePct: string; points: number; decidedById: string | null; releaseAt: Date | null; createdAt: Date; countsForTier: boolean; orderPhone: string | null; multiplier: string; creditedGoodsValue: number | null }[]>`
      SELECT "id", "userId", "externalOrderId", "ratePct"::text AS "ratePct", "multiplier"::text AS "multiplier", "points", "decidedById", "releaseAt", "createdAt", "countsForTier", "orderPhone", "creditedGoodsValue" FROM "external_points_claims"
       WHERE "id" = ${claimId} AND "state" = 'PENDING' FOR UPDATE`;
    if (!row || (!row.userId && !chat)) return skipped;
    const order = await tx.externalOrder.findUniqueOrThrow({
      where: { id: row.externalOrderId },
      select: { pancakeOrderId: true, source: true, status: true, deliveredAt: true, goodsValue: true, trackingCode: true, phone: true },
    });
    // SĐT trên đơn khác SĐT lúc tạo claim (nhân viên sửa đơn): không cộng theo số nào, người kiểm quyết. Claim đã có người duyệt thì thôi.
    if (chat && row.decidedById === null && phoneDiffers(row.orderPhone, order.phone)) {
      const reason = `SĐT trên đơn đã đổi (đuôi ${last3(row.orderPhone!)} thành ${last3(order.phone!)}), cần nhân viên kiểm`;
      const moved = await tx.externalPointsClaim.updateMany({ where: { id: row.id, state: 'PENDING' }, data: { state: 'REVIEW', reviewReason: reason, holdUntil: null } });
      if (moved.count !== 1) return skipped;
      await recordClaimEvent(tx, { claimId: row.id, action: 'PHONE_CHANGED', fromState: 'PENDING', toState: 'REVIEW', userIdBefore: row.userId, userIdAfter: row.userId, note: reason, orderStatus: order.status });
      return { outcome: 'TO_REVIEW' as const, userId: row.userId, points: 0, code: maskClaimCode(order.trackingCode), kind: 'PHONE' as const };
    }
    const code = maskClaimCode(order.trackingCode);
    const nowMs = now.getTime();
    // Đơn đã giao: giao + hạn giữ. Đơn hoàn một phần: chỉ claim đã có người duyệt, theo mốc cộng nhân viên đặt lúc duyệt.
    const dueDelivered = order.status === 'DELIVERED' && order.deliveredAt !== null && order.deliveredAt.getTime() + opts.pendingDays * 864e5 <= nowMs;
    let duePartial = false;
    if (order.status === 'PARTIAL_RETURN') {
      // Chỉ quyết định đưa ra khi đơn đã hoàn một phần mới đủ để cộng; duyệt từ trước đó phải được kiểm lại.
      if (row.decidedById !== null && (await decidedAtPartialReturn(tx, row.id))) {
        duePartial = row.releaseAt !== null && row.releaseAt.getTime() <= nowMs;
      } else {
        const reason = 'Đơn hoàn một phần trên sàn, cần nhân viên kiểm';
        await tx.externalPointsClaim.updateMany({ where: { id: row.id, state: 'PENDING' }, data: { state: 'REVIEW', reviewReason: reason } });
        await recordClaimEvent(tx, { claimId: row.id, action: 'TO_REVIEW', fromState: 'PENDING', toState: 'REVIEW', userIdBefore: row.userId, userIdAfter: row.userId, note: reason, orderStatus: order.status });
        return { outcome: 'TO_REVIEW' as const, userId: row.userId, points: 0, code };
      }
    }
    if (!dueDelivered && !duePartial) return skipped;

    if (chat && !row.userId && !row.orderPhone) {
      // Chưa có chủ mà SĐT lúc tạo claim cũng đã bị xoá (retention, vd đơn bị huỷ rồi giao lại): không còn cách nào liên kết nên không
      // giữ chờ rồi để hết hạn mất điểm; người kiểm quyết.
      const reason = 'Claim chưa có chủ và không còn SĐT để liên kết, cần nhân viên kiểm';
      await tx.externalPointsClaim.updateMany({ where: { id: row.id, state: 'PENDING', userId: null }, data: { state: 'REVIEW', reviewReason: reason } });
      await recordClaimEvent(tx, { claimId: row.id, action: 'TO_REVIEW', fromState: 'PENDING', toState: 'REVIEW', note: reason, orderStatus: order.status });
      return { outcome: 'TO_REVIEW' as const, userId: null, points: 0, code, kind: 'PHONE' as const };
    }
    if (chat && !row.userId) {
      // Chưa có thành viên: giữ điểm tới holdUntil (mốc cộng + loyalty.chat_unclaimed_hold_days), không ghi sổ.
      const dueAt = dueDelivered && order.deliveredAt ? releaseAtOf(order.deliveredAt, { pendingDays: opts.pendingDays }) : (row.releaseAt ?? now);
      const holdUntil = holdUntilOf(dueAt, opts.chat!);
      const held = await tx.externalPointsClaim.updateMany({ where: { id: row.id, state: 'PENDING', userId: null }, data: { state: 'HELD_NO_MEMBER', holdUntil } });
      if (held.count !== 1) return skipped;
      await recordClaimEvent(tx, { claimId: row.id, action: 'HOLD_NO_MEMBER', fromState: 'PENDING', toState: 'HELD_NO_MEMBER', note: `Giữ điểm tới ${holdUntil.toISOString()}`, orderStatus: order.status });
      return { outcome: 'HELD' as const, userId: null, points: 0, code, kind: 'PHONE' as const };
    }
    const userId = row.userId!;
    const kind = chat ? ('PHONE' as const) : ('SCAN' as const);

    const [user] = await tx.$queryRaw<{ isBlocked: boolean; role: string; phone: string | null; tierId: string | null; phoneVerifiedAt: Date | null }[]>`
      SELECT "isBlocked", "role"::text AS "role", "phone", "tierId", "phoneVerifiedAt" FROM "users" WHERE "id" = ${userId} FOR UPDATE`;
    let multiplier = 1;
    if (chat && user) {
      const tier = user.tierId ? await tx.membershipTier.findUnique({ where: { id: user.tierId }, select: { pointMultiplier: true } }) : null;
      // Điểm đã chốt ở lần kiểm gần nhất (tạo, liên kết, duyệt) là điểm được cộng: hạng tăng sau đó không nâng điểm (claim đã qua kiểm
      // trần/ngưỡng theo hệ số cũ), hạng giảm thì hạ theo.
      multiplier = Math.min(tierMultiplierOf({ tier }), Number(row.multiplier));
    }
    const points = claimPoints(order.goodsValue, Number(row.ratePct), multiplier);
    let reviewReason: string | null = null;
    if (!user) reviewReason = 'Tài khoản không còn';
    else if (user.isBlocked) reviewReason = 'Tài khoản đang bị khoá';
    else if (points === null || points <= 0) reviewReason = 'Chưa tính được tiền hàng của đơn';
    else if (chat && row.decidedById === null && (row.orderPhone ?? order.phone) !== null && user.phone !== (row.orderPhone ?? order.phone)) reviewReason = 'SĐT thành viên không còn khớp SĐT trên đơn';
    else if (chat && (user.role === 'STAFF' || user.role === 'ADMIN') && row.decidedById === null) reviewReason = 'Thành viên là nhân viên Tubu Tree, cần người khác duyệt';
    else if (chat && !phoneVerifiedFresh(user.phoneVerifiedAt, { now, maxDays: opts.chat!.phoneVerifiedMaxDays }) && !(await approvedDespiteStale(tx, row))) reviewReason = PHONE_STALE_REASON;
    let finalPoints = points ?? 0;
    let settleNote: string | null = null;
    if (!reviewReason && chat) {
      // Tiền hàng lớn hơn lúc kiểm: các luật chỉ kiểm lúc tạo/liên kết/duyệt (trần theo người tạo, ngưỡng) không chạy lại được ở đây, người
      // kiểm quyết. Duyệt đặt lại mốc tiền hàng đã kiểm nên chỉ vào REVIEW một lần cho mỗi lần tăng. Bằng hoặc thấp hơn thì cộng không quá điểm đã kiểm.
      const checkedGoods = row.creditedGoodsValue;
      if (checkedGoods !== null ? (order.goodsValue ?? 0) > checkedGoods : (points ?? 0) > row.points) {
        reviewReason = 'Tiền hàng tăng sau khi kiểm (điểm tính lại lớn hơn điểm đã duyệt), cần nhân viên kiểm';
      } else {
        finalPoints = Math.min(points ?? 0, row.points);
      }
    } else if (!reviewReason && row.decidedById !== null && row.creditedGoodsValue !== null && (order.goodsValue ?? 0) <= row.creditedGoodsValue) {
      // Người kiểm đã duyệt đúng tiền hàng này (hoặc cao hơn) và chốt điểm theo trần lúc duyệt: cộng đúng số đã chốt. Chạy lại ngưỡng tự duyệt
      // và trần ở đây sẽ đưa claim về REVIEW ở mỗi lần cộng, duyệt bao nhiêu lần cũng không tới được bước cộng.
      finalPoints = Math.min(points ?? 0, row.points);
    } else if (!reviewReason && points !== null && points > row.points) {
      // Tiền hàng tăng sau lúc claim qua kiểm: vượt ngưỡng tự duyệt thì người kiểm lại; chỉ vượt trần tháng thì cộng ở mức chốt, không dưới điểm đã kiểm.
      const reviewAbove = opts.reviewAboveVnd ?? 2_000_000;
      const cap = opts.monthlyPointsCap ?? 200_000;
      if ((order.goodsValue ?? 0) > reviewAbove) {
        reviewReason = 'Tiền hàng tăng vượt ngưỡng tự duyệt';
      } else {
        const others =
          (
            await tx.externalPointsClaim.aggregate({
              where: { userId, kind: 'SCAN', id: { not: row.id }, createdAt: { gte: startOfVnMonth(row.createdAt), lt: startOfNextVnMonth(row.createdAt) }, state: { in: ['PENDING', 'REVIEW', 'CREDITED'] } },
              _sum: { points: true },
            })
          )._sum.points ?? 0;
        finalPoints = settlePoints({ newPoints: points, checkedPoints: row.points, others, cap });
        if (finalPoints < points) settleNote = `Chốt theo trần tháng: ${finalPoints} thay vì ${points} điểm`;
      }
    }
    if (reviewReason) {
      await tx.externalPointsClaim.updateMany({ where: { id: row.id, state: 'PENDING' }, data: { state: 'REVIEW', reviewReason } });
      await recordClaimEvent(tx, { claimId: row.id, action: 'TO_REVIEW', fromState: 'PENDING', toState: 'REVIEW', userIdBefore: row.userId, userIdAfter: row.userId, note: reviewReason });
      return { outcome: 'TO_REVIEW' as const, userId: row.userId, points: 0, code, kind };
    }

    const moved = await tx.externalPointsClaim.updateMany({
      where: { id: row.id, state: 'PENDING' },
      data: { state: 'CREDITED', creditedAt: now, points: finalPoints, ...(chat ? { multiplier, creditedGoodsValue: order.goodsValue } : {}) },
    });
    if (moved.count !== 1) return skipped;
    const prefix = chat ? 'PANCAKE_CHAT_ORDER' : 'MARKETPLACE_ORDER';
    const res = await applyPointsDelta(tx, {
      userId,
      delta: finalPoints,
      lot: 'STANDARD',
      reason: `${prefix}:${order.pancakeOrderId}`,
      refType: 'EXTERNAL_ORDER',
      refId: row.id,
      expiresAt: pointsExpiryFrom(now, opts.expiryMonths),
      skipDuplicates: true,
    });
    // Dòng sổ đã có mà claim vẫn PENDING là sổ và claim lệch nhau: rollback, không đoán.
    if (!res.applied) throw new Error(`releaseClaim ${row.id}: đã có dòng sổ ${prefix}:${order.pancakeOrderId}`);
    await tx.externalPointsClaim.update({ where: { id: row.id }, data: { pointsTxId: res.entryId } });
    await recordClaimEvent(tx, { claimId: row.id, action: 'CREDIT', fromState: 'PENDING', toState: 'CREDITED', userIdBefore: row.userId, userIdAfter: row.userId, note: settleNote ?? `${finalPoints} điểm` });
    if (!chat) {
      const channel = (await tx.externalOrder.findUnique({ where: { id: row.externalOrderId }, select: { channel: true } }))?.channel ?? null;
      await recordExtClaimEvent(tx, {
        name: 'ext_claim_credited',
        userId,
        at: now,
        props: { points: finalPoints, channel, daysFromClaim: Math.max(0, Math.floor((now.getTime() - row.createdAt.getTime()) / 864e5)) },
      });
    }
    return { outcome: 'CREDITED' as const, userId, points: finalPoints, code, kind, countsForTier: row.countsForTier };
  });
}

/**
 * Cron 30 phút: cộng mọi claim PENDING có đơn đã giao đủ `loyalty.external_pending_days`. Khoá advisory theo transaction chặn hai
 * lượt chạy chồng nhau (hai replica, hai lần gọi); mỗi claim vẫn tự an toàn nhờ điều kiện trạng thái nên khoá này chỉ để khỏi làm trùng việc.
 */
export async function releaseDueClaims(
  prisma: PrismaService,
  config: Pick<SystemConfigService, 'get'>,
  notifier: ClaimNotifier | undefined,
  now: Date = new Date(),
  hooks: { recalcTier?: (userId: string) => Promise<void> } = {},
): Promise<{ credited: number; toReview: number; held: number; skippedLocked: boolean }> {
  const cfg = await loadClaimConfig(config);
  const chatCfg = await loadChatConfig(config);
  // Mỗi loại claim có cờ riêng: cờ tắt thì claim loại đó đứng yên (không cộng, không giữ).
  const kinds: ('SCAN' | 'PHONE')[] = [...(cfg.enabled ? (['SCAN'] as const) : []), ...(chatCfg.enabled ? (['PHONE'] as const) : [])];
  if (kinds.length === 0) return { credited: 0, toReview: 0, held: 0, skippedLocked: false };
  const expiryMonths = await config.get<unknown>('loyalty.point_expire_months', 12);
  const cutoff = new Date(now.getTime() - cfg.pendingDays * 864e5);
  let credited = 0;
  let toReview = 0;
  let held = 0;
  let skippedLocked = false;
  await prisma.$transaction(
    async (lockTx) => {
      const [lock] = await lockTx.$queryRaw<{ ok: boolean }[]>`SELECT pg_try_advisory_xact_lock(hashtext(${RELEASE_LOCK})) AS "ok"`;
      if (!lock?.ok) {
        skippedLocked = true;
        return;
      }
      for (let b = 0; b < MAX_BATCHES; b++) {
        const due = await prisma.externalPointsClaim.findMany({
          where: {
            state: 'PENDING',
            kind: { in: kinds },
            // Claim PHONE chưa có thành viên vẫn được xét để chuyển HELD_NO_MEMBER; claim SCAN luôn có chủ.
            OR: [{ userId: { not: null } }, { kind: 'PHONE' }],
            AND: [
              {
                OR: [
                  { externalOrder: { status: 'DELIVERED', deliveredAt: { lte: cutoff } } },
                  { decidedById: { not: null }, releaseAt: { lte: now }, externalOrder: { status: 'PARTIAL_RETURN' } },
                ],
              },
            ],
          },
          orderBy: { createdAt: 'asc' },
          take: BATCH,
          select: { id: true },
        });
        if (due.length === 0) break;
        let progressed = 0;
        for (const { id } of due) {
          try {
            const res = await releaseClaim(prisma, id, { pendingDays: cfg.pendingDays, expiryMonths, now, reviewAboveVnd: cfg.reviewAboveVnd, monthlyPointsCap: cfg.monthlyPointsCap, chat: chatCfg });
            if (res.outcome === 'CREDITED') {
              credited++;
              progressed++;
              const isChat = res.kind === 'PHONE';
              if (notifier && res.userId) {
                await notifier
                  .notify(
                    res.userId,
                    isChat ? 'CHAT_ORDER_POINTS_CREDITED' : 'EXTERNAL_POINTS_CREDITED',
                    { points: formatPoints(res.points), code: res.code },
                    { dedupeKey: `${isChat ? 'chat-credit' : 'ext-credit'}:${id}` },
                  )
                  .catch((e: unknown) => logger.warn(`Gửi thông báo cộng điểm lỗi claim=${id}: ${e instanceof Error ? e.message : e}`));
              }
              // Đơn chat tính vào xét hạng: cộng xong thì hạng phải được tính lại ngay (sau commit, lỗi không làm hỏng lượt cộng).
              if (res.countsForTier && res.userId && hooks.recalcTier) {
                await hooks.recalcTier(res.userId).catch((e: unknown) => logger.warn(`recalcTier sau cộng điểm chat lỗi user=${res.userId}: ${e instanceof Error ? e.message : e}`));
              }
            } else if (res.outcome === 'HELD') {
              held++;
              progressed++;
            } else if (res.outcome === 'TO_REVIEW') {
              toReview++;
              progressed++;
            }
          } catch (err) {
            logger.error(`releaseClaim ${id} lỗi: ${err instanceof Error ? err.message : err}`);
          }
        }
        if (progressed === 0) break;
      }
    },
    { timeout: 10 * 60_000, maxWait: 10_000 },
  );
  return { credited, toReview, held, skippedLocked };
}
