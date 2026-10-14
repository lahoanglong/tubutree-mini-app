import type { PointsLot, Prisma } from '@prisma/client';

/**
 * Chương trình giới thiệu duy nhất (Q-05): người mời (users.referredById của người được mời) nhận
 * referral.referrer_reward_points Điểm Xanh khi người được mời có đơn THỨ 2 giao thành công trong
 * referral.window_days ngày kể từ đơn đầu; thu hồi nếu một trong hai đơn đó bị trả.
 *
 * Dòng thưởng: refType REFERRAL, reason REFERRAL_ORDER2:<refereeId> (partial unique index theo reason ở
 * cả points_transactions_referral_unique lẫn coin_transactions_referral_unique cũ ⇒ mỗi người được mời
 * thưởng đúng 1 lần, và vì mỗi người được mời chỉ có 1 người mời nên cũng là 1 lần cho mỗi cặp), refId
 * "<đơn đầu>:<đơn thứ 2>". Gộp phiên khách đổi chủ đơn nhưng không đổi reason, nên thu hồi và chặn dùng
 * lại đơn đều tra theo id đơn trong refId.
 *
 * PD-3: thưởng trước gộp nằm ở coin_transactions (xu), sau gộp ở points_transactions (Điểm Xanh). Mọi
 * kiểm "đã thưởng / đã thu hồi / số lượt / mốc" ở đây đọc HỢP hai sổ; chỉ đọc sổ mới thì người được
 * mời đã thưởng bằng xu sẽ được thưởng lại bằng điểm (index points không thấy dòng coin).
 */
export const REFERRAL_ORDER2_PREFIX = 'REFERRAL_ORDER2:';
export const REFERRAL_ORDER2_REVOKE_PREFIX = 'REFERRAL_ORDER2_REVOKE:';
/** Thưởng của luồng cũ gắn cashback sàn ngoài (đã gỡ) — vẫn tính là "đã thưởng" để không trả 2 lần. */
export const LEGACY_REFERRAL_CASHBACK_PREFIX = 'REFERRAL_CASHBACK:';
/** Thu hồi thiếu vì người mời đã tiêu điểm: dòng delta 0 để admin lọc (refType REFERRAL_DEBT). */
export const REFERRAL_DEBT_REF_TYPE = 'REFERRAL_DEBT';

/**
 * Mốc thưởng thêm (referral.milestones_points). Lần cấp đầu giữ reason cũ
 * REFERRAL_MILESTONE:<referrerId>:<count>; mốc bị thu hồi rồi đạt lại thì cấp "đời" mới
 * REFERRAL_MILESTONE:<referrerId>:<count>#<n>. Thu hồi đời n: REFERRAL_MILESTONE_REVOKE:<referrerId>:<count>#<n>.
 * Reason duy nhất theo đời nên cùng partial unique index chặn cấp/thu hồi trùng khi chạy song song.
 */
export const MILESTONE_PREFIX = 'REFERRAL_MILESTONE:';
export const MILESTONE_REVOKE_PREFIX = 'REFERRAL_MILESTONE_REVOKE:';

type Db = Prisma.TransactionClient;

/** Sổ chứa một dòng thưởng: COIN = xu cấp trước PD-3, POINTS = Điểm Xanh cấp sau. */
export type RewardLedger = 'COIN' | 'POINTS';

export interface ReferralGrant {
  amount: number;
  ledger: RewardLedger;
}

/**
 * Giá trị Điểm Xanh của một khoản thưởng cấp bằng xu trước gộp: số xu đó đã nằm trong lô quy đổi
 * (migration B, 1.000 xu = 1 điểm làm tròn lên), nên thu hồi trừ đúng chừng ấy ở lô CONVERTED (OQ-9).
 */
export function legacyXuToPoints(xu: number): number {
  return Math.ceil(Math.max(xu, 0) / 1000);
}

/**
 * Khoá dòng users của người được mời. Cả lúc cấp thưởng lẫn lúc thu hồi (trong tx trả hàng) đều
 * lấy khoá này trước khi đọc, nên lần cấp không thể đọc "2 đơn đã giao" rồi ghi thưởng sau khi lần
 * trả đơn kia đã kiểm "chưa có thưởng" và commit. NO KEY UPDATE (như sổ Ví): tx trả hàng đã chèn
 * dòng có khoá ngoại tới user này (lịch sử trạng thái, sự kiện), giữ KEY SHARE; FOR UPDATE đụng khoá
 * đó của lần trả hàng song song khác của cùng khách và deadlock.
 */
export async function lockReferee(tx: Db, refereeId: string): Promise<void> {
  await tx.$queryRaw`SELECT "id" FROM "users" WHERE "id" = ${refereeId} FOR NO KEY UPDATE`;
}

/**
 * Khoá dòng users của người mời và trả số dư hai lô. Mọi thao tác trên mốc thưởng (cấp lẫn thu hồi)
 * đọc số lượt thành công SAU khoá này, nên 2 lần trả hàng của 2 người được mời khác nhau, hay một lần
 * cấp mốc chạy song song lần thu hồi, không thể cùng đọc một số đếm cũ.
 */
export async function lockReferrer(tx: Db, referrerId: string): Promise<{ standard: number; converted: number }> {
  const [row] = await tx.$queryRaw<{ pointsBalance: number; pointsConvertedBalance: number }[]>`
    SELECT "pointsBalance", "pointsConvertedBalance" FROM "users" WHERE "id" = ${referrerId} FOR UPDATE`;
  return { standard: Number(row?.pointsBalance ?? 0), converted: Number(row?.pointsConvertedBalance ?? 0) };
}

/** Đã có dòng REFERRAL mang một trong các reason này ở sổ xu cũ hoặc sổ điểm chưa. */
export async function hasReferralEntry(db: Db, reasons: string[]): Promise<boolean> {
  const where = { refType: 'REFERRAL', reason: { in: reasons } };
  const [coin, points] = await Promise.all([
    db.coinTransaction.findFirst({ where, select: { id: true } }),
    db.pointsTransaction.findFirst({ where, select: { id: true } }),
  ]);
  return Boolean(coin || points);
}

/** Số bạn giới thiệu thành công còn hiệu lực, gộp hai sổ: thưởng (kể cả kiểu cũ qua cashback) trừ lần đã thu hồi. */
export async function countReferralSuccesses(db: Db, referrerId: string): Promise<number> {
  const count = async (prefix: string) => {
    const where = { userId: referrerId, refType: 'REFERRAL', reason: { startsWith: prefix } };
    const [coin, points] = await Promise.all([db.coinTransaction.count({ where }), db.pointsTransaction.count({ where })]);
    return coin + points;
  };
  const [legacy = 0, granted = 0, revoked = 0] = await Promise.all(
    [LEGACY_REFERRAL_CASHBACK_PREFIX, REFERRAL_ORDER2_PREFIX, REFERRAL_ORDER2_REVOKE_PREFIX].map(count),
  );
  return legacy + granted - revoked;
}

export interface MilestoneState {
  /** Khoản đã cấp của từng đời (đơn vị theo sổ), theo số đời (đời 0 = reason không hậu tố). */
  grants: Map<number, ReferralGrant>;
  revokes: number;
}

/** Trạng thái mốc của người mời (gộp hai sổ), theo số lượt của mốc. Mốc đang giữ ⇔ grants.size > revokes. */
export async function readMilestoneState(db: Db, referrerId: string): Promise<Map<number, MilestoneState>> {
  const grantPrefix = `${MILESTONE_PREFIX}${referrerId}:`;
  const revokePrefix = `${MILESTONE_REVOKE_PREFIX}${referrerId}:`;
  const where = {
    userId: referrerId,
    refType: 'REFERRAL',
    OR: [{ reason: { startsWith: grantPrefix } }, { reason: { startsWith: revokePrefix } }],
  };
  const select = { reason: true, delta: true } as const;
  const [coinRows, pointsRows] = await Promise.all([
    db.coinTransaction.findMany({ where, select }),
    db.pointsTransaction.findMany({ where, select }),
  ]);
  const rows = [
    ...coinRows.map((r) => ({ ...r, ledger: 'COIN' as const })),
    ...pointsRows.map((r) => ({ ...r, ledger: 'POINTS' as const })),
  ];
  const state = new Map<number, MilestoneState>();
  for (const row of rows) {
    const isRevoke = row.reason.startsWith(revokePrefix);
    const [countPart, genPart] = row.reason.slice(isRevoke ? revokePrefix.length : grantPrefix.length).split('#');
    const count = Number(countPart);
    if (!Number.isFinite(count)) continue;
    const s = state.get(count) ?? { grants: new Map<number, ReferralGrant>(), revokes: 0 };
    if (isRevoke) s.revokes += 1;
    else s.grants.set(genPart ? Number(genPart) : 0, { amount: row.delta, ledger: row.ledger });
    state.set(count, s);
  }
  return state;
}

export function milestoneGrantReason(referrerId: string, count: number, gen: number): string {
  return `${MILESTONE_PREFIX}${referrerId}:${count}${gen > 0 ? `#${gen}` : ''}`;
}

/**
 * Trừ lại thưởng của người mời bằng một dòng đối ứng ở sổ điểm. BẮT BUỘC chạy trong tx.
 * Thưởng cấp bằng xu trước gộp → trừ lô CONVERTED ceil(xu/1000); cấp bằng điểm → trừ lô STANDARD.
 * Trừ tối đa số dư của lô đó (không âm, không lấy lô kia bù); phần thiếu ghi dòng delta 0 refType
 * REFERRAL_DEBT (reason `${debtReason}:<số điểm thiếu>`). Đã có dòng đối ứng (ở sổ nào cũng vậy) thì
 * trả null, không trừ gì thêm.
 */
async function debitReferralReward(
  tx: Db,
  referrerId: string,
  grant: ReferralGrant,
  reason: string,
  refId: string,
  debtReason: string,
): Promise<{ revoked: number; shortfall: number } | null> {
  const balances = await lockReferrer(tx, referrerId);
  if (await hasReferralEntry(tx, [reason])) return null;
  const lot: PointsLot = grant.ledger === 'COIN' ? 'CONVERTED' : 'STANDARD';
  const due = grant.ledger === 'COIN' ? legacyXuToPoints(grant.amount) : Math.max(grant.amount, 0);
  const balance = lot === 'CONVERTED' ? balances.converted : balances.standard;
  const take = Math.min(Math.max(balance, 0), due);
  const inserted = await tx.pointsTransaction.createMany({
    data: [{ userId: referrerId, delta: take > 0 ? -take : 0, lot, reason, refType: 'REFERRAL', refId }],
    skipDuplicates: true,
  });
  if (inserted.count === 0) return null;
  if (take > 0) {
    const guarded: Prisma.UserUpdateManyArgs =
      lot === 'CONVERTED'
        ? { where: { id: referrerId, pointsConvertedBalance: { gte: take } }, data: { pointsConvertedBalance: { decrement: take } } }
        : { where: { id: referrerId, pointsBalance: { gte: take } }, data: { pointsBalance: { decrement: take } } };
    const dec = await tx.user.updateMany(guarded);
    // Số dư đã đọc sau FOR UPDATE ở trên nên không thể thiếu; ném để rollback thay vì để sổ lệch.
    if (dec.count !== 1) throw new Error(`Thu hồi thưởng giới thiệu ${reason}: số dư lô ${lot} đổi giữa chừng`);
  }
  const shortfall = due - take;
  if (shortfall > 0) {
    await tx.pointsTransaction.create({
      data: {
        userId: referrerId,
        delta: 0,
        lot,
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
      s.grants.get(gen) ?? { amount: 0, ledger: 'POINTS' },
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
 * `revoked`/`shortfall` tính bằng Điểm Xanh.
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
  const where = {
    refType: 'REFERRAL',
    reason: { startsWith: REFERRAL_ORDER2_PREFIX },
    OR: [{ refId: { startsWith: `${order.id}:` } }, { refId: { endsWith: `:${order.id}` } }],
  };
  const select = { userId: true, delta: true, refId: true, reason: true } as const;
  const [coinGrants, pointsGrants] = await Promise.all([
    tx.coinTransaction.findMany({ where, select }),
    tx.pointsTransaction.findMany({ where, select }),
  ]);
  const grants = [
    ...coinGrants.map((g) => ({ ...g, ledger: 'COIN' as const })),
    ...pointsGrants.map((g) => ({ ...g, ledger: 'POINTS' as const })),
  ].filter((g) => g.delta > 0 && g.refId?.split(':').includes(order.id));

  const total = { revoked: 0, shortfall: 0 };
  let anyRevoked = false;
  for (const grant of grants) {
    const refereeId = grant.reason.slice(REFERRAL_ORDER2_PREFIX.length);
    const main = await debitReferralReward(
      tx,
      grant.userId,
      { amount: grant.delta, ledger: grant.ledger },
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
 * Các đơn hiện thuộc `refereeId` đã nằm trong một lần thưởng REFERRAL_ORDER2 (kể cả đã thu hồi, ở sổ
 * xu cũ hay sổ điểm), kèm người mời đã nhận lần thưởng đó. Sau gộp phiên khách, đơn của khách đã dùng
 * để thưởng sang tài khoản đích nhưng dòng thưởng vẫn mang id khách — chặn theo reason
 * REFERRAL_ORDER2:<refereeId> không thấy chúng.
 */
export async function findReferralRewardedOrders(
  tx: Db,
  refereeId: string,
): Promise<{ orderId: string; referrerId: string }[]> {
  return tx.$queryRaw<{ orderId: string; referrerId: string }[]>`
    SELECT o."id" AS "orderId", g."userId" AS "referrerId"
      FROM (
        SELECT "userId", "refId", "reason" FROM "coin_transactions" WHERE "refType" = 'REFERRAL'
        UNION ALL
        SELECT "userId", "refId", "reason" FROM "points_transactions" WHERE "refType" = 'REFERRAL'
      ) g
      JOIN "orders" o
        ON o."id" IN (split_part(g."refId", ':', 1), split_part(g."refId", ':', 2))
     WHERE starts_with(g."reason", ${REFERRAL_ORDER2_PREFIX})
       AND o."userId" = ${refereeId}`;
}
