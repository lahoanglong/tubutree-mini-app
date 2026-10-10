import type { Prisma } from '@prisma/client';

/**
 * Chương trình giới thiệu duy nhất (Q-05): người mời (users.referredById của người được mời) nhận
 * coins.referrer_reward khi người được mời có đơn THỨ 2 giao thành công trong referral.window_days
 * ngày kể từ đơn đầu; thu hồi nếu một trong hai đơn đó bị trả.
 *
 * Dòng thưởng: refType REFERRAL, reason REFERRAL_ORDER2:<refereeId> (partial unique index
 * coin_transactions_referral_unique theo reason ⇒ mỗi người được mời thưởng đúng 1 lần, và vì mỗi
 * người được mời chỉ có 1 người mời nên cũng là 1 lần cho mỗi cặp), refId "<đơn đầu>:<đơn thứ 2>".
 */
export const REFERRAL_ORDER2_PREFIX = 'REFERRAL_ORDER2:';
export const REFERRAL_ORDER2_REVOKE_PREFIX = 'REFERRAL_ORDER2_REVOKE:';
/** Thưởng của luồng cũ gắn cashback sàn ngoài (đã gỡ) — vẫn tính là "đã thưởng" để không trả 2 lần. */
export const LEGACY_REFERRAL_CASHBACK_PREFIX = 'REFERRAL_CASHBACK:';
/** Thu hồi thiếu vì người mời đã tiêu xu: dòng delta 0 để admin lọc (refType REFERRAL_DEBT). */
export const REFERRAL_DEBT_REF_TYPE = 'REFERRAL_DEBT';

/**
 * Khoá dòng users của người được mời. Cả lúc cấp thưởng lẫn lúc thu hồi (trong tx trả hàng) đều
 * lấy khoá này trước khi đọc, nên lần cấp không thể đọc "2 đơn đã giao" rồi ghi thưởng sau khi lần
 * trả đơn kia đã kiểm "chưa có thưởng" và commit.
 */
export async function lockReferee(tx: Prisma.TransactionClient, refereeId: string): Promise<void> {
  await tx.$queryRaw`SELECT "id" FROM "users" WHERE "id" = ${refereeId} FOR UPDATE`;
}

/**
 * Thu hồi thưởng giới thiệu khi một trong hai đơn đã dùng để thưởng bị trả. BẮT BUỘC chạy trong tx
 * của lần lật trạng thái. Trừ tối đa số xu người mời đang có (số dư không âm); phần thiếu ghi một
 * dòng delta 0 refType REFERRAL_DEBT để admin xử lý. Idempotent: dòng thu hồi dùng reason duy nhất
 * theo người được mời (cùng partial unique index), ON CONFLICT DO NOTHING.
 */
export async function revokeReferralRewardForOrder(
  tx: Prisma.TransactionClient,
  order: { id: string; userId: string },
): Promise<{ revoked: number; shortfall: number } | null> {
  await lockReferee(tx, order.userId);
  const grant = await tx.coinTransaction.findFirst({
    where: { refType: 'REFERRAL', reason: `${REFERRAL_ORDER2_PREFIX}${order.userId}` },
    select: { userId: true, delta: true, refId: true },
  });
  if (!grant || grant.delta <= 0 || !grant.refId?.split(':').includes(order.id)) return null;

  const [row] = await tx.$queryRaw<{ coinsBalance: number }[]>`
    SELECT "coinsBalance" FROM "users" WHERE "id" = ${grant.userId} FOR UPDATE`;
  const take = Math.min(Math.max(Number(row?.coinsBalance ?? 0), 0), grant.delta);
  const inserted = await tx.coinTransaction.createMany({
    data: [
      {
        userId: grant.userId,
        delta: -take,
        reason: `${REFERRAL_ORDER2_REVOKE_PREFIX}${order.userId}`,
        refType: 'REFERRAL',
        refId: order.id,
      },
    ],
    skipDuplicates: true,
  });
  if (inserted.count === 0) return null;
  if (take > 0) {
    await tx.user.update({ where: { id: grant.userId }, data: { coinsBalance: { decrement: take } } });
  }
  const shortfall = grant.delta - take;
  if (shortfall > 0) {
    await tx.coinTransaction.create({
      data: {
        userId: grant.userId,
        delta: 0,
        reason: `REFERRAL_ORDER2_DEBT:${order.userId}:${shortfall}`,
        refType: REFERRAL_DEBT_REF_TYPE,
        refId: order.id,
      },
    });
  }
  return { revoked: take, shortfall };
}
