import type { Prisma } from '@prisma/client';
import { loadPointExpiryTxns, lotRecoverable, reviewLotKey } from '../loyalty/loyalty-expiry.service';
import { reviewRewardLockKey } from './review-eligibility';

/** Dòng sổ thu hồi thưởng đánh giá vì dòng hàng được đánh giá bị trả; unique theo reason (một lần cho mỗi đánh giá). */
export const reviewReturnReason = (reviewId: string): string => `REVIEW_RETURN:${reviewId}`;

export interface RewardedReview {
  id: string;
  userId: string;
  productId: string;
  pointsEarned: number;
}

/** Dòng thưởng của đánh giá đã tới hạn chưa; cùng quy tắc `expiresAt <= now` với cron hết hạn. */
async function rewardExpired(tx: Prisma.TransactionClient, userId: string, reviewId: string): Promise<boolean> {
  const credit = await tx.pointsTransaction.findFirst({
    where: { userId, refType: 'REVIEW', refId: reviewId, delta: { gt: 0 } },
    select: { expiresAt: true },
  });
  return credit?.expiresAt != null && credit.expiresAt.getTime() <= Date.now();
}

/**
 * Thu hồi điểm đã thưởng cho một đánh giá, trả số điểm thực trừ (0 khi không có gì để thu). Caller đã giữ khoá advisory của cặp
 * (khách, sản phẩm) và khoá dòng user, và truyền `balance` đọc cùng câu khoá đó.
 *
 * Điểm thưởng đã quá hạn thì cron đã (hoặc sẽ) trừ chính các điểm đó; thu hồi thêm là trừ hai lần và có thể kéo số dư âm. Thu
 * hồi tối đa phần lô đánh giá chưa mất theo sổ lô (lotRecoverable) và không quá số dư, nên số dư không bao giờ âm. Dòng gốc cũ
 * không hạn (trước PE-3) hoặc không tìm thấy lô thì thu hồi theo số đã thưởng. Không thu hồi được gì thì không ghi dòng nào;
 * điểm đã thưởng nằm ở dòng REVIEW:<slug> cùng refId nên phần thiếu tra lại được.
 */
export async function takeBackReviewReward(
  tx: Prisma.TransactionClient,
  review: RewardedReview,
  balance: number,
  reason: string,
): Promise<number> {
  if (review.pointsEarned <= 0 || (await rewardExpired(tx, review.userId, review.id))) return 0;
  const recoverable = lotRecoverable(await loadPointExpiryTxns(tx, review.userId), reviewLotKey(review.id));
  const take = Math.min(review.pointsEarned, recoverable ?? review.pointsEarned, Math.max(0, balance));
  if (take <= 0) return 0;
  await tx.pointsTransaction.create({
    data: { userId: review.userId, delta: -take, reason, refType: 'REVIEW', refId: review.id },
  });
  // Số dư đã đọc sau khoá dòng user nên không thể thiếu; ném để rollback thay vì để sổ lệch.
  const dec = await tx.user.updateMany({
    where: { id: review.userId, pointsBalance: { gte: take } },
    data: { pointsBalance: { decrement: take } },
  });
  if (dec.count !== 1) throw new Error(`Thu hồi thưởng đánh giá ${review.id}: số dư đổi giữa chừng`);
  return take;
}

const rewardedReviewsOf = (tx: Prisma.TransactionClient, orderId: string, productIds: readonly string[] | null) =>
  tx.review.findMany({
    where: { orderId, pointsEarned: { gt: 0 }, ...(productIds ? { productId: { in: [...productIds] } } : {}) },
    select: { id: true, userId: true, productId: true, pointsEarned: true },
    orderBy: [{ userId: 'asc' }, { productId: 'asc' }, { id: 'asc' }],
  });

/**
 * Khoá advisory của từng cặp (khách, sản phẩm) có đánh giá được thưởng trên đơn bị trả, TRƯỚC mọi ghi lên dòng users của lần
 * đảo. Xoá và tạo đánh giá (ReviewsService) lấy khoá này trước rồi mới tới dòng user; lần đảo lấy khoá sau khi đã ghi users
 * (hoàn Ví, trả điểm) thì chéo thứ tự với chúng và deadlock.
 *
 * `productIds` null = mọi sản phẩm của đơn (trả cả đơn); không thì chỉ các sản phẩm của dòng bị trả.
 */
export async function lockRewardedReviewsOfOrder(
  tx: Prisma.TransactionClient,
  orderId: string,
  productIds: readonly string[] | null,
): Promise<void> {
  for (const r of await rewardedReviewsOf(tx, orderId, productIds)) {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${reviewRewardLockKey(r.userId, r.productId)}))`;
  }
}

/**
 * Thu hồi thưởng đánh giá của các dòng hàng bị trả (điểm đã cấp ngay khi đơn giao nên đơn trả không được giữ). Mỗi đánh giá
 * một lần: dòng REVIEW_RETURN:<id> (partial unique theo reason) là dấu đã xử lý, nên lần trả sau của cùng sản phẩm, trả nốt
 * cả đơn và gọi lại đều không trừ thêm. Số dư không đủ thì thu hồi phần có, như thu hồi điểm đơn. Gọi trong tx của lần đảo,
 * SAU lockRewardedReviewsOfOrder; trả tổng điểm thực thu.
 */
export async function revokeReviewRewardsForReturn(
  tx: Prisma.TransactionClient,
  orderId: string,
  productIds: readonly string[] | null,
): Promise<number> {
  let taken = 0;
  for (const review of await rewardedReviewsOf(tx, orderId, productIds)) {
    const reason = reviewReturnReason(review.id);
    if (await tx.pointsTransaction.findFirst({ where: { reason, refType: 'REVIEW' }, select: { id: true } })) continue;
    // NO KEY UPDATE như reversePartialReturn: tx này đã ghi users (hoàn Ví/điểm) nên FOR UPDATE sẽ nâng khoá đang giữ và
    // chéo thứ tự với tx khác đang chờ khoá dòng này.
    const [u] = await tx.$queryRaw<{ pointsBalance: number }[]>`
      SELECT "pointsBalance" FROM "users" WHERE "id" = ${review.userId} FOR NO KEY UPDATE`;
    taken += await takeBackReviewReward(tx, review, u?.pointsBalance ?? 0, reason);
  }
  return taken;
}
