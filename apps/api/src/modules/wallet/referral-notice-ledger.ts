import type { PrismaClient } from '@prisma/client';
import type { ReferralNotice } from './referral-notify';
import {
  MILESTONE_PREFIX,
  MILESTONE_REVOKE_PREFIX,
  REFERRAL_DEBT_REF_TYPE,
  REFERRAL_ORDER2_PARTIAL_DEBT_PREFIX,
  REFERRAL_ORDER2_PARTIAL_REVOKE_PREFIX,
  REFERRAL_ORDER2_PREFIX,
  REFERRAL_ORDER2_REVOKE_PREFIX,
  referralGrantDue,
} from './referral-reward';

type Db = Pick<PrismaClient, 'pointsTransaction' | 'coinTransaction' | 'user'>;

export interface ReferralLedgerRow {
  id: string;
  userId: string;
  delta: number;
  reason: string;
  refId: string | null;
  createdAt: Date;
}

/**
 * FOLDED: dòng khoá REVOKE đã gộp vào tin của dòng thu hồi từng phần đóng khoản thưởng (đường trực tiếp chỉ gửi một tin cho cả
 * sự kiện). AMBIGUOUS: nhiều dòng khoá REVOKE cùng người mời cùng refId (gộp khách cắt nhiều người được mời trong một tx) nên
 * không tách được mốc/nợ về từng tin; bỏ qua thay vì gửi sai số điểm.
 */
export type ReferralNoticeFromLedger = ReferralNotice | 'FOLDED' | 'AMBIGUOUS' | null;

/** Các tiền tố reason mà đường trực tiếp báo người mời (referral-notify.ts) và dòng sổ điểm tương ứng. */
export const REFERRAL_NOTICE_REASON_PREFIXES = [
  REFERRAL_ORDER2_PREFIX,
  MILESTONE_PREFIX,
  REFERRAL_ORDER2_PARTIAL_REVOKE_PREFIX,
  REFERRAL_ORDER2_REVOKE_PREFIX,
] as const;

const MILESTONE_DEBT_PREFIX = 'REFERRAL_MILESTONE_DEBT:';
const ORDER2_DEBT_PREFIX = 'REFERRAL_ORDER2_DEBT:';
const MERGE_REF_PREFIX = 'MERGE:';

/** Số điểm thiếu nằm ở đoạn cuối reason của dòng nợ (`<tiền tố>:<số điểm thiếu>`). */
function shortfallOf(reason: string): number {
  const n = Number(reason.slice(reason.lastIndexOf(':') + 1));
  return Number.isFinite(n) && n > 0 ? n : 0;
}

async function debtTotal(db: Db, userId: string, reasonPrefix: string, refId?: string): Promise<number> {
  const rows = await db.pointsTransaction.findMany({
    where: { userId, refType: REFERRAL_DEBT_REF_TYPE, reason: { startsWith: reasonPrefix }, ...(refId !== undefined && { refId }) },
    select: { reason: true },
  });
  return rows.reduce((sum, r) => sum + shortfallOf(r.reason), 0);
}

/** Mốc bị thu cùng lúc (revokeLostMilestones) của sự kiện đóng khoản thưởng: dòng cùng refId (id đơn hoặc MERGE:<id khách>). */
async function milestoneRevokeOf(db: Db, userId: string, refId: string): Promise<{ taken: number; debt: number }> {
  const rows = await db.pointsTransaction.findMany({
    where: { userId, refType: 'REFERRAL', reason: { startsWith: MILESTONE_REVOKE_PREFIX }, refId },
    select: { delta: true },
  });
  return { taken: rows.reduce((sum, r) => sum + Math.max(-r.delta, 0), 0), debt: await debtTotal(db, userId, MILESTONE_DEBT_PREFIX, refId) };
}

/**
 * Dòng thu hồi từng phần CUỐI của (người mời, người được mời) có đóng khoản thưởng không: đóng khi tổng đã thu từng phần (điểm
 * đã trừ + nợ) đủ cả khoản VÀ dòng khoá REVOKE ghi cùng refId (đơn) với nó. Đường trực tiếp đóng khoản trong chính tx của lần
 * thu từng phần đó (revokeReferralRewardPartially) và chỉ gửi một tin mang khoá của dòng từng phần.
 */
async function closingPartial(db: Db, userId: string, refereeId: string): Promise<{ row: ReferralLedgerRow; revoke: ReferralLedgerRow } | null> {
  const [revoke, partials, partialDebts, grant] = await Promise.all([
    db.pointsTransaction.findFirst({ where: { userId, refType: 'REFERRAL', reason: `${REFERRAL_ORDER2_REVOKE_PREFIX}${refereeId}` } }),
    db.pointsTransaction.findMany({
      where: { userId, refType: 'REFERRAL', reason: { startsWith: `${REFERRAL_ORDER2_PARTIAL_REVOKE_PREFIX}${refereeId}:` } },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    }),
    debtTotal(db, userId, `${REFERRAL_ORDER2_PARTIAL_DEBT_PREFIX}${refereeId}:`),
    findGrant(db, refereeId),
  ]);
  const last = partials[partials.length - 1];
  if (!revoke || !last || !grant || last.refId !== revoke.refId) return null;
  const takenTotal = partials.reduce((sum, r) => sum + Math.max(-r.delta, 0), 0);
  const due = referralGrantDue(grant);
  return due > 0 && takenTotal + partialDebts >= due ? { row: last, revoke } : null;
}

async function findGrant(db: Db, refereeId: string): Promise<{ amount: number; ledger: 'COIN' | 'POINTS' } | null> {
  const where = { refType: 'REFERRAL', reason: `${REFERRAL_ORDER2_PREFIX}${refereeId}`, delta: { gt: 0 } };
  const select = { delta: true } as const;
  const points = await db.pointsTransaction.findFirst({ where, select });
  if (points) return { amount: points.delta, ledger: 'POINTS' };
  const coin = await db.coinTransaction.findFirst({ where, select });
  return coin ? { amount: coin.delta, ledger: 'COIN' } : null;
}

/**
 * Người được mời chính là người nhận tin (hoặc phiên khách đã gộp vào họ): chỉ xảy ra sau khi gộp khách chuyển dòng sổ sang
 * tài khoản đích. Đường trực tiếp không bao giờ báo "bạn bè" là chính người nhận, nên tin dựng lại cũng bỏ qua; riêng thu hồi do
 * gộp thì đường trực tiếp báo với tên ẩn (hideFriend) nên giữ.
 */
async function isSelfReferral(db: Db, userId: string, refereeId: string): Promise<boolean> {
  if (refereeId === userId) return true;
  const referee = await db.user.findUnique({ where: { id: refereeId }, select: { mergedIntoId: true } });
  return referee?.mergedIntoId === userId;
}

/**
 * Dựng lại tin ReferralNotice mà đường trực tiếp đã (hoặc lẽ ra phải) gửi cho một dòng sổ điểm khoá tin, chỉ từ sổ. Cùng khoá
 * reason nên cùng dedupeKey; số điểm/nợ/nguyên nhân cùng nguồn với đường trực tiếp nên lời tin giống hệt (referralNoticeMessage).
 * Trả null nếu dòng không phải dòng khoá của tin nào.
 */
export async function referralNoticeFromLedger(db: Db, row: ReferralLedgerRow): Promise<ReferralNoticeFromLedger> {
  const { reason, userId } = row;
  if (reason.startsWith(REFERRAL_ORDER2_PREFIX)) {
    const refereeId = reason.slice(REFERRAL_ORDER2_PREFIX.length);
    // Dòng thưởng đã theo sổ của khách gộp sang chính người được mời (khách mời X, X là target): không có "bạn" nào để báo.
    if (!(row.delta > 0) || (await isSelfReferral(db, userId, refereeId))) return null;
    return { kind: 'PAID', referrerId: userId, refereeId, points: row.delta, key: reason };
  }
  if (reason.startsWith(MILESTONE_PREFIX)) {
    if (!(row.delta > 0)) return null;
    const count = Number(reason.slice(reason.lastIndexOf(':') + 1).split('#')[0]);
    if (!Number.isInteger(count) || count <= 0) return null;
    return { kind: 'MILESTONE', referrerId: userId, count, points: row.delta, key: reason };
  }
  if (reason.startsWith(REFERRAL_ORDER2_PARTIAL_REVOKE_PREFIX)) {
    const rest = reason.slice(REFERRAL_ORDER2_PARTIAL_REVOKE_PREFIX.length);
    const sep = rest.indexOf(':');
    if (sep <= 0) return null;
    const refereeId = rest.slice(0, sep);
    if (await isSelfReferral(db, userId, refereeId)) return null;
    let taken = Math.max(-row.delta, 0);
    let debt = await debtTotal(db, userId, `${REFERRAL_ORDER2_PARTIAL_DEBT_PREFIX}${rest}:`);
    const closing = await closingPartial(db, userId, refereeId);
    if (closing && closing.row.id === row.id && closing.revoke.refId) {
      const milestones = await milestoneRevokeOf(db, userId, closing.revoke.refId);
      taken += milestones.taken;
      debt += milestones.debt;
    }
    return { kind: 'REVOKED', referrerId: userId, refereeId, taken, debt, cause: 'PARTIAL_RETURN', key: reason };
  }
  if (reason.startsWith(REFERRAL_ORDER2_REVOKE_PREFIX)) {
    const refereeId = reason.slice(REFERRAL_ORDER2_REVOKE_PREFIX.length);
    const refId = row.refId;
    if (!refId) return null;
    // Thu hồi do gộp (cause MERGE) đã tự ẩn tên khi người được mời là chính người giữ thưởng; các nguyên nhân khác không có "bạn" để nêu.
    if (!refId.startsWith(MERGE_REF_PREFIX) && (await isSelfReferral(db, userId, refereeId))) return null;
    if ((await closingPartial(db, userId, refereeId))?.revoke.id === row.id) return 'FOLDED';
    const sameEvent = await db.pointsTransaction.count({
      where: { userId, refType: 'REFERRAL', reason: { startsWith: REFERRAL_ORDER2_REVOKE_PREFIX }, refId },
    });
    if (sameEvent > 1) return 'AMBIGUOUS';
    const [milestones, mainDebt] = await Promise.all([
      milestoneRevokeOf(db, userId, refId),
      debtTotal(db, userId, `${ORDER2_DEBT_PREFIX}${refereeId}:`, refId),
    ]);
    const merged = refId.startsWith(MERGE_REF_PREFIX);
    let hideFriend = false;
    if (merged) {
      // Tự mời: người được mời là phiên khách vừa gộp hoặc chính tài khoản đích của nó (auth.service gộp khách).
      const guestId = refId.slice(MERGE_REF_PREFIX.length);
      const guest = await db.user.findUnique({ where: { id: guestId }, select: { mergedIntoId: true } });
      hideFriend = refereeId === guestId || (guest?.mergedIntoId != null && refereeId === guest.mergedIntoId);
    }
    return {
      kind: 'REVOKED',
      referrerId: userId,
      refereeId,
      taken: Math.max(-row.delta, 0) + milestones.taken,
      debt: mainDebt + milestones.debt,
      cause: merged ? 'MERGE' : 'RETURN',
      key: reason,
      ...(hideFriend && { hideFriend: true }),
    };
  }
  return null;
}
