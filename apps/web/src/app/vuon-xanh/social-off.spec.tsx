// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { byText, click, flush, render, type Rendered } from '@/test-utils/dom';

// Cờ GAME_SOCIAL_ON_WEB tắt (mặc định): web khổ điện thoại giống Mini App, không có tab Cộng đồng. Trạng thái bật nằm ở page.spec.tsx.

const state = vi.hoisted(() => ({
  search: '' as string,
  replace: vi.fn(),
  push: vi.fn(),
  data: {} as Record<string, unknown>,
  calls: [] as string[],
}));

vi.mock('@/lib/auth-phase', () => ({ useAuthPhase: () => 'authenticated' }));
vi.mock('@/lib/auth-context', () => ({ useAuth: () => ({ retrySession: vi.fn() }) }));
vi.mock('@/lib/idempotency-key', () => ({ newIdempotencyKey: () => 'key-1' }));
vi.mock('@/lib/route-map', () => ({ isWebRouteReady: () => true }));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: state.push, replace: state.replace }),
  usePathname: () => '/vuon-xanh',
  useSearchParams: () => new URLSearchParams(state.search),
}));
vi.mock('@/lib/core-http', () => ({
  coreHttp: {
    get: async (path: string) => {
      state.calls.push(path);
      if (path === '/config/public') return { waste: { enabled: false } };
      if (path in state.data) return state.data[path];
      throw new Error(`chưa mock ${path}`);
    },
    post: async () => {
      throw new Error('chưa mock POST');
    },
  },
}));

import GamePage from './page';
import { GAME_SOCIAL_ON_WEB } from '@tubutree/app-core/features';

const PROFILE = {
  totalSeeds: 1_250, streakDays: 3, treeStage: 1, treeHealth: 'HEALTHY', streakFreezes: 1, lastDewAt: null, lastCheckInAt: null,
  ecoImpact: { progress: 600, target: 1_000, treeType: 'Cây Sưa', treesPlanted: 2 }, streakFreezeCost: 80, treePointsPrice: 20_000, spinCostPoints: 10,
};
const SEASON = { id: 's1', name: 'Mùa Thu Xanh', theme: 'Thu', region: 'Tây Nguyên', startAt: '2026-10-01', endAt: '2026-12-01', featuredSpecies: [{ id: 'a', name: 'Sưa', emoji: '🌳', rarity: 'RARE' }] };

let mounted: Rendered | null = null;
const mount = async () => {
  mounted = render(<GamePage />);
  await flush(8);
  return mounted.container;
};
const panel = (c: HTMLElement, label: string) => c.querySelector<HTMLElement>(`[role="tabpanel"][aria-label="${label}"]`);

beforeEach(() => {
  state.search = '';
  state.calls = [];
  state.replace.mockReset();
  state.push.mockReset();
  state.data = {
    '/game/profile': PROFILE,
    '/game/quiz/today': [],
    '/game/missions': [],
    '/game/forest': { count: 0, plantedCount: 0, trees: [] },
    '/game/season': SEASON,
    '/game/friends': [{ id: 'f1', nickname: 'Lan', giftedToday: false }],
    '/game/leaderboard': [],
    '/me/loyalty': { pointsBalance: 100_000, redeemablePoints: 100_000, redeemableTotal: 100_000 },
  };
});
afterEach(() => {
  mounted?.unmount();
  mounted = null;
});

describe('Vườn Xanh web khi cờ GAME_SOCIAL_ON_WEB tắt', () => {
  it('cờ mặc định là tắt', () => {
    expect(GAME_SOCIAL_ON_WEB).toBe(false);
  });

  it('chỉ hai tab Hôm nay / Vườn, không có tab hay khung Cộng đồng', async () => {
    const c = await mount();
    expect(Array.from(c.querySelectorAll('[role="tab"]')).map((t) => t.textContent)).toEqual(['Hôm nay', 'Vườn']);
    expect(panel(c, 'Cộng đồng')).toBeNull();
  });

  it('?tab=community rơi về Hôm nay và không tải bảng xếp hạng, bạn bè', async () => {
    state.search = 'tab=community';
    const c = await mount();
    expect(panel(c, 'Hôm nay')!.hidden).toBe(false);
    expect(state.calls).not.toContain('/game/friends');
    expect(state.calls).not.toContain('/game/leaderboard');
  });

  it('mở tab Vườn: banner mùa và lối vào bảng tin nằm cuối tab như Mini App; không có Tặng nước hay xếp hạng', async () => {
    state.search = 'tab=garden';
    state.data['/game/garden'] = { plots: [], maxPlots: 4, nextUnlock: null };
    state.data['/game/collection'] = [];
    state.data['/game/community'] = { goal: null, myDrops: 0, pct: 0 };
    const c = await mount();
    const garden = panel(c, 'Vườn')!;
    expect(garden.textContent).toContain('Mùa Thu Xanh');
    const feed = garden.querySelector<HTMLAnchorElement>('a[href="/cong-dong"]');
    expect(feed?.textContent).toContain('Bảng tin cộng đồng');
    expect(c.textContent).not.toContain('Tặng 💧');
    expect(c.textContent).not.toContain('Chuỗi điểm danh dài nhất');
    expect(state.calls).not.toContain('/game/friends');
    expect(state.calls).not.toContain('/game/leaderboard');
  });

  it('sheet Kiếm thêm nước không có hàng "Nước từ bạn bè" dù có bạn', async () => {
    const today = new Date().toISOString();
    state.data['/game/profile'] = { ...PROFILE, totalSeeds: 0, firstCheckinBonus: 0, dailyLoginSeeds: 15, dewSeeds: 15, lastCheckInAt: today, lastDewAt: today };
    state.data['/me/daily-check-in'] = { checkedInToday: true, pointsDone: true, waterDone: true, streakDays: 1, streakDay: 1, currentCycleDay: 1, todayPoints: 0, todayWater: 0, rewards: [] };
    const c = await mount();
    click(byText(c, 'button', 'Kiếm thêm nước')!);
    await flush(4);
    expect(document.querySelector('[role="dialog"]')?.textContent).toContain('Kiếm nước');
    expect(document.querySelector('[role="dialog"]')?.textContent).not.toContain('Nước từ bạn bè');
    expect(state.calls).not.toContain('/game/friends');
  });
});
