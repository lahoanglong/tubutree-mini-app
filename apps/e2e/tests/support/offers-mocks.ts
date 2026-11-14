import type { Page } from '@playwright/test';
import type { RewardCatalogDTO, RewardItemDTO } from '@tubutree/shared-types';
import type { MockApi } from './mock-api';

/** Thanh tab của trung tâm Ưu đãi (`/offers`): ba tab Săn mã, Mã của tôi, Đổi quà. Tab con của Kho quà (Đổi mã, Quà tặng…) cũng có role="tab" nên luôn chọn qua tablist này. */
export const hubTabs = (page: Page) => page.getByRole('tablist', { name: 'Các mục Ưu đãi', exact: true });
export const hubTab = (page: Page, name: string) => hubTabs(page).getByRole('tab', { name, exact: true });
export const hubPanel = (page: Page, name: string) => page.getByRole('tabpanel', { name, exact: true });

/** Đường dẫn kèm query hiện tại của trang (không gồm origin). */
export const pathAndSearch = (page: Page): string => {
  const u = new URL(page.url());
  return u.pathname + u.search;
};

const rewardBase = {
  description: 'Miễn phí vận chuyển cho 1 đơn từ 99.000đ.',
  label: 'Phổ biến',
  imageUrl: null,
  stockRemaining: null,
  soldOut: false,
  canRedeem: true,
  claimInstructions: null,
} as const;

const REWARDS: RewardItemDTO[] = [
  { ...rewardBase, id: 'reward-freeship', kind: 'VOUCHER', name: 'Miễn phí vận chuyển', pointsCost: 20_000, voucher: { type: 'FREESHIP', value: 0, minOrder: 99_000, maxDiscount: null, validDays: 30 }, sortOrder: 10 },
  { ...rewardBase, id: 'reward-50k', kind: 'VOUCHER', name: 'Giảm 50.000đ', pointsCost: 50_000, canRedeem: false, voucher: { type: 'AMOUNT', value: 50_000, minOrder: 300_000, maxDiscount: null, validDays: 30 }, sortOrder: 20 },
] as RewardItemDTO[];

/** Kho quà của khách đã đăng nhập (`GET /me/loyalty/rewards`): tab Đổi quà nạp đúng nội dung trang `/rewards`. */
export function mockRewardsCatalog(api: MockApi, points = 40_000): void {
  api.get('/me/loyalty/rewards', {
    pointsBalance: points, pointsConvertedBalance: 0, lockedPoints: 0, redeemablePoints: points, giftClaimDays: 60,
    claimPoint: { name: 'Kho Tubu TP.HCM', addressLine: '1 Đường A', communeName: 'Phường B', provinceName: 'TP. Hồ Chí Minh', openingHours: {} },
    rewards: REWARDS,
  } as RewardCatalogDTO);
}

/** Kho quà cho khách chưa đăng nhập (`GET /loyalty/preview`, công khai). */
export function mockLoyaltyPreview(api: MockApi): void {
  api.get('/loyalty/preview', {
    rewards: [REWARDS[0]!],
    giftClaimDays: 60,
    claimPoint: null,
    tiers: [
      { id: 'MAM_XANH', name: 'Mầm Xanh', minPoints: 0, minSpending: null, multiplier: 1, perks: ['Quà sinh nhật'] },
      { id: 'LOC_BIEC', name: 'Lộc Biếc', minPoints: 2500, minSpending: 5_000_000, multiplier: 1.2, perks: ['Freeship đơn từ 99k'] },
    ],
    rates: { earnPct: 2, vndPerPoint: 50, vndPerPointRedeem: 1, maxRedeemPct: 0.2 },
    pointExpireMonths: 12,
  } as never);
}

/** Đủ mock để trang Vườn Xanh (`/game`) dựng được khi spec chỉ cần chứng minh một nút mở đúng trang này. */
export function mockGardenStub(api: MockApi): void {
  api.get('/game/profile', {
    totalSeeds: 340, streakDays: 5, treeStage: 2, treeHealth: 'HEALTHY', streakFreezes: 1, lastDewAt: null, lastCheckInAt: null,
    ecoImpact: { progress: 40, target: 100, treeType: 'Cây Sưa Đỏ', treesPlanted: 3 }, treePointsPrice: 300, spinCostPoints: 10,
  });
  api.get('/game/quiz/today', []);
  api.get('/game/leaderboard', []);
  api.get('/game/missions', []);
  api.get('/game/forest', { count: 0, plantedCount: 0, trees: [] });
  api.get('/game/community', { goal: null, myDrops: 0, pct: 0 });
  api.get('/game/collection', []);
  api.get('/game/season', null);
  api.get('/game/season/leaderboard', []);
  api.get('/game/friends', []);
  api.get('/game/garden', {
    plots: [{ id: 'plot-home', slot: 1, isHome: true, treeType: 'Cây Sưa Đỏ', speciesId: null, progress: 40, target: 100, treeStage: 2, treesPlanted: 3, treeHealth: 'HEALTHY' }],
    maxPlots: 4,
    nextUnlock: { slot: 3, seedCost: 500 },
  });
  api.allowUnmocked('GET /game/season-pass', 'POST /events');
}
