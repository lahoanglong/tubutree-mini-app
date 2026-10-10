import type { Prisma } from '@prisma/client';

/**
 * Chương trình giới thiệu duy nhất (Q-05): người mời (users.referredById của người được mời) nhận
 * coins.referrer_reward khi người được mời có đơn THỨ 2 giao thành công trong referral.window_days
 * ngày kể từ đơn đầu; thu hồi nếu một trong hai đơn đó bị trả.
 *
 * Dòng thưởng: refType REFERRAL, reason REFERRAL_ORDER2:<refereeId> (partial unique index
 * coin_transactions_referral_unique theo reason ⇒ mỗi người được mời thưởng đúng 1 lần, và vì mỗi
 * người được mời chỉ có 1 người mời nên cũng là 1 lần cho mỗi cặp), refId "<đơn đầu>:<đơn thứ 2>".
 * Gộp phiên khách đổi chủ đơn nhưng không đổi reason, nên thu hồi và chặn dùng lại đơn đều tra
 * theo id đơn trong refId.
 */
export const REFERRAL_ORDER2_PREFIX = 'REFERRAL_ORDER2:';
export const REFERRAL_ORDER2_REVOKE_PREFIX = 'REFERRAL_ORDER2_REVOKE:';
/** Thưởng của luồng cũ gắn cashback sàn ngoài (đã gỡ) — vẫn tính là "đã thưởng" để không trả 2 lần. */
export const LEGACY_REFERRAL_CASHBACK_PREFIX = 'REFERRAL_CASHBACK:';
/** Thu hồi thiếu vì người mời đã tiêu xu: dòng delta 0 để admin lọc (refType REFERRAL_DEBT). */
export const REFERRAL_DEBT_REF_TYPE = 'REFERRAL_DEBT';

/**
 * Mốc thưởng thêm (coins.referral_milestones). Lần cấp đầu giữ reason cũ
 * REFERRAL_MILESTONE:<referrerId>:<count>; mốc bị thu hồi rồi đạt lại thì cấp "đời" mới
 * REFERRAL_MILESTONE:<referrerId>:<count>#<n>. Thu hồi đời n: REFERRAL_MILESTONE_REVOKE:<referrerId>:<count>#<n>.
 * Reason duy nhất theo đời nên cùng partial unique index chặn cấp/thu hồi trùng khi chạy song song.
 */
const MILESTONE_PREFIX = 'REFERRAL_MILESTONE:';
const MILESTONE_REVOKE_PREFIX = 'REFERRAL_MILESTONE_REVOKE:';

type Db = Prisma.TransactionClient;

/**
 * Khoá dòng users của người được mời. Cả lúc cấp thưởng lẫn lúc thu hồi (trong tx trả hàng) đều
 * lấy khoá này trước khi đọc, nên lần cấp không thể đọc "2 đơn đã giao" rồi ghi thưởng sau khi lần
 * trả đơn kia đã kiểm "chưa có thưởng" và commit.
 */
export async function lockReferee(tx: Db, refereeId: string): Promise<void> {
  await tx.$queryRaw`SELECT "id" FROM "users" WHERE "id" = ${refereeId} FOR UPDATE`;
}

/**
 * Khoá dòng users của người mời và trả số dư. Mọi thao tác trên mốc thưởng (cấp lẫn thu hồi) đọc
 * số lượt thành công SAU khoá này, nên 2 lần trả hàng của 2 người được mời khác nhau, hay một lần
 * cấp mốc chạy song song lần thu hồi, không thể cùng đọc một số đếm cũ.
 */
export async function lockReferrer(tx: Db, referrerId: string): Promise<number> {
  const [row] = await tx.$queryRaw<{ coinsBalance: number }[]>`
    SELECT "coinsBalance" FROM "users" WHERE "id" = ${referrerId} FOR UPDATE`;
  return Number(row?.coinsBalance ?? 0);
}

/** Số bạn giới thiệu thành công còn hiệu lực: thưởng (kể cả kiểu cũ qua cashback) trừ lần đã thu hồi. */
export async function countReferralSuccesses(db: Db, referrerId: string): Promise<number> {
  const [legacy = 0, granted = 0, revoked = 0] = await Promise.all(
    [LEGACY_REFERRAL_CASHBACK_PREFIX, REFERRAL_ORDER2_PREFIX, REFERRAL_ORDER2_REVOKE_PREFIX].map((prefix) =>
      db.coinTransaction.count({ where: { userId: referrerId, refType: 'REFERRAL', reason: { startsWith: prefix } } }),
    ),
  );
  return legacy + granted - revoked;
}

export interface MilestoneState {
  /** delta của từng đời đã cấp, theo số đời (đời 0 = reason không hậu tố). */
  grants: Map<number, number>;
  revokes: number;
}

/** Trạng thái mốc của người mời, theo số lượt của mốc. Mốc đang giữ ⇔ grants.size > revokes. */
export async function readMilestoneState(db: Db, referrerId: string): Promise<Map<number, MilestoneState>> {
  const grantPrefix = `${MILESTONE_PREFIX}${referrerId}:`;
  const revokePrefix = `${MILESTONE_REVOKE_PREFIX}${referrerId}:`;
  const rows = await db.coinTransaction.findMany({
    where: {
      userId: referrerId,
      refType: 'REFERRAL',
      OR: [{ reason: { startsWith: grantPrefix } }, { reason: { startsWith: revokePrefix } }],
    },
    select: { reason: true, delta: true },
  });
  const state = new Map<number, MilestoneState>();
  for (const row of rows) {
    const isRevoke = row.reason.startsWith(revokePrefix);
    const [countPart, genPart] = row.reason.slice(isRevoke ? revokePrefix.length : grantPrefix.length).split('#');
    const count = Number(countPart);
    if (!Number.isFinite(count)) continue;
    const s = state.get(count) ?? { grants: new Map<number, number>(), revokes: 0 };
    if (isRevoke) s.revokes += 1;
    else s.grants.set(genPart ? Number(genPart) : 0, row.delta);
    state.set(count, s);
  }
  return state;
}

export function milestoneGrantReason(referrerId: string, count: number, gen: number): string {
  return `${MILESTONE_PREFIX}${referrerId}:${count}${gen > 0 ? `#${gen}` : ''}`;
}

/**
 * Trừ lại xu thưởng của người mời bằng một dòng đối ứng. BẮT BUỘC chạy trong tx và SAU lockReferrer.
 * Trừ tối đa số dư hiện có (không âm); phần thiếu ghi dòng delta 0 refType REFERRAL_DEBT
 * (reason `${debtReason}:<số xu thiếu>`). Dòng đối ứng ghi bằng ON CONFLICT DO NOTHING: đã có thì
 * trả null, không trừ gì thêm.
 */
async function debitReferralReward(
  tx: Db,
  referrerId: string,
  amount: number,
  reason: string,
  refId: string,
  debtReason: string,
): Promise<{ revoked: number; shortfall: number } | null> {
  const balance = await lockReferrer(tx, referrerId);
  const take = Math.min(Math.max(balance, 0), Math.max(amount, 0));
  const inserted = await tx.coinTransaction.createMany({
    data: [{ userId: referrerId, delta: -take, reason, refType: 'REFERRAL', refId }],
    skipDuplicates: true,
  });
  if (inserted.count === 0) return null;
  if (take > 0) {
    await tx.user.update({ where: { id: referrerId }, data: { coinsBalance: { decrement: take } } });
  }
  const shortfall = Math.max(amount, 0) - take;
  if (shortfall > 0) {
    await tx.coinTransaction.create({
      data: {
        userId: referrerId,
        delta: 0,
        reason: `${debtReason}:${shortfall}`,
        refType: REFERRAL_DEBT_REF_TYPE,
        refId,
      },
    });
  }
  return { revoked: take, shortfall };
}

/**
 * Thu hồi các mốc đang giữ có số lượt lớn hơn số lượt giới thiệu còn hiệu lực. Mốc lấy từ chính các
 * dòng đã cấp (không đọc config) nên mốc đã bị gỡ khỏi config vẫn thu hồi được.
 */
async function revokeLostMilestones(
  tx: Db,
  referrerId: string,
  refId: string,
): Promise<{ revoked: number; shortfall: number }> {
  await lockReferrer(tx, referrerId);
  const net = await countReferralSuccesses(tx, referrerId);
  const state = await readMilestoneState(tx, referrerId);
  const total = { revoked: 0, shortfall: 0 };
  for (const [count, s] of state) {
    if (count <= net || s.grants.size <= s.revokes) continue;
    const gen = s.revokes;
    const res = await debitReferralReward(
      tx,
      referrerId,
      s.grants.get(gen) ?? 0,
      `${MILESTONE_REVOKE_PREFIX}${referrerId}:${count}#${gen}`,
      refId,
      `REFERRAL_MILESTONE_DEBT:${referrerId}:${count}#${gen}`,
    );
    if (res) {
      total.revoked += res.revoked;
      total.shortfall += res.shortfall;
    }
  }
  return total;
}

/**
 * Thu hồi thưởng giới thiệu khi một trong hai đơn đã dùng để thưởng bị trả, kèm các mốc thưởng thêm
 * không còn đủ số lượt. BẮT BUỘC chạy trong tx của lần lật trạng thái. Không để số dư âm; phần thiếu
 * ghi REFERRAL_DEBT. Idempotent: dòng thu hồi dùng reason duy nhất (cùng partial unique index).
 */
export async function revokeReferralRewardForOrder(
  tx: Db,
  order: { id: string; userId: string },
): Promise<{ revoked: number; shortfall: number } | null> {
  await lockReferee(tx, order.userId);
  // Tra theo id đơn, không theo chủ đơn hiện tại: gộp phiên khách chuyển đơn sang tài khoản đích
  // nhưng dòng thưởng vẫn mang id khách (REFERRAL_ORDER2:<guestId>). Không cần khoá thêm dòng
  // khách: mọi lần xét thưởng cho khách đọc đơn theo userId = khách và khoá khách, còn lần gộp cũng
  // khoá khách trước khi chuyển đơn, nên khi đơn đã thuộc người khác thì dòng thưởng của khách
  // (nếu có) đã commit và thấy được ở đây.
  const grants = (
    await tx.coinTransaction.findMany({
      where: {
        refType: 'REFERRAL',
        reason: { startsWith: REFERRAL_ORDER2_PREFIX },
        OR: [{ refId: { startsWith: `${order.id}:` } }, { refId: { endsWith: `:${order.id}` } }],
      },
      select: { userId: true, delta: true, refId: true, reason: true },
    })
  ).filter((g) => g.delta > 0 && g.refId?.split(':').includes(order.id));

  const total = { revoked: 0, shortfall: 0 };
  let anyRevoked = false;
  for (const grant of grants) {
    const refereeId = grant.reason.slice(REFERRAL_ORDER2_PREFIX.length);
    const main = await debitReferralReward(
      tx,
      grant.userId,
      grant.delta,
      `${REFERRAL_ORDER2_REVOKE_PREFIX}${refereeId}`,
      order.id,
      `REFERRAL_ORDER2_DEBT:${refereeId}`,
    );
    if (!main) continue;
    const milestones = await revokeLostMilestones(tx, grant.userId, order.id);
    anyRevoked = true;
    total.revoked += main.revoked + milestones.revoked;
    total.shortfall += main.shortfall + milestones.shortfall;
  }
  return anyRevoked ? total : null;
}

/**
 * Các đơn hiện thuộc `refereeId` đã nằm trong một lần thưởng REFERRAL_ORDER2 (kể cả đã thu hồi), kèm
 * người mời đã nhận lần thưởng đó. Sau gộp phiên khách, đơn của khách đã dùng để thưởng sang tài
 * khoản đích nhưng dòng thưởng vẫn mang id khách — chặn theo reason REFERRAL_ORDER2:<refereeId>
 * không thấy chúng.
 */
export async function findReferralRewardedOrders(
  tx: Db,
  refereeId: string,
): Promise<{ orderId: string; referrerId: string }[]> {
  return tx.$queryRaw<{ orderId: string; referrerId: string }[]>`
    SELECT o."id" AS "orderId", ct."userId" AS "referrerId"
      FROM "coin_transactions" ct
      JOIN "orders" o
        ON o."id" IN (split_part(ct."refId", ':', 1), split_part(ct."refId", ':', 2))
     WHERE ct."refType" = 'REFERRAL'
       AND starts_with(ct."reason", ${REFERRAL_ORDER2_PREFIX})
       AND o."userId" = ${refereeId}`;
}
