import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { MiniTodayResponse } from '@tubutree/shared-types';
import type { ArcadeStatus } from '@tubutree/app-core/api/game';
import type { ArcadeMountOptions } from '@tubutree/app-core/arcade/arcade-canvas';
import { gameCopy } from '@tubutree/app-core/game-mini/copy';
import { fillCopy } from '@tubutree/app-core/shop-copy';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  phase: 'authenticated' as 'authenticated' | 'guest' | 'loading' | 'device',
  status: vi.fn(),
  start: vi.fn(),
  mount: vi.fn(),
  controller: { start: vi.fn(), pause: vi.fn(), resume: vi.fn(), destroy: vi.fn(), resize: vi.fn() },
  navigate: vi.fn(),
  matcher: vi.fn(),
  play: vi.fn(),
}));
vi.mock('../../lib/smart-nav', () => ({ useSmartNavigate: () => mocks.navigate }));
vi.mock('../../utils/sfx', () => ({ sfx: { play: (cue: string) => mocks.play(cue) } }));
vi.mock('../../pages/game-album', () => ({ AlbumLine: () => <div data-testid="album-line" /> }));
vi.mock('@tubutree/app-core/game-mini/matcher-status', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  matcherStatusQuery: () => ({ queryKey: ['game', 'matcher', 'status'], queryFn: () => mocks.matcher() }),
}));
vi.mock('zmp-ui', async (importOriginal) => ({ ...(await importOriginal<Record<string, unknown>>()), useNavigate: () => vi.fn() }));
vi.mock('../../store/auth', () => {
  const state = () =>
    mocks.phase === 'authenticated'
      ? { status: 'authenticated', user: { id: 'u1', phone: '0900000001', zaloId: 'zalo-1' } }
      : mocks.phase === 'device'
        ? { status: 'authenticated', user: { id: 'g1', phone: null, zaloId: 'guest_abc' } }
        : { status: mocks.phase === 'loading' ? 'loading' : 'idle', user: null };
  return { useAuthStore: Object.assign((sel: (s: ReturnType<typeof state>) => unknown) => sel(state()), { getState: state }) };
});
vi.mock('../../hooks/use-login-notice', () => ({ useLoginWithNotice: () => vi.fn() }));
vi.mock('../../services/arcade-api', () => ({
  arcadeStatusQuery: { queryKey: ['game', 'arcade'], queryFn: () => mocks.status() },
  startArcadeRun: (gameId: unknown) => mocks.start(gameId),
  submitArcadeRun: vi.fn(),
  submitHomeQuiz: vi.fn(),
}));
vi.mock('../../utils/haptic', () => ({ haptic: vi.fn() }));
vi.mock('@tubutree/app-core/arcade/arcade-canvas', () => ({
  mountArcade: (options: ArcadeMountOptions) => {
    mocks.mount(options);
    return mocks.controller;
  },
}));

import { ArcadeHub } from './arcade-hub';

const STATUS: ArcadeStatus = {
  games: {
    dew_catcher: { bestScore: 240, plays: 3, used: 2, cap: 3 },
    refill_rush: { bestScore: 0, plays: 0, used: 0, cap: 3 },
  },
  window: null,
  windowBonus: false,
  nextWindowAt: null,
  quizClaimed: false,
};

const TODAY: MiniTodayResponse = {
  dayKey: '2026-11-28',
  games: [
    { game: 'sort', items: 10, timeLimitMs: 45_000, rewardedRoundsPerDay: 2, rewardedRoundsLeft: 2, playedToday: 0 },
    { game: 'daily_quiz', items: 3, timeLimitMs: 60_000, rewardedRoundsPerDay: 2, rewardedRoundsLeft: 1, playedToday: 1 },
  ],
  rewardEligible: true,
  noRewardReason: null,
  caps: { waterUsed: 0, waterCap: 40, pointsUsed: 0, pointsCap: 100, accountCapReached: false, pointsBudgetExhausted: false },
  dailyQuizDoneToday: false,
};

function renderHub(props: Partial<Parameters<typeof ArcadeHub>[0]> = {}) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return { qc, ...render(<QueryClientProvider client={qc}><ArcadeHub mini={null} {...props} /></QueryClientProvider>) };
}
const game = (id: 'dew_catcher' | 'refill_rush') => within(screen.getByTestId(`arcade-game-${id}`));
const at = (iso: string) => vi.useFakeTimers({ toFake: ['Date'], now: new Date(iso) });

beforeEach(() => {
  vi.clearAllMocks();
  mocks.phase = 'authenticated';
  mocks.status.mockResolvedValue(STATUS);
  mocks.start.mockResolvedValue({ runId: 'r1.dew_catcher.1.x.sig', startedAt: '2026-11-15T01:00:00.000Z', expiresAt: '2026-11-15T01:10:00.000Z' });
  mocks.matcher.mockResolvedValue({ enabled: false });
  window.localStorage.clear();
});
afterEach(() => {
  vi.useRealTimers();
});

describe('ArcadeHub: sảnh mini game', () => {
  it('có tiêu đề h2 "Mini game", danh sách đúng hai game, mỗi game một h3 chứa nút có tên rõ và dòng thưởng', async () => {
    renderHub();
    expect(screen.getByRole('heading', { level: 2, name: fillCopy('arcade.hub.title') })).toBeInTheDocument();
    expect(screen.getByText(fillCopy('arcade.hub.sub'))).toBeInTheDocument();
    const items = within(screen.getByRole('list')).getAllByRole('listitem');
    expect(items).toHaveLength(2);
    expect(game('dew_catcher').getByRole('heading', { level: 3, name: /Hứng Sương Tinh Khiết/ })).toBeInTheDocument();
    expect(game('refill_rush').getByRole('heading', { level: 3, name: /Phân Loại Vỏ Chai Thần Tốc/ })).toBeInTheDocument();
    expect(game('dew_catcher').getByText('+💧 Giọt nước')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Chơi Hứng Sương Tinh Khiết' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Chơi Phân Loại Vỏ Chai Thần Tốc' })).toBeInTheDocument();
    await game('dew_catcher').findByText(fillCopy('arcade.best', { n: 240 }));
  });

  it('đã đăng nhập: kỷ lục và lượt thưởng còn lại lấy từ máy chủ; game chưa chơi chỉ có lượt', async () => {
    renderHub();
    expect(await game('dew_catcher').findByText(fillCopy('arcade.best', { n: 240 }))).toBeInTheDocument();
    expect(game('dew_catcher').getByTestId('arcade-status-dew_catcher')).toHaveTextContent(gameCopy('row.left', { n: 1 }));
    expect(await game('refill_rush').findByText(gameCopy('row.left', { n: 3 }))).toBeInTheDocument();
    expect(game('refill_rush').queryByText(/^Kỷ lục/)).toBeNull();
    expect(mocks.status).toHaveBeenCalledTimes(1);
    expect(screen.queryByText(fillCopy('arcade.guest.demo'))).toBeNull();
  });

  it('đang tải trạng thái: khung chờ thay số liệu; máy chủ lỗi thì sảnh vẫn dùng được, không báo số bịa', async () => {
    mocks.status.mockRejectedValue(new Error('mạng'));
    renderHub();
    expect(screen.getAllByRole('button', { name: /^Chơi / })).toHaveLength(2);
    await waitFor(() => expect(mocks.status).toHaveBeenCalled());
    await waitFor(() => expect(document.querySelector('.tubu-skeleton')).toBeNull());
    expect(screen.queryByText(/Còn \d+ lượt thưởng/)).toBeNull();
    expect(screen.getByRole('button', { name: 'Chơi Hứng Sương Tinh Khiết' })).toBeEnabled();
  });

  it('khách: nút "Chơi thử", một dòng nói kỷ lục lưu trên máy, kỷ lục đọc từ máy, KHÔNG gọi máy chủ', () => {
    mocks.phase = 'guest';
    window.localStorage.setItem('tubu.arcade.best.refill_rush', '310');
    renderHub();
    expect(screen.getByRole('button', { name: 'Chơi thử Hứng Sương Tinh Khiết' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Chơi thử Phân Loại Vỏ Chai Thần Tốc' })).toBeInTheDocument();
    expect(screen.getAllByText(fillCopy('arcade.guest.demo'))).toHaveLength(1);
    expect(game('refill_rush').getByText(fillCopy('arcade.best', { n: 310 }))).toBeInTheDocument();
    expect(game('dew_catcher').queryByText(/^Kỷ lục/)).toBeNull();
    expect(screen.queryByText(/Còn \d+ lượt thưởng/)).toBeNull();
    expect(mocks.status).not.toHaveBeenCalled();
  });

  it('tài khoản khách theo thiết bị (guest_): coi như khách chơi thử, đọc kỷ lục từ máy, KHÔNG gọi máy chủ', () => {
    mocks.phase = 'device';
    window.localStorage.setItem('tubu.arcade.best.dew_catcher', '120');
    renderHub();
    expect(screen.getByRole('button', { name: 'Chơi thử Hứng Sương Tinh Khiết' })).toBeInTheDocument();
    expect(screen.getAllByText(fillCopy('arcade.guest.demo'))).toHaveLength(1);
    expect(game('dew_catcher').getByText(fillCopy('arcade.best', { n: 120 }))).toBeInTheDocument();
    expect(screen.queryByText(/Còn \d+ lượt thưởng/)).toBeNull();
    expect(mocks.status).not.toHaveBeenCalled();
  });

  it('phiên đang khôi phục: chưa gọi máy chủ và chưa coi là khách đã đăng nhập', () => {
    mocks.phase = 'loading';
    renderHub();
    expect(mocks.status).not.toHaveBeenCalled();
    expect(screen.queryByText(/Còn \d+ lượt thưởng/)).toBeNull();
  });
});

describe('ArcadeHub: Sảnh Game gom mọi game', () => {
  it('cờ game mini bật: hai game hành động VẪN hiện cùng game mini (lỗi cũ: bị ẩn), thứ tự cố định, mỗi thẻ một hình', async () => {
    renderHub({ mini: TODAY });
    const ids = within(screen.getByRole('list'))
      .getAllByRole('article')
      .map((a) => a.getAttribute('data-testid'));
    expect(ids).toEqual(['arcade-game-dew_catcher', 'arcade-game-refill_rush', 'mini-play-row-daily_quiz', 'mini-play-row-sort']);
    expect(screen.getByTestId('mini-play-status-daily_quiz')).toHaveTextContent(gameCopy('row.left', { n: 1 }));
    expect(within(screen.getByTestId('mini-play-row-sort')).getByText('+💧 · Điểm Xanh')).toBeInTheDocument();
    expect(document.querySelectorAll('.tubu-hub-art-svg')).toHaveLength(4);
    expect(await screen.findByTestId('album-line')).toBeInTheDocument();
  });

  it('chạm thẻ game mini mở màn chơi trong Mini App và kêu "pop"', () => {
    renderHub({ mini: TODAY });
    fireEvent.click(screen.getByRole('button', { name: 'Chơi Đúng Thùng' }));
    expect(mocks.navigate).toHaveBeenCalledWith('/game/play/sort');
    expect(mocks.play).toHaveBeenCalledWith('pop');
  });

  it('Chọn Chuẩn Xanh khi cờ bật; Vòng quay cuộn tới khối vòng quay cùng tab', async () => {
    mocks.matcher.mockResolvedValue({ enabled: true });
    const anchor = document.createElement('div');
    anchor.id = 'game-wheel';
    anchor.scrollIntoView = vi.fn();
    document.body.appendChild(anchor);
    renderHub({ mini: TODAY, wheel: { cost: 10_000, anchorId: 'game-wheel' } });
    fireEvent.click(await screen.findByRole('button', { name: 'Mở Chọn Chuẩn Xanh' }));
    expect(mocks.navigate).toHaveBeenCalledWith('/game/matcher?from=play_today');
    expect(within(screen.getByTestId('hub-card-wheel')).getByText('10.000 Điểm Xanh mỗi lượt')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Quay Vòng Quay May Mắn' }));
    expect(anchor.scrollIntoView).toHaveBeenCalled();
    anchor.remove();
  });

  it('không có game mini thì không hỏi cờ Chọn Chuẩn Xanh và không có dòng Sổ tay', () => {
    renderHub();
    expect(mocks.matcher).not.toHaveBeenCalled();
    expect(screen.queryByTestId('album-line')).toBeNull();
  });

  it('trong khung giờ thưởng, hai game hành động mang huy hiệu "Giờ thưởng"', () => {
    at('2026-11-14T00:00:00Z');
    renderHub({ mini: TODAY });
    expect(screen.getAllByText('Giờ thưởng')).toHaveLength(2);
    expect(within(screen.getByTestId('mini-play-row-sort')).queryByText('Giờ thưởng')).toBeNull();
  });
});

describe('ArcadeHub: huy hiệu khung giờ thưởng', () => {
  it('trong Khung Giờ Sương Sớm (07:00 giờ VN): huy hiệu bật và nói đang là khung nào', async () => {
    at('2026-11-14T00:00:00Z');
    renderHub();
    const badge = screen.getByTestId('arcade-window-badge');
    expect(badge).toHaveAttribute('data-active', 'true');
    expect(within(badge).getByText(fillCopy('arcade.badge.label'))).toBeInTheDocument();
    expect(within(badge).getByText(fillCopy('arcade.badge.active.SUONG_SOM'))).toBeInTheDocument();
    expect(badge).toHaveAttribute('role', 'note');
  });

  it('trong Mưa Rào Tối (21:00 giờ VN)', () => {
    at('2026-11-14T14:00:00Z');
    renderHub();
    expect(screen.getByTestId('arcade-window-badge')).toHaveAttribute('data-active', 'true');
    expect(screen.getByText(fillCopy('arcade.badge.active.MUA_RAO'))).toBeInTheDocument();
  });

  it('ngoài khung (12:00 giờ VN): huy hiệu tắt và nói khung kế tiếp', () => {
    at('2026-11-14T05:00:00Z');
    renderHub();
    expect(screen.getByTestId('arcade-window-badge')).toHaveAttribute('data-active', 'false');
    expect(screen.getByText(fillCopy('arcade.badge.next.MUA_RAO'))).toBeInTheDocument();
  });

  it('sau 22:00 giờ VN khung kế tiếp là Sương Sớm hôm sau', () => {
    at('2026-11-14T16:00:00Z');
    renderHub();
    expect(screen.getByText(fillCopy('arcade.badge.next.SUONG_SOM'))).toBeInTheDocument();
  });

  it('sang khung mới khi đang xem thì huy hiệu đổi theo nhịp phút', () => {
    vi.useFakeTimers({ toFake: ['Date', 'setInterval', 'clearInterval'], now: new Date('2026-11-13T23:29:30Z') });
    renderHub();
    expect(screen.getByTestId('arcade-window-badge')).toHaveAttribute('data-active', 'false');
    expect(screen.getByText(fillCopy('arcade.badge.next.SUONG_SOM'))).toBeInTheDocument();
    act(() => {
      vi.advanceTimersByTime(60_000);
    });
    expect(screen.getByTestId('arcade-window-badge')).toHaveAttribute('data-active', 'true');
    expect(screen.getByText(fillCopy('arcade.badge.active.SUONG_SOM'))).toBeInTheDocument();
  });
});

describe('ArcadeHub: mở và đóng lớp phủ', () => {
  it('chạm Chơi mở lớp phủ của ĐÚNG game ngay trong trang (không đổi route), nạp engine với game đó', async () => {
    renderHub();
    expect(screen.queryByTestId('arcade-overlay')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Chơi Phân Loại Vỏ Chai Thần Tốc' }));
    const dialog = await screen.findByRole('dialog', { name: 'Phân Loại Vỏ Chai Thần Tốc' });
    expect(dialog.parentElement).toBe(document.body);
    await waitFor(() => expect(mocks.mount).toHaveBeenCalledTimes(1));
    expect(mocks.mount.mock.calls[0]![0].game).toBe('refill_rush');
  });

  it('bấm Chơi trong lớp phủ xin mã ván cho đúng game đã mở từ sảnh', async () => {
    renderHub();
    expect(mocks.start).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Chơi Phân Loại Vỏ Chai Thần Tốc' }));
    const ready = await screen.findByTestId('arcade-ready');
    await waitFor(() => expect(mocks.mount).toHaveBeenCalledTimes(1));
    const play = within(ready).getByRole('button', { name: 'Chơi' });
    await waitFor(() => expect(play).not.toHaveAttribute('aria-busy'));
    fireEvent.click(play);
    expect(mocks.start).toHaveBeenCalledTimes(1);
    expect(mocks.start).toHaveBeenCalledWith('refill_rush');
    expect(mocks.controller.start).toHaveBeenCalledTimes(1);
  });

  it('Đóng trả về sảnh, huỷ engine; mở game khác thì dựng engine mới cho game đó', async () => {
    renderHub();
    fireEvent.click(screen.getByRole('button', { name: 'Chơi Hứng Sương Tinh Khiết' }));
    const dialog = await screen.findByRole('dialog');
    await waitFor(() => expect(mocks.mount).toHaveBeenCalledTimes(1));
    fireEvent.click(within(dialog).getByRole('button', { name: 'Đóng' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(mocks.controller.destroy).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId('arcade-hub')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Chơi Phân Loại Vỏ Chai Thần Tốc' }));
    await screen.findByRole('dialog', { name: 'Phân Loại Vỏ Chai Thần Tốc' });
    await waitFor(() => expect(mocks.mount).toHaveBeenCalledTimes(2));
    expect(mocks.mount.mock.calls[1]![0].game).toBe('refill_rush');
  });

  it('khách mở lớp phủ thấy "Chơi thử"; nút mở sảnh lấy lại focus khi đóng', async () => {
    mocks.phase = 'guest';
    renderHub();
    const opener = screen.getByRole('button', { name: 'Chơi thử Hứng Sương Tinh Khiết' });
    opener.focus();
    fireEvent.click(opener);
    await screen.findByRole('dialog');
    await waitFor(() => expect(mocks.mount).toHaveBeenCalled());
    expect(within(screen.getByTestId('arcade-ready')).getByRole('button', { name: 'Chơi thử' })).toBeInTheDocument();
    fireEvent.keyDown(document, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(document.activeElement).toBe(opener);
  });
});
