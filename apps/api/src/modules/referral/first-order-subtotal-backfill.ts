import type { PrismaClient } from '@prisma/client';
import type { FirstOrderOutcome } from './first-order-reward';

/**
 * Bù một lần khi mốc thưởng đơn đầu đổi từ `orders.total` sang `orders.subtotal` (tiền hàng). Thưởng chỉ được xét lúc đơn sang DELIVERED.
 * Đơn giao trong khoảng từ lúc bật cờ tới lúc deploy bản mới, có tiền hàng đạt mốc mà tổng trả dưới mốc (mã khách mới, điểm), đã bị luật cũ
 * bỏ qua. Luật mới lại coi đơn đó là đơn đầu đạt mốc, nên đơn sau của cùng người gặp NOT_FIRST: không ai còn xét lại, cả cặp mất thưởng.
 * scripts/backfill-first-order-subtotal.ts gọi lại đường thưởng thật cho các đơn này. Đường đó idempotent theo người được mời và giữ mọi luật
 * (cờ, chặn tự mời, trần tháng), nên chạy lại không cấp hai lần.
 */

/** Lúc bật cờ growth.referral_viral_enabled trên PROD (w8-04): 19/11/2026 23:13:49 giờ Việt Nam. Trước đó chưa có thưởng đơn đầu. */
export const FIRST_ORDER_VIRAL_LIVE_AT = new Date('2026-11-19T16:13:49Z');

/** Id đơn luật cũ bỏ qua mà luật mới coi là đạt mốc, cũ trước (thứ tự firstQualifyingOrder). */
export async function subtotalSwitchCandidates(db: Pick<PrismaClient, 'order'>, since: Date, minOrder: number): Promise<string[]> {
  const rows = await db.order.findMany({
    where: {
      type: 'RETAIL',
      placedForCustomer: false,
      status: 'DELIVERED',
      deliveredAt: { gte: since },
      subtotal: { gte: minOrder },
      total: { lt: minOrder },
      user: { referredById: { not: null } },
    },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    select: { id: true },
  });
  return rows.map((r) => r.id);
}

/** Chạy thử (apply=false) chỉ trả danh sách. apply=true xét từng đơn tuần tự và đếm kết quả: `GRANTED`, `SKIPPED:<lý do>`, `BLOCKED:<lý do>`. */
export async function backfillFirstOrderSubtotal(
  deps: { db: Pick<PrismaClient, 'order'>; grant: (orderId: string) => Promise<FirstOrderOutcome> },
  opts: { since: Date; minOrder: number; apply: boolean },
): Promise<{ candidates: string[]; outcomes: Record<string, number> }> {
  const candidates = await subtotalSwitchCandidates(deps.db, opts.since, opts.minOrder);
  const outcomes: Record<string, number> = {};
  if (!opts.apply) return { candidates, outcomes };
  for (const id of candidates) {
    const out = await deps.grant(id);
    const key = out.status === 'GRANTED' ? 'GRANTED' : `${out.status}:${out.reason}`;
    outcomes[key] = (outcomes[key] ?? 0) + 1;
  }
  return { candidates, outcomes };
}
