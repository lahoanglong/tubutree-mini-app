import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Nhịp chơi người mới của Vườn Xanh (docs/2026-10-25-ux-review/03-game-nguoi-moi.md, 2.3, 2.6, 2.7, F1-F10): nút chính
 * theo trạng thái, sheet "Kiếm nước", thẻ 3 bước, số hiện trước khi bấm, hộp chúc mừng cây mầm, vòng quay thiếu điểm.
 * Dùng vòng quay THẬT để kiểm nút "Cách kiếm Điểm Xanh".
 */
const mocks = vi.hoisted(() => ({
  navigate: vi.fn(),
  openSnackbar: vi.fn(),
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
    giftWater: vi.fn(),
  },
}));
vi.mock('zmp-ui', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  Page: ({ children }: { children: ReactNode }) => <div data-testid="page">{children}</div>,
  useNavigate: () => mocks.navigate,
  useSnackbar: () => ({ openSnackbar: mocks.openSnackbar, closeSnackbar: vi.fn() }),
}));
vi.mock('../hooks/use-public-config', () => ({ usePublicConfig: () => ({ isLoaded: true, waste: { enabled: false } }) }));
vi.mock('../store/auth', () => ({
  useAuthStore: (sel?: (s: unknown) => unknown) => {
    const state = { status: 'authenticated', user: { id: 'u1' }, login: vi.fn() };
    return sel ? sel(state) : state;
  },
}));
vi.mock('../utils/haptic', () => ({ haptic: vi.fn() }));
vi.mock('../utils/features', () => ({ SEASON_PASS_ENABLED: false }));
const bridge = vi.hoisted(() => ({ shareLink: vi.fn().mockResolvedValue(undefined) }));
vi.mock('../services/zmp-bridge', () => bridge);
vi.mock('../services/game-api', () => mocks.api);
vi.mock('../services/account-api', () => ({ getLoyalty: () => mocks.getLoyalty(), getDailyCheckInStatus: () => mocks.getDailyCheckInStatus() }));

import GamePage from './game';
import { vi as viText } from '../i18n/vi';

const todayIso = () => new Date().toISOString();
const yesterdayIso = () => new Date(Date.now() - 24 * 3600 * 1000).toISOString();

/** Hồ sơ người mới: 0 giọt, chưa điểm danh lần nào, cây mầm 60 giọt. */
const NEW_PLAYER = {
  totalSeeds: 0,
  streakDays: 0,
  treeStage: 1,
  treeHealth: 'HEALTHY' as const,
  streakFreezes: 0,
  lastDewAt: null as string | null,
  lastCheckInAt: null as string | null,
  streakFreezeCost: 40,
  treePointsPrice: 50_000,
  streakRepairable: false,
  streakRepairCost: 50,
  spinCostPoints: 10_000,
  dailyLoginSeeds: 15,
  dewSeeds: 15,
  streak7Seeds: 30,
  quizWrongSeeds: 2,
  firstCheckinBonus: 50,
  currentTreeTarget: 60,
  nextTreeTarget: 300,
  ecoImpact: { progress: 0, target: 60, treeType: 'Cây Dứa Fuwa3e', treesPlanted: 0 },
};
/** Đã nhận nước hôm nay, hết nước. */
const DRY = { ...NEW_PLAYER, lastCheckInAt: todayIso(), lastDewAt: todayIso(), streakDays: 1, firstCheckinBonus: 0 };

const HOME = { id: null, slot: 1, isHome: true, treeType: 'Sồi', speciesId: null, progress: 0, target: 60, treeStage: 1, treesPlanted: 2, treeHealth: 'HEALTHY' };
const PLOT = { id: 'pa', slot: 2, isHome: false, treeType: 'Mận', speciesId: 's1', progress: 5, target: 300, treeStage: 1, treesPlanted: 0, treeHealth: 'HEALTHY' };
const QUIZ = [
  { id: 'q1', question: 'Cây cần gì?', options: ['A', 'B'], category: 'cay', difficulty: 1, waterReward: 8 },
  { id: 'q2', question: 'Nước từ đâu?', options: ['A', 'B'], category: 'nuoc', difficulty: 1, waterReward: 10 },
];

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <GamePage />
    </QueryClientProvider>,
  );
}
const openTab = async (name: 'Hôm nay' | 'Vườn' | 'Cộng đồng') => fireEvent.click(await screen.findByRole('tab', { name }));
const todayPanel = async () => {
  await screen.findByRole('tab', { name: 'Hôm nay' });
  return within(screen.getByRole('tabpanel', { name: 'Hôm nay' }));
};
/** Hàng việc trong sheet "Kiếm nước": tiêu đề nằm trong div cạnh nút. */
const rowOf = (title: string | RegExp) => within(screen.getByText(title).parentElement!.parentElement!);

beforeEach(() => {
  vi.clearAllMocks();
  try {
    window.localStorage.clear();
  } catch {
    /* jsdom luôn có localStorage */
  }
  const a = mocks.api;
  mocks.getLoyalty.mockResolvedValue({ pointsBalance: 100_000, redeemablePoints: 100_000, redeemableTotal: 100_000 });
  mocks.getDailyCheckInStatus.mockResolvedValue(null);
  a.getGameProfile.mockResolvedValue({ ...NEW_PLAYER });
  a.getTodayQuiz.mockResolvedValue(QUIZ);
  a.getLeaderboard.mockResolvedValue([]);
  a.getMissions.mockResolvedValue([]);
  a.getForest.mockResolvedValue({ count: 0, plantedCount: 0, trees: [] });
  a.getCommunity.mockResolvedValue({ goal: null, myDrops: 0, pct: 0 });
  a.getCollection.mockResolvedValue([]);
  a.getSeason.mockResolvedValue(null);
  a.getSeasonLeaderboard.mockResolvedValue([]);
  a.getFriends.mockResolvedValue([]);
  a.getGarden.mockResolvedValue({ plots: [HOME], maxPlots: 4, nextUnlock: { slot: 2, seedCost: 100 } });
  a.fetchSeasonPass.mockResolvedValue({ active: false });
  a.checkIn.mockResolvedValue({ points: { success: true, cycleDay: 1, streakDays: 1, pointsEarned: 1000, totalPoints: 1000, message: '' }, water: { seedsEarned: 65, streakDays: 1, totalSeeds: 65, streakFrozeUsed: false, bonusNote: '' }, alreadyDone: false, pending: [] });
  a.collectDew.mockResolvedValue({ seedsEarned: 15, totalSeeds: 80 });
  a.waterTree.mockResolvedValue({ progress: 30, target: 60, harvested: false, treesPlanted: 0 });
  a.waterPlot.mockResolvedValue({ progress: 25, target: 300, harvested: false, treesPlanted: 0, revivedFromDead: false });
  a.buyTree.mockResolvedValue({ certificateCode: 'TUBU-9', treeType: 'Sồi', cost: 50_000, pointsUsed: 50_000, pointsUsedConverted: 0 });
});

describe('Vườn Xanh người mới — nút chính và không ngõ cụt', () => {
  it('hồ sơ mới 0 giọt: nút đầu tiên là điểm danh nhận 65💧, bấm gọi checkIn, không gọi tưới', async () => {
    renderPage();
    const buttons = await (await todayPanel()).findAllByRole('button');
    expect(buttons[0]).toHaveTextContent('Điểm danh nhận 65💧');
    fireEvent.click(buttons[0]!);
    await waitFor(() => expect(mocks.api.checkIn).toHaveBeenCalledTimes(1));
    expect(mocks.api.waterTree).not.toHaveBeenCalled();
    // Lần đầu chỉ điểm danh: hứng sương để bước 3.
    expect(mocks.api.collectDew).not.toHaveBeenCalled();
  });

  it('ngày sau: "Nhận nước hôm nay (+30💧)" điểm danh rồi hứng sương luôn một lần bấm', async () => {
    mocks.api.getGameProfile.mockResolvedValue({ ...NEW_PLAYER, firstCheckinBonus: 0, lastCheckInAt: yesterdayIso(), streakDays: 1 });
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: 'Nhận nước hôm nay (+30💧)' }));
    await waitFor(() => expect(mocks.api.checkIn).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(mocks.api.collectDew).toHaveBeenCalledTimes(1));
  });

  it('đã nhận nước và có từ 20💧: "Tưới hết (N💧)" gửi drops = toàn bộ số giọt', async () => {
    mocks.api.getGameProfile.mockResolvedValue({ ...DRY, totalSeeds: 65 });
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: 'Tưới hết (65💧)' }));
    await waitFor(() => expect(mocks.api.waterTree).toHaveBeenCalledWith(65));
  });

  it('hết nước: nút chính thành "Kiếm thêm nước" và mở sheet, không gọi API tưới', async () => {
    mocks.api.getGameProfile.mockResolvedValue({ ...DRY, totalSeeds: 5 });
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: 'Kiếm thêm nước' }));
    expect(await screen.findByRole('heading', { name: 'Kiếm nước' })).toBeInTheDocument();
    expect(screen.getByText(/Bạn đang có 5💧/)).toBeInTheDocument();
    expect(mocks.api.waterTree).not.toHaveBeenCalled();
  });

  describe('mọi nút thiếu nước mở sheet "Kiếm nước", không bấm ra lỗi', () => {
    const STUCK = { ...DRY, totalSeeds: 0, streakRepairable: true, brokenStreakDays: 5, streakFreezeCost: 40, streakRepairCost: 50 };
    const cases: { label: string; tab: 'Hôm nay' | 'Vườn'; name: RegExp | string; api: () => ReturnType<typeof vi.fn>; need: string }[] = [
      { label: 'nút chính', tab: 'Hôm nay', name: 'Kiếm thêm nước', api: () => mocks.api.waterTree, need: 'Bạn đang có 0💧' },
      { label: 'vé giữ lửa', tab: 'Hôm nay', name: 'Còn thiếu 40💧', api: () => mocks.api.buyStreakFreeze, need: 'Bạn cần thêm 40💧 nữa.' },
      { label: 'hồi sinh chuỗi', tab: 'Hôm nay', name: 'Còn thiếu 50💧', api: () => mocks.api.repairStreak, need: 'Bạn cần thêm 50💧 nữa.' },
      { label: 'tưới lô phụ', tab: 'Vườn', name: 'Tưới', api: () => mocks.api.waterPlot, need: 'Bạn cần thêm 20💧 nữa.' },
      { label: 'mở lô', tab: 'Vườn', name: 'Còn thiếu 100💧', api: () => mocks.api.unlockPlot, need: 'Bạn cần thêm 100💧 nữa.' },
    ];
    it.each(cases)('$label', async ({ tab, name, api, need }) => {
      mocks.api.getGameProfile.mockResolvedValue(STUCK);
      mocks.api.getGarden.mockResolvedValue({ plots: [HOME, PLOT], maxPlots: 4, nextUnlock: { slot: 3, seedCost: 100 } });
      renderPage();
      if (tab === 'Vườn') await openTab('Vườn');
      fireEvent.click(await screen.findByRole('button', { name }));
      expect(await screen.findByRole('heading', { name: 'Kiếm nước' })).toBeInTheDocument();
      expect(screen.getByText(new RegExp(need.replace('.', '\\.')))).toBeInTheDocument();
      expect(api()).not.toHaveBeenCalled();
      expect(mocks.openSnackbar).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'error' }));
    });
  });

  it('sheet đã điểm danh + hứng sương thì chỉ còn câu đố; hết câu đố thì báo xong và giờ mở lại', async () => {
    mocks.api.getGameProfile.mockResolvedValue({ ...DRY, totalSeeds: 0 });
    mocks.api.getTodayQuiz.mockResolvedValue([]);
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: 'Kiếm thêm nước' }));
    const sheet = await screen.findByRole('heading', { name: 'Kiếm nước' });
    expect(sheet).toBeInTheDocument();
    expect(screen.queryByText('Điểm danh hôm nay')).not.toBeInTheDocument();
    expect(screen.queryByText('Hứng giọt sương', { selector: 'div' })).not.toBeInTheDocument();
    expect(screen.getByText('Bạn đã làm hết việc kiếm nước hôm nay.')).toBeInTheDocument();
    expect(screen.getByText('Điểm danh và hứng sương mở lại sau 0 giờ ngày mai.')).toBeInTheDocument();
  });

  it('sheet liệt kê điểm danh (+số), hứng sương, câu đố còn lại; bấm điểm danh trong sheet gọi checkIn', async () => {
    mocks.api.getGameProfile.mockResolvedValue({ ...NEW_PLAYER, firstCheckinBonus: 0, lastCheckInAt: yesterdayIso(), totalSeeds: 3 });
    mocks.api.getFriends.mockResolvedValue([{ id: 'f1', nickname: 'Lan', canGift: true }]);
    renderPage();
    // Hôm nay chưa nhận nước nên nút chính là "Nhận nước"; mở sheet từ vé giữ lửa (thiếu nước).
    fireEvent.click(await screen.findByRole('button', { name: 'Còn thiếu 37💧' }));
    await screen.findByRole('heading', { name: 'Kiếm nước' });
    const checkin = rowOf('Điểm danh hôm nay');
    expect(checkin.getByText('+15💧')).toBeInTheDocument();
    expect(screen.getByText('Làm câu đố (còn 2 câu)')).toBeInTheDocument();
    expect(screen.queryByText('Nước từ bạn bè')).not.toBeInTheDocument();
    fireEvent.click(checkin.getByRole('button', { name: 'Điểm danh' }));
    await waitFor(() => expect(mocks.api.checkIn).toHaveBeenCalledTimes(1));
  });

  it('sheet: câu đố đang tải hiện trạng thái đang tải; tải lỗi hiện thông báo và "Thử lại" tải lại câu đố', async () => {
    mocks.api.getGameProfile.mockResolvedValue({ ...DRY, totalSeeds: 0 });
    mocks.api.getTodayQuiz.mockRejectedValueOnce(new Error('boom')).mockResolvedValue(QUIZ);
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: 'Kiếm thêm nước' }));
    expect(await screen.findByText('Chưa tải được việc kiếm nước.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Thử lại' }));
    expect(await screen.findByText('Làm câu đố (còn 2 câu)')).toBeInTheDocument();
    expect(mocks.api.getTodayQuiz).toHaveBeenCalledTimes(2);
  });

  it('sheet: lỗi điểm danh hiện ngay trong sheet', async () => {
    mocks.api.getGameProfile.mockResolvedValue({ ...NEW_PLAYER, firstCheckinBonus: 0, lastCheckInAt: yesterdayIso(), totalSeeds: 0 });
    mocks.api.checkIn.mockRejectedValue(new Error('Hôm nay bạn đã điểm danh rồi'));
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: 'Còn thiếu 40💧' }));
    await screen.findByRole('heading', { name: 'Kiếm nước' });
    fireEvent.click(rowOf('Điểm danh hôm nay').getByRole('button', { name: 'Điểm danh' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Có chút trục trặc, thử lại nhé');
  });
});

describe('Vườn Xanh người mới — thẻ 3 bước', () => {
  it('hồ sơ mới: bước 1 đang làm; xong điểm danh sang bước 2; xong cây đầu sang bước 3 có "Đã hiểu"', async () => {
    const view = renderPage();
    expect(await screen.findByText('Bước 1/3')).toBeInTheDocument();
    expect(screen.getByText('Bấm nút xanh bên dưới để điểm danh.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Đã hiểu' })).not.toBeInTheDocument();
    view.unmount();

    mocks.api.getGameProfile.mockResolvedValue({ ...NEW_PLAYER, lastCheckInAt: todayIso(), totalSeeds: 65 });
    const second = renderPage();
    expect(await screen.findByText('Bước 2/3')).toBeInTheDocument();
    second.unmount();

    mocks.api.getGameProfile.mockResolvedValue({
      ...DRY,
      totalSeeds: 5,
      ecoImpact: { progress: 5, target: 300, treeType: 'Cây', treesPlanted: 1 },
    });
    renderPage();
    expect(await screen.findByText('Bước 3/3')).toBeInTheDocument();
    expect(screen.getByText('Câu đố đúng hết thêm khoảng 18💧.')).toBeInTheDocument();
    expect(screen.getByText('Ngày mai: điểm danh + sương = 30💧')).toBeInTheDocument();
  });

  it('bấm "Đã hiểu": thẻ tự ẩn và không hiện lại ở lần mở sau', async () => {
    mocks.api.getGameProfile.mockResolvedValue({ ...DRY, ecoImpact: { progress: 5, target: 300, treeType: 'Cây', treesPlanted: 1 } });
    const view = renderPage();
    fireEvent.click(await screen.findByRole('button', { name: 'Đã hiểu' }));
    await waitFor(() => expect(screen.queryByText('Phiên đầu tiên của bạn')).not.toBeInTheDocument());
    view.unmount();
    renderPage();
    await screen.findByRole('button', { name: /Kiếm thêm nước|Tưới hết/ });
    expect(screen.queryByText('Phiên đầu tiên của bạn')).not.toBeInTheDocument();
  });
});

describe('Vườn Xanh người mới — số hiện trước khi bấm lấy từ hồ sơ', () => {
  it('điểm danh, sương, ô N3 và N7 ghi số 💧 từ profile', async () => {
    mocks.api.getGameProfile.mockResolvedValue({
      ...DRY,
      lastCheckInAt: yesterdayIso(),
      lastDewAt: null,
      dailyLoginSeeds: 17,
      dewSeeds: 11,
      streak7Seeds: 40,
      firstCheckinBonus: 0,
      totalSeeds: 500,
    });
    renderPage();
    expect(await screen.findByText('Nhận +17💧 và Điểm Xanh mỗi ngày')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Hứng giọt sương (+11💧)' })).toBeInTheDocument();
    expect(screen.getByText('+5💧')).toBeInTheDocument();
    expect(screen.getByText('+40💧')).toBeInTheDocument();
    // Nút chính gộp điểm danh + sương theo đúng hai số đó.
    expect(screen.getByRole('button', { name: 'Nhận nước hôm nay (+28💧)' })).toBeInTheDocument();
  });

  it('bình đầy: nút chính "Nhận nước hôm nay" không ghi +N💧', async () => {
    mocks.api.getGameProfile.mockResolvedValue({ ...NEW_PLAYER, firstCheckinBonus: 0, lastCheckInAt: yesterdayIso(), lastDewAt: null, streakDays: 1, totalSeeds: 500, tankCapacity: 500 });
    renderPage();
    expect(await screen.findByRole('button', { name: 'Nhận nước hôm nay' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Nhận nước hôm nay \(\+/ })).toBeNull();
  });

  it('bình gần đầy: nút chính ghi số chỗ trống', async () => {
    mocks.api.getGameProfile.mockResolvedValue({ ...NEW_PLAYER, firstCheckinBonus: 0, lastCheckInAt: yesterdayIso(), lastDewAt: null, streakDays: 1, totalSeeds: 495, tankCapacity: 500 });
    renderPage();
    expect(await screen.findByRole('button', { name: 'Nhận nước hôm nay (+5💧)' })).toBeInTheDocument();
  });

  it('lần đầu: dòng phụ nói lần đầu nhận gồm quà người mới', async () => {
    renderPage();
    expect(await screen.findByText('Lần đầu nhận +65💧, các ngày sau +15💧, kèm Điểm Xanh')).toBeInTheDocument();
  });

  it('API cũ chưa trả số: chữ giữ nguyên như trước, không hiện "undefined"', async () => {
    mocks.api.getGameProfile.mockResolvedValue({
      totalSeeds: 500,
      streakDays: 2,
      treeStage: 1,
      streakFreezes: 0,
      lastDewAt: null,
      lastCheckInAt: yesterdayIso(),
      ecoImpact: { progress: 0, target: 600, treeType: 'Cây', treesPlanted: 1 },
    });
    renderPage();
    expect(await screen.findByText('Nhận giọt nước và Điểm Xanh mỗi ngày')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Nhận nước hôm nay' })).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/undefined|NaN/);
  });
});

describe('Vườn Xanh người mới — hộp chúc mừng', () => {
  beforeEach(() => {
    mocks.api.getGameProfile.mockResolvedValue({ ...DRY, totalSeeds: 65 });
  });

  it('cây mầm: +2.000 Điểm Xanh và thẻ loài, không mã giảm giá, không lời "Tubu góp 1 cây", báo cây kế tiếp cần 300💧', async () => {
    mocks.api.waterTree.mockResolvedValue({
      progress: 5,
      target: 300,
      harvested: true,
      treesPlanted: 1,
      reward: { points: 2000, species: { name: 'Lim xanh', emoji: '🌲', rarity: 'COMMON', ecoFact: null } },
    });
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: 'Tưới hết (65💧)' }));
    expect(await screen.findByText('Thu hoạch thành công!')).toBeInTheDocument();
    expect(screen.getByText('+2.000 Điểm Xanh')).toBeInTheDocument();
    expect(screen.getByText('🌲 Lim xanh')).toBeInTheDocument();
    expect(screen.getByText('Cây tiếp theo cần 300💧')).toBeInTheDocument();
    expect(document.body.textContent).not.toContain('Tubu sẽ góp');
    expect(screen.queryByRole('button', { name: 'Dùng mã giảm giá ngay' })).not.toBeInTheDocument();
  });

  it.each([
    ['DAY', 'Hôm nay bạn đã nhận mã giảm giá'],
    ['MONTH', 'Tháng này bạn đã nhận đủ mã giảm giá'],
  ] as const)('chạm trần mã theo %s: hộp giải thích, cây vẫn được tính', async (cap, text) => {
    mocks.api.waterTree.mockResolvedValue({
      progress: 0,
      target: 600,
      harvested: true,
      treesPlanted: 5,
      couponCapped: cap,
      reward: { certificate: 'CERT-1' },
    });
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: 'Tưới hết (65💧)' }));
    expect(await screen.findByText(new RegExp(text))).toBeInTheDocument();
    expect(screen.getByText('CERT-1')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Dùng mã giảm giá ngay' })).not.toBeInTheDocument();
  });

  it('nhiều mã trong một lần tưới: hiện tất cả mã', async () => {
    mocks.api.waterTree.mockResolvedValue({ progress: 0, target: 600, harvested: true, treesPlanted: 3, reward: { coupon: 'A1', coupons: ['A1', { code: 'B2' }] } });
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: 'Tưới hết (65💧)' }));
    expect(await screen.findByText('A1')).toBeInTheDocument();
    expect(screen.getByText('B2')).toBeInTheDocument();
  });

  it.each([
    ['couponCapped', { couponCapped: 'GUEST' }],
    ['rewardBlocked', { rewardBlocked: 'GUEST' }],
  ])('khách vãng lai (%s): mời đăng nhập Zalo kèm nút đăng nhập', async (_n, extra) => {
    mocks.api.waterTree.mockResolvedValue({ progress: 0, target: 600, harvested: true, treesPlanted: 1, ...extra });
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: 'Tưới hết (65💧)' }));
    expect(await screen.findByText('Đăng nhập Zalo để nhận quà khi thu hoạch.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Đăng nhập Zalo' })).toBeInTheDocument();
  });

  it('"Chia sẻ với bạn bè" mở hộp chia sẻ Zalo gốc tới /game, không đăng bài Cộng đồng', async () => {
    mocks.api.waterTree.mockResolvedValue({ progress: 0, target: 600, harvested: true, treesPlanted: 2, reward: { certificate: 'C2' } });
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: 'Tưới hết (65💧)' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Chia sẻ với bạn bè' }));
    expect(bridge.shareLink).toHaveBeenCalledWith(expect.objectContaining({ path: '/game', title: expect.any(String) }));
    expect(screen.queryByRole('button', { name: /Chia sẻ lên Cộng đồng/ })).not.toBeInTheDocument();
  });

  it('khách vãng lai không có nút chia sẻ', async () => {
    mocks.api.waterTree.mockResolvedValue({ progress: 0, target: 600, harvested: true, treesPlanted: 1, rewardBlocked: 'GUEST' });
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: 'Tưới hết (65💧)' }));
    await screen.findByText('Thu hoạch thành công!');
    expect(screen.queryByRole('button', { name: 'Chia sẻ với bạn bè' })).not.toBeInTheDocument();
  });

  it('cây mầm của khách (không điểm, không mã): nói cây mầm, không nói Tubu góp 1 cây', async () => {
    mocks.api.waterTree.mockResolvedValue({ progress: 0, target: 300, harvested: true, treesPlanted: 1, rewardBlocked: 'GUEST', reward: { sprout: true } });
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: 'Tưới hết (65💧)' }));
    await screen.findByText('Thu hoạch thành công!');
    expect(document.body.textContent).toContain('Cây mầm đầu tiên của bạn đã lớn');
    expect(document.body.textContent).not.toContain('Tubu sẽ góp');
  });

  it('thu hoạch thường vẫn nói Tubu góp 1 cây và không có khung điểm', async () => {
    mocks.api.waterTree.mockResolvedValue({ progress: 0, target: 600, harvested: true, treesPlanted: 2, reward: { coupon: 'GAME30000-X', certificate: 'C2' } });
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: 'Tưới hết (65💧)' }));
    await screen.findByText('Thu hoạch thành công!');
    expect(document.body.textContent).toContain('Tubu sẽ góp 1 cây vào quỹ trồng cây');
    expect(screen.queryByText(/Điểm Xanh$/)).not.toBeInTheDocument();
  });
});

describe('Vườn Xanh người mới — thiếu điểm và lô phụ', () => {
  it('vòng quay thiếu điểm: hiện "Bạn có X / 10.000 Điểm Xanh", không có nút quay, nút "Cách kiếm Điểm Xanh" sang /loyalty', async () => {
    mocks.getLoyalty.mockResolvedValue({ pointsBalance: 3_000, redeemablePoints: 3_000, redeemableTotal: 3_000 });
    renderPage();
    expect(await (await todayPanel()).findByText('Bạn có 3.000 / 10.000 Điểm Xanh cho 1 lượt quay')).toBeInTheDocument();
    expect((await todayPanel()).queryByRole('button', { name: /Quay ngay/ })).not.toBeInTheDocument();
    fireEvent.click((await todayPanel()).getByRole('button', { name: 'Cách kiếm Điểm Xanh' }));
    expect(mocks.navigate).toHaveBeenCalledWith('/loyalty');
    expect(mocks.api.spin).not.toHaveBeenCalled();
  });

  it('vòng quay đủ điểm hoặc chưa biết số dư: vẫn là nút "Quay ngay"', async () => {
    const view = renderPage();
    expect(await (await todayPanel()).findByRole('button', { name: /Quay ngay/ })).toBeInTheDocument();
    view.unmount();
    mocks.getLoyalty.mockRejectedValue(new Error('boom'));
    renderPage();
    expect(await (await todayPanel()).findByRole('button', { name: /Quay ngay/ })).toBeInTheDocument();
  });

  it('vòng quay chỉ tính điểm dùng được: điểm bị khoá theo đơn chưa hết hạn đổi trả không được tính', async () => {
    mocks.getLoyalty.mockResolvedValue({ pointsBalance: 12_000, redeemablePoints: 4_000, redeemableTotal: 4_000 });
    renderPage();
    expect(await (await todayPanel()).findByText('Bạn có 4.000 / 10.000 Điểm Xanh cho 1 lượt quay')).toBeInTheDocument();
  });

  it('góp quỹ nằm ở tab Vườn (không còn ở Hôm nay); thiếu điểm hiện số dư và "Cách kiếm Điểm Xanh"', async () => {
    mocks.getLoyalty.mockResolvedValue({ pointsBalance: 1_000, redeemablePoints: 1_000, redeemableTotal: 1_000 });
    renderPage();
    await openTab('Vườn');
    const garden = within(screen.getByRole('tabpanel', { name: 'Vườn' }));
    expect(await garden.findByText('Bạn có 1.000 / 50.000 Điểm Xanh')).toBeInTheDocument();
    expect(garden.queryByRole('button', { name: /Góp quỹ trồng cây/ })).not.toBeInTheDocument();
    fireEvent.click(garden.getByRole('button', { name: 'Cách kiếm Điểm Xanh' }));
    expect(mocks.navigate).toHaveBeenCalledWith('/loyalty');
    expect(screen.queryByRole('button', { name: /Góp quỹ trồng cây/ })).not.toBeInTheDocument();
  });

  it('đủ điểm: tab Vườn có nút góp quỹ kèm giá, tab Hôm nay không có', async () => {
    renderPage();
    expect(await (await todayPanel()).findByRole('button', { name: /Điểm danh nhận/ })).toBeInTheDocument();
    expect((await todayPanel()).queryByRole('button', { name: /Góp quỹ trồng cây/ })).not.toBeInTheDocument();
    await openTab('Vườn');
    expect(await screen.findByRole('button', { name: 'Góp quỹ trồng cây (50.000 điểm)' })).toBeInTheDocument();
  });

  it('lô phụ ẩn tới khi thu hoạch cây thứ 2, thay bằng một dòng gợi ý', async () => {
    mocks.api.getGameProfile.mockResolvedValue({ ...DRY, ecoImpact: { progress: 5, target: 300, treeType: 'Cây', treesPlanted: 1 } });
    renderPage();
    await openTab('Vườn');
    expect(await screen.findByText('Thu hoạch cây thứ 2 để mở thêm lô đất.')).toBeInTheDocument();
    expect(screen.queryByText(/Lô đất của bạn/)).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Mở lô|Còn thiếu/ })).not.toBeInTheDocument();
  });

  it('đã thu hoạch cây thứ 2: lô đất hiện, nút mở lô ghi giá khi đủ nước', async () => {
    mocks.api.getGameProfile.mockResolvedValue({ ...DRY, totalSeeds: 500, ecoImpact: { progress: 5, target: 600, treeType: 'Cây', treesPlanted: 2 } });
    renderPage();
    await openTab('Vườn');
    expect(await screen.findByRole('button', { name: 'Mở lô (100💧)' })).toBeInTheDocument();
    expect(screen.queryByText('Thu hoạch cây thứ 2 để mở thêm lô đất.')).not.toBeInTheDocument();
  });
});

describe('Vườn Xanh người mới — chữ không còn hứa mất tiến độ', () => {
  it.each(['WILTED', 'DEAD'] as const)('cây %s: "Cây đang héo, tưới để cây xanh lại."', async (health) => {
    mocks.api.getGameProfile.mockResolvedValue({ ...DRY, treeHealth: health });
    renderPage();
    expect(await screen.findByText('Cây đang héo, tưới để cây xanh lại.')).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/trồng cây mới từ đầu|héo úa|mất hết/);
  });

  it('cổng đăng nhập riêng cho game', () => {
    expect(viText.game.newbie.loginToView).toBe('Đăng nhập để trồng cây, nhận nước và quà');
  });
});
