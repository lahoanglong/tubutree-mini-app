import type { PrismaService } from '../../prisma/prisma.service';

export const UNMATCHED_RETRY_DAYS_FOR_ATTENTION = 3;
/** Claim PENDING mà đơn chưa tới được mốc cộng quá ngần này ngày (bằng tuổi đơn tối đa mặc định) thì cần người xem. */
export const STALE_PENDING_DAYS = 60;

import type { Prisma } from '@prisma/client';

/** Claim đã cộng mà đơn đã đóng (huỷ, hoàn, xoá): lẽ ra phải đã đảo. */
export const closedCreditedWhere: Prisma.ExternalPointsClaimWhereInput = { state: 'CREDITED', externalOrder: { status: { in: ['CANCELLED', 'RETURNED', 'DELETED'] } } };

/** Claim PENDING không có đường tới hạn (xem externalPointsAttentionCount). */
export const stalePendingWhere = (now: Date): Prisma.ExternalPointsClaimWhereInput => ({
  state: 'PENDING',
  OR: [
    { createdAt: { lt: new Date(now.getTime() - STALE_PENDING_DAYS * 864e5) }, externalOrder: { status: { in: ['OPEN', 'RETURNING'] } } },
    { externalOrder: { status: 'DELIVERED', deliveredAt: null } },
    { externalOrder: { status: 'PARTIAL_RETURN' }, OR: [{ decidedById: null }, { releaseAt: null }] },
  ],
});

type Db = Pick<PrismaService, 'externalPointsClaim' | 'externalClaimAttempt'>;

/**
 * Số việc "Cần xử lý" của điểm đơn ngoài app, cùng điều kiện với hai danh sách admin: claim REVIEW, lần gửi mã UNMATCHED chưa xử lý đã
 * hết 3 ngày tự ghép (hoặc đã thấy đơn nhưng nguồn lạ), claim đã cộng mà đơn hoàn một phần (cờ reviewReason), claim đã cộng mà đơn đã đóng
 * (huỷ, hoàn, xoá) vì lẽ ra phải đã đảo.
 */
export async function externalPointsAttentionCount(db: Db, now: Date): Promise<number> {
  const stale = new Date(now.getTime() - UNMATCHED_RETRY_DAYS_FOR_ATTENTION * 864e5);
  const [review, attempts, partial, closed, stuck] = await Promise.all([
    db.externalPointsClaim.count({ where: { state: 'REVIEW' } }),
    db.externalClaimAttempt.count({ where: { result: 'UNMATCHED', resolvedAt: null, OR: [{ externalOrderId: { not: null } }, { createdAt: { lt: stale } }] } }),
    db.externalPointsClaim.count({ where: { state: 'CREDITED', reviewReason: { not: null } } }),
    db.externalPointsClaim.count({ where: closedCreditedWhere }),
    // Lưới an toàn: PENDING không có đường nào tới hạn. Đơn kẹt chưa giao lâu (OPEN, RETURNING), đơn DELIVERED thiếu deliveredAt,
    // đơn hoàn một phần chưa ai duyệt hoặc thiếu mốc cộng.
    db.externalPointsClaim.count({ where: stalePendingWhere(now) }),
  ]);
  return review + attempts + partial + closed + stuck;
}
