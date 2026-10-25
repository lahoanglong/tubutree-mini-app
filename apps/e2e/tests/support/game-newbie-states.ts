import type { MockApi } from './mock-api';

/** Ba trạng thái của phiên đầu để chụp so Mini App với web ở 375x812 (cùng dữ liệu giả cho cả hai bên). */
export type NewbieState = 'new' | 'after-checkin' | 'after-seedling';

export const NEWBIE_STATES: NewbieState[] = ['new', 'after-checkin', 'after-seedling'];

const base = {
  treeStage: 1,
  treeHealth: 'HEALTHY',
  streakFreezes: 0,
  lastDewAt: null as string | null,
  streakFreezeCost: 40,
  treePointsPrice: 50_000,
  streakRepairable: false,
  streakRepairCost: 50,
  spinCostPoints: 10_000,
  dailyLoginSeeds: 15,
  dewSeeds: 15,
  streak7Seeds: 30,
  quizWrongSeeds: 2,
};

export function newbieProfile(state: NewbieState) {
  const now = new Date().toISOString();
  if (state === 'new') {
    return { ...base, totalSeeds: 0, streakDays: 0, lastCheckInAt: null, firstCheckinBonus: 50, currentTreeTarget: 60, nextTreeTarget: 300, ecoImpact: { progress: 0, target: 60, treeType: 'Cây Dứa Fuwa3e', treesPlanted: 0 } };
  }
  if (state === 'after-checkin') {
    return { ...base, totalSeeds: 65, streakDays: 1, lastCheckInAt: now, firstCheckinBonus: 0, currentTreeTarget: 60, nextTreeTarget: 300, ecoImpact: { progress: 0, target: 60, treeType: 'Cây Dứa Fuwa3e', treesPlanted: 0 } };
  }
  return { ...base, totalSeeds: 5, streakDays: 1, lastCheckInAt: now, firstCheckinBonus: 0, currentTreeTarget: 300, nextTreeTarget: 600, ecoImpact: { progress: 0, target: 300, treeType: 'Cây Dứa Fuwa3e', treesPlanted: 1 } };
}

/** Các GET chung của trang Vườn Xanh (phiên đăng nhập do từng nền tảng tự dựng). */
export function mockNewbieGame(api: MockApi, state: NewbieState) {
  api.get('/game/profile', newbieProfile(state));
  api.get('/game/quiz/today', [
    { id: 'q1', question: 'Cây xanh hấp thụ khí nào?', options: ['CO₂', 'Oxy'], category: 'cay', difficulty: 1, waterReward: 8 },
    { id: 'q2', question: 'Chai nhựa nên bỏ vào đâu?', options: ['Thùng tái chế', 'Sông'], category: 'tai_che', difficulty: 1, waterReward: 10 },
  ]);
  api.get('/game/leaderboard', []);
  api.get('/game/missions', []);
  api.get('/game/forest', { count: 0, plantedCount: 0, trees: [] });
  api.get('/game/community', { goal: null, myDrops: 0, pct: 0 });
  api.get('/game/collection', []);
  api.get('/game/season', null);
  api.get('/game/season/leaderboard', []);
  api.get('/game/friends', []);
  api.get('/game/garden', {
    plots: [{ id: null, slot: 1, isHome: true, treeType: 'Cây Dứa Fuwa3e', speciesId: null, progress: 0, target: 60, treeStage: 1, treesPlanted: 0, treeHealth: 'HEALTHY' }],
    maxPlots: 4,
    nextUnlock: { slot: 2, seedCost: 100 },
  });
  api.get('/me/loyalty', { pointsBalance: 0, redeemablePoints: 0, redeemableTotal: 0, tier: null, nextTier: null, tiers: [] });
  api.allowUnmocked('GET /game/season-pass', 'POST /events');
}
