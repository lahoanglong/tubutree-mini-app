import { render, screen, fireEvent, waitFor, act, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Đặc tả hành vi trang Vườn Cây (C-082, PC-10a): nút điểm danh/hứng sương/tưới/thu hoạch/góp quỹ trồng cây,
 * lô đất, Chặng Mùa, quiz, nhiệm vụ, tặng nước, vòng quay. Viết TRƯỚC khi tách game.tsx thành
 * components/game/* để chứng minh việc chia khối không đổi điều kiện bật/tắt nút, lời gọi API,
 * khoá làm mới cache và con số hiển thị. Chỉ truy vấn theo role/chữ, không theo class/cấu trúc.
 */
const mocks = vi.hoisted(() => ({
  navigate: vi.fn(),
  openSnackbar: vi.fn(),
  login: vi.fn(),
  haptic: vi.fn(),
  copyText: vi.fn(),
  auth: { status: 'authenticated' as string },
  publicConfig: { isLoaded: true, waste: { enabled: true, dropoff: true, mailin: true, pickup: false } },
  features: { seasonPass: false },
  getLoyalty: vi.fn(),
  wheel: { cost: undefined as number | undefined, onSpin: undefined as (() => Promise<unknown>) | undefined },
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
  useLocation: () => ({ pathname: '/game', search: '', state: null }),
  useSnackbar: () => ({ openSnackbar: mocks.openSnackbar, closeSnackbar: vi.fn() }),
}));
vi.mock('../hooks/use-public-config', () => ({ usePublicConfig: () => mocks.publicConfig }));
vi.mock('../store/auth', () => ({
  useAuthStore: (sel?: (s: unknown) => unknown) => {
    const state = { status: mocks.auth.status, user: { id: 'u1' }, login: mocks.login };
    return sel ? sel(state) : state;
  },
}));
vi.mock('../utils/haptic', () => ({ haptic: mocks.haptic }));
vi.mock('../utils/features', () => ({
  get SEASON_PASS_ENABLED() {
    return mocks.features.seasonPass;
  },
}));
vi.mock('../utils/clipboard', () => ({ copyText: mocks.copyText }));
vi.mock('../components/wheel', () => ({
  WheelOfFortune: ({ cost, onSpin }: { cost: number; onSpin: () => Promise<unknown> }) => {
    mocks.wheel.cost = cost;
    mocks.wheel.onSpin = onSpin;
    return <div data-testid="wheel" />;
  },
}));
vi.mock('../services/game-api', () => mocks.api);
vi.mock('../services/account-api', () => ({ getLoyalty: (...a: unknown[]) => mocks.getLoyalty(...a) }));

import GamePage from './game';
import { vi as viText } from '../i18n/vi';

const HOUR = 3600 * 1000;
const todayIso = () => new Date().toISOString();
const twoDaysAgoIso = () => new Date(Date.now() - 48 * HOUR).toISOString();

const PROFILE = {
  totalSeeds: 1_250,
  streakDays: 2,
  treeStage: 2,
  treeHealth: 'HEALTHY' as 'HEALTHY' | 'WILTED' | 'DEAD',
  streakFreezes: 1,
  lastDewAt: null as string | null,
  lastCheckInAt: null as string | null,
  streakFreezeCost: 80,
  treePointsPrice: 50,
  streakRepairable: false,
  ecoImpact: { progress: 10, target: 50, treeType: 'Sồi', treesPlanted: 3 },
};

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
  const invalidate = vi.spyOn(qc, 'invalidateQueries');
  const view = render(
    <QueryClientProvider client={qc}>
      <GamePage />
    </QueryClientProvider>,
  );
  const invalidated = () => invalidate.mock.calls.map((c) => (c[0] as { queryKey: unknown[] }).queryKey);
  return { ...view, qc, invalidated };
}

/** Chuyển tab của trang Vườn Xanh. Khối ở tab khác vẫn được dựng nhưng ẩn, nên truy vấn theo role phải mở tab trước. */
async function openTab(name: 'Hôm nay' | 'Vườn') {
  fireEvent.click(await screen.findByRole('tab', { name }));
}

beforeEach(() => {
  mocks.publicConfig.waste.enabled = true;
  vi.clearAllMocks();
  mocks.auth.status = 'authenticated';
  mocks.features.seasonPass = false;
  mocks.wheel.cost = undefined;
  mocks.wheel.onSpin = undefined;
  const a = mocks.api;
  mocks.getLoyalty.mockResolvedValue({ pointsBalance: 100_000, redeemablePoints: 100_000, redeemableTotal: 100_000 });
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
  a.spin.mockResolvedValue({ prize: { id: 'p1', name: 'Mã 10K', rewardType: 'COUPON', value: 10_000 } });
  a.answerQuiz.mockResolvedValue({ isCorrect: true, correct: 1, waterEarned: 20, explanation: 'Cây quang hợp.' });
  a.waterTree.mockResolvedValue({ progress: 30, target: 50, harvested: false, treesPlanted: 3 });
  a.buyTree.mockResolvedValue({ certificateCode: 'TUBU-9', treeType: 'Sồi', cost: 50, pointsUsed: 50, pointsUsedConverted: 0 });
  a.claimMission.mockResolvedValue({ claimed: true, rewardPoints: 50, couponCode: null });
  a.unlockPlot.mockResolvedValue({});
  a.waterPlot.mockResolvedValue({ progress: 5, target: 20, harvested: false, treesPlanted: 0, revivedFromDead: false });
  a.claimSeasonPass.mockResolvedValue({ claimed: true, reward: { type: 'SEEDS', amount: 10 } });
  a.giftWater.mockResolvedValue({ amount: 50, recipientId: 'f1' });
  mocks.copyText.mockResolvedValue(true);
});

describe('GamePage — trạng thái trang', () => {
  it('đang khôi phục phiên: không hiện cổng đăng nhập, không hiện hành động, không tải hồ sơ', async () => {
    mocks.auth.status = 'loading';
    renderPage();
    await waitFor(() => expect(mocks.api.getSeason).toHaveBeenCalled());
    expect(screen.queryByRole('button', { name: viText.auth.loginCta })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Nhận nước hôm nay/ })).not.toBeInTheDocument();
    expect(mocks.api.getGameProfile).not.toHaveBeenCalled();
  });

  it('chưa đăng nhập: hiện cổng đăng nhập, bấm gọi login(), không tải hồ sơ/nhiệm vụ', async () => {
    mocks.auth.status = 'unauthenticated';
    renderPage();
    expect(screen.getByText(viText.game.newbie.loginToView)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: viText.auth.loginCta }));
    expect(mocks.login).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('button', { name: /Nhận nước hôm nay/ })).not.toBeInTheDocument();
    expect(mocks.api.getGameProfile).not.toHaveBeenCalled();
    expect(mocks.api.getMissions).not.toHaveBeenCalled();
  });

  it('lỗi tải hồ sơ: báo lỗi rõ ràng và "Thử lại" tải lại hồ sơ, không dựng phần còn lại', async () => {
    mocks.api.getGameProfile.mockRejectedValueOnce(new Error('boom')).mockResolvedValue({ ...PROFILE });
    renderPage();
    const retry = await screen.findByRole('button', { name: /Thử lại/ });
    expect(screen.queryByRole('button', { name: /Nhận nước hôm nay/ })).not.toBeInTheDocument();
    fireEvent.click(retry);
    expect(await screen.findByRole('button', { name: /Nhận nước hôm nay/ })).toBeInTheDocument();
    expect(mocks.api.getGameProfile).toHaveBeenCalledTimes(2);
  });
});

describe('GamePage — vườn và lối tắt', () => {
  it('thẻ vườn: tên loại cây và dòng tổng hợp giọt nước/chuỗi/cây góp quỹ', async () => {
    const { container } = renderPage();
    expect(await screen.findByText('Sồi')).toBeInTheDocument();
    expect(container.textContent).toContain('10/50💧 · 💧 1.250 · 🔥 2 ngày · 🌳 cây đã trồng: 3');
  });

  it('chưa có ecoImpact: tên mặc định "Vườn của bạn" và số 0', async () => {
    mocks.api.getGameProfile.mockResolvedValue({ ...PROFILE, ecoImpact: null });
    const { container } = renderPage();
    expect(await screen.findByText('Vườn của bạn')).toBeInTheDocument();
    expect(container.textContent).toContain('0/0💧');
  });

  it('giai đoạn cây theo tiến độ: <=50% mầm, >50% cành, 100% cây', async () => {
    const view = renderPage();
    await screen.findByText('Sồi');
    expect(screen.getByText('🌱')).toBeInTheDocument();
    view.unmount();

    mocks.api.getGameProfile.mockResolvedValue({ ...PROFILE, ecoImpact: { ...PROFILE.ecoImpact, progress: 60, target: 100 } });
    const second = renderPage();
    await screen.findByText('Sồi');
    expect(screen.getByText('🌿')).toBeInTheDocument();
    expect(screen.queryByText('🌱')).not.toBeInTheDocument();
    second.unmount();

    mocks.api.getGameProfile.mockResolvedValue({ ...PROFILE, ecoImpact: { ...PROFILE.ecoImpact, progress: 100, target: 100 } });
    renderPage();
    await screen.findByText('Sồi');
    // chỉ còn 🌳 ở thẻ vườn: ô "Cây đã góp quỹ" dùng icon Lucide
    expect(screen.getAllByText('🌳')).toHaveLength(1);
  });

  it('lối tắt: Đổi rác lấy quà (nhãn Mới, dòng giọt nước/Điểm Xanh) → /recycle; Bảng tin cộng đồng → /feed', async () => {
    renderPage();
    const row = await screen.findByRole('button', { name: /Đổi rác lấy quà/ });
    expect(within(row).getByText('Mới')).toBeInTheDocument();
    expect(within(row).getByText('Giọt nước dùng trong Vườn, Điểm Xanh dùng để mua sắm')).toBeInTheDocument();
    fireEvent.click(row);
    expect(mocks.navigate).toHaveBeenLastCalledWith('/recycle');
    expect(screen.queryByText('Đổi vỏ chai lấy nước')).toBeNull();
    await openTab('Vườn');
    expect(screen.getByText('Xem mẹo sống xanh từ mọi người')).toBeInTheDocument();
    expect(screen.queryByText(/Khoe thành tích/)).toBeNull();
    fireEvent.click(screen.getByText('Bảng tin cộng đồng'));
    expect(mocks.navigate).toHaveBeenLastCalledWith('/feed');
  });

  it('chương trình tắt → không có thẻ Đổi rác trong Vườn', async () => {
    mocks.publicConfig.waste.enabled = false;
    renderPage();
    await screen.findByText('Sồi');
    expect(screen.queryByText('Đổi rác lấy quà')).toBeNull();
  });

  it('banner mùa chỉ hiện khi có mùa, kèm chủ đề/vùng và loài nổi bật', async () => {
    const view = renderPage();
    await screen.findByText('Sồi');
    expect(screen.queryByText('Mùa Xuân')).not.toBeInTheDocument();
    view.unmount();

    mocks.api.getSeason.mockResolvedValue({
      id: 's1',
      name: 'Mùa Xuân',
      theme: 'Hoa đào',
      region: 'Hà Giang',
      startAt: '',
      endAt: '',
      featuredSpecies: [
        { id: 'a', name: 'Đào', emoji: '🌸', rarity: 'RARE' },
        { id: 'b', name: 'Mai', emoji: '🌼', rarity: 'COMMON' },
      ],
    });
    renderPage();
    expect(await screen.findByText('Mùa Xuân')).toBeInTheDocument();
    expect(screen.getByText('🌸 🌼')).toBeInTheDocument();
    expect(screen.getByText('Hoa đào · Hà Giang')).toBeInTheDocument();
    expect(screen.getByText('Loài nổi bật mùa này: Đào, Mai')).toBeInTheDocument();
  });
});

describe('GamePage — điểm danh chuỗi (Vườn)', () => {
  it('chưa điểm danh: nút "Điểm danh" bật; chạm lúc đang gửi không gọi lần 2, báo thành công, làm mới đủ khoá', async () => {
    const gate = pending<unknown>();
    mocks.api.checkIn.mockReturnValue(gate.promise);
    const { invalidated } = renderPage();
    const btn = await screen.findByRole('button', { name: 'Điểm danh' });
    expect(btn).toBeEnabled();
    fireEvent.click(btn);
    await waitFor(() => expect(btn).toBeDisabled());
    fireEvent.click(btn);
    expect(mocks.api.checkIn).toHaveBeenCalledTimes(1);
    await act(async () => {
      gate.resolve({ seedsEarned: 10, pointsEarned: 0, streakDays: 3, totalSeeds: 1_260, streakFrozeUsed: true, bonusNote: 'Thưởng ngày 3' });
    });
    await waitFor(() =>
      expect(mocks.openSnackbar).toHaveBeenCalledWith({ text: '+10💧 · 🧊 đã dùng vé giữ lửa · Thưởng ngày 3', type: 'success' }),
    );
    const keys = invalidated();
    expect(keys).toContainEqual(['game']);
    expect(keys).toContainEqual(['me']);
    expect(keys).toContainEqual(['loyalty']);
    // /me/coins đã 410: không còn khoá nào để làm mới.
    expect(keys).not.toContainEqual(['coins']);
  });

  it('đã điểm danh hôm nay: nút "Đã điểm danh" tắt, bấm không gọi API', async () => {
    mocks.api.getGameProfile.mockResolvedValue({ ...PROFILE, lastCheckInAt: todayIso() });
    renderPage();
    const btn = await screen.findByRole('button', { name: 'Đã điểm danh' });
    expect(btn).toBeDisabled();
    fireEvent.click(btn);
    expect(mocks.api.checkIn).not.toHaveBeenCalled();
  });

  it('điểm danh từ hôm kia: nút lại bật (khoá theo ngày giờ VN, không theo "đã từng")', async () => {
    mocks.api.getGameProfile.mockResolvedValue({ ...PROFILE, lastCheckInAt: twoDaysAgoIso() });
    renderPage();
    expect(await screen.findByRole('button', { name: 'Điểm danh' })).toBeEnabled();
  });

  it('lỗi điểm danh: báo lỗi, không làm mới cache, nút bật lại', async () => {
    mocks.api.checkIn.mockRejectedValue(new Error('boom'));
    const { invalidated } = renderPage();
    const btn = await screen.findByRole('button', { name: 'Điểm danh' });
    fireEvent.click(btn);
    await waitFor(() => expect(mocks.openSnackbar).toHaveBeenCalledWith(expect.objectContaining({ type: 'error' })));
    expect(invalidated()).not.toContainEqual(['game']);
    await waitFor(() => expect(btn).toBeEnabled());
  });

  it('tiêu đề chuỗi và 7 ô ngày: chu kỳ 7 ngày, ô thưởng ngày 3 và 7', async () => {
    const view = renderPage();
    expect(await screen.findByText('Điểm danh chuỗi 2 ngày')).toBeInTheDocument();
    for (const d of [1, 2, 3, 4, 5, 6, 7]) expect(screen.getByText(`N${d}`)).toBeInTheDocument();
    // Ô 💧 đã làm: 2 ngày; ô 🎁: ngày 3 và 7
    expect(screen.getAllByText('💧')).toHaveLength(2);
    expect(screen.getAllByText('🎁')).toHaveLength(2);
    view.unmount();

    mocks.api.getGameProfile.mockResolvedValue({ ...PROFILE, streakDays: 7 });
    const full = renderPage();
    await screen.findByText('Điểm danh chuỗi 7 ngày');
    expect(screen.getAllByText('💧')).toHaveLength(7);
    expect(screen.queryByText('🎁')).not.toBeInTheDocument();
    full.unmount();

    mocks.api.getGameProfile.mockResolvedValue({ ...PROFILE, streakDays: 10 });
    renderPage();
    await screen.findByText('Điểm danh chuỗi 10 ngày');
    // 10 % 7 = 3 ngày đã làm
    expect(screen.getAllByText('💧')).toHaveLength(3);
  });
});

describe('GamePage — giọt sương và vé giữ lửa', () => {
  it('giọt sương chưa hứng: nút bật, gọi API 1 lần, báo số giọt nước và làm mới', async () => {
    const { invalidated } = renderPage();
    const btn = await screen.findByRole('button', { name: 'Hứng giọt sương' });
    expect(btn).toBeEnabled();
    fireEvent.click(btn);
    await waitFor(() =>
      expect(mocks.openSnackbar).toHaveBeenCalledWith({ text: 'Hứng được +5💧 từ giọt sương sáng 💦', type: 'success' }),
    );
    expect(mocks.api.collectDew).toHaveBeenCalledTimes(1);
    expect(invalidated()).toContainEqual(['game']);
  });

  it('đã hứng hôm nay: nút "Đã hứng sương" tắt, bấm không gọi API', async () => {
    mocks.api.getGameProfile.mockResolvedValue({ ...PROFILE, lastDewAt: todayIso() });
    renderPage();
    const btn = await screen.findByRole('button', { name: 'Đã hứng sương' });
    expect(btn).toBeDisabled();
    fireEvent.click(btn);
    expect(mocks.api.collectDew).not.toHaveBeenCalled();
  });

  it('điểm danh và hứng sương độc lập nhau: đã điểm danh vẫn hứng được sương', async () => {
    mocks.api.getGameProfile.mockResolvedValue({ ...PROFILE, lastCheckInAt: todayIso() });
    renderPage();
    expect(await screen.findByRole('button', { name: 'Hứng giọt sương' })).toBeEnabled();
  });

  it('vé giữ lửa: hiện số vé và giá từ hồ sơ, mua gọi API đúng 1 lần và báo số vé còn lại', async () => {
    const { container } = renderPage();
    const btn = await screen.findByRole('button', { name: 'Mua (80💧)' });
    expect(container.textContent).toContain('Vé giữ lửa: 1');
    fireEvent.click(btn);
    await waitFor(() =>
      expect(mocks.openSnackbar).toHaveBeenCalledWith({ text: 'Đã mua vé giữ lửa 🧊 (còn 2 vé)', type: 'success' }),
    );
    expect(mocks.api.buyStreakFreeze).toHaveBeenCalledTimes(1);
  });

  it('hồ sơ không có giá vé: mặc định 80💧', async () => {
    mocks.api.getGameProfile.mockResolvedValue({ ...PROFILE, streakFreezeCost: undefined });
    renderPage();
    expect(await screen.findByRole('button', { name: 'Mua (80💧)' })).toBeInTheDocument();
  });

  it('lỗi mua vé: báo lỗi', async () => {
    mocks.api.buyStreakFreeze.mockRejectedValue(new Error('boom'));
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: 'Mua (80💧)' }));
    await waitFor(() => expect(mocks.openSnackbar).toHaveBeenCalledWith(expect.objectContaining({ type: 'error' })));
  });
});

describe('GamePage — hồi sinh chuỗi và cảnh báo cây', () => {
  it('không trong cửa sổ hồi sinh: không có khối hồi sinh', async () => {
    renderPage();
    await screen.findByText('Sồi');
    expect(screen.queryByRole('button', { name: /Hồi sinh/ })).not.toBeInTheDocument();
  });

  it('trong cửa sổ hồi sinh: hiện chuỗi đã mất và giá; bấm gọi API, báo + haptic, chỉ làm mới hồ sơ', async () => {
    mocks.api.getGameProfile.mockResolvedValue({ ...PROFILE, streakRepairable: true, brokenStreakDays: 5, streakRepairCost: 300 });
    const { invalidated } = renderPage();
    expect(await screen.findByText(viText.game.streakRepair.title(5))).toBeInTheDocument();
    expect(screen.getByText(viText.game.streakRepair.body)).toBeInTheDocument();
    const btn = screen.getByRole('button', { name: 'Hồi sinh (300💧)' });
    fireEvent.click(btn);
    await waitFor(() =>
      expect(mocks.openSnackbar).toHaveBeenCalledWith({ text: viText.game.streakRepair.ok, type: 'success' }),
    );
    expect(mocks.api.repairStreak).toHaveBeenCalledTimes(1);
    expect(mocks.haptic).toHaveBeenCalledWith('medium');
    const keys = invalidated();
    expect(keys).toContainEqual(['game', 'profile']);
    expect(keys).not.toContainEqual(['loyalty']);
  });

  it('cây héo/chết hiện đúng cảnh báo; khoẻ thì không có', async () => {
    const view = renderPage();
    await screen.findByText('Sồi');
    expect(screen.queryByText(viText.game.newbie.treeWilted)).not.toBeInTheDocument();
    view.unmount();

    mocks.api.getGameProfile.mockResolvedValue({ ...PROFILE, treeHealth: 'WILTED' });
    const wilted = renderPage();
    expect(await screen.findByText(viText.game.newbie.treeWilted)).toBeInTheDocument();
    wilted.unmount();

    mocks.api.getGameProfile.mockResolvedValue({ ...PROFILE, treeHealth: 'DEAD' });
    renderPage();
    // Hồ sơ cũ còn DEAD: hiện như héo, không nói chuyện mất tiến độ.
    expect(await screen.findByText(viText.game.newbie.treeWilted)).toBeInTheDocument();
    expect(document.body.textContent).not.toContain('trồng cây mới từ đầu');
  });
});

describe('GamePage — tưới cây, thu hoạch, góp quỹ trồng cây', () => {
  beforeEach(() => {
    // Đã nhận nước hôm nay: nút chính là "Tưới hết" với toàn bộ 1.250💧.
    mocks.api.getGameProfile.mockResolvedValue({ ...PROFILE, lastCheckInAt: todayIso() });
  });

  it('tưới hết: gọi waterTree(1250) một lần dù chạm lúc đang gửi, báo tiến độ, làm mới cả rừng', async () => {
    const gate = pending<unknown>();
    mocks.api.waterTree.mockReturnValue(gate.promise);
    const { invalidated } = renderPage();
    const btn = await screen.findByRole('button', { name: 'Tưới hết (1.250💧)' });
    expect(btn).toBeEnabled();
    fireEvent.click(btn);
    await waitFor(() => expect(btn).toBeDisabled());
    fireEvent.click(btn);
    expect(mocks.api.waterTree).toHaveBeenCalledTimes(1);
    expect(mocks.api.waterTree).toHaveBeenCalledWith(1250);
    await act(async () => {
      gate.resolve({ progress: 30, target: 50, harvested: false, treesPlanted: 3 });
    });
    await waitFor(() => expect(mocks.openSnackbar).toHaveBeenCalledWith({ text: 'Đã tưới · 30/50💧', type: 'success' }));
    const keys = invalidated();
    expect(keys).toContainEqual(['game']);
    expect(keys).toContainEqual(['game', 'forest']);
    expect(keys).toContainEqual(['loyalty']);
    expect(screen.queryByText('Thu hoạch thành công!')).not.toBeInTheDocument();
  });

  it('lỗi tưới cây: báo lỗi, nút bật lại', async () => {
    mocks.api.waterTree.mockRejectedValue(new Error('boom'));
    renderPage();
    const btn = await screen.findByRole('button', { name: 'Tưới hết (1.250💧)' });
    fireEvent.click(btn);
    await waitFor(() => expect(mocks.openSnackbar).toHaveBeenCalledWith(expect.objectContaining({ type: 'error' })));
    await waitFor(() => expect(btn).toBeEnabled());
  });

  it('thu hoạch: mở hộp chúc mừng với mã giảm giá, mã đóng góp quỹ và loài mới; không báo snackbar tiến độ', async () => {
    mocks.api.waterTree.mockResolvedValue({
      progress: 50,
      target: 50,
      harvested: true,
      treesPlanted: 4,
      reward: {
        coupon: 'GIAM10',
        certificate: 'CERT-77',
        species: { name: 'Lim xanh', emoji: '🌲', rarity: 'RARE', ecoFact: 'Gỗ lim rất bền.' },
      },
    });
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: 'Tưới hết (1.250💧)' }));
    expect(await screen.findByText('Thu hoạch thành công!')).toBeInTheDocument();
    expect(document.body.textContent).toContain('Tubu sẽ góp 1 cây vào quỹ trồng cây');
    expect(screen.getByText('GIAM10')).toBeInTheDocument();
    expect(screen.getByText('Mã đóng góp quỹ trồng cây')).toBeInTheDocument();
    expect(screen.getByText('CERT-77')).toBeInTheDocument();
    expect(screen.getByText('💎 Hiếm · Sưu tập mới!')).toBeInTheDocument();
    expect(screen.getByText('🌲 Lim xanh')).toBeInTheDocument();
    expect(screen.getByText('Gỗ lim rất bền.')).toBeInTheDocument();
    expect(mocks.openSnackbar).not.toHaveBeenCalledWith(expect.objectContaining({ text: expect.stringContaining('Đã tưới') }));
  });

  it('thu hoạch không có quà: không có mã giảm giá, không có nút "Dùng mã giảm giá ngay"; "Tuyệt vời!" đóng hộp', async () => {
    mocks.api.waterTree.mockResolvedValue({ progress: 50, target: 50, harvested: true, treesPlanted: 4 });
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: 'Tưới hết (1.250💧)' }));
    await screen.findByText('Thu hoạch thành công!');
    expect(screen.queryByRole('button', { name: 'Dùng mã giảm giá ngay' })).not.toBeInTheDocument();
    expect(screen.queryByText('Mã đóng góp quỹ trồng cây')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Tuyệt vời!' }));
    await waitFor(() => expect(screen.queryByText('Thu hoạch thành công!')).not.toBeInTheDocument());
  });

  it('hộp thu hoạch có mã: chạm mã để chép (thành công/thất bại), "Dùng mã giảm giá ngay" đóng hộp và sang /browse', async () => {
    mocks.api.waterTree.mockResolvedValue({ progress: 50, target: 50, harvested: true, treesPlanted: 4, reward: { coupon: 'GIAM10' } });
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: 'Tưới hết (1.250💧)' }));
    fireEvent.click(await screen.findByText('GIAM10'));
    await waitFor(() => expect(mocks.openSnackbar).toHaveBeenCalledWith({ text: 'Đã sao chép mã giảm giá', type: 'success' }));
    expect(mocks.copyText).toHaveBeenCalledWith('GIAM10');

    mocks.copyText.mockResolvedValue(false);
    fireEvent.click(screen.getByText('GIAM10'));
    await waitFor(() =>
      expect(mocks.openSnackbar).toHaveBeenCalledWith({ text: 'Không sao chép được — mã của bạn: GIAM10', type: 'info', duration: 4000 }),
    );

    fireEvent.click(screen.getByRole('button', { name: 'Dùng mã giảm giá ngay' }));
    expect(mocks.navigate).toHaveBeenLastCalledWith('/browse');
    await waitFor(() => expect(screen.queryByText('Thu hoạch thành công!')).not.toBeInTheDocument());
  });

  it('ô mã giảm giá là nút bàn phím được: Enter và Space chép mã như chạm', async () => {
    mocks.api.waterTree.mockResolvedValue({ progress: 50, target: 50, harvested: true, treesPlanted: 4, reward: { coupon: 'GIAM10' } });
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: 'Tưới hết (1.250💧)' }));
    const box = (await screen.findByText('GIAM10')).closest<HTMLElement>('[role="button"]')!;
    expect(box).toHaveAttribute('tabindex', '0');
    fireEvent.keyDown(box, { key: 'Enter' });
    await waitFor(() => expect(mocks.copyText).toHaveBeenCalledTimes(1));
    fireEvent.keyDown(box, { key: ' ' });
    await waitFor(() => expect(mocks.copyText).toHaveBeenCalledTimes(2));
    expect(mocks.copyText).toHaveBeenLastCalledWith('GIAM10');
    fireEvent.keyDown(box, { key: 'a' });
    expect(mocks.copyText).toHaveBeenCalledTimes(2);
  });

  it('góp quỹ trồng cây: nút kèm giá Điểm Xanh, gọi API 1 lần, báo mã đóng góp, làm mới quỹ + số dư điểm', async () => {
    const { invalidated } = renderPage();
    await openTab('Vườn');
    const btn = await screen.findByRole('button', { name: /Góp quỹ trồng cây \(50 điểm\)/ });
    fireEvent.click(btn);
    expect(mocks.api.buyTree).not.toHaveBeenCalled();
    fireEvent.click(await screen.findByRole('button', { name: 'Xác nhận' }));
    await waitFor(() =>
      expect(mocks.openSnackbar).toHaveBeenCalledWith({ text: 'Đã góp 1 cây vào quỹ trồng cây 🌳 (−50 điểm) · mã TUBU-9', type: 'success' }),
    );
    expect(mocks.api.buyTree).toHaveBeenCalledTimes(1);
    const keys = invalidated();
    expect(keys).toContainEqual(['game', 'forest']);
    expect(keys).toContainEqual(['loyalty']);
    expect(keys).not.toContainEqual(['coins']);
  });

  it('góp quỹ trồng cây: gửi Idempotency-Key theo hợp đồng BE (8–128 ký tự A-Za-z0-9_-) cho mỗi hộp xác nhận', async () => {
    renderPage();
    await openTab('Vườn');
    fireEvent.click(await screen.findByRole('button', { name: /Góp quỹ trồng cây/ }));
    fireEvent.click(await screen.findByRole('button', { name: 'Xác nhận' }));
    await waitFor(() => expect(mocks.api.buyTree).toHaveBeenCalledTimes(1));
    expect(mocks.api.buyTree).toHaveBeenCalledWith(expect.stringMatching(/^[A-Za-z0-9_-]{8,128}$/));
  });

  it('góp quỹ trồng cây lỗi mạng: hộp ở lại, thử lại gửi đúng key cũ; thành công thì đóng hộp, mở lại ra key mới', async () => {
    mocks.api.buyTree.mockRejectedValueOnce(new Error('Network Error'));
    renderPage();
    await openTab('Vườn');
    fireEvent.click(await screen.findByRole('button', { name: /Góp quỹ trồng cây/ }));
    fireEvent.click(await screen.findByRole('button', { name: 'Xác nhận' }));
    await waitFor(() => expect(mocks.openSnackbar).toHaveBeenCalledWith(expect.objectContaining({ type: 'error' })));
    const retry = screen.getByRole('button', { name: 'Xác nhận' });
    await waitFor(() => expect(retry).toBeEnabled());
    fireEvent.click(retry);
    await waitFor(() => expect(mocks.api.buyTree).toHaveBeenCalledTimes(2));
    const [first, second] = mocks.api.buyTree.mock.calls.map((c) => c[0]);
    expect(second).toBe(first);
    await waitFor(() =>
      expect(mocks.openSnackbar).toHaveBeenCalledWith(expect.objectContaining({ type: 'success' })),
    );
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Xác nhận' })).not.toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: /Góp quỹ trồng cây/ }));
    fireEvent.click(await screen.findByRole('button', { name: 'Xác nhận' }));
    await waitFor(() => expect(mocks.api.buyTree).toHaveBeenCalledTimes(3));
    expect(mocks.api.buyTree.mock.calls[2]![0]).not.toBe(first);
  });

  it('chú thích dưới nút góp quỹ nói rõ điểm không hết hạn chỉ bị dùng khi điểm thường không đủ (PD-3, OQ-5)', async () => {
    renderPage();
    expect(
      await screen.findByText('Góp bằng Điểm Xanh — dùng điểm thường trước, thiếu mới dùng điểm không hết hạn.'),
    ).toBeInTheDocument();
  });

  it('hồ sơ không có giá cây: nút "Góp quỹ trồng cây" không kèm giá', async () => {
    mocks.api.getGameProfile.mockResolvedValue({ ...PROFILE, treePointsPrice: undefined });
    renderPage();
    await openTab('Vườn');
    const btn = await screen.findByRole('button', { name: /Góp quỹ trồng cây/ });
    expect(btn).toHaveTextContent(/^Góp quỹ trồng cây$/);
  });
});

describe('GamePage — lô đất', () => {
  const HOME = { id: null, slot: 1, isHome: true, treeType: 'Sồi', speciesId: null, progress: 10, target: 50, treeStage: 1, treesPlanted: 3, treeHealth: 'HEALTHY' };
  const PLOT_A = { id: 'pa', slot: 2, isHome: false, treeType: 'Mận', speciesId: 's1', progress: 5, target: 20, treeStage: 1, treesPlanted: 1, treeHealth: 'WILTED' };
  const PLOT_B = { id: 'pb', slot: 3, isHome: false, treeType: 'Xoài', speciesId: 's2', progress: 20, target: 20, treeStage: 3, treesPlanted: 0, treeHealth: 'DEAD' };
  const NEXT = { slot: 4, seedCost: 1_200 };

  it('chưa tải được garden: không có khối lô đất', async () => {
    renderPage();
    await openTab('Vườn');
    await screen.findByText('Sồi');
    expect(screen.queryByText(/Lô đất của bạn/)).not.toBeInTheDocument();
  });

  it('chỉ liệt kê lô không phải lô nhà; chưa có lô thì có lời gợi ý', async () => {
    mocks.api.getGarden.mockResolvedValue({ plots: [HOME], maxPlots: 3, nextUnlock: NEXT });
    renderPage();
    await openTab('Vườn');
    expect(await screen.findByText('Lô đất của bạn (1/3)')).toBeInTheDocument();
    expect(screen.getByText(/Mở thêm lô đất để trồng nhiều cây cùng lúc/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Tưới' })).not.toBeInTheDocument();
  });

  it('thu hoạch ở lô phụ: hộp chúc mừng vẫn có nút "Chia sẻ với bạn bè" (Zalo)', async () => {
    mocks.api.getGarden.mockResolvedValue({ plots: [HOME, PLOT_A, PLOT_B], maxPlots: 4, nextUnlock: NEXT });
    mocks.api.waterPlot.mockResolvedValue({ progress: 0, target: 20, harvested: true, treesPlanted: 2, revivedFromDead: false, reward: { certificate: 'C9' } });
    renderPage();
    await openTab('Vườn');
    fireEvent.click((await screen.findAllByRole('button', { name: 'Tưới' }))[0]!);
    expect(await screen.findByText('Thu hoạch thành công!')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Chia sẻ với bạn bè' })).toBeInTheDocument();
  });

  it('mỗi lô có nút Tưới gọi waterPlot(id, 20) đúng lô; báo tiến độ lô; hiện tình trạng héo (lô DEAD cũ cũng chỉ héo)', async () => {
    mocks.api.getGarden.mockResolvedValue({ plots: [HOME, PLOT_A, PLOT_B], maxPlots: 4, nextUnlock: NEXT });
    const { container, invalidated } = renderPage();
    await openTab('Vườn');
    expect(await screen.findByText('Lô 2 · Mận')).toBeInTheDocument();
    expect(screen.getByText('Lô 3 · Xoài')).toBeInTheDocument();
    expect(screen.queryByText('Lô 1 · Sồi')).not.toBeInTheDocument();
    expect(container.textContent).toContain('5/20💧 · 🌳 1 · 🥀 héo');
    expect(container.textContent).toContain('20/20💧 · 🌳 0 · 🥀 héo');
    const buttons = screen.getAllByRole('button', { name: 'Tưới' });
    expect(buttons).toHaveLength(2);
    fireEvent.click(buttons[1]!);
    await waitFor(() => expect(mocks.api.waterPlot).toHaveBeenCalledWith('pb', 20));
    await waitFor(() => expect(mocks.openSnackbar).toHaveBeenCalledWith({ text: 'Đã tưới lô · 5/20💧', type: 'success' }));
    expect(invalidated()).toContainEqual(['game', 'forest']);
  });

  it('đang tưới một lô: chỉ nút của lô đó bị khoá', async () => {
    const gate = pending<unknown>();
    mocks.api.waterPlot.mockReturnValue(gate.promise);
    mocks.api.getGarden.mockResolvedValue({ plots: [HOME, PLOT_A, PLOT_B], maxPlots: 4, nextUnlock: NEXT });
    renderPage();
    await openTab('Vườn');
    await screen.findByText('Lô 2 · Mận');
    const [first, second] = screen.getAllByRole('button', { name: 'Tưới' });
    fireEvent.click(first!);
    await waitFor(() => expect(first).toBeDisabled());
    expect(second).toBeEnabled();
    expect(mocks.api.waterPlot).toHaveBeenCalledWith('pa', 20);
  });

  it('tưới lô đến mức thu hoạch: mở hộp chúc mừng', async () => {
    mocks.api.getGarden.mockResolvedValue({ plots: [HOME, PLOT_A], maxPlots: 4, nextUnlock: NEXT });
    mocks.api.waterPlot.mockResolvedValue({ progress: 20, target: 20, harvested: true, treesPlanted: 1, revivedFromDead: false, reward: { coupon: 'LO-5' } });
    renderPage();
    await openTab('Vườn');
    fireEvent.click(await screen.findByRole('button', { name: 'Tưới' }));
    expect(await screen.findByText('Thu hoạch thành công!')).toBeInTheDocument();
    expect(screen.getByText('LO-5')).toBeInTheDocument();
  });

  it('mở lô: chỉ còn nút giá giọt nước (xu đã gộp vào Điểm Xanh), gọi unlockPlot một lần, khoá khi đang gửi', async () => {
    const gate = pending<unknown>();
    mocks.api.unlockPlot.mockReturnValue(gate.promise);
    mocks.api.getGarden.mockResolvedValue({ plots: [HOME], maxPlots: 3, nextUnlock: NEXT });
    const { invalidated } = renderPage();
    await openTab('Vườn');
    const seeds = await screen.findByRole('button', { name: 'Mở lô (1.200💧)' });
    expect(screen.getAllByRole('button', { name: /Mở lô/ })).toHaveLength(1);
    expect(seeds).toBeEnabled();
    fireEvent.click(seeds);
    await waitFor(() => expect(seeds).toBeDisabled());
    fireEvent.click(seeds);
    expect(mocks.api.unlockPlot).toHaveBeenCalledTimes(1);
    expect(mocks.api.unlockPlot).toHaveBeenCalledWith(NEXT.slot);
    await act(async () => {
      gate.resolve({});
    });
    await waitFor(() => expect(mocks.openSnackbar).toHaveBeenCalledWith({ text: 'Đã mở lô đất mới 🪴', type: 'success' }));
    const keys = invalidated();
    expect(keys).toContainEqual(['game']);
    expect(keys).not.toContainEqual(['coins']);
  });

  it('đã đủ lô: không còn nút mở, hiện thông báo tối đa', async () => {
    mocks.api.getGarden.mockResolvedValue({ plots: [HOME, PLOT_A], maxPlots: 2, nextUnlock: null });
    renderPage();
    await openTab('Vườn');
    expect(await screen.findByText(/Bạn đã mở tối đa số lô đất/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Mở lô/ })).not.toBeInTheDocument();
  });
});

describe('GamePage — Chặng Mùa (Season Pass) đã ẩn (C-044, Q-16)', () => {
  const activePass = {
    active: true,
    seasonTitle: 'Xuân',
    xp: 150,
    premiumEligible: true,
    tiers: [
      { tier: 0, xpRequired: 100, free: { type: 'SEEDS', amount: 10 }, premium: { type: 'XU', amount: 500 }, unlocked: true, claimedFree: false, claimedPremium: false },
    ],
  };

  it('không gọi API season-pass và không dựng khối dù server trả mùa đang chạy', async () => {
    mocks.api.fetchSeasonPass.mockResolvedValue(activePass);
    renderPage();
    await openTab('Vườn');
    await screen.findByText('Sồi');
    await waitFor(() => expect(mocks.api.getSeason).toHaveBeenCalled());
    expect(mocks.api.fetchSeasonPass).not.toHaveBeenCalled();
    expect(screen.queryByText(viText.game.seasonPass.title)).not.toBeInTheDocument();
    expect(screen.queryByText(/Season Pass|Chặng Mùa/)).not.toBeInTheDocument();
  });

  it('chưa đăng nhập cũng không gọi API season-pass', async () => {
    mocks.auth.status = 'unauthenticated';
    renderPage();
    await waitFor(() => expect(mocks.api.getSeason).toHaveBeenCalled());
    expect(mocks.api.fetchSeasonPass).not.toHaveBeenCalled();
  });
});

describe('GamePage — Chặng Mùa (Season Pass) khi bật cờ SEASON_PASS_ENABLED', () => {
  beforeEach(() => {
    mocks.features.seasonPass = true;
  });

  const tiers = (over: Record<string, unknown> = {}) => [
    { tier: 0, xpRequired: 100, free: { type: 'SEEDS', amount: 10 }, premium: { type: 'XU', amount: 500 }, unlocked: true, claimedFree: false, claimedPremium: false, ...over },
    { tier: 1, xpRequired: 300, free: { type: 'SEEDS', amount: 20 }, premium: { type: 'XU', amount: 900 }, unlocked: false, claimedFree: false, claimedPremium: false },
  ];

  it('không có mùa đang chạy hoặc không có bậc: ẩn khối', async () => {
    mocks.api.fetchSeasonPass.mockResolvedValue({ active: true, seasonTitle: 'Xuân', xp: 0, premiumEligible: false, tiers: [] });
    renderPage();
    await openTab('Vườn');
    await screen.findByText('Sồi');
    expect(screen.queryByText(viText.game.seasonPass.title)).not.toBeInTheDocument();
  });

  it('hiện tiêu đề, XP hiện có / mốc cuối, gợi ý Premium khi chưa đủ điều kiện', async () => {
    mocks.api.fetchSeasonPass.mockResolvedValue({ active: true, seasonTitle: 'Xuân', xp: 150, premiumEligible: false, tiers: tiers() });
    const { container } = renderPage();
    await openTab('Vườn');
    expect(await screen.findByText(viText.game.seasonPass.title)).toBeInTheDocument();
    expect(screen.getByText(viText.game.seasonPass.subtitle('Xuân'))).toBeInTheDocument();
    expect(screen.getByText('150 điểm kinh nghiệm')).toBeInTheDocument();
    expect(screen.getAllByText('300 điểm kinh nghiệm').length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText(viText.game.seasonPass.premiumHint)).toBeInTheDocument();
    // 150/300 = 50%
    expect(container.querySelector('[style*="width: 50%"]')).not.toBeNull();
  });

  it('bậc đã mở + chưa đủ điều kiện Premium: nhánh miễn phí nhận được, Premium và bậc khoá đều tắt', async () => {
    mocks.api.fetchSeasonPass.mockResolvedValue({ active: true, seasonTitle: 'Xuân', xp: 150, premiumEligible: false, tiers: tiers() });
    renderPage();
    await openTab('Vườn');
    await screen.findByText(viText.game.seasonPass.title);
    expect(screen.getByRole('button', { name: viText.game.seasonPass.claim })).toBeEnabled();
    const locked = screen.getAllByRole('button', { name: viText.game.seasonPass.locked });
    // premium bậc 0 (chưa đủ điều kiện) + free và premium bậc 1 (chưa mở)
    expect(locked).toHaveLength(3);
    for (const b of locked) expect(b).toBeDisabled();
  });

  it('nhận nhánh miễn phí: gọi claimSeasonPass(tier, "free") một lần, báo + haptic, làm mới mùa/hồ sơ/Điểm Xanh', async () => {
    mocks.api.fetchSeasonPass.mockResolvedValue({ active: true, seasonTitle: 'Xuân', xp: 150, premiumEligible: false, tiers: tiers() });
    const { invalidated } = renderPage();
    await openTab('Vườn');
    const btn = await screen.findByRole('button', { name: viText.game.seasonPass.claim });
    fireEvent.click(btn);
    await waitFor(() =>
      expect(mocks.openSnackbar).toHaveBeenCalledWith({ text: viText.game.seasonPass.claimOk, type: 'success' }),
    );
    expect(mocks.api.claimSeasonPass).toHaveBeenCalledTimes(1);
    expect(mocks.api.claimSeasonPass).toHaveBeenCalledWith(0, 'free');
    expect(mocks.haptic).toHaveBeenCalledWith('medium');
    const keys = invalidated();
    expect(keys).toContainEqual(['game', 'seasonPass']);
    expect(keys).toContainEqual(['game', 'profile']);
    expect(keys).toContainEqual(['loyalty']);
    expect(keys).not.toContainEqual(['coins']);
  });

  it('đủ điều kiện Premium: nhánh Premium nhận được qua claimSeasonPass(tier, "premium")', async () => {
    mocks.api.fetchSeasonPass.mockResolvedValue({ active: true, seasonTitle: 'Xuân', xp: 150, premiumEligible: true, tiers: tiers() });
    renderPage();
    await openTab('Vườn');
    await screen.findByText(viText.game.seasonPass.title);
    expect(screen.queryByText(viText.game.seasonPass.premiumHint)).not.toBeInTheDocument();
    const claims = screen.getAllByRole('button', { name: viText.game.seasonPass.claim });
    expect(claims).toHaveLength(2);
    fireEvent.click(claims[1]!);
    await waitFor(() => expect(mocks.api.claimSeasonPass).toHaveBeenCalledWith(0, 'premium'));
  });

  it('phần đã nhận hiện "✓ Đã nhận" thay cho nút', async () => {
    mocks.api.fetchSeasonPass.mockResolvedValue({ active: true, seasonTitle: 'Xuân', xp: 150, premiumEligible: true, tiers: tiers({ claimedFree: true }) });
    renderPage();
    await openTab('Vườn');
    await screen.findByText(viText.game.seasonPass.title);
    expect(screen.getByText(viText.game.seasonPass.claimed)).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: viText.game.seasonPass.claim })).toHaveLength(1);
  });
});

describe('GamePage — cộng đồng, sổ tay, tặng nước, tác động xanh', () => {
  it('mục tiêu cộng đồng chỉ hiện khi có mục tiêu đang chạy', async () => {
    const view = renderPage();
    await screen.findByText('Sồi');
    expect(screen.queryByText('Mục tiêu cộng đồng')).not.toBeInTheDocument();
    view.unmount();

    mocks.api.getCommunity.mockResolvedValue({
      goal: { id: 'g1', title: 'Rừng Tubu', region: 'Hà Giang', targetDrops: 5_000, currentDrops: 1_250, treesToPlant: 100, status: 'ACTIVE' },
      myDrops: 89,
      pct: 25,
    });
    const { container } = renderPage();
    expect(await screen.findByText('Mục tiêu cộng đồng')).toBeInTheDocument();
    expect(screen.getByText('Rừng Tubu')).toBeInTheDocument();
    expect(screen.getByText('Hà Giang · mục tiêu góp quỹ trồng 100 cây')).toBeInTheDocument();
    expect(screen.getByText('1.250/5.000💧 (25%)')).toBeInTheDocument();
    expect(screen.getByText('Bạn đã góp 89💧')).toBeInTheDocument();
    expect(container.textContent).toContain('Đủ mốc, Tubu góp quỹ trồng cây');
    expect(container.querySelector('[style*="width: 25%"]')).not.toBeNull();
  });

  it('sổ tay loài cây: đếm loài đã sưu tập, loài chưa có hiện ???, loài trùng hiện ×N', async () => {
    mocks.api.getCollection.mockResolvedValue([
      { id: 'c1', name: 'Lim xanh', rarity: 'RARE', emoji: '🌲', region: null, owned: true, count: 3, story: null, ecoFact: null },
      { id: 'c2', name: 'Đào', rarity: 'COMMON', emoji: '🌸', region: null, owned: false, count: 0, story: null, ecoFact: null },
    ]);
    renderPage();
    expect(await screen.findByText('Sổ tay loài cây (1/2)')).toBeInTheDocument();
    expect(screen.getByText('Lim xanh')).toBeInTheDocument();
    expect(screen.getByText('🌲')).toBeInTheDocument();
    expect(screen.getByText('×3')).toBeInTheDocument();
    expect(screen.getByText('???')).toBeInTheDocument();
    expect(screen.getByText('❔')).toBeInTheDocument();
    expect(screen.queryByText('Đào')).not.toBeInTheDocument();
  });

  it('Mini App chỉ đọc (Zalo 4.6): có bạn bè và dữ liệu xếp hạng vẫn không hiện tặng nước, không hiện bảng xếp hạng, không gọi API tương ứng', async () => {
    mocks.api.getFriends.mockResolvedValue([{ id: 'f1', nickname: 'Lan', giftedToday: false }]);
    mocks.api.getLeaderboard.mockResolvedValue([{ rank: 1, nickname: 'Nhất', streak: 30, treesPlanted: 9 }]);
    mocks.api.getSeasonLeaderboard.mockResolvedValue([{ rank: 1, nickname: 'Lan', drops: 1_250 }]);
    renderPage();
    await screen.findByText('Sồi');
    await openTab('Vườn');
    expect(screen.queryByRole('tab', { name: 'Cộng đồng' })).not.toBeInTheDocument();
    for (const t of ['Tặng nước cho bạn bè', 'Chuỗi điểm danh dài nhất', 'Xếp hạng góp nước mùa này', 'Lan', 'Nhất']) {
      expect(screen.queryByText(t)).not.toBeInTheDocument();
    }
    expect(screen.queryByRole('button', { name: 'Tặng 💧' })).not.toBeInTheDocument();
    expect(mocks.api.getFriends).not.toHaveBeenCalled();
    expect(mocks.api.getLeaderboard).not.toHaveBeenCalled();
    expect(mocks.api.getSeasonLeaderboard).not.toHaveBeenCalled();
  });

  it('tác động xanh: số cây góp quỹ, giọt nước đã góp, không gán số CO₂ cho cây của khách; chưa góp cây nào thì hiện lời mời', async () => {
    const { container } = renderPage();
    expect(await screen.findByText('Tác động xanh của bạn')).toBeInTheDocument();
    expect(container.textContent).not.toMatch(/CO₂|kg/);
    expect(screen.getByText('Cây đã góp quỹ')).toBeInTheDocument();
    expect(screen.getByText('Giọt nước đã góp')).toBeInTheDocument();
    expect(screen.getByText('Chăm cây ảo đến khi thu hoạch để Tubu góp 1 cây vào quỹ trồng cây.')).toBeInTheDocument();
  });

  it('đóng góp của tôi: tối đa 5 mã, trạng thái từng cây, số cây còn lại', async () => {
    const trees = Array.from({ length: 7 }, (_, i) => ({
      certificateCode: `TUBU-${i + 1}`,
      treeType: 'Sồi',
      status: i === 0 ? 'PLANTED' : 'PLEDGED',
      region: null,
      pledgedAt: '',
      plantedAt: null,
    }));
    mocks.api.getForest.mockResolvedValue({ count: 7, plantedCount: 1, trees });
    const { container } = renderPage();
    expect(await screen.findByText('TUBU-1')).toBeInTheDocument();
    expect(screen.getByText('TUBU-5')).toBeInTheDocument();
    expect(screen.queryByText('TUBU-6')).not.toBeInTheDocument();
    expect(screen.getByText('Đã trồng')).toBeInTheDocument();
    expect(screen.getAllByText('Đã góp quỹ')).toHaveLength(4);
    expect(screen.getByText('…và 2 cây khác')).toBeInTheDocument();
    expect(container.textContent).toContain('Bạn đã góp 7 cây vào quỹ trồng cây của Tubu');
    expect(screen.queryByText(/Chăm cây ảo đến khi thu hoạch/)).not.toBeInTheDocument();
    // Nhánh có cây góp quỹ nhưng chưa cây nào được trồng thật: thẻ không quy đổi khí thải cho cây của khách.
    expect(container.textContent).not.toMatch(/CO₂|CO2|hấp thụ|\bkg\b/i);
  });
});

describe('GamePage — vòng quay may mắn', () => {
  it('giá vòng quay lấy từ spinCostPoints của /game/profile', async () => {
    mocks.api.getGameProfile.mockResolvedValue({ ...PROFILE, spinCostPoints: 20 });
    renderPage();
    await screen.findByTestId('wheel');
    await waitFor(() => expect(mocks.wheel.cost).toBe(20));
  });

  it('truyền giá mặc định 10.000 điểm cho vòng quay; quay gọi spin(), trả kết quả và làm mới cache', async () => {
    const { invalidated } = renderPage();
    await screen.findByTestId('wheel');
    expect(mocks.wheel.cost).toBe(10_000);
    let result: unknown;
    await act(async () => {
      result = await mocks.wheel.onSpin!();
    });
    expect(mocks.api.spin).toHaveBeenCalledTimes(1);
    expect(result).toEqual({ prize: { id: 'p1', name: 'Mã 10K', rewardType: 'COUPON', value: 10_000 } });
    const keys = invalidated();
    expect(keys).toContainEqual(['game']);
    expect(keys).toContainEqual(['loyalty']);
    expect(keys).not.toContainEqual(['coins']);
  });

  it('quay lỗi: báo lỗi và ném lại để vòng quay tự xử lý, không làm mới cache', async () => {
    mocks.api.spin.mockRejectedValue(new Error('hết giọt nước'));
    const { invalidated } = renderPage();
    await screen.findByTestId('wheel');
    await act(async () => {
      await expect(mocks.wheel.onSpin!()).rejects.toThrow('hết giọt nước');
    });
    expect(mocks.openSnackbar).toHaveBeenCalledWith(expect.objectContaining({ type: 'error' }));
    expect(invalidated()).not.toContainEqual(['game']);
  });
});

describe('GamePage — quiz Sống Xanh', () => {
  const Q1 = { id: 'q1', question: 'Cây nào hấp thụ CO2?', options: ['Đá', 'Cây', 'Gạch', 'Sắt'], category: 'cay', difficulty: 1, waterReward: 20 };
  const Q2 = { id: 'q2', question: 'Nhựa phân huỷ bao lâu?', options: ['1 ngày', '450 năm'], category: 'tai_che', difficulty: 3, waterReward: 30 };

  it('hết quiz hôm nay: hiện lời chúc hoàn thành', async () => {
    renderPage();
    expect(await screen.findByText(/Bạn đã hoàn thành câu đố hôm nay/)).toBeInTheDocument();
  });

  it('một câu: tiêu đề phân loại/độ khó, thưởng; chọn đáp án gọi answerQuiz(id, lựa chọn) và khoá mọi đáp án; chỉ làm mới hồ sơ + me', async () => {
    mocks.api.getTodayQuiz.mockResolvedValue([Q1]);
    const { container, invalidated } = renderPage();
    expect(await screen.findByText('Cây nào hấp thụ CO2?')).toBeInTheDocument();
    expect(container.textContent).toContain('🌳 Cây cối · Dễ');
    expect(container.textContent).not.toContain('Câu 1/');
    expect(screen.getByText('+20💧')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Cây' }));
    expect(await screen.findByText('Chính xác! +20💧')).toBeInTheDocument();
    expect(mocks.api.answerQuiz).toHaveBeenCalledWith('q1', 1);
    expect(screen.getByText('Bạn có biết: Cây quang hợp.')).toBeInTheDocument();
    for (const name of ['Đá', 'Cây', 'Gạch', 'Sắt']) expect(screen.getByRole('button', { name })).toBeDisabled();
    const keys = invalidated();
    expect(keys).toContainEqual(['game', 'profile']);
    expect(keys).toContainEqual(['me']);
    expect(keys).not.toContainEqual(['loyalty']);
    expect(screen.getByRole('button', { name: 'Hoàn thành' })).toBeInTheDocument();
  });

  it('đang gửi đáp án: mọi đáp án bị khoá, chạm tiếp không gọi API lần 2', async () => {
    const gate = pending<unknown>();
    mocks.api.getTodayQuiz.mockResolvedValue([Q1]);
    mocks.api.answerQuiz.mockReturnValue(gate.promise);
    renderPage();
    const opt = await screen.findByRole('button', { name: 'Cây' });
    fireEvent.click(opt);
    await waitFor(() => expect(screen.getByRole('button', { name: 'Đá' })).toBeDisabled());
    fireEvent.click(opt);
    expect(mocks.api.answerQuiz).toHaveBeenCalledTimes(1);
  });

  it('nhiều câu: đánh số Câu n/N, trả lời sai báo "Chưa đúng", "Câu tiếp theo" sang câu kế, câu cuối "Hoàn thành" kết thúc quiz', async () => {
    mocks.api.getTodayQuiz.mockResolvedValue([Q1, Q2]);
    mocks.api.answerQuiz
      .mockResolvedValueOnce({ isCorrect: false, correct: 1, waterEarned: 0, explanation: null })
      .mockResolvedValueOnce({ isCorrect: true, correct: 1, waterEarned: 30, explanation: null });
    const { container } = renderPage();
    await screen.findByText('Cây nào hấp thụ CO2?');
    expect(container.textContent).toContain('🌳 Cây cối · Dễ · Câu 1/2');
    fireEvent.click(screen.getByRole('button', { name: 'Đá' }));
    expect(await screen.findByText('Chưa đúng — cùng học nhé 🌿')).toBeInTheDocument();
    expect(screen.queryByText(/Bạn có biết/)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Câu tiếp theo' }));

    expect(await screen.findByText('Nhựa phân huỷ bao lâu?')).toBeInTheDocument();
    expect(container.textContent).toContain('♻️ Tái chế · Khó · Câu 2/2');
    expect(screen.getByText('+30💧')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '450 năm' }));
    expect(await screen.findByText('Chính xác! +30💧')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Hoàn thành' }));
    expect(await screen.findByText(/Bạn đã hoàn thành câu đố hôm nay/)).toBeInTheDocument();
    expect(mocks.api.answerQuiz).toHaveBeenNthCalledWith(1, 'q1', 0);
    expect(mocks.api.answerQuiz).toHaveBeenNthCalledWith(2, 'q2', 1);
  });

  it('lỗi gửi đáp án: báo lỗi, chưa hiện đáp án, đáp án bật lại', async () => {
    mocks.api.getTodayQuiz.mockResolvedValue([Q1]);
    mocks.api.answerQuiz.mockRejectedValue(new Error('boom'));
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: 'Cây' }));
    await waitFor(() => expect(mocks.openSnackbar).toHaveBeenCalledWith(expect.objectContaining({ type: 'error' })));
    expect(screen.queryByText(/Chính xác|Chưa đúng/)).not.toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole('button', { name: 'Cây' })).toBeEnabled());
  });

  it('phân loại lạ rơi về "Thiên nhiên"', async () => {
    mocks.api.getTodayQuiz.mockResolvedValue([{ ...Q1, category: 'khac', difficulty: 2 }]);
    const { container } = renderPage();
    await screen.findByText('Cây nào hấp thụ CO2?');
    expect(container.textContent).toContain('🌿 Thiên nhiên · Vừa');
  });
});

describe('GamePage — nhiệm vụ', () => {
  const mission = (over: Record<string, unknown>) => ({
    code: 'X',
    title: 'Nhiệm vụ X',
    rewardPoints: 50,
    progress: 0,
    goal: 3,
    completed: false,
    claimed: false,
    ...over,
  });

  it('không có nhiệm vụ: hiện "Chưa có nhiệm vụ."', async () => {
    renderPage();
    expect(await screen.findByText('Chưa có nhiệm vụ.')).toBeInTheDocument();
  });

  it('đạt điều kiện chưa nhận: có nút "Nhận thưởng" gọi claimMission(code), báo + haptic, làm mới nhiệm vụ + me + loyalty', async () => {
    mocks.api.getMissions.mockResolvedValue([mission({ code: 'REVIEW_3', title: 'Viết 3 đánh giá', progress: 3, goal: 3, completed: true })]);
    const { invalidated } = renderPage();
    const btn = await screen.findByRole('button', { name: viText.game.missions.claim });
    expect(screen.getByText('+50 Điểm Xanh')).toBeInTheDocument();
    expect(screen.getByText('3/3')).toBeInTheDocument();
    fireEvent.click(btn);
    await waitFor(() =>
      expect(mocks.openSnackbar).toHaveBeenCalledWith({ text: viText.game.missions.claimOk(50), type: 'success' }),
    );
    expect(mocks.api.claimMission).toHaveBeenCalledTimes(1);
    expect(mocks.api.claimMission).toHaveBeenCalledWith('REVIEW_3');
    expect(mocks.haptic).toHaveBeenCalledWith('medium');
    const keys = invalidated();
    expect(keys).toContainEqual(['game', 'missions']);
    expect(keys).toContainEqual(['me']);
    expect(keys).toContainEqual(['loyalty']);
  });

  it('đã nhận: có dấu tích ở tên và không còn nút; chưa đạt: hiện tiến độ và không có nút', async () => {
    mocks.api.getMissions.mockResolvedValue([
      mission({ code: 'A', title: 'Đã xong', progress: 3, goal: 3, completed: true, claimed: true }),
      mission({ code: 'B', title: 'Đang làm', progress: 1, goal: 3 }),
    ]);
    renderPage();
    expect(await screen.findByText('Đã xong')).toBeInTheDocument();
    expect(screen.getByText('Đang làm')).toBeInTheDocument();
    expect(screen.getByText('1/3')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: viText.game.missions.claim })).not.toBeInTheDocument();
  });

  it('nhiệm vụ chưa xong có nút "Làm ngay" dẫn đúng chỗ; mã lạ và nhiệm vụ đã xong không có nút', async () => {
    mocks.api.getMissions.mockResolvedValue([
      mission({ code: 'FIRST_ORDER', title: 'Đơn đầu tiên', progress: 0, goal: 1 }),
      mission({ code: 'REVIEW_3', title: 'Viết 3 đánh giá', progress: 0, goal: 3 }),
      mission({ code: 'INVITE_3', title: 'Mời 3 bạn', progress: 0, goal: 3 }),
      mission({ code: 'MYSTERY', title: 'Nhiệm vụ lạ', progress: 0, goal: 1 }),
      mission({ code: 'DONE_ONE', title: 'Đã xong', progress: 1, goal: 1, completed: true, claimed: true }),
    ]);
    renderPage();
    await screen.findByText('Đơn đầu tiên');
    expect(screen.getAllByRole('button', { name: /^Làm ngay: / })).toHaveLength(3);
    fireEvent.click(screen.getByRole('button', { name: 'Làm ngay: Đơn đầu tiên' }));
    expect(mocks.navigate).toHaveBeenLastCalledWith('/browse');
    fireEvent.click(screen.getByRole('button', { name: 'Làm ngay: Viết 3 đánh giá' }));
    expect(mocks.navigate).toHaveBeenLastCalledWith('/orders?tab=delivered');
    fireEvent.click(screen.getByRole('button', { name: 'Làm ngay: Mời 3 bạn' }));
    expect(mocks.navigate).toHaveBeenLastCalledWith('/wallet');
  });

  it('nhiệm vụ Chăm chỉ 7 ngày: "Làm ngay" cuộn tới khối điểm danh', async () => {
    mocks.api.getMissions.mockResolvedValue([mission({ code: 'CHECKIN_7', title: 'Chăm chỉ 7 ngày', progress: 0, goal: 7 })]);
    const scrollIntoView = vi.fn();
    Element.prototype.scrollIntoView = scrollIntoView;
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: 'Làm ngay: Chăm chỉ 7 ngày' }));
    await waitFor(() => expect(scrollIntoView).toHaveBeenCalled());
    expect(document.getElementById('game-checkin')).not.toBeNull();
  });

  it('thanh tiến độ nhiệm vụ có tên đọc màn hình', async () => {
    mocks.api.getMissions.mockResolvedValue([mission({ code: 'REVIEW_3', title: 'Viết 3 đánh giá', progress: 1, goal: 3 })]);
    renderPage();
    expect(await screen.findByRole('progressbar', { name: 'Viết 3 đánh giá: 1/3' })).toBeInTheDocument();
  });

  it('nhiệm vụ điểm danh 7 ngày lấy tiến độ từ chuỗi ngày của hồ sơ (tối đa bằng mục tiêu)', async () => {
    mocks.api.getMissions.mockResolvedValue([mission({ code: 'CHECKIN_7', title: 'Điểm danh 7 ngày', progress: 0, goal: 7 })]);
    renderPage();
    expect(await screen.findByText('2/7')).toBeInTheDocument();
  });

  it('mục tiêu thiếu/0 lấy mặc định theo mã; mục tiêu cấu hình bằng 1 được giữ nguyên', async () => {
    mocks.api.getMissions.mockResolvedValue([
      mission({ code: 'INVITE_3', title: 'Mời 3 bạn', progress: 1, goal: 0 }),
      mission({ code: 'LAZY', title: 'Mục tiêu 1', progress: 0, goal: 1 }),
    ]);
    renderPage();
    expect(await screen.findByText('1/3')).toBeInTheDocument();
    expect(screen.getByText('0/1')).toBeInTheDocument();
  });

  it('đạt theo tiến độ dù server chưa đánh dấu completed vẫn cho nhận', async () => {
    mocks.api.getMissions.mockResolvedValue([mission({ code: 'FIRST_ORDER', title: 'Đơn đầu tiên', progress: 1, goal: 1, completed: false })]);
    renderPage();
    expect(await screen.findByRole('button', { name: viText.game.missions.claim })).toBeEnabled();
  });
});

describe('GamePage — cảnh báo React trùng key', () => {
  it('mọi danh sách dựng từ dữ liệu đúng hình của API không phát cảnh báo key', async () => {
    mocks.features.seasonPass = true;
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    const HOME = { id: null, slot: 1, isHome: true, treeType: 'Sồi', speciesId: null, progress: 10, target: 50, treeStage: 1, treesPlanted: 3, treeHealth: 'HEALTHY' };
    const plot = (n: number) => ({ id: `p${n}`, slot: n, isHome: false, treeType: 'Mận', speciesId: null, progress: 5, target: 20, treeStage: 1, treesPlanted: 0, treeHealth: 'HEALTHY' });
    const a = mocks.api;
    a.getLeaderboard.mockResolvedValue([
      { rank: 1, nickname: 'Nhất', streak: 30, treesPlanted: 9 },
      { rank: 2, nickname: 'Nhì', streak: 20, treesPlanted: 7 },
    ]);
    a.getSeasonLeaderboard.mockResolvedValue([1, 2, 3, 4, 5].map((rank) => ({ rank, nickname: `Bạn ${rank}`, drops: 1_000 - rank })));
    a.getMissions.mockResolvedValue([1, 2, 3].map((n) => ({ code: `M${n}`, title: `Nhiệm vụ ${n}`, rewardPoints: 10, progress: 0, goal: 3, completed: false, claimed: false })));
    a.getForest.mockResolvedValue({
      count: 3,
      plantedCount: 0,
      trees: [1, 2, 3].map((n) => ({ certificateCode: `TUBU-${n}`, treeType: 'Sồi', status: 'PLEDGED', region: null, pledgedAt: '', plantedAt: null })),
    });
    a.getCollection.mockResolvedValue([1, 2].map((n) => ({ id: `c${n}`, name: `Loài ${n}`, rarity: 'COMMON', emoji: '🌳', region: null, owned: true, count: 1, story: null, ecoFact: null })));
    a.getFriends.mockResolvedValue([1, 2].map((n) => ({ id: `f${n}`, nickname: `Bạn ${n}`, giftedToday: false })));
    a.getGarden.mockResolvedValue({ plots: [HOME, plot(2), plot(3)], maxPlots: 5, nextUnlock: null });
    a.getTodayQuiz.mockResolvedValue([{ id: 'q1', question: 'Cây nào hấp thụ CO2?', options: ['Đá', 'Cây', 'Gạch'], category: 'cay', difficulty: 1, waterReward: 20 }]);
    a.fetchSeasonPass.mockResolvedValue({
      active: true,
      seasonTitle: 'Xuân',
      xp: 150,
      premiumEligible: true,
      tiers: [0, 1, 2].map((tier) => ({ tier, xpRequired: 100 * (tier + 1), free: { type: 'SEEDS', amount: 10 }, premium: { type: 'SEEDS', amount: 20 }, unlocked: tier === 0, claimedFree: false, claimedPremium: false })),
    });
    try {
      renderPage();
      await screen.findByText('Nhiệm vụ 3');
      await openTab('Vườn');
      await screen.findByText('Lô 3 · Mận');
      expect(errors.mock.calls.filter((c) => /same key|unique "key"/.test(String(c[0])))).toEqual([]);
    } finally {
      errors.mockRestore();
    }
  });
});

describe('GamePage — nút khoá trong lúc đang gửi', () => {
  const cases: { label: string; name: string | RegExp; fn: () => ReturnType<typeof vi.fn>; setup?: () => void; confirmName?: string; tab?: 'Vườn' }[] = [
    { label: 'hứng giọt sương', name: 'Hứng giọt sương', fn: () => mocks.api.collectDew },
    { label: 'mua vé giữ lửa', name: 'Mua (80💧)', fn: () => mocks.api.buyStreakFreeze },
    { label: 'góp quỹ trồng cây', name: /Góp quỹ trồng cây/, fn: () => mocks.api.buyTree, confirmName: 'Xác nhận', tab: 'Vườn' },
    {
      label: 'hồi sinh chuỗi',
      name: 'Hồi sinh (300💧)',
      fn: () => mocks.api.repairStreak,
      setup: () => mocks.api.getGameProfile.mockResolvedValue({ ...PROFILE, streakRepairable: true, brokenStreakDays: 5, streakRepairCost: 300 }),
    },
  ];
  it.each(cases)('$label: chạm lần 2 khi chưa phản hồi không gọi API lần nữa', async ({ name, fn, setup, confirmName, tab }) => {
    setup?.();
    fn().mockReturnValue(pending<unknown>().promise);
    renderPage();
    if (tab) await openTab(tab);
    const btn = await screen.findByRole('button', { name });
    fireEvent.click(btn);
    if (confirmName) fireEvent.click(await screen.findByRole('button', { name: confirmName }));
    await waitFor(() => expect(btn).toBeDisabled());
    fireEvent.click(btn);
    expect(fn()).toHaveBeenCalledTimes(1);
  });
});
