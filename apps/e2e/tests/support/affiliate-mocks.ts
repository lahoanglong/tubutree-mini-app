import type {
  AffiliateDashboard,
  AffiliateMe,
  CtvMilestoneItem,
  CtvMilestonesResponse,
  CtvTiersResponse,
} from '../../../miniapp/src/services/affiliate-api';
import type { MockApi } from './mock-api';

/**
 * Mock Dashboard CTV (apps/miniapp/src/pages/affiliate.tsx) — route affiliate.controller.ts:
 *   GET /affiliate/me, /dashboard, /links, /commissions, /analytics/storefronts, /analytics/products,
 *   GET /affiliate/tiers, GET /affiliate/milestones, POST /affiliate/milestones/:id/claim.
 * Dữ liệu bậc/mốc chép từ apps/api/src/modules/affiliate/ctv-milestones.ts (CTV_TIERS,
 * CTV_MONTHLY_MILESTONES). Bậc CTV chỉ là danh hiệu — KHÔNG có bonusPct.
 */

/** Doanh số đã chốt tháng này: 3,2tr → bậc "Đồng", đạt mốc 3tr, chưa đạt mốc 10tr. */
export const CTV_REVENUE = 3_200_000;

export const CTV_TIER: AffiliateDashboard['tier'] = {
  name: 'Đồng',
  emoji: '🌿',
  nextName: 'Bạc',
  nextThreshold: 10_000_000,
  toNext: 6_800_000,
};

export const CTV_DASHBOARD: AffiliateDashboard = {
  todayCommission: 15000,
  monthCommission: 180000,
  pendingCommission: 60000,
  withdrawableCommission: 120000,
  totalClicks: 42,
  totalConversions: 5,
  monthRevenue: CTV_REVENUE,
  tier: CTV_TIER,
};

export const CTV_TIERS: CtvTiersResponse = {
  revenue: CTV_REVENUE,
  tier: CTV_TIER,
  allTiers: [
    { name: 'Tân binh', emoji: '🌱', min: 0, milestoneRewardXu: null },
    { name: 'Đồng', emoji: '🌿', min: 3_000_000, milestoneRewardXu: 50_000 },
    { name: 'Bạc', emoji: '🌳', min: 10_000_000, milestoneRewardXu: 200_000 },
    { name: 'Vàng', emoji: '🌲', min: 30_000_000, milestoneRewardXu: 600_000 },
    { name: 'Kim Cương', emoji: '💎', min: 80_000_000, milestoneRewardXu: 2_000_000 },
  ],
};

export const MILESTONE_3M: CtvMilestoneItem = {
  id: 'milestone-3m',
  title: 'Mốc Khởi Động 3 Triệu',
  threshold: 3_000_000,
  rewardXu: 50_000,
  description: 'Đạt 3.000.000đ doanh số đã chốt trong tháng',
  achieved: true,
  claimed: false,
  canClaim: true,
  progressPct: 100,
};

export const MILESTONE_10M: CtvMilestoneItem = {
  id: 'milestone-10m',
  title: 'Mốc Tăng Tốc 10 Triệu',
  threshold: 10_000_000,
  rewardXu: 200_000,
  description: 'Đạt 10.000.000đ doanh số đã chốt trong tháng',
  achieved: false,
  claimed: false,
  canClaim: false,
  progressPct: 32,
};

export const CTV_MILESTONES: CtvMilestonesResponse = {
  monthKey: '2026-09',
  currentRevenue: CTV_REVENUE,
  pendingRevenue: 450_000,
  holdDays: 7,
  milestones: [MILESTONE_3M, MILESTONE_10M],
  previousMonth: null,
};

export const CTV_MILESTONES_EMPTY: CtvMilestonesResponse = {
  monthKey: '2026-09',
  currentRevenue: 0,
  pendingRevenue: 0,
  holdDays: 7,
  milestones: [],
  previousMonth: null,
};

export function mockAffiliateDashboard(
  api: MockApi,
  opts: { me?: Partial<AffiliateMe>; milestones?: CtvMilestonesResponse | (() => CtvMilestonesResponse) } = {},
): void {
  const me: AffiliateMe = { isAffiliate: true, referralCode: 'CTV-AFF1', walletBalance: 0, ...opts.me };
  api.get('/affiliate/me', me);
  api.get('/affiliate/dashboard', CTV_DASHBOARD);
  api.get('/affiliate/links', []);
  api.get('/affiliate/commissions', []);
  api.get('/affiliate/analytics/storefronts', { storefronts: [] });
  api.get('/affiliate/analytics/products', []);
  api.get('/affiliate/tiers', CTV_TIERS);
  const ms = opts.milestones ?? CTV_MILESTONES_EMPTY;
  api.get('/affiliate/milestones', typeof ms === 'function' ? () => ms() : ms);
}
