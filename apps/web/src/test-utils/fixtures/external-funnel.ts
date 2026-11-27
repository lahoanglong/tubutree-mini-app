import type { ExternalClaimFunnel } from '@tubutree/shared-types';

/** Trả lời mẫu của GET /admin/external-claims/funnel cho spec của tab Tích điểm đơn sàn (số giả, đủ mọi trường). */
export const EXTERNAL_FUNNEL: ExternalClaimFunnel = {
  period: '30d',
  from: '2026-10-28T00:00:00.000Z',
  to: '2026-11-27T00:00:00.000Z',
  submissions: { total: 1250, scan: 900, typed: 300 },
  matchedOrders: 820,
  phoneMismatch: { rejected: 12, review: 7 },
  noPhoneReview: { review: 31, waiting: 9 },
  unmatched: 95,
  pending: { claims: 140, points: 210_000 },
  credited: { claims: 600, points: 905_000, users: 480 },
  converted: { users: 96, orders: 130, gmv: 41_500_000, rate: 0.2 },
};

export const EXTERNAL_FUNNEL_PATH = '/admin/external-claims/funnel';
