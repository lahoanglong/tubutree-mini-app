import type { PointsLot, Prisma } from '@prisma/client';
import { returnedGoods } from '../orders/refund-allocation';
import { partialReturnTotals } from '../orders/return-ledger';
import type { ReferralNotice } from './referral-notify';

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
 * "<đơn đầu>:<đơn thứ 2>".
 *
 * Gộp phiên khách (chốt G6): gộp khách G vào tài khoản T chuyển orders.userId của G sang T nhưng dòng thưởng
 * REFERRAL_ORDER2:<G> của người mời R ở lại nguyên. Từ đó thưởng TÁCH khỏi các đơn đã chuyển: trả/huỷ (cả đơn lẫn một phần)
 * đơn cũ của G không thu hồi thưởng của R (findOrderGrants bỏ lần thưởng có người được mời khác chủ đơn hiện tại) và không
 * khoá dòng users của R. Thu hồi theo chủ đơn sẽ khoá T (người được mời theo chủ đơn) rồi R, ngược thứ tự tx trả đơn của R
 * (khoá R rồi người mời của R) ⇒ deadlock khi T mời R, R mời G. Chấp nhận lỗ nhỏ: khách tạo 2 đơn, người mời nhận thưởng,
 * gộp rồi trả thì người mời vẫn giữ thưởng. Chặn dùng lại đơn đã thưởng làm cặp thưởng MỚI cho tài khoản đích vẫn tra theo id
 * đơn trong refId (findReferralRewardedOrders).
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

/** Kết quả một lần thu hồi (Điểm Xanh), kèm tin báo người mời để caller gửi SAU khi tx commit. */
export interface ReferralRevokeResult {
  revoked: number;
  shortfall: number;
  notices: ReferralNotice[];
}

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
  /** Các đời đã thu hồi (hậu tố #<đời> của dòng thu hồi). */
  revoked: Set<number>;
}

/**
 * Các đời đang giữ, tăng dần. Không gộp thì luôn là một đoạn liền sau các đời đã thu (đời cấp = số đời đã cấp, đời thu =
 * đời giữ nhỏ nhất), nên thu đời nhỏ nhất trùng reason cách đánh số cũ. Sau gộp khách, đời của khách được đánh lại nối
 * sau đời của người đích (renameMergedMilestones) nên đời giữ có thể xen giữa đời đã thu.
 */
export function heldMilestoneGens(s: MilestoneState | undefined): number[] {
  if (!s) return [];
  return [...s.grants.keys()].filter((gen) => !s.revoked.has(gen)).sort((a, b) => a - b);
}

/** Đời cho lần cấp mới: sau đời lớn nhất đã có (cấp hay thu), không bao giờ trùng reason cũ. */
export function nextMilestoneGen(s: MilestoneState | undefined): number {
  if (!s) return 0;
  return Math.max(-1, ...s.grants.keys(), ...s.revoked) + 1;
}

/** Trạng thái mốc của người mời (gộp hai sổ), theo số lượt của mốc. Mốc đang giữ ⇔ heldMilestoneGens khác rỗng. */
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
    const gen = genPart ? Number(genPart) : 0;
    if (!Number.isInteger(gen) || gen < 0) continue;
    const s = state.get(count) ?? { grants: new Map<number, ReferralGrant>(), revoked: new Set<number>() };
    if (isRevoke) s.revoked.add(gen);
    else s.grants.set(gen, { amount: row.delta, ledger: row.ledger });
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
    if (count <= net) continue;
    // Sau gộp khách có thể giữ nhiều đời của cùng mốc (khách và người đích mỗi bên đạt một lần): hết đủ lượt thì thu cả.
    for (const gen of heldMilestoneGens(s)) {
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
  }
  return total;
}

/**
 * Gộp khách `fromId` vào `toId` (gọi trong tx gộp, SAU khi dòng sổ của khách đã sang `toId`, đang giữ khoá dòng users của
 * `toId`): đổi khoá các dòng mốc REFERRAL_MILESTONE[_REVOKE]:<fromId>:<mốc>#<đời> (và dòng nợ mốc) sang `toId`, đời của khách
 * dời nối sau đời lớn nhất của `toId` cho cùng mốc. Đọc mốc theo `toId` (readMilestoneState, revokeLostMilestones) mới thấy
 * mốc khách đã nhận: không cấp lại mốc đó lần hai và lượt bị thu hồi sau này thu được cả mốc của khách. Dời đời (không đọc
 * mọi tiền tố) để reason mới không đụng partial unique index theo reason, và để dòng thu hồi vẫn cùng khoá `<mốc>#<đời>` với
 * dòng cấp — loyalty-expiry ghép lô thưởng/lô thu hồi theo khoá đó.
 */
export async function renameMergedMilestones(tx: Db, fromId: string, toId: string): Promise<void> {
  const fromGrant = `${MILESTONE_PREFIX}${fromId}:`;
  const fromRevoke = `${MILESTONE_REVOKE_PREFIX}${fromId}:`;
  const fromDebt = `REFERRAL_MILESTONE_DEBT:${fromId}:`;
  const where = {
    userId: toId,
    OR: [
      { refType: 'REFERRAL', reason: { startsWith: fromGrant } },
      { refType: 'REFERRAL', reason: { startsWith: fromRevoke } },
      { refType: REFERRAL_DEBT_REF_TYPE, reason: { startsWith: fromDebt } },
    ],
  };
  const select = { id: true, reason: true } as const;
  const [coinRows, pointsRows] = await Promise.all([
    tx.coinTransaction.findMany({ where, select }),
    tx.pointsTransaction.findMany({ where, select }),
  ]);
  if (coinRows.length + pointsRows.length === 0) return;

  const own = await readMilestoneState(tx, toId);
  const offset = new Map<number, number>();
  const rename = (reason: string): string | null => {
    const prefix = reason.startsWith(fromRevoke) ? fromRevoke : reason.startsWith(fromGrant) ? fromGrant : fromDebt;
    const [mark, ...tail] = reason.slice(prefix.length).split(':');
    const [countPart, genPart] = (mark ?? '').split('#');
    const count = Number(countPart);
    const gen = genPart ? Number(genPart) : 0;
    if (!Number.isFinite(count) || !Number.isInteger(gen) || gen < 0) return null;
    if (!offset.has(count)) offset.set(count, nextMilestoneGen(own.get(count)));
    const newGen = gen + offset.get(count)!;
    if (prefix === fromGrant) return milestoneGrantReason(toId, count, newGen);
    const toPrefix = prefix === fromRevoke ? MILESTONE_REVOKE_PREFIX : 'REFERRAL_MILESTONE_DEBT:';
    return [`${toPrefix}${toId}:${count}#${newGen}`, ...tail].join(':');
  };
  for (const row of coinRows) {
    const reason = rename(row.reason);
    if (reason) await tx.coinTransaction.update({ where: { id: row.id }, data: { reason } });
  }
  for (const row of pointsRows) {
    const reason = rename(row.reason);
    if (reason) await tx.pointsTransaction.update({ where: { id: row.id }, data: { reason } });
  }
}

/**
 * Các lần thưởng REFERRAL_ORDER2 (delta > 0, sổ xu cũ hoặc sổ điểm) đã dùng đơn này VÀ có người được mời đúng là chủ đơn
 * hiện tại. Đơn đã gộp sang tài khoản khác (dòng thưởng mang id khách cũ REFERRAL_ORDER2:<guestId>) bị bỏ: thưởng đó tách
 * khỏi đơn (xem đầu file), caller không thu hồi và không khoá người mời của khách. Caller khoá chủ đơn (lockReferee) trước
 * khi gọi. Chủ đơn lấy từ ảnh chụp đơn của caller: nếu lần gộp commit xen giữa thì ảnh chụp còn là khách, và lần thưởng của
 * khách bị thu như trước gộp (khoá khách rồi người mời, cùng chiều đường thường) — không đảo thứ tự khoá.
 */
async function findOrderGrants(tx: Db, order: { id: string; userId: string }) {
  const orderId = order.id;
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
  const grants = [
    ...coinGrants.map((g) => ({ ...g, ledger: 'COIN' as const })),
    ...pointsGrants.map((g) => ({ ...g, ledger: 'POINTS' as const })),
  ]
    .filter((g) => g.delta > 0 && g.refId?.split(':').includes(orderId))
    .map((g) => ({
      referrerId: g.userId,
      refereeId: g.reason.slice(REFERRAL_ORDER2_PREFIX.length),
      grant: { amount: g.delta, ledger: g.ledger } satisfies ReferralGrant,
    }))
    .filter((g) => g.refereeId === order.userId);
  // Thưởng đã thu hồi hoàn toàn thì không còn gì để thu: bỏ ra trước khi caller khoá người mời. Dòng thu hồi không bao giờ
  // bị xoá nên đọc ngoài khoá vẫn đúng. Thưởng bị thu lúc gộp vì tạo vòng (khách G mời X, X mời T, G gộp vào T) vẫn nằm ở T;
  // nếu trả đơn của X còn khoá T thì đảo chiều với trả đơn của T (khoá T rồi X) ⇒ deadlock.
  const out: typeof grants = [];
  for (const g of grants) {
    if (!(await hasReferralEntry(tx, [`${REFERRAL_ORDER2_REVOKE_PREFIX}${g.refereeId}`]))) out.push(g);
  }
  return out;
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
 * `revoked`/`shortfall` tính bằng Điểm Xanh; null nếu không thu gì. Đơn đã gộp sang tài khoản khác: không thu (đầu file).
 */
export async function revokeReferralRewardPartially(
  tx: Db,
  order: { id: string; userId: string },
  input: { requestId: string; returnedGoods: number; orderGoods: number },
): Promise<ReferralRevokeResult | null> {
  await lockReferee(tx, order.userId);
  const grants = await findOrderGrants(tx, order);
  const total: ReferralRevokeResult = { revoked: 0, shortfall: 0, notices: [] };
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
    const notice = { taken: 0, debt: 0, key: null as string | null };
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
      notice.taken += res.revoked;
      notice.debt += res.shortfall;
      notice.key = reason;
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
        notice.taken += milestones.revoked;
        notice.debt += milestones.shortfall;
        notice.key ??= `${REFERRAL_ORDER2_REVOKE_PREFIX}${refereeId}`;
      }
    }
    if (notice.key) {
      total.notices.push({ kind: 'REVOKED', referrerId, refereeId, taken: notice.taken, debt: notice.debt, cause: 'PARTIAL_RETURN', key: notice.key });
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
export async function revokeReferralRewardForPriorReturns(tx: Db, orderIds: string[]): Promise<ReferralRevokeResult | null> {
  const total: ReferralRevokeResult = { revoked: 0, shortfall: 0, notices: [] };
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
    total.notices.push(...res.notices);
  }
  return anyRevoked ? total : null;
}

/**
 * Thu hồi thưởng giới thiệu khi một trong hai đơn đã dùng để thưởng bị trả CẢ ĐƠN, kèm các mốc thưởng thêm
 * không còn đủ số lượt. BẮT BUỘC chạy trong tx của lần lật trạng thái. Không để số dư âm; phần thiếu
 * ghi REFERRAL_DEBT. Idempotent: dòng thu hồi dùng reason duy nhất (cùng partial unique index).
 * `revoked`/`shortfall` tính bằng Điểm Xanh. Đơn đã gộp sang tài khoản khác: không thu, không khoá người mời (đầu file).
 */
export async function revokeReferralRewardForOrder(
  tx: Db,
  order: { id: string; userId: string },
): Promise<ReferralRevokeResult | null> {
  await lockReferee(tx, order.userId);
  const grants = await findOrderGrants(tx, order);

  const total: ReferralRevokeResult = { revoked: 0, shortfall: 0, notices: [] };
  let anyRevoked = false;
  for (const g of grants) {
    const res = await revokeGrantFully(tx, g, order.id, 'RETURN');
    if (!res) continue;
    anyRevoked = true;
    total.revoked += res.revoked;
    total.shortfall += res.shortfall;
    total.notices.push(...res.notices);
  }
  return anyRevoked ? total : null;
}

/**
 * Thu hồi HOÀN TOÀN một lần thưởng (phần còn lại sau các lần thu từng phần) kèm các mốc không còn đủ lượt. Caller đã khoá
 * người được mời. Chỉ thu phần chưa thu ở các lần trả một phần (kể cả phần đã ghi nợ). Dòng thu hồi vẫn ghi khi phần còn lại
 * là 0: nó là dấu "đã thu hồi hoàn toàn" cho số lượt giới thiệu và mốc thưởng thêm.
 */
async function revokeGrantFully(
  tx: Db,
  g: { referrerId: string; refereeId: string; grant: ReferralGrant },
  refId: string,
  cause: 'RETURN' | 'MERGE',
): Promise<ReferralRevokeResult | null> {
  await lockReferrer(tx, g.referrerId);
  const partial = await readPartialRevocations(tx, g.referrerId, g.refereeId);
  const reason = `${REFERRAL_ORDER2_REVOKE_PREFIX}${g.refereeId}`;
  const main = await debitReferralReward(
    tx,
    g.referrerId,
    g.grant,
    reason,
    refId,
    `REFERRAL_ORDER2_DEBT:${g.refereeId}`,
    Math.max(0, referralGrantDue(g.grant) - partial.total),
  );
  if (!main) return null;
  const milestones = await revokeLostMilestones(tx, g.referrerId, refId);
  const revoked = main.revoked + milestones.revoked;
  const shortfall = main.shortfall + milestones.shortfall;
  return {
    revoked,
    shortfall,
    notices: [{ kind: 'REVOKED', referrerId: g.referrerId, refereeId: g.refereeId, taken: revoked, debt: shortfall, cause, key: reason }],
  };
}

/**
 * Thu hồi hoàn toàn thưởng REFERRAL_ORDER2:<refereeId> (ở bất kỳ ai đang giữ dòng thưởng), không theo đơn: gộp khách cắt một
 * liên kết giới thiệu tự mời hoặc tạo vòng thì thu luôn thưởng đã cấp cho liên kết đó. Khoá người được mời rồi người giữ
 * thưởng như đường trả hàng. Không có thưởng hoặc đã thu hồi rồi thì null.
 */
export async function revokeReferralRewardForReferee(
  tx: Db,
  refereeId: string,
  refId: string,
): Promise<ReferralRevokeResult | null> {
  await lockReferee(tx, refereeId);
  const where = { refType: 'REFERRAL', reason: `${REFERRAL_ORDER2_PREFIX}${refereeId}`, delta: { gt: 0 } };
  const select = { userId: true, delta: true } as const;
  const [coin, points] = await Promise.all([
    tx.coinTransaction.findFirst({ where, select }),
    tx.pointsTransaction.findFirst({ where, select }),
  ]);
  const row = points ? { ...points, ledger: 'POINTS' as const } : coin ? { ...coin, ledger: 'COIN' as const } : null;
  if (!row) return null;
  return revokeGrantFully(tx, { referrerId: row.userId, refereeId, grant: { amount: row.delta, ledger: row.ledger } }, refId, 'MERGE');
}

/**
 * Người dùng hiện tại của một id: dòng khách đã gộp (users.mergedIntoId) quy về tài khoản đích. Mã giới thiệu cũ của khách và
 * người được mời còn trỏ dòng khách (tạo xen giữa lúc gộp) nhờ đó thưởng cho tài khoản đích. Chỉ khách mới bị gộp và đích
 * không bao giờ là khách nên chuỗi dài một bước; vòng lặp có giới hạn chỉ để phòng dữ liệu tay.
 */
export async function resolveMergedUserId(db: Db, userId: string): Promise<string | null> {
  let current = userId;
  for (let hop = 0; hop < 5; hop++) {
    const row = await db.user.findUnique({ where: { id: current }, select: { mergedIntoId: true, metadata: true } });
    // Tài khoản đích đã xoá (account-deletion đổi mã của chính nó): mã cũ của khách đã gộp không được quy về nó.
    if (hop > 0 && isAnonymized(row?.metadata)) return null;
    if (!row?.mergedIntoId || row.mergedIntoId === current) return current;
    current = row.mergedIntoId;
  }
  return current;
}

/** Dòng đã ẩn danh hoá bởi account-deletion.service (metadata.anonymizedAt). */
export function isAnonymized(metadata: unknown): boolean {
  return typeof metadata === 'object' && metadata !== null && 'anonymizedAt' in metadata;
}

/**
 * Các đơn hiện thuộc `refereeId` đã nằm trong một lần thưởng REFERRAL_ORDER2 (kể cả đã thu hồi, ở sổ
 * xu cũ hay sổ điểm), kèm người mời đã nhận lần thưởng đó. Sau gộp phiên khách, đơn của khách đã dùng
 * để thưởng sang tài khoản đích nhưng dòng thưởng vẫn mang id khách — chặn theo reason
 * REFERRAL_ORDER2:<refereeId> không thấy chúng. Tra theo id đơn (không theo người được mời trong reason), kể cả khi lần
 * thưởng đó không còn bị thu hồi qua đơn đã chuyển: tài khoản đích không được dùng lại các đơn này để thưởng lần nữa.
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
