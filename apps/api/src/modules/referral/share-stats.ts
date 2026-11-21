import type { PrismaClient } from '@prisma/client';
import type { ReferralShareStatsDTO } from '@tubutree/shared-types';

/** Sự kiện khách bấm gửi link mời (thẻ thành tích Sổ tay Xanh, thẻ chia sẻ ở Tài khoản, thẻ nhựa đã giảm của đơn). */
export const REFERRAL_SHARE_EVENT = 'green_card_shared';

type Count = number | bigint;

/**
 * Lượt bấm gửi link mời trong [since, until], tách theo cách gửi (mở hộp chia sẻ / sao chép link). Chỉ là số lượt bấm phía khách: không biết
 * người nhận có mở link hay không, đó là việc của phễu thưởng đơn đầu. Lọc theo giờ máy chủ nhận (`receivedAt`, như phễu mua hàng): `occurredAt` do máy
 * khách gửi, đồng hồ máy lệch hay hàng đợi Mini gửi muộn thì lượt bấm rơi ra ngoài khung.
 */
export async function referralShareStats(db: Pick<PrismaClient, '$queryRaw'>, since: Date, until: Date): Promise<ReferralShareStatsDTO> {
  const rows = await db.$queryRaw<Array<{ method: string | null; n: Count }>>`
    SELECT e.props->>'method' AS method, count(*) AS n
      FROM "analytics_events" e
     WHERE e."eventName" = ${REFERRAL_SHARE_EVENT}
       AND e."receivedAt" >= ${since.toISOString()}::timestamp
       AND e."receivedAt" <= ${until.toISOString()}::timestamp
     GROUP BY 1`;
  const out: ReferralShareStatsDTO = { share: 0, copy: 0 };
  for (const row of rows) {
    if (row.method === 'share' || row.method === 'copy') out[row.method] += Number(row.n);
  }
  return out;
}
