import type { Prisma, PrismaClient } from '@prisma/client';
import { REFERRAL_GUARD_REASONS, type ReferralFirstOrderGuardDTO } from '@tubutree/shared-types';
import type { FirstOrderBlockReason } from './first-order-guard';
import { FIRST_ORDER_REFERRER_PREFIX } from './first-order-reward';

/**
 * Đếm để theo dõi luật chống tự giới thiệu của thưởng đơn đầu, nhất là luật IP 24 giờ: 4G Việt Nam và Wi-Fi văn phòng dùng chung IP công
 * khai (CGNAT), nên bạn thật có thể bị chặn và cả cặp mất thưởng. Số đã thưởng lấy từ sổ điểm (dòng của người mời, mỗi cặp một dòng); số bị
 * chặn lấy từ sự kiện hệ thống ghi lúc xét, vì lần chặn không để lại dòng nào khác. Chỉ là số đếm, không nới luật.
 */
export const FIRST_ORDER_BLOCKED_EVENT = 'referral_first_order_blocked';

type Count = number | bigint;

/**
 * Ghi một lần chặn. eventId cố định theo đơn: việc sau giao chạy lại hay cron xét lại cùng đơn không đếm thêm, đơn đếm theo lý do của lần
 * chặn đầu tiên. Không lưu id hay SĐT của khách, chỉ id đơn để ADMIN mở đơn khi cần xem lại.
 */
export async function recordFirstOrderBlocked(
  db: Pick<Prisma.TransactionClient, 'analyticsEvent'>,
  orderId: string,
  reason: FirstOrderBlockReason,
  at: Date,
): Promise<void> {
  await db.analyticsEvent.createMany({
    data: [{ eventId: `${FIRST_ORDER_BLOCKED_EVENT}:${orderId}`, eventName: FIRST_ORDER_BLOCKED_EVENT, platform: 'system', occurredAt: at, props: { orderId, reason } }],
    skipDuplicates: true,
  });
}

/** Số cặp đã thưởng và số đơn đầu bị chặn theo lý do, trong [since, until]. */
export async function firstOrderGuardStats(
  db: Pick<PrismaClient, '$queryRaw' | 'pointsTransaction'>,
  since: Date,
  until: Date,
): Promise<ReferralFirstOrderGuardDTO> {
  const rewarded = await db.pointsTransaction.count({
    where: { refType: 'REFERRAL', reason: { startsWith: FIRST_ORDER_REFERRER_PREFIX }, createdAt: { gte: since, lte: until } },
  });
  const rows = await db.$queryRaw<Array<{ reason: string | null; n: Count }>>`
    SELECT e.props->>'reason' AS reason, count(*) AS n
      FROM "analytics_events" e
     WHERE e."eventName" = ${FIRST_ORDER_BLOCKED_EVENT}
       AND e."occurredAt" >= ${since.toISOString()}::timestamp
       AND e."occurredAt" <= ${until.toISOString()}::timestamp
     GROUP BY 1`;
  const blocked = Object.fromEntries(REFERRAL_GUARD_REASONS.map((r) => [r, 0])) as ReferralFirstOrderGuardDTO['blocked'];
  for (const row of rows) {
    if (row.reason && (REFERRAL_GUARD_REASONS as readonly string[]).includes(row.reason)) {
      blocked[row.reason as FirstOrderBlockReason] += Number(row.n);
    }
  }
  return { rewarded, blocked };
}
