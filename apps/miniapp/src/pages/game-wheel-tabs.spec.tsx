import { render, screen, fireEvent, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

/**
 * Hộp kết quả vòng quay và các tab của trang Vườn Xanh (C-082): ZaUI Sheet không dùng portal nên nằm
 * ngay tại chỗ dựng. Kết quả về sau 3,6 giây, người chơi có thể đã đổi sang tab khác; hộp không được
 * nằm trong khối đang ẩn (mất phần thưởng vừa nhận, trang kẹt khoá cuộn). Dùng vòng quay THẬT, không mock.
 */
const mocks = vi.hoisted(() => ({
  navigate: vi.fn(),
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
    spin: vi.fn(),
  },
}));
vi.mock('zmp-ui', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  // class "zaui-page" để ModalWrapper của ZaUI bật/tắt "disable-scrolling" như trên máy thật.
  Page: ({ children }: { children: ReactNode }) => <div className="zaui-page">{children}</div>,
  useNavigate: () => mocks.navigate,
  useLocation: () => ({ pathname: '/game', search: '', state: null }),
  useSnackbar: () => ({ openSnackbar: vi.fn(), closeSnackbar: vi.fn() }),
}));
vi.mock('../store/auth', () => ({
  useAuthStore: (sel?: (s: unknown) => unknown) => {
    const state = { status: 'authenticated', user: { id: 'u1' }, login: vi.fn() };
    return sel ? sel(state) : state;
  },
}));
vi.mock('../utils/haptic', () => ({ haptic: vi.fn() }));
vi.mock('../services/game-api', () => ({
  ...mocks.api,
  checkIn: vi.fn(),
  collectDew: vi.fn(),
  buyStreakFreeze: vi.fn(),
  repairStreak: vi.fn(),
  answerQuiz: vi.fn(),
  waterTree: vi.fn(),
  buyTree: vi.fn(),
  claimMission: vi.fn(),
  unlockPlot: vi.fn(),
  waterPlot: vi.fn(),
  claimSeasonPass: vi.fn(),
  giftWater: vi.fn(),
}));

import GamePage from './game';

const SPIN_MS = 3600;
const PRIZE = { prize: { id: 'p1', name: 'Thưởng 50 Điểm Xanh', rewardType: 'POINTS', value: 50 } };

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <GamePage />
    </QueryClientProvider>,
  );
}

const advance = (ms: number) => act(async () => { await vi.advanceTimersByTimeAsync(ms); });
const pageEl = () => document.querySelector('.zaui-page')!;

beforeEach(() => {
  vi.clearAllMocks();
  const a = mocks.api;
  a.getGameProfile.mockResolvedValue({
    totalSeeds: 1_250,
    streakDays: 2,
    treeStage: 2,
    treeHealth: 'HEALTHY',
    streakFreezes: 1,
    lastDewAt: null,
    lastCheckInAt: null,
    streakFreezeCost: 80,
    treePointsPrice: 50,
    streakRepairable: false,
    ecoImpact: { progress: 10, target: 50, treeType: 'Sồi', treesPlanted: 3 },
  });
  a.getTodayQuiz.mockResolvedValue([]);
  a.getLeaderboard.mockResolvedValue([]);
  a.getMissions.mockResolvedValue([]);
  a.getForest.mockResolvedValue({ count: 0, plantedCount: 0, trees: [] });
  a.getCommunity.mockResolvedValue({ goal: null, myDrops: 0, pct: 0 });
  a.getCollection.mockResolvedValue([]);
  a.getSeason.mockResolvedValue(null);
  a.getSeasonLeaderboard.mockResolvedValue([]);
  a.getFriends.mockResolvedValue([]);
  a.getGarden.mockResolvedValue({ plots: [], maxPlots: 3, nextUnlock: null });
  a.fetchSeasonPass.mockResolvedValue({ active: false });
  a.spin.mockResolvedValue(PRIZE);
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

/** Tải xong bằng timer thật, rồi mới chuyển sang timer giả để điều khiển 3,6 giây quay. */
async function openToday() {
  renderPage();
  const spinBtn = await screen.findByRole('button', { name: /Quay ngay/ });
  vi.useFakeTimers();
  vi.spyOn(Math, 'random').mockReturnValue(0);
  return spinBtn;
}

describe('GamePage — hộp kết quả vòng quay không phụ thuộc tab đang xem', () => {
  it('ở lại tab Hôm nay: hộp kết quả hiện ra sau khi quay xong', async () => {
    const spinBtn = await openToday();
    fireEvent.click(spinBtn);
    await advance(SPIN_MS);
    expect(mocks.api.spin).toHaveBeenCalledTimes(1);
    expect(screen.getByText('Chúc mừng!')).toBeVisible();
    expect(screen.getByText('Thưởng 50 Điểm Xanh')).toBeVisible();
    expect(screen.getByText('+50 Điểm Xanh đã vào tài khoản')).toBeVisible();
  });

  it('trúng voucher: "Dùng ngay" đóng hộp rồi đưa sang trang mua sắm', async () => {
    mocks.api.spin.mockResolvedValue({
      prize: {
        id: 'p4',
        name: 'Voucher 20k',
        rewardType: 'COUPON',
        value: 20000,
        coupon: { code: 'GAME20000-ABCDE-1234', minOrder: 120000, expiresAt: '2026-11-13T09:00:00.000Z' },
      },
    });
    const spinBtn = await openToday();
    fireEvent.click(spinBtn);
    await advance(SPIN_MS);
    expect(screen.getByText('GAME20000-ABCDE-1234')).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Dùng ngay' }));
    await advance(500);
    expect(mocks.navigate).toHaveBeenCalledWith('/browse');
    expect(screen.queryByText('GAME20000-ABCDE-1234')).not.toBeInTheDocument();
  });

  it.each(['Vườn'])('đổi sang tab %s trong lúc quay: hộp kết quả vẫn nhìn thấy được', async (tabName) => {
    const spinBtn = await openToday();
    fireEvent.click(spinBtn);
    await advance(1000);
    fireEvent.click(screen.getByRole('tab', { name: tabName }));
    await advance(SPIN_MS);
    expect(screen.getByText('Chúc mừng!')).toBeVisible();
    expect(screen.getByText('Thưởng 50 Điểm Xanh')).toBeVisible();
    expect(screen.getByRole('button', { name: 'Tuyệt vời!' })).toBeVisible();
  });

  it('đổi tab rồi đóng hộp: trang hết khoá cuộn và tab vẫn là tab đã chọn', async () => {
    const spinBtn = await openToday();
    fireEvent.click(spinBtn);
    await advance(1000);
    fireEvent.click(screen.getByRole('tab', { name: 'Vườn' }));
    await advance(SPIN_MS);
    expect(screen.getByText('Chúc mừng!')).toBeVisible();
    expect(pageEl().classList.contains('disable-scrolling')).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Tuyệt vời!' }));
    await advance(500);
    expect(screen.queryByText('Chúc mừng!')).not.toBeInTheDocument();
    expect(pageEl().classList.contains('disable-scrolling')).toBe(false);
    expect(screen.getByRole('tab', { name: 'Vườn' })).toHaveAttribute('aria-selected', 'true');
  });

  it('đóng hộp rồi quay lần hai: gọi spin lần 2 và hộp hiện lại', async () => {
    const spinBtn = await openToday();
    fireEvent.click(spinBtn);
    await advance(SPIN_MS);
    fireEvent.click(screen.getByRole('button', { name: 'Tuyệt vời!' }));
    await advance(500);
    expect(screen.queryByText('Chúc mừng!')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Quay ngay/ }));
    await advance(SPIN_MS);
    expect(mocks.api.spin).toHaveBeenCalledTimes(2);
    expect(screen.getByText('Chúc mừng!')).toBeVisible();
  });

  it('quay lỗi: không có hộp kết quả, trang không bị khoá cuộn', async () => {
    mocks.api.spin.mockRejectedValue(new Error('hết giọt nước'));
    const spinBtn = await openToday();
    fireEvent.click(spinBtn);
    await advance(SPIN_MS);
    expect(screen.queryByText('Chúc mừng!')).not.toBeInTheDocument();
    expect(pageEl().classList.contains('disable-scrolling')).toBe(false);
  });
});
