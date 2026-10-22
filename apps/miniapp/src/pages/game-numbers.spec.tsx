import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { describe, it, expect, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ navigate: vi.fn(), openSnackbar: vi.fn() }));
vi.mock('zmp-ui', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  Page: ({ children }: { children: ReactNode }) => <div data-testid="page">{children}</div>,
  useNavigate: () => mocks.navigate,
  useSnackbar: () => ({ openSnackbar: mocks.openSnackbar, closeSnackbar: vi.fn() }),
}));
vi.mock('../store/auth', () => {
  const state = { status: 'authenticated', user: { id: 'u1' }, login: vi.fn() };
  return { useAuthStore: (sel?: (s: typeof state) => unknown) => (sel ? sel(state) : state) };
});
vi.mock('../utils/haptic', () => ({ haptic: vi.fn() }));
vi.mock('../components/wheel', () => ({ WheelOfFortune: () => null }));
vi.mock('../services/game-api', () => {
  const resolved = (v: unknown) => vi.fn().mockResolvedValue(v);
  return {
    getGameProfile: resolved({
      totalSeeds: 1_250_000,
      streakDays: 12,
      treeStage: 2,
      streakFreezes: 1,
      lastDewAt: null,
      lastCheckInAt: null,
      streakFreezeCost: 1_500,
      treePointsPrice: 50,
      ecoImpact: { progress: 12_000, target: 50_000, treeType: 'Sồi', treesPlanted: 3 },
    }),
    getTodayQuiz: resolved([]),
    getLeaderboard: resolved([]),
    getMissions: resolved([]),
    getForest: resolved({ count: 0, plantedCount: 0, trees: [] }),
    getCommunity: resolved({
      goal: { id: 'g1', title: 'Rừng Tubu', region: 'Hà Giang', targetDrops: 5_000_000, currentDrops: 1_250_000, treesToPlant: 100, status: 'ACTIVE' },
      myDrops: 89_000,
      pct: 25,
    }),
    getCollection: resolved([]),
    getSeason: resolved(null),
    getSeasonLeaderboard: resolved([{ rank: 1, nickname: 'Lan', drops: 1_250_000 }]),
    getFriends: resolved([]),
    getGarden: resolved({
      plots: [],
      maxPlots: 3,
      nextUnlock: { slot: 2, seedCost: 1_200 },
    }),
    fetchSeasonPass: resolved({ active: false }),
    checkIn: vi.fn(),
    collectDew: vi.fn(),
    buyStreakFreeze: vi.fn(),
    repairStreak: vi.fn(),
    spin: vi.fn(),
    answerQuiz: vi.fn(),
    waterTree: vi.fn(),
    buyTree: vi.fn(),
    claimMission: vi.fn(),
    unlockPlot: vi.fn(),
    waterPlot: vi.fn(),
    claimSeasonPass: vi.fn(),
    giftWater: vi.fn(),
  };
});

import GamePage from './game';

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <GamePage />
    </QueryClientProvider>,
  );
}

describe('GamePage — số hiển thị có dấu phân cách nghìn (C-083)', () => {
  it('giọt nước và mục tiêu cộng đồng theo kiểu "1.250.000", giá góp quỹ là Điểm Xanh, không có số trần', async () => {
    const { container } = renderPage();
    expect(await screen.findByText(/Góp quỹ trồng cây/)).toBeInTheDocument();
    await screen.findByText(/Rừng Tubu/);
    await screen.findByText(/Xếp hạng góp nước mùa này/);
    const text = container.textContent ?? '';

    expect(text).toContain('Mua (1.500💧)');
    expect(text).toContain('Góp quỹ trồng cây (50 điểm)');
    expect(text).toContain('1.250.000/5.000.000💧');
    expect(text).toContain('Bạn đã góp 89.000💧');
    expect(text).toContain('12.000/50.000💧 · 💧 1.250.000');
    expect(text).toContain('Mở lô (1.200💧)');
    expect(text).not.toMatch(/(?<![\p{L}_])xu(?![\p{L}_])/iu);
    expect(text).toContain('1.250.000💧');
    expect(text).not.toMatch(/(^|[^\d.])\d{4,}(?![\d.])/);
  });
});
