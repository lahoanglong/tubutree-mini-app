import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Chống chạm đúp ở trang Vườn: `disabled={mutation.isPending}` chỉ có hiệu lực sau lần render kế, nên hai cú
 * chạm trong cùng một khung hình vẫn đều thấy nút đang bật. Test dồn hai lần `click()` vào MỘT `act` để React
 * chưa kịp dựng lại giữa hai lần — đúng tình huống đó — rồi đếm số lần gọi API.
 */
const mocks = vi.hoisted(() => ({
  openSnackbar: vi.fn(),
  features: { seasonPass: false },
  api: {
    getGameProfile: vi.fn(),
    getTodayQuiz: vi.fn(),
    getLeaderboard: vi.fn(),
    getMissions: vi.fn(),
    getForest: vi.fn(),
    getCommunity: vi.fn(),
    getCollection: vi.fn(),
    getSeason: vi.fn(),
    getSeasonLeaderboard: vi.fn(),
    getFriends: vi.fn(),
    getGarden: vi.fn(),
    fetchSeasonPass: vi.fn(),
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
  },
}));
vi.mock('zmp-ui', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  Page: ({ children }: { children: ReactNode }) => <div data-testid="page">{children}</div>,
  Sheet: ({ visible, children }: { visible: boolean; children: ReactNode }) => (visible ? <div role="dialog">{children}</div> : null),
  useNavigate: () => vi.fn(),
  useLocation: () => ({ pathname: '/game', search: '', state: null }),
  useSnackbar: () => ({ openSnackbar: mocks.openSnackbar, closeSnackbar: vi.fn() }),
}));
vi.mock('../store/auth', () => ({
  useAuthStore: (sel?: (s: unknown) => unknown) => {
    const state = { status: 'authenticated', user: { id: 'u1' }, login: vi.fn() };
    return sel ? sel(state) : state;
  },
}));
vi.mock('../utils/haptic', () => ({ haptic: vi.fn() }));
vi.mock('../utils/features', () => ({
  get SEASON_PASS_ENABLED() {
    return mocks.features.seasonPass;
  },
}));
vi.mock('../components/wheel', () => ({ WheelOfFortune: () => <div data-testid="wheel" /> }));
vi.mock('../services/game-api', () => mocks.api);
vi.mock('../services/account-api', () => ({ getLoyalty: () => Promise.resolve({ pointsBalance: 100_000, redeemablePoints: 100_000, redeemableTotal: 100_000 }) }));

import GamePage from './game';
import { vi as viText } from '../i18n/vi';

const PROFILE = {
  totalSeeds: 1_250,
  streakDays: 2,
  treeStage: 2,
  treeHealth: 'HEALTHY',
  streakFreezes: 1,
  lastDewAt: null,
  lastCheckInAt: null,
  streakFreezeCost: 80,
  treePointsPrice: 50,
  streakRepairable: true,
  brokenStreakDays: 5,
  streakRepairCost: 300,
  ecoImpact: { progress: 10, target: 50, treeType: 'Sồi', treesPlanted: 3 },
};
const HOME = { id: null, slot: 1, isHome: true, treeType: 'Sồi', speciesId: null, progress: 10, target: 50, treeStage: 1, treesPlanted: 3, treeHealth: 'HEALTHY' };
const PLOT_A = { id: 'pa', slot: 2, isHome: false, treeType: 'Mận', speciesId: 's1', progress: 5, target: 20, treeStage: 1, treesPlanted: 1, treeHealth: 'HEALTHY' };
const PLOT_B = { id: 'pb', slot: 3, isHome: false, treeType: 'Xoài', speciesId: 's2', progress: 8, target: 20, treeStage: 1, treesPlanted: 0, treeHealth: 'HEALTHY' };
const FRIENDS = [
  { id: 'f1', nickname: 'Lan', giftedToday: false },
  { id: 'f2', nickname: 'Minh', giftedToday: false },
];
const MISSION = { code: 'REVIEW_3', title: 'Viết 3 đánh giá', rewardPoints: 50, progress: 3, goal: 3, completed: true, claimed: false };
const Q1 = { id: 'q1', question: 'Cây nào hấp thụ CO2?', options: ['Đá', 'Cây', 'Gạch'], category: 'cay', difficulty: 1, waterReward: 20 };
const TIERS = [
  { tier: 0, xpRequired: 100, free: { type: 'SEEDS', amount: 10 }, premium: { type: 'SEEDS', amount: 20 }, unlocked: true, claimedFree: false, claimedPremium: false },
];

function pending<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <GamePage />
    </QueryClientProvider>,
  );
}

/** Mọi cú chạm nằm trong cùng một lô cập nhật của React: chưa có lần dựng lại nào xen giữa. */
async function tapTogether(...targets: HTMLElement[]) {
  await act(async () => {
    for (const t of targets) t.click();
  });
}

async function openTab(name: 'Hôm nay' | 'Vườn' | 'Cộng đồng') {
  fireEvent.click(await screen.findByRole('tab', { name }));
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.features.seasonPass = false;
  const a = mocks.api;
  a.getGameProfile.mockResolvedValue({ ...PROFILE });
  a.getTodayQuiz.mockResolvedValue([]);
  a.getLeaderboard.mockResolvedValue([]);
  a.getMissions.mockResolvedValue([]);
  a.getForest.mockResolvedValue({ count: 0, plantedCount: 0, trees: [] });
  a.getCommunity.mockResolvedValue({ goal: null, myDrops: 0, pct: 0 });
  a.getCollection.mockResolvedValue([]);
  a.getSeason.mockResolvedValue(null);
  a.getSeasonLeaderboard.mockResolvedValue([]);
  a.getFriends.mockResolvedValue([]);
  a.getGarden.mockResolvedValue(null);
  a.fetchSeasonPass.mockResolvedValue({ active: false });
  a.checkIn.mockResolvedValue({ seedsEarned: 10, pointsEarned: 0, streakDays: 3, totalSeeds: 1_260, streakFrozeUsed: false, bonusNote: '' });
  a.collectDew.mockResolvedValue({ seedsEarned: 5, totalSeeds: 1_255 });
  a.buyStreakFreeze.mockResolvedValue({ streakFreezes: 2, totalSeeds: 1_170 });
  a.repairStreak.mockResolvedValue({ repaired: true, streakDays: 5, totalSeeds: 900 });
  a.answerQuiz.mockResolvedValue({ isCorrect: true, correct: 1, waterEarned: 20, explanation: null });
  a.waterTree.mockResolvedValue({ progress: 30, target: 50, harvested: false, treesPlanted: 3 });
  a.buyTree.mockResolvedValue({ certificateCode: 'TUBU-9', treeType: 'Sồi', cost: 50, pointsUsed: 50, pointsUsedConverted: 0 });
  a.claimMission.mockResolvedValue({ claimed: true, rewardPoints: 50, couponCode: null });
  a.unlockPlot.mockResolvedValue({});
  a.waterPlot.mockResolvedValue({ progress: 5, target: 20, harvested: false, treesPlanted: 0, revivedFromDead: false });
  a.claimSeasonPass.mockResolvedValue({ claimed: true, reward: { type: 'SEEDS', amount: 10 } });
  a.giftWater.mockResolvedValue({ amount: 50, recipientId: 'f1' });
});

interface Case {
  label: string;
  api: () => ReturnType<typeof vi.fn>;
  setup?: () => void;
  tab?: 'Vườn' | 'Cộng đồng';
  /** Danh sách cú chạm theo thứ tự: cùng một nút hai lần, hoặc hai nút khác nhau của cùng một thao tác. */
  targets: () => Promise<HTMLElement[]>;
}

const twice = async (name: string | RegExp) => {
  const btn = await screen.findByRole('button', { name });
  return [btn, btn];
};
const byName = (name: string | RegExp) => () => twice(name);

const CASES: Case[] = [
  {
    label: 'tưới hết',
    api: () => mocks.api.waterTree,
    setup: () => mocks.api.getGameProfile.mockResolvedValue({ ...PROFILE, lastCheckInAt: new Date().toISOString() }),
    targets: byName(/Tưới hết/),
  },
  { label: 'điểm danh', api: () => mocks.api.checkIn, targets: byName('Điểm danh') },
  { label: 'hứng giọt sương', api: () => mocks.api.collectDew, targets: byName('Hứng giọt sương') },
  { label: 'mua vé giữ lửa', api: () => mocks.api.buyStreakFreeze, targets: byName('Mua (80💧)') },
  { label: 'hồi sinh chuỗi', api: () => mocks.api.repairStreak, targets: byName('Hồi sinh (300💧)') },
  {
    label: 'nhận thưởng nhiệm vụ',
    api: () => mocks.api.claimMission,
    setup: () => mocks.api.getMissions.mockResolvedValue([MISSION]),
    targets: byName(viText.game.missions.claim),
  },
  {
    label: 'trả lời quiz (cùng đáp án)',
    api: () => mocks.api.answerQuiz,
    setup: () => mocks.api.getTodayQuiz.mockResolvedValue([Q1]),
    targets: async () => {
      const opt = await screen.findByRole('button', { name: 'Cây' });
      return [opt, opt];
    },
  },
  {
    label: 'trả lời quiz (hai đáp án khác nhau)',
    api: () => mocks.api.answerQuiz,
    setup: () => mocks.api.getTodayQuiz.mockResolvedValue([Q1]),
    targets: async () => [await screen.findByRole('button', { name: 'Cây' }), await screen.findByRole('button', { name: 'Đá' })],
  },
  {
    label: 'tưới lô đất',
    api: () => mocks.api.waterPlot,
    tab: 'Vườn',
    setup: () => mocks.api.getGarden.mockResolvedValue({ plots: [HOME, PLOT_A], maxPlots: 4, nextUnlock: null }),
    targets: byName('Tưới'),
  },
  {
    label: 'mở lô đất',
    api: () => mocks.api.unlockPlot,
    tab: 'Vườn',
    setup: () => mocks.api.getGarden.mockResolvedValue({ plots: [HOME], maxPlots: 3, nextUnlock: { slot: 2, seedCost: 1_200 } }),
    targets: byName('Mở lô (1.200💧)'),
  },
  {
    label: 'tặng nước bạn bè',
    api: () => mocks.api.giftWater,
    tab: 'Cộng đồng',
    setup: () => mocks.api.getFriends.mockResolvedValue(FRIENDS.slice(0, 1)),
    targets: byName('Tặng 💧'),
  },
  {
    label: 'nhận thưởng Chặng Mùa',
    api: () => mocks.api.claimSeasonPass,
    tab: 'Cộng đồng',
    setup: () => {
      mocks.features.seasonPass = true;
      mocks.api.fetchSeasonPass.mockResolvedValue({ active: true, seasonTitle: 'Xuân', xp: 150, premiumEligible: false, tiers: TIERS });
    },
    targets: byName(viText.game.seasonPass.claim),
  },
];

describe('GamePage — chạm đúp cùng khung hình chỉ gọi API một lần', () => {
  it.each(CASES)('$label', async ({ api, setup, tab, targets }) => {
    setup?.();
    api().mockReturnValue(pending<unknown>().promise);
    renderPage();
    if (tab) await openTab(tab);
    const buttons = await targets();
    await tapTogether(...buttons);
    expect(api()).toHaveBeenCalledTimes(1);
  });

  it('góp quỹ trồng cây: xác nhận hai lần trong cùng khung hình chỉ gọi buyTree một lần', async () => {
    mocks.api.buyTree.mockReturnValue(pending<unknown>().promise);
    renderPage();
    await openTab('Vườn');
    fireEvent.click(await screen.findByRole('button', { name: /Góp quỹ trồng cây/ }));
    const ok = await screen.findByRole('button', { name: 'Xác nhận' });
    await tapTogether(ok, ok);
    expect(mocks.api.buyTree).toHaveBeenCalledTimes(1);
  });
});

describe('GamePage — khoá chỉ theo đích của thao tác', () => {
  it('tưới hai lô khác nhau cùng lúc: mỗi lô được gọi một lần, chạm đúp cùng lô thì bỏ qua', async () => {
    mocks.api.getGarden.mockResolvedValue({ plots: [HOME, PLOT_A, PLOT_B], maxPlots: 4, nextUnlock: null });
    mocks.api.waterPlot.mockReturnValue(pending<unknown>().promise);
    renderPage();
    await openTab('Vườn');
    await screen.findByText('Lô 2 · Mận');
    const [a, b] = screen.getAllByRole('button', { name: 'Tưới' }) as [HTMLElement, HTMLElement];
    await tapTogether(a, a, b, b);
    expect(mocks.api.waterPlot).toHaveBeenCalledTimes(2);
    expect(mocks.api.waterPlot).toHaveBeenCalledWith('pa', 20);
    expect(mocks.api.waterPlot).toHaveBeenCalledWith('pb', 20);
  });

  it('tặng nước hai bạn khác nhau cùng lúc: mỗi bạn được gọi một lần', async () => {
    mocks.api.getFriends.mockResolvedValue(FRIENDS);
    mocks.api.giftWater.mockReturnValue(pending<unknown>().promise);
    renderPage();
    await openTab('Cộng đồng');
    await screen.findByText('Lan');
    const [a, b] = screen.getAllByRole('button', { name: 'Tặng 💧' }) as [HTMLElement, HTMLElement];
    await tapTogether(a, a, b, b);
    expect(mocks.api.giftWater).toHaveBeenCalledTimes(2);
    expect(mocks.api.giftWater).toHaveBeenCalledWith('f1');
    expect(mocks.api.giftWater).toHaveBeenCalledWith('f2');
  });
});

describe('GamePage — nhả khoá để bấm lại được', () => {
  it('lỗi mạng: nhả khoá, bấm lại gọi API lần hai', async () => {
    mocks.api.checkIn.mockRejectedValueOnce(new Error('boom'));
    renderPage();
    const btn = await screen.findByRole('button', { name: 'Điểm danh' });
    await tapTogether(btn, btn);
    await waitFor(() => expect(mocks.openSnackbar).toHaveBeenCalledWith(expect.objectContaining({ type: 'error' })));
    await waitFor(() => expect(mocks.api.checkIn).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(btn).toBeEnabled());
    await tapTogether(btn);
    expect(mocks.api.checkIn).toHaveBeenCalledTimes(2);
  });

  it('lỗi ở thao tác theo đích: nhả khoá đúng đích đó', async () => {
    mocks.api.getGarden.mockResolvedValue({ plots: [HOME, PLOT_A], maxPlots: 4, nextUnlock: null });
    mocks.api.waterPlot.mockRejectedValueOnce(new Error('boom'));
    renderPage();
    await openTab('Vườn');
    const btn = await screen.findByRole('button', { name: 'Tưới' });
    await tapTogether(btn, btn);
    await waitFor(() => expect(mocks.openSnackbar).toHaveBeenCalledWith(expect.objectContaining({ type: 'error' })));
    await waitFor(() => expect(btn).toBeEnabled());
    await tapTogether(btn);
    expect(mocks.api.waterPlot).toHaveBeenCalledTimes(2);
  });

  it('thành công: nhả khoá, lần tưới sau gọi API bình thường', async () => {
    mocks.api.getGameProfile.mockResolvedValue({ ...PROFILE, lastCheckInAt: new Date().toISOString() });
    renderPage();
    const btn = await screen.findByRole('button', { name: /Tưới hết/ });
    await tapTogether(btn, btn);
    await waitFor(() => expect(mocks.openSnackbar).toHaveBeenCalledWith(expect.objectContaining({ type: 'success' })));
    await waitFor(() => expect(btn).toBeEnabled());
    await tapTogether(btn);
    expect(mocks.api.waterTree).toHaveBeenCalledTimes(2);
  });
});
