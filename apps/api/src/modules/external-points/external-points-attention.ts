import type { PrismaService } from '../../prisma/prisma.service';

export const UNMATCHED_RETRY_DAYS_FOR_ATTENTION = 3;

type Db = Pick<PrismaService, 'externalPointsClaim' | 'externalClaimAttempt'>;

/**
 * Số việc "Cần xử lý" của điểm đơn ngoài app, cùng điều kiện với hai danh sách admin: claim REVIEW, lần gửi mã UNMATCHED chưa xử lý đã
 * hết 3 ngày tự ghép (hoặc đã thấy đơn nhưng nguồn lạ), claim đã cộng mà đơn hoàn một phần (cờ reviewReason), và claim đã cộng mà đơn đã đóng
 * (huỷ, hoàn, xoá) vì lẽ ra phải đã đảo.
 */
export async function externalPointsAttentionCount(db: Db, now: Date): Promise<number> {
  const stale = new Date(now.getTime() - UNMATCHED_RETRY_DAYS_FOR_ATTENTION * 864e5);
  const [review, attempts, partial, closed] = await Promise.all([
    db.externalPointsClaim.count({ where: { state: 'REVIEW' } }),
    db.externalClaimAttempt.count({ where: { result: 'UNMATCHED', resolvedAt: null, OR: [{ externalOrderId: { not: null } }, { createdAt: { lt: stale } }] } }),
    db.externalPointsClaim.count({ where: { state: 'CREDITED', reviewReason: { not: null } } }),
    db.externalPointsClaim.count({ where: { state: 'CREDITED', externalOrder: { status: { in: ['CANCELLED', 'RETURNED', 'DELETED'] } } } }),
  ]);
  return review + attempts + partial + closed;
}
