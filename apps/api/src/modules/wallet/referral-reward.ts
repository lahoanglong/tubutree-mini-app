import type { PointsLot, Prisma } from '@prisma/client';
import { returnedGoods } from '../orders/refund-allocation';
import { partialReturnTotals } from '../orders/return-ledger';

/**
 * Chương trình giới thiệu duy nhất (Q-05): người mời (users.referredById của người được mời) nhận
 * referral.referrer_reward_points Điểm Xanh khi người được mời có đơn THỨ 2 giao thành công trong
 * referral.window_days ngày kể từ đơn đầu; thu hồi nếu một trong hai đơn đó bị trả. Đơn đã trả hết phần có tiền qua các
 * lần trả một phần đã duyệt (còn DELIVERED chỉ vì dòng quà 0đ) không được chọn vào cặp, như đơn đã RETURNED
 * (fullyReturnedOrderIds); đơn mới trả một phần thì vẫn được chọn và bị thu theo tỷ lệ.
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
 *
 * Trả MỘT PHẦN (chốt 2026-10-15): trả một phần một trong hai đơn đã dùng để thưởng thu hồi thưởng THEO TỶ LỆ tiền hàng đã
 * trả luỹ kế của chính đơn đó (revokeReferralRewardPartially). Mục tiêu luỹ kế của đơn = làm tròn XUỐNG (tỷ lệ × số điểm của
 * thưởng; thưởng xu cũ quy ra điểm bằng legacyXuToPoints trước); mỗi yêu cầu trả thu (mục tiêu − phần đã thu cho đơn đó), kẹp
 * để tổng thu hồi của cả hai đơn không vượt thưởng. Lần trả CẢ ĐƠN sau đó (revokeReferralRewardForOrder) chỉ thu phần còn
 * lại (thưởng − đã thu từng phần, kể cả phần ghi nợ); trả một phần sau khi đã thu hồi cả thì không làm gì.
 * Thu hồi từng phần CHƯA đủ cả khoản KHÔNG làm giảm số lượt giới thiệu hợp lệ và KHÔNG đụng mốc thưởng thêm:
 * countReferralSuccesses chỉ trừ dòng REFERRAL_ORDER2_REVOKE (thu hồi hoàn toàn). Thu hồi HOÀN TOÀN = tổng đã thu (điểm đã trừ
 * + nợ) >= thưởng, dù đạt bằng trả cả đơn hay qua nhiều lần trả một phần (vd 2/3 mỗi đơn, hay trả hết dòng có tiền còn dòng
 * quà 0đ): lúc đó ghi dòng REFERRAL_ORDER2_REVOKE delta 0 và chạy revokeLostMilestones như đường trả cả đơn.
 * Dòng thu hồi từng phần: refType REFERRAL, reason REFERRAL_ORDER2_PARTIAL_REVOKE:<refereeId>:<yêu cầu trả> (duy nhất theo yêu
 * cầu trả dưới cùng partial unique index theo reason ⇒ chạy lại cùng yêu cầu không trừ lần hai), refId = đơn bị trả; phần
 * thiếu ghi REFERRAL_DEBT reason REFERRAL_ORDER2_PARTIAL_DEBT:<refereeId>:<yêu cầu trả>:<số điểm thiếu>.
 */
export const REFERRAL_ORDER2_PREFIX = 'REFERRAL_ORDER2:';
export const REFERRAL_ORDER2_REVOKE_PREFIX = 'REFERRAL_ORDER2_REVOKE:';
export const REFERRAL_ORDER2_PARTIAL_REVOKE_PREFIX = 'REFERRAL_ORDER2_PARTIAL_REVOKE:';
export const REFERRAL_ORDER2_PARTIAL_DEBT_PREFIX = 'REFERRAL_ORDER2_PARTIAL_DEBT:';
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

/** Số Điểm Xanh phải thu khi thu hồi toàn bộ một khoản thưởng. */
export function referralGrantDue(grant: ReferralGrant): number {
  return grant.ledger === 'COIN' ? legacyXuToPoints(grant.amount) : Math.max(grant.amount, 0);
}

/**
 * Mục tiêu thu hồi LUỸ KẾ (Điểm Xanh) cho một đơn đã trả một phần: floor(số điểm của thưởng × tiền hàng đã trả luỹ kế / tiền
 * hàng của đơn). Thưởng xu cũ quy ra điểm (referralGrantDue = legacyXuToPoints) TRƯỚC rồi mới làm tròn xuống theo điểm: làm
 * tròn theo xu rồi ceil sang điểm sẽ thu dư tới 1 điểm mỗi đơn. Trả hết tiền hàng = đúng referralGrantDue. Đơn không có
 * tiền hàng thì không có tỷ lệ để thu từng phần (đường trả cả đơn vẫn thu hết). Số nguyên < 2^53 nên phép chia rồi floor
 * không lệch: thương không nguyên cách số nguyên gần nhất ít nhất 1/tiền hàng, lớn hơn sai số làm tròn của double.
 */
export function partialRevokeTarget(grant: ReferralGrant, returnedGoods: number, orderGoods: number): number {
  const due = referralGrantDue(grant);
  if (!(orderGoods > 0) || !(returnedGoods > 0)) return 0;
  return returnedGoods >= orderGoods ? due : Math.floor((due * returnedGoods) / orderGoods);
}

/**
 * Số thu ở yêu cầu trả này: mục tiêu luỹ kế của đơn trừ phần đã thu cho đơn đó, không quá phần thưởng còn chưa thu (cả hai
 * đơn cộng lại không vượt thưởng). Không âm.
 */
export function partialRevokeDue(input: { grantDue: number; target: number; revokedForOrder: number; revokedTotal: number }): number {
  const forOrder = input.target - input.revokedForOrder;
  const left = input.grantDue - input.revokedTotal;
  return Math.max(0, Math.min(forOrder, left));
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
 * trả null, không trừ gì thêm. `due` (Điểm Xanh) mặc định cả khoản; thu hồi từng phần và phần còn lại sau đó truyền số riêng.
 */
async function debitReferralReward(
  tx: Db,
  referrerId: string,
  grant: ReferralGrant,
  reason: string,
  refId: string,
  debtReason: string,
  due: number = referralGrantDue(grant),
): Promise<{ revoked: number; shortfall: number } | null> {
  const balances = await lockReferrer(tx, referrerId);
  if (await hasReferralEntry(tx, [reason])) return null;
  const lot: PointsLot = grant.ledger === 'COIN' ? 'CONVERTED' : 'STANDARD';
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
 * Các lần thưởng REFERRAL_ORDER2 (delta > 0, sổ xu cũ hoặc sổ điểm) đã dùng đơn này. Tra theo id đơn, không theo chủ đơn
 * hiện tại: gộp phiên khách chuyển đơn sang tài khoản đích nhưng dòng thưởng vẫn mang id khách (REFERRAL_ORDER2:<guestId>).
 * Không cần khoá thêm dòng khách: mọi lần xét thưởng cho khách đọc đơn theo userId = khách và khoá khách, còn lần gộp cũng
 * khoá khách trước khi chuyển đơn, nên khi đơn đã thuộc người khác thì dòng thưởng của khách (nếu có) đã commit và thấy được
 * ở đây. Caller khoá người được mời (lockReferee) trước khi gọi.
 */
async function findOrderGrants(tx: Db, orderId: string) {
  const where = {
    refType: 'REFERRAL',
    reason: { startsWith: REFERRAL_ORDER2_PREFIX },
    OR: [{ refId: { startsWith: `${orderId}:` } }, { refId: { endsWith: `:${orderId}` } }],
  };
  const select = { userId: true, delta: true, refId: true, reason: true } as const;
  const [coinGrants, pointsGrants] = await Promise.all([
    tx.coinTransaction.findMany({ where, select }),
    tx.pointsTransaction.findMany({ where, select }),
  ]);
  return [
    ...coinGrants.map((g) => ({ ...g, ledger: 'COIN' as const })),
    ...pointsGrants.map((g) => ({ ...g, ledger: 'POINTS' as const })),
  ]
    .filter((g) => g.delta > 0 && g.refId?.split(':').includes(orderId))
    .map((g) => ({
      referrerId: g.userId,
      refereeId: g.reason.slice(REFERRAL_ORDER2_PREFIX.length),
      grant: { amount: g.delta, ledger: g.ledger } satisfies ReferralGrant,
    }));
}

/**
 * Phần đã thu hồi TỪNG PHẦN của thưởng cho một người được mời (Điểm Xanh): phần đã trừ (−delta dòng PARTIAL_REVOKE) cộng phần
 * ghi nợ (số cuối reason dòng PARTIAL_DEBT), theo đơn (refId) và tổng. Dòng thu hồi luôn ở sổ điểm. Đọc SAU lockReferrer.
 */
async function readPartialRevocations(
  tx: Db,
  referrerId: string,
  refereeId: string,
): Promise<{ byOrder: Map<string, number>; total: number }> {
  const [taken, debts] = await Promise.all([
    tx.pointsTransaction.findMany({
      where: { userId: referrerId, refType: 'REFERRAL', reason: { startsWith: `${REFERRAL_ORDER2_PARTIAL_REVOKE_PREFIX}${refereeId}:` } },
      select: { delta: true, refId: true },
    }),
    tx.pointsTransaction.findMany({
      where: { userId: referrerId, refType: REFERRAL_DEBT_REF_TYPE, reason: { startsWith: `${REFERRAL_ORDER2_PARTIAL_DEBT_PREFIX}${refereeId}:` } },
      select: { reason: true, refId: true },
    }),
  ]);
  const byOrder = new Map<string, number>();
  let total = 0;
  const add = (orderId: string | null, points: number) => {
    if (!(points > 0)) return;
    total += points;
    if (orderId) byOrder.set(orderId, (byOrder.get(orderId) ?? 0) + points);
  };
  for (const r of taken) add(r.refId, -r.delta);
  for (const d of debts) add(d.refId, Number(d.reason.slice(d.reason.lastIndexOf(':') + 1)));
  return { byOrder, total };
}

/**
 * Thu hồi thưởng giới thiệu THEO TỶ LỆ khi một phần đơn đã dùng để thưởng được duyệt trả (xem đầu file). BẮT BUỘC chạy
 * trong tx duyệt yêu cầu trả, sau khi caller đã lật yêu cầu sang APPROVED. `returnedGoods` = tiền hàng đã trả luỹ kế của đơn
 * qua mọi yêu cầu trả một phần đã duyệt, GỒM yêu cầu này; `orderGoods` = tiền hàng của đơn. Khoá theo đúng thứ tự đường trả cả
 * đơn (người được mời rồi người mời). Không để số dư âm; phần thiếu ghi REFERRAL_DEBT. Không đụng mốc thưởng thêm.
 * `revoked`/`shortfall` tính bằng Điểm Xanh; null nếu không thu gì.
 */
export async function revokeReferralRewardPartially(
  tx: Db,
  order: { id: string; userId: string },
  input: { requestId: string; returnedGoods: number; orderGoods: number },
): Promise<{ revoked: number; shortfall: number } | null> {
  await lockReferee(tx, order.userId);
  const grants = await findOrderGrants(tx, order.id);
  const total = { revoked: 0, shortfall: 0 };
  let anyRevoked = false;
  for (const { referrerId, refereeId, grant } of grants) {
    await lockReferrer(tx, referrerId);
    // Đã thu hồi cả khoản (trả cả một trong hai đơn): phần còn lại đã thu hết ở đó.
    if (await hasReferralEntry(tx, [`${REFERRAL_ORDER2_REVOKE_PREFIX}${refereeId}`])) continue;
    const reason = `${REFERRAL_ORDER2_PARTIAL_REVOKE_PREFIX}${refereeId}:${input.requestId}`;
    if (await hasReferralEntry(tx, [reason])) continue;
    const prior = await readPartialRevocations(tx, referrerId, refereeId);
    const grantDue = referralGrantDue(grant);
    const due = partialRevokeDue({
      grantDue,
      target: partialRevokeTarget(grant, input.returnedGoods, input.orderGoods),
      revokedForOrder: prior.byOrder.get(order.id) ?? 0,
      revokedTotal: prior.total,
    });
    if (due > 0) {
      const res = await debitReferralReward(
        tx,
        referrerId,
        grant,
        reason,
        order.id,
        `${REFERRAL_ORDER2_PARTIAL_DEBT_PREFIX}${refereeId}:${input.requestId}`,
        due,
      );
      if (!res) continue;
      anyRevoked = true;
      total.revoked += res.revoked;
      total.shortfall += res.shortfall;
    }
    // Các lần trả một phần đã thu đủ cả khoản (điểm đã trừ + nợ): đó là thu hồi HOÀN TOÀN. Ghi dòng REVOKE delta 0 (cùng
    // reason với đường trả cả đơn nên lần trả cả đơn sau đó thấy và không ghi/thu thêm) để số lượt giới thiệu giảm, rồi thu
    // các mốc thưởng thêm không còn đủ lượt.
    if (grantDue > 0 && prior.total + due >= grantDue) {
      const closed = await debitReferralReward(
        tx,
        referrerId,
        grant,
        `${REFERRAL_ORDER2_REVOKE_PREFIX}${refereeId}`,
        order.id,
        `REFERRAL_ORDER2_DEBT:${refereeId}`,
        0,
      );
      if (closed) {
        const milestones = await revokeLostMilestones(tx, referrerId, order.id);
        anyRevoked = true;
        total.revoked += milestones.revoked;
        total.shortfall += milestones.shortfall;
      }
    }
  }
  return anyRevoked ? total : null;
}

/**
 * Trong các đơn ứng viên của cặp thưởng, các đơn đã trả hết phần có tiền qua các yêu cầu trả một phần ĐÃ DUYỆT (tiền hàng đã
 * trả luỹ kế >= tiền hàng của đơn, cùng returnedGoods như revokeReferralRewardForPriorReturns). Đơn như vậy còn DELIVERED chỉ vì
 * dòng quà 0đ chưa trả, nên bị loại khỏi cặp như đơn đã RETURNED. Gọi sau lockReferee: tx duyệt trả cũng lấy khoá đó trước khi
 * commit nên yêu cầu vừa duyệt không lọt. Hai truy vấn gộp cho mọi đơn được truyền vào (caller truyền từng trang ứng viên).
 */
export async function fullyReturnedOrderIds(tx: Db, orderIds: string[]): Promise<Set<string>> {
  const out = new Set<string>();
  if (orderIds.length === 0) return out;
  const requests = await tx.returnRequest.findMany({
    where: { orderId: { in: orderIds }, status: 'APPROVED', fullReturn: false },
    select: { orderId: true, items: { select: { orderItemId: true, quantity: true } } },
  });
  if (requests.length === 0) return out;
  const qtyByOrder = new Map<string, Map<string, number>>();
  for (const r of requests) {
    const qty = qtyByOrder.get(r.orderId) ?? new Map<string, number>();
    for (const it of r.items) qty.set(it.orderItemId, (qty.get(it.orderItemId) ?? 0) + it.quantity);
    qtyByOrder.set(r.orderId, qty);
  }
  const orders = await tx.order.findMany({ where: { id: { in: [...qtyByOrder.keys()] } }, include: { items: true } });
  for (const order of orders) {
    const goods = returnedGoods(order, qtyByOrder.get(order.id) ?? new Map());
    if (goods.goods > 0 && goods.returned >= goods.goods) out.add(order.id);
  }
  return out;
}

/**
 * Ngay sau khi CẤP thưởng (cùng tx, đã khoá người được mời): đơn trong cặp có thể đã được duyệt trả một phần TRƯỚC lúc cấp —
 * lần duyệt đó chạy revokeReferralRewardPartially khi chưa có dòng thưởng nên không thu gì. Thu theo tỷ lệ tiền hàng đã trả
 * luỹ kế của các yêu cầu trả một phần đã duyệt, mỗi đơn một requestId tất định `GRANT-<id đơn>` (reason không trùng giữa hai
 * đơn; chạy lại không trừ lần hai). Lần duyệt trả song song: tx duyệt lấy lockReferee trước khi đọc dòng thưởng, tx cấp lấy
 * nó trước khi đọc yêu cầu đã duyệt, nên bên commit sau luôn thấy bên kia và đúng một bên thu.
 */
export async function revokeReferralRewardForPriorReturns(tx: Db, orderIds: string[]): Promise<{ revoked: number; shortfall: number } | null> {
  const total = { revoked: 0, shortfall: 0 };
  let anyRevoked = false;
  for (const orderId of orderIds) {
    const prior = await partialReturnTotals(tx, orderId);
    if (prior.approvedQty.size === 0) continue;
    const order = await tx.order.findUniqueOrThrow({ where: { id: orderId }, include: { items: true } });
    const goods = returnedGoods(order, prior.approvedQty);
    const res = await revokeReferralRewardPartially(tx, order, {
      requestId: `GRANT-${orderId}`,
      returnedGoods: goods.returned,
      orderGoods: goods.goods,
    });
    if (!res) continue;
    anyRevoked = true;
    total.revoked += res.revoked;
    total.shortfall += res.shortfall;
  }
  return anyRevoked ? total : null;
}

/**
 * Thu hồi thưởng giới thiệu khi một trong hai đơn đã dùng để thưởng bị trả CẢ ĐƠN, kèm các mốc thưởng thêm
 * không còn đủ số lượt. BẮT BUỘC chạy trong tx của lần lật trạng thái. Không để số dư âm; phần thiếu
 * ghi REFERRAL_DEBT. Idempotent: dòng thu hồi dùng reason duy nhất (cùng partial unique index).
 * `revoked`/`shortfall` tính bằng Điểm Xanh.
 */
export async function revokeReferralRewardForOrder(
  tx: Db,
  order: { id: string; userId: string },
): Promise<{ revoked: number; shortfall: number } | null> {
  await lockReferee(tx, order.userId);
  const grants = await findOrderGrants(tx, order.id);

  const total = { revoked: 0, shortfall: 0 };
  let anyRevoked = false;
  for (const { referrerId, refereeId, grant } of grants) {
    // Chỉ thu phần chưa thu ở các lần trả một phần (kể cả phần đã ghi nợ). Dòng thu hồi vẫn ghi khi phần còn lại là 0: nó là
    // dấu "đã thu hồi hoàn toàn" cho số lượt giới thiệu và mốc thưởng thêm.
    await lockReferrer(tx, referrerId);
    const partial = await readPartialRevocations(tx, referrerId, refereeId);
    const main = await debitReferralReward(
      tx,
      referrerId,
      grant,
      `${REFERRAL_ORDER2_REVOKE_PREFIX}${refereeId}`,
      order.id,
      `REFERRAL_ORDER2_DEBT:${refereeId}`,
      Math.max(0, referralGrantDue(grant) - partial.total),
    );
    if (!main) continue;
    const milestones = await revokeLostMilestones(tx, referrerId, order.id);
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
