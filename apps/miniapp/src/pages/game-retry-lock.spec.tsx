import { render, screen, waitFor, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Các nút của trang Vườn không đi qua `useLockedMutation`: "Thử lại" lịch điểm danh, cổng đăng nhập, "Đăng nhập Zalo" trong
 * hộp thu hoạch và "Chia sẻ với bạn bè". Chúng chỉ được chặn chạm đúp nếu handler TRẢ Promise (Button/ErrorState khoá tới khi
 * Promise xong); `() => void x()` trả undefined nên hai cú chạm cùng khung hình đều lọt. Mỗi ca chạy cả hai kiểu: hai cú
 * chạm trong cùng một `act` (React chưa vẽ xen giữa), và hai cú ở hai `act` liên tiếp (React đã vẽ xong cú đầu).
 */
const mocks = vi.hoisted(() => ({
  navigate: vi.fn(),
  openSnackbar: vi.fn(),
  login: vi.fn(),
  shareLink: vi.fn(),
  auth: { status: 'authenticated' as string, error: undefined as string | undefined },
  getLoyalty: vi.fn(),
  getDailyCheckInStatus: vi.fn(),
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
  },
}));
vi.mock('zmp-ui', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  Page: ({ children }: { children: ReactNode }) => <div data-testid="page">{children}</div>,
  useNavigate: () => mocks.navigate,
  useLocation: () => ({ pathname: '/game', search: '', state: null }),
  useSnackbar: () => ({ openSnackbar: mocks.openSnackbar, closeSnackbar: vi.fn() }),
}));
vi.mock('../hooks/use-public-config', () => ({ usePublicConfig: () => ({ isLoaded: true, waste: { enabled: false } }) }));
vi.mock('../store/auth', () => {
  const state = () => ({ status: mocks.auth.status, error: mocks.auth.error, user: { id: 'u1' }, login: mocks.login });
  return { useAuthStore: Object.assign((sel?: (s: unknown) => unknown) => (sel ? sel(state()) : state()), { getState: state }) };
});
vi.mock('../utils/haptic', () => ({ haptic: vi.fn() }));
vi.mock('../utils/features', () => ({ SEASON_PASS_ENABLED: false }));
vi.mock('../components/wheel', () => ({ WheelOfFortune: () => <div data-testid="wheel" /> }));
vi.mock('../services/zmp-bridge', () => ({ shareLink: (...a: unknown[]) => mocks.shareLink(...a) }));
vi.mock('../services/game-api', () => mocks.api);
vi.mock('../services/account-api', () => ({
  getLoyalty: (...a: unknown[]) => mocks.getLoyalty(...a),
  getDailyCheckInStatus: (...a: unknown[]) => mocks.getDailyCheckInStatus(...a),
}));

import GamePage from './game';
import { vi as viText } from '../i18n/vi';
import { gameNewbieCopy } from '@tubutree/app-core/game-newbie';

const PROFILE = {
  totalSeeds: 1_250,
  streakDays: 2,
  treeStage: 2,
  treeHealth: 'HEALTHY',
  streakFreezes: 1,
  lastDewAt: null,
  lastCheckInAt: new Date().toISOString(),
  streakFreezeCost: 80,
  treePointsPrice: 50,
  streakRepairable: false,
  ecoImpact: { progress: 10, target: 50, treeType: 'Sồi', treesPlanted: 3 },
};
const HALF = { checkedInToday: false, pointsDone: false, waterDone: true, streakDays: 1, currentCycleDay: 1, todayPoints: 1000, todayWater: 0, rewards: [] };

function deferred<T = unknown>() {
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
  const view = render(
    <QueryClientProvider client={qc}>
      <GamePage />
    </QueryClientProvider>,
  );
  return { ...view, qc };
}

type Taps = 'cùng khung hình' | 'hai lượt vẽ liên tiếp';
const TAPS: Taps[] = ['cùng khung hình', 'hai lượt vẽ liên tiếp'];

/** Hai cú chạm vào cùng một nút theo `how`. */
async function tapTwice(target: HTMLElement, how: Taps) {
  if (how === 'hai lượt vẽ liên tiếp') {
    await act(async () => {
      target.click();
    });
    await act(async () => {
      target.click();
    });
    return;
  }
  await act(async () => {
    target.click();
    target.click();
  });
}

const openHarvest = async (reward: Record<string, unknown>) => {
  mocks.api.waterTree.mockResolvedValue({ progress: 50, target: 50, harvested: true, treesPlanted: 4, ...reward });
  const btn = await screen.findByRole('button', { name: /^Tưới hết/ });
  await act(async () => {
    btn.click();
  });
  await screen.findByText('Thu hoạch thành công!');
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.auth.status = 'authenticated';
  mocks.auth.error = undefined;
  mocks.login.mockReset();
  mocks.shareLink.mockReset();
  mocks.getLoyalty.mockResolvedValue({ pointsBalance: 100_000, redeemablePoints: 100_000, redeemableTotal: 100_000 });
  mocks.getDailyCheckInStatus.mockResolvedValue(null);
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
});

describe('GamePage — "Thử lại" lịch điểm danh khi đã có dữ liệu cũ và lần tải nền lỗi', () => {
  it.each(TAPS)('hai cú chạm %s chỉ tải lại một lần', async (how) => {
    mocks.getDailyCheckInStatus.mockResolvedValue(HALF);
    const { qc } = renderPage();
    await screen.findByRole('button', { name: 'Nhận Điểm Xanh hôm nay' });
    mocks.getDailyCheckInStatus.mockRejectedValue(new Error('mạng lỗi'));
    await act(async () => {
      await qc.invalidateQueries({ queryKey: ['loyalty-checkin'] });
    });
    const retry = await screen.findByRole('button', { name: 'Thử lại' });
    expect(await screen.findByText('Chưa tải được lịch điểm danh')).toBeInTheDocument();

    mocks.getDailyCheckInStatus.mockClear();
    mocks.getDailyCheckInStatus.mockReturnValue(deferred().promise);
    await tapTwice(retry, how);
    expect(mocks.getDailyCheckInStatus).toHaveBeenCalledTimes(1);
  });
});

describe('GamePage — cổng đăng nhập', () => {
  it.each(TAPS)('hai cú chạm %s vào nút đăng nhập chỉ gọi login một lần', async (how) => {
    mocks.auth.status = 'idle';
    mocks.login.mockReturnValue(deferred().promise);
    renderPage();
    await screen.findByText(gameNewbieCopy.loginToView);
    await tapTwice(screen.getByRole('button', { name: viText.auth.loginCta }), how);
    expect(mocks.login).toHaveBeenCalledTimes(1);
  });

  it('đăng nhập lỗi: báo đúng một lần dù chạm đúp, rồi bấm lại được', async () => {
    mocks.auth.status = 'idle';
    const gate = deferred();
    // Store thật gộp các lần login chồng nhau thành một Promise: cả hai lần gọi đều chờ cùng một kết quả.
    mocks.login.mockReturnValue(gate.promise);
    renderPage();
    await screen.findByText(gameNewbieCopy.loginToView);
    const btn = screen.getByRole('button', { name: viText.auth.loginCta });
    await tapTwice(btn, 'cùng khung hình');
    mocks.auth.error = 'Tài khoản bị khoá';
    await act(async () => {
      gate.resolve(undefined);
    });
    await waitFor(() => expect(mocks.openSnackbar).toHaveBeenCalledTimes(1));
    await act(async () => {});
    expect(mocks.openSnackbar).toHaveBeenCalledTimes(1);
    await act(async () => {
      btn.click();
    });
    expect(mocks.login).toHaveBeenCalledTimes(2);
  });
});

describe('GamePage — hộp thu hoạch', () => {
  it.each(TAPS)('khách vãng lai: hai cú chạm %s vào "Đăng nhập Zalo" chỉ gọi login một lần', async (how) => {
    mocks.login.mockReturnValue(deferred().promise);
    renderPage();
    await openHarvest({ rewardBlocked: 'GUEST' });
    await tapTwice(screen.getByRole('button', { name: 'Đăng nhập Zalo' }), how);
    expect(mocks.login).toHaveBeenCalledTimes(1);
  });

  it.each(TAPS)('hai cú chạm %s vào "Chia sẻ với bạn bè" chỉ mở hộp chia sẻ một lần', async (how) => {
    mocks.shareLink.mockReturnValue(deferred().promise);
    renderPage();
    await openHarvest({ reward: { certificate: 'C2' } });
    await tapTwice(screen.getByRole('button', { name: 'Chia sẻ với bạn bè' }), how);
    expect(mocks.shareLink).toHaveBeenCalledTimes(1);
  });

  it('chia sẻ xong (hay bị huỷ): nhả khoá, bấm lại mở hộp lần hai', async () => {
    const first = deferred();
    mocks.shareLink.mockReturnValueOnce(first.promise).mockReturnValue(deferred().promise);
    renderPage();
    await openHarvest({ reward: { certificate: 'C2' } });
    const btn = screen.getByRole('button', { name: 'Chia sẻ với bạn bè' });
    await tapTwice(btn, 'cùng khung hình');
    await act(async () => {
      first.reject(new Error('Người dùng đóng hộp chia sẻ'));
    });
    await act(async () => {
      btn.click();
    });
    expect(mocks.shareLink).toHaveBeenCalledTimes(2);
  });
});
