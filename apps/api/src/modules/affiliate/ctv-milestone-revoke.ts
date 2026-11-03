import type { Prisma } from '@prisma/client';
import { applyPointsDelta } from '../loyalty/points-ledger';
import { loadPointExpiryTxns, lotRecoverable } from '../loyalty/loyalty-expiry.service';
import { REFERRAL_DEBT_REF_TYPE } from '../wallet/referral-reward';
import { CONFIRMED_COMMISSION_STATUSES, CTV_MONTHLY_MILESTONES, vnMonthBounds, type VnMonth } from './ctv-milestones';

type Db = Prisma.TransactionClient;

/** refType của dòng thưởng mốc (claimMilestone) và của dòng thu hồi nó; cùng refId = id claim nên sổ lô ghép được hai dòng. */
export const CTV_MILESTONE_REF_TYPE = 'AFFILIATE_MILESTONE';
export const CTV_MILESTONE_REVOKE_REF_TYPE = 'AFFILIATE_MILESTONE_REVOKE';
/** Khoá lô khớp CTV_MILESTONE_RULE ở loyalty-expiry.service.ts. */
export const ctvMilestoneLotKey = (claimId: string): string => `CTV_MILESTONE:${claimId}`;

/** Doanh số đã chốt của CTV trong tháng VN: tổng commissionableTotal của hoa hồng APPROVED/PAID có approvedAt trong tháng. */
export async function confirmedMonthRevenue(db: Pick<Db, 'commission'>, userId: string, month: VnMonth): Promise<number> {
  const agg = await db.commission.aggregate({
    where: {
      affiliateUserId: userId,
      status: { in: [...CONFIRMED_COMMISSION_STATUSES] },
      approvedAt: { gte: month.start, lt: month.end },
    },
    _sum: { commissionableTotal: true },
  });
  return agg._sum.commissionableTotal ?? 0;
}

/**
 * Khoá dòng CTV (NO KEY UPDATE, như mọi đường ghi số dư) rồi trả số dư Điểm Xanh. Cả nhận mốc lẫn thu hồi lấy khoá này TRƯỚC khi
 * đọc doanh số: nhận mốc đọc doanh số cũ rồi commit sau lần đảo thì không ai thu lại được thưởng, nên hai bên phải xếp hàng.
 */
export async function lockCtvForMilestones(tx: Db, userId: string): Promise<number> {
  const [row] = await tx.$queryRaw<{ pointsBalance: number }[]>`
    SELECT "pointsBalance" FROM "users" WHERE "id" = ${userId} FOR NO KEY UPDATE`;
  return Number(row?.pointsBalance ?? 0);
}

export interface CtvMilestoneRevoked {
  claimId: string;
  userId: string;
  /** Điểm thực trừ khỏi số dư. */
  taken: number;
  /** Phần không thu được vì số dư thiếu (đã ghi nợ). */
  debt: number;
}

/**
 * CTV-01: sau khi hoa hồng đã chốt (APPROVED/PAID, duyệt vào `approvedAt`) bị đảo hoặc cắt, thu hồi điểm của các mốc ĐÃ NHẬN của
 * tháng đó mà doanh số đã chốt nay dưới ngưỡng. BẮT BUỘC chạy trong tx đã ghi thay đổi hoa hồng.
 *
 * Thu từ lô STANDARD, không quá phần lô thưởng mốc còn thu hồi được (lotRecoverable: trừ điểm cron đã trừ vì hết hạn) và không
 * quá số dư. Thiếu thì ghi dòng nợ delta 0 refType REFERRAL_DEBT như thưởng giới thiệu; nợ được trừ vào lần nhận lại mốc.
 * Idempotent theo trạng thái dòng claim (revokedAt) dưới khoá CTV: chạy lại hay chạy song song không trừ hai lần.
 */
export async function revokeLostCtvMilestones(tx: Db, userId: string, approvedAt: Date | null): Promise<CtvMilestoneRevoked[]> {
  if (!approvedAt) return [];
  let balance = await lockCtvForMilestones(tx, userId);
  const month = vnMonthBounds(approvedAt);
  const claims = await tx.ctvMilestoneClaim.findMany({
    where: { userId, monthKey: month.key, revokedAt: null, rewardPoints: { gt: 0 } },
    orderBy: { createdAt: 'asc' },
  });
  if (claims.length === 0) return [];
  const revenue = await confirmedMonthRevenue(tx, userId, month);
  const lost = claims.filter((c) => {
    const milestone = CTV_MONTHLY_MILESTONES.find((m) => m.id === c.milestoneId);
    return milestone !== undefined && revenue < milestone.threshold;
  });
  if (lost.length === 0) return [];

  const ledger = await loadPointExpiryTxns(tx, userId);
  const out: CtvMilestoneRevoked[] = [];
  for (const claim of lost) {
    const marked = await tx.ctvMilestoneClaim.updateMany({
      where: { id: claim.id, revokedAt: null },
      data: { revokedAt: new Date(), revokeCount: { increment: 1 } },
    });
    if (marked.count !== 1) continue;
    const generation = claim.revokeCount + 1;
    const recoverable = lotRecoverable(ledger, ctvMilestoneLotKey(claim.id));
    const owed = Math.min(claim.rewardPoints, recoverable ?? claim.rewardPoints);
    const taken = Math.min(owed, Math.max(balance, 0));
    if (taken > 0) {
      const res = await applyPointsDelta(tx, {
        userId,
        delta: -taken,
        lot: 'STANDARD',
        reason: `CTV_MILESTONE_REVOKE:${claim.id}:${generation}`,
        refType: CTV_MILESTONE_REVOKE_REF_TYPE,
        refId: claim.id,
      });
      // Số dư đã đọc sau khoá CTV nên không thể thiếu; ném để rollback thay vì để sổ lệch.
      if (!res.applied) throw new Error(`Thu hồi thưởng mốc ${claim.id}: số dư đổi giữa chừng`);
      balance -= taken;
    }
    const debt = owed - taken;
    if (debt > 0) {
      await tx.pointsTransaction.create({
        data: {
          userId,
          delta: 0,
          lot: 'STANDARD',
          reason: `CTV_MILESTONE_DEBT:${claim.id}:${generation}:${debt}`,
          refType: REFERRAL_DEBT_REF_TYPE,
          refId: claim.id,
        },
      });
    }
    await tx.ctvMilestoneClaim.update({ where: { id: claim.id }, data: { revokeDebt: debt } });
    out.push({ claimId: claim.id, userId, taken, debt });
  }
  return out;
}
