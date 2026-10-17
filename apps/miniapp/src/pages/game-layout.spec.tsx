import { render, screen, fireEvent, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { useEffect } from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Bố cục trang Vườn Xanh (C-082 bước 2, C-114): điều hướng nội bộ theo tab, hành động chính của ngày nằm
 * ở tab mặc định theo đúng thứ tự, mỗi khối là một h2, trang có đúng một h1 ở mọi trạng thái.
 * Chỉ kiểm cấu trúc và thứ tự DOM: vị trí theo pixel (390x844) phải xem trên máy thật/trình duyệt.
 */
const mocks = vi.hoisted(() => ({
  auth: { status: 'authenticated' as string },
  wheel: { mounts: 0, unmounts: 0 },
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
  },
}));
vi.mock('zmp-ui', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  Page: ({ children }: { children: ReactNode }) => <div data-testid="page">{children}</div>,
  useNavigate: () => vi.fn(),
  useLocation: () => ({ pathname: '/game', search: '', state: null }),
  useSnackbar: () => ({ openSnackbar: vi.fn(), closeSnackbar: vi.fn() }),
}));
vi.mock('../store/auth', () => ({
  useAuthStore: (sel?: (s: unknown) => unknown) => {
    const state = { status: mocks.auth.status, user: { id: 'u1' }, login: vi.fn() };
    return sel ? sel(state) : state;
  },
}));
vi.mock('../utils/haptic', () => ({ haptic: vi.fn() }));
vi.mock('../components/wheel', () => ({
  WheelOfFortune: () => {
    useEffect(() => {
      mocks.wheel.mounts += 1;
      return () => {
        mocks.wheel.unmounts += 1;
      };
    }, []);
    return <div data-testid="wheel" />;
  },
}));
vi.mock('../services/game-api', () => ({
  ...mocks.api,
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
}));

import GamePage from './game';
import { vi as viText } from '../i18n/vi';

const GARDEN = {
  plots: [{ id: 'pa', slot: 2, isHome: false, treeType: 'Mận', speciesId: 's1', progress: 5, target: 20, treeStage: 1, treesPlanted: 1, treeHealth: 'HEALTHY' }],
  maxPlots: 3,
  nextUnlock: { slot: 3, seedCost: 1_200 },
};

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <GamePage />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.auth.status = 'authenticated';
  mocks.wheel.mounts = 0;
  mocks.wheel.unmounts = 0;
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
  a.getTodayQuiz.mockResolvedValue([{ id: 'q1', question: 'Cây nào hấp thụ CO2?', options: ['Đá', 'Cây'], category: 'cay', difficulty: 1, waterReward: 20 }]);
  a.getLeaderboard.mockResolvedValue([]);
  a.getMissions.mockResolvedValue([{ code: 'REVIEW_3', title: 'Viết 3 đánh giá', rewardPoints: 50, progress: 1, goal: 3, completed: false, claimed: false }]);
  a.getForest.mockResolvedValue({ count: 0, plantedCount: 0, trees: [] });
  a.getCommunity.mockResolvedValue({ goal: null, myDrops: 0, pct: 0 });
  a.getCollection.mockResolvedValue([]);
  a.getSeason.mockResolvedValue(null);
  a.getSeasonLeaderboard.mockResolvedValue([]);
  a.getFriends.mockResolvedValue([{ id: 'f1', nickname: 'Lan', giftedToday: false }]);
  a.getGarden.mockResolvedValue(GARDEN);
  a.fetchSeasonPass.mockResolvedValue({ active: false });
});

const tabs = () => screen.getAllByRole('tab');
// Khối ẩn không có tên truy cập (đặc tả accname), nên tìm theo aria-label thay vì theo role+name.
const tabPanel = (name: string) => {
  const el = document.querySelector<HTMLElement>(`[role="tabpanel"][aria-label="${name}"]`);
  if (!el) throw new Error(`không có tabpanel "${name}"`);
  return el;
};
const follows = (a: Element, b: Element) => Boolean(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);

describe('GamePage — một h1 ở mọi trạng thái (C-114)', () => {
  it('đã tải xong: đúng một h1 "Vườn Xanh"', async () => {
    const { container } = renderPage();
    await screen.findByRole('tab', { name: 'Hôm nay' });
    const h1s = container.querySelectorAll('h1');
    expect(h1s).toHaveLength(1);
    expect(h1s[0]).toHaveTextContent('Vườn Xanh');
  });

  it('đang khôi phục phiên: vẫn có đúng một h1', () => {
    mocks.auth.status = 'loading';
    const { container } = renderPage();
    expect(container.querySelectorAll('h1')).toHaveLength(1);
  });

  it('chưa đăng nhập: một h1 và cổng đăng nhập', () => {
    mocks.auth.status = 'unauthenticated';
    const { container } = renderPage();
    expect(container.querySelectorAll('h1')).toHaveLength(1);
    expect(screen.getByRole('button', { name: viText.auth.loginCta })).toBeInTheDocument();
  });

  it('lỗi tải hồ sơ: một h1 và nút Thử lại', async () => {
    mocks.api.getGameProfile.mockRejectedValue(new Error('boom'));
    const { container } = renderPage();
    await screen.findByRole('button', { name: /Thử lại/ });
    expect(container.querySelectorAll('h1')).toHaveLength(1);
  });
});

describe('GamePage — điều hướng nội bộ bằng tab (C-082)', () => {
  it('có ba tab Hôm nay / Vườn / Cộng đồng, mở sẵn Hôm nay', async () => {
    renderPage();
    await screen.findByRole('tab', { name: 'Hôm nay' });
    expect(tabs().map((t) => t.textContent)).toEqual(['Hôm nay', 'Vườn', 'Cộng đồng']);
    expect(screen.getByRole('tab', { name: 'Hôm nay' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tab', { name: 'Vườn' })).toHaveAttribute('aria-selected', 'false');
  });

  // App chạy immersive và trang này không dùng className="page" (chỉ PageHeader đệm safe-top, khối đó cuộn đi),
  // nên thanh tab dính ở mép 0 sẽ nằm dưới status bar và đè lên capsule Zalo.
  it('thanh tab dính đầu trang chừa safe-top, không dính mép 0', async () => {
    renderPage();
    const tablist = await screen.findByRole('tablist');
    const sticky = tablist.closest<HTMLElement>('[style*="sticky"]');
    expect(sticky).not.toBeNull();
    expect(sticky!.style.top).toContain('var(--safe-top)');
  });

  it('chỉ khối của tab đang chọn nhìn thấy được; đổi tab thì đổi khối', async () => {
    renderPage();
    await screen.findByRole('tab', { name: 'Hôm nay' });
    await screen.findByText('Lô 2 · Mận');
    expect(tabPanel('Hôm nay')).toBeVisible();
    expect(tabPanel('Vườn')).not.toBeVisible();
    expect(tabPanel('Cộng đồng')).not.toBeVisible();

    fireEvent.click(screen.getByRole('tab', { name: 'Vườn' }));
    expect(tabPanel('Vườn')).toBeVisible();
    expect(tabPanel('Hôm nay')).not.toBeVisible();
    expect(screen.getByRole('tab', { name: 'Vườn' })).toHaveAttribute('aria-selected', 'true');
    expect(within(tabPanel('Vườn')).getByText('Lô 2 · Mận')).toBeVisible();

    fireEvent.click(screen.getByRole('tab', { name: 'Cộng đồng' }));
    expect(tabPanel('Cộng đồng')).toBeVisible();
    expect(within(tabPanel('Cộng đồng')).getByText('Chuỗi điểm danh dài nhất')).toBeVisible();
    expect(within(tabPanel('Cộng đồng')).getByRole('button', { name: 'Tặng 💧' })).toBeVisible();
  });

  it('mỗi khối đặt vào đúng tab: tưới/điểm danh/nhiệm vụ/quiz/vòng quay ở Hôm nay, lô đất ở Vườn, xếp hạng ở Cộng đồng', async () => {
    renderPage();
    await screen.findByText('Lô 2 · Mận');
    const today = within(tabPanel('Hôm nay'));
    expect(today.getByRole('button', { name: 'Tưới cây (20💧)' })).toBeInTheDocument();
    expect(today.getByRole('button', { name: 'Điểm danh' })).toBeInTheDocument();
    expect(today.getByRole('heading', { name: 'Nhiệm vụ' })).toBeInTheDocument();
    expect(today.getByRole('heading', { name: 'Quiz Sống Xanh hôm nay' })).toBeInTheDocument();
    expect(today.getByTestId('wheel')).toBeInTheDocument();
    // Khối ở tab đang ẩn không vào cây accessibility nên kiểm theo chữ + thẻ h2.
    expect(within(tabPanel('Vườn')).getByText(/Lô đất của bạn/).tagName).toBe('H2');
    expect(within(tabPanel('Vườn')).getByText('Tác động xanh của bạn').tagName).toBe('H2');
    expect(within(tabPanel('Cộng đồng')).getByText('Chuỗi điểm danh dài nhất').tagName).toBe('H2');
  });

  it('đổi tab không dựng lại khối: vòng quay chỉ mount một lần', async () => {
    renderPage();
    await screen.findByRole('tab', { name: 'Hôm nay' });
    fireEvent.click(screen.getByRole('tab', { name: 'Vườn' }));
    fireEvent.click(screen.getByRole('tab', { name: 'Cộng đồng' }));
    fireEvent.click(screen.getByRole('tab', { name: 'Hôm nay' }));
    expect(mocks.wheel.mounts).toBe(1);
    expect(mocks.wheel.unmounts).toBe(0);
  });
});

describe('GamePage — hành động chính nằm đầu trang (C-082)', () => {
  it('trong tab Hôm nay: thẻ vườn → tab → tưới cây → điểm danh → nhiệm vụ → quiz', async () => {
    const { container } = renderPage();
    await screen.findByRole('tab', { name: 'Hôm nay' });
    const hero = screen.getByText('Sồi');
    const tabList = screen.getByRole('tablist');
    const water = screen.getByRole('button', { name: 'Tưới cây (20💧)' });
    const checkIn = screen.getByRole('button', { name: 'Điểm danh' });
    const missions = screen.getByRole('heading', { name: 'Nhiệm vụ' });
    const quiz = screen.getByRole('heading', { name: 'Quiz Sống Xanh hôm nay' });
    const order = [hero, tabList, water, checkIn, missions, quiz];
    for (let i = 0; i + 1 < order.length; i += 1) expect(follows(order[i]!, order[i + 1]!)).toBe(true);
    // 3 hành động chính đứng trước mọi khối phụ của tab (vòng quay, đổi vỏ chai).
    expect(follows(missions, screen.getByTestId('wheel'))).toBe(true);
    expect(container.querySelectorAll('[role="tabpanel"]')).toHaveLength(3);
  });

  it('chỉ có một nút "Điểm danh" trên trang Vườn, kèm dòng nói rõ nhận giọt nước', async () => {
    renderPage();
    await screen.findByRole('tab', { name: 'Hôm nay' });
    expect(screen.getAllByRole('button', { name: /Điểm danh/ })).toHaveLength(1);
    expect(screen.getByText('Nhận giọt nước tưới cây mỗi ngày')).toBeInTheDocument();
  });

  it('mỗi khối có tiêu đề h2 thật', async () => {
    const { container } = renderPage();
    await screen.findByText('Lô 2 · Mận');
    const h2 = [...container.querySelectorAll('h2')].map((h) => h.textContent);
    expect(h2).toEqual(
      expect.arrayContaining(['Nhiệm vụ', 'Quiz Sống Xanh hôm nay', 'Vòng quay may mắn', 'Tác động xanh của bạn', 'Chuỗi điểm danh dài nhất']),
    );
  });
});

describe('GamePage — kích thước file (C-082)', () => {
  it('pages/game.tsx không quá 400 dòng: trang chỉ ghép khối', () => {
    const lines = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'game.tsx'), 'utf8').split('\n').length;
    expect(lines).toBeLessThanOrEqual(400);
  });
});
