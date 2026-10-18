import { Logger } from '@nestjs/common';
import { formatPoints } from '../../common/format-points';
import type { PrismaService } from '../../prisma/prisma.service';
import { pointsExpiryFrom } from '../loyalty/points-expiry-date';
import { applyPointsDelta } from '../loyalty/points-ledger';
import type { SystemConfigService } from '../system-config/system-config.service';
import { loadClaimConfig } from './external-claim.config';
import type { ClaimNotifier } from './external-claim-status';
import { startOfVnMonth } from '../../common/vn-time';
import { decidedAtPartialReturn, recordClaimEvent } from './external-claim-audit';
import { advisoryUserLock } from './external-claim.service';
import { lockOrderThenClaim } from './external-claim-status';
import { settlePoints } from './external-claim.rules';
import { claimPoints, maskClaimCode } from './external-points-rate';

const logger = new Logger('ExternalClaimRelease');
const BATCH = 100;
const MAX_BATCHES = 20;
const RELEASE_LOCK = 'external-points.release';

export type ReleaseOutcome = 'CREDITED' | 'SKIPPED' | 'TO_REVIEW';

/**
 * Cộng điểm một claim tới hạn trong MỘT transaction: khoá claim rồi users, chuyển PENDING sang CREDITED có điều kiện trạng thái, kiểm
 * lại đơn vẫn DELIVERED đủ hạn, ghi đúng một dòng sổ (skipDuplicates + unique (reason, refId)). Hai lượt cộng song song cùng claim
 * thì một lượt thấy claim đã rời PENDING và bỏ qua; điểm chốt theo tiền hàng mới nhất của đơn lúc cộng.
 */
export async function releaseClaim(
  prisma: PrismaService,
  claimId: string,
  opts: { pendingDays: number; expiryMonths: unknown; now?: Date; reviewAboveVnd?: number; monthlyPointsCap?: number },
): Promise<{ outcome: ReleaseOutcome; userId: string | null; points: number; code: string }> {
  const now = opts.now ?? new Date();
  const skipped = { outcome: 'SKIPPED' as const, userId: null, points: 0, code: '' };
  return prisma.$transaction(async (tx) => {
    // Khoá đơn (FOR SHARE) TRƯỚC khi đọc trạng thái: webhook huỷ/hoàn đang ghi đơn phải xong, hoặc ta xong trước rồi nó thấy claim CREDITED và đảo.
    // Thứ tự khoá: advisory theo khách (cùng đường duyệt, để trần tháng chốt tuần tự), đơn, claim, users.
    const head = await tx.externalPointsClaim.findUnique({ where: { id: claimId }, select: { userId: true } });
    if (!head?.userId) return skipped;
    await advisoryUserLock(tx, head.userId);
    if (!(await lockOrderThenClaim(tx, claimId))) return skipped;
    const [row] = await tx.$queryRaw<{ id: string; userId: string | null; externalOrderId: string; ratePct: string; points: number; decidedById: string | null; releaseAt: Date | null; createdAt: Date }[]>`
      SELECT "id", "userId", "externalOrderId", "ratePct"::text AS "ratePct", "points", "decidedById", "releaseAt", "createdAt" FROM "external_points_claims"
       WHERE "id" = ${claimId} AND "state" = 'PENDING' FOR UPDATE`;
    if (!row || !row.userId) return skipped;
    const order = await tx.externalOrder.findUniqueOrThrow({
      where: { id: row.externalOrderId },
      select: { pancakeOrderId: true, source: true, status: true, deliveredAt: true, goodsValue: true, trackingCode: true },
    });
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

    const [user] = await tx.$queryRaw<{ isBlocked: boolean }[]>`SELECT "isBlocked" FROM "users" WHERE "id" = ${row.userId} FOR UPDATE`;
    const points = claimPoints(order.goodsValue, Number(row.ratePct));
    let reviewReason: string | null = null;
    if (!user) reviewReason = 'Tài khoản không còn';
    else if (user.isBlocked) reviewReason = 'Tài khoản đang bị khoá';
    else if (points === null || points <= 0) reviewReason = 'Chưa tính được tiền hàng của đơn';
    let finalPoints = points ?? 0;
    let settleNote: string | null = null;
    if (!reviewReason && points !== null && points > row.points) {
      // Tiền hàng tăng sau lúc claim qua kiểm: vượt ngưỡng tự duyệt thì người kiểm lại; chỉ vượt trần tháng thì cộng ở mức chốt, không dưới điểm đã kiểm.
      const reviewAbove = opts.reviewAboveVnd ?? 2_000_000;
      const cap = opts.monthlyPointsCap ?? 200_000;
      if ((order.goodsValue ?? 0) > reviewAbove) {
        reviewReason = 'Tiền hàng tăng vượt ngưỡng tự duyệt';
      } else {
        const month = await tx.externalPointsClaim.aggregate({
          where: { userId: row.userId, kind: 'SCAN', id: { not: row.id }, createdAt: { gte: startOfVnMonth(row.createdAt) }, state: { in: ['PENDING', 'REVIEW', 'CREDITED'] } },
          _sum: { points: true },
        });
        finalPoints = settlePoints({ newPoints: points, checkedPoints: row.points, others: month._sum.points ?? 0, cap });
        if (finalPoints < points) settleNote = `Chốt theo trần tháng: ${finalPoints} thay vì ${points} điểm`;
      }
    }
    if (reviewReason) {
      await tx.externalPointsClaim.updateMany({ where: { id: row.id, state: 'PENDING' }, data: { state: 'REVIEW', reviewReason } });
      await recordClaimEvent(tx, { claimId: row.id, action: 'TO_REVIEW', fromState: 'PENDING', toState: 'REVIEW', userIdBefore: row.userId, userIdAfter: row.userId, note: reviewReason });
      return { outcome: 'TO_REVIEW' as const, userId: row.userId, points: 0, code };
    }

    const moved = await tx.externalPointsClaim.updateMany({
      where: { id: row.id, state: 'PENDING' },
      data: { state: 'CREDITED', creditedAt: now, points: finalPoints },
    });
    if (moved.count !== 1) return skipped;
    const prefix = order.source === 'CHAT' ? 'PANCAKE_CHAT_ORDER' : 'MARKETPLACE_ORDER';
    const res = await applyPointsDelta(tx, {
      userId: row.userId,
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
    return { outcome: 'CREDITED' as const, userId: row.userId, points: finalPoints, code };
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
): Promise<{ credited: number; toReview: number; skippedLocked: boolean }> {
  const cfg = await loadClaimConfig(config);
  if (!cfg.enabled) return { credited: 0, toReview: 0, skippedLocked: false };
  const expiryMonths = await config.get<unknown>('loyalty.point_expire_months', 12);
  const cutoff = new Date(now.getTime() - cfg.pendingDays * 864e5);
  let credited = 0;
  let toReview = 0;
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
            userId: { not: null },
            OR: [
              { externalOrder: { status: 'DELIVERED', deliveredAt: { lte: cutoff } } },
              { decidedById: { not: null }, releaseAt: { lte: now }, externalOrder: { status: 'PARTIAL_RETURN' } },
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
            const res = await releaseClaim(prisma, id, { pendingDays: cfg.pendingDays, expiryMonths, now, reviewAboveVnd: cfg.reviewAboveVnd, monthlyPointsCap: cfg.monthlyPointsCap });
            if (res.outcome === 'CREDITED') {
              credited++;
              progressed++;
              if (notifier && res.userId) {
                await notifier
                  .notify(res.userId, 'EXTERNAL_POINTS_CREDITED', { points: formatPoints(res.points), code: res.code }, { dedupeKey: `ext-credit:${id}` })
                  .catch((e: unknown) => logger.warn(`Gửi EXTERNAL_POINTS_CREDITED lỗi claim=${id}: ${e instanceof Error ? e.message : e}`));
              }
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
  return { credited, toReview, skippedLocked };
}
