import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ArcadeStatus } from '@tubutree/app-core/api/game';
import type { ArcadeMountOptions } from '@tubutree/app-core/arcade/arcade-canvas';
import { fillCopy } from '@tubutree/app-core/shop-copy';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  phase: 'authenticated' as 'authenticated' | 'guest' | 'loading' | 'device',
  status: vi.fn(),
  mount: vi.fn(),
  controller: { start: vi.fn(), pause: vi.fn(), resume: vi.fn(), destroy: vi.fn(), resize: vi.fn() },
}));
vi.mock('zmp-ui', async (importOriginal) => ({ ...(await importOriginal<Record<string, unknown>>()), useNavigate: () => vi.fn() }));
vi.mock('../../store/auth', () => {
  const state = () =>
    mocks.phase === 'authenticated'
      ? { status: 'authenticated', user: { id: 'u1', phone: '0900000001', zaloId: 'zalo-1' } }
      : mocks.phase === 'device'
        ? { status: 'authenticated', user: { id: 'g1', phone: null, zaloId: 'guest_abc' } }
        : { status: mocks.phase === 'loading' ? 'loading' : 'unauthenticated', user: null };
  return { useAuthStore: Object.assign((sel: (s: ReturnType<typeof state>) => unknown) => sel(state()), { getState: state }) };
});
vi.mock('../../hooks/use-login-notice', () => ({ useLoginWithNotice: () => vi.fn() }));
vi.mock('../../services/arcade-api', () => ({
  arcadeStatusQuery: { queryKey: ['game', 'arcade'], queryFn: () => mocks.status() },
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

function renderHub() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return { qc, ...render(<QueryClientProvider client={qc}><ArcadeHub /></QueryClientProvider>) };
}
const game = (id: 'dew_catcher' | 'refill_rush') => within(screen.getByTestId(`arcade-game-${id}`));
const at = (iso: string) => vi.useFakeTimers({ toFake: ['Date'], now: new Date(iso) });

beforeEach(() => {
  vi.clearAllMocks();
  mocks.phase = 'authenticated';
  mocks.status.mockResolvedValue(STATUS);
  window.localStorage.clear();
});
afterEach(() => {
  vi.useRealTimers();
});

describe('ArcadeHub: sảnh mini game', () => {
  it('có tiêu đề h2 "Mini game", danh sách đúng hai game, mỗi game một h3 và một nút Chơi có tên rõ', async () => {
    renderHub();
    expect(screen.getByRole('heading', { level: 2, name: fillCopy('arcade.hub.title') })).toBeInTheDocument();
    expect(screen.getByText(fillCopy('arcade.hub.sub'))).toBeInTheDocument();
    const items = within(screen.getByRole('list')).getAllByRole('listitem');
    expect(items).toHaveLength(2);
    expect(game('dew_catcher').getByRole('heading', { level: 3, name: 'Hứng Sương Tinh Khiết' })).toBeInTheDocument();
    expect(game('refill_rush').getByRole('heading', { level: 3, name: 'Phân Loại Vỏ Chai Thần Tốc' })).toBeInTheDocument();
    expect(game('dew_catcher').getByText(fillCopy('arcade.dew.desc'))).toBeInTheDocument();
    expect(game('refill_rush').getByText(fillCopy('arcade.rush.desc'))).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Chơi Hứng Sương Tinh Khiết' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Chơi Phân Loại Vỏ Chai Thần Tốc' })).toBeInTheDocument();
    await game('dew_catcher').findByText(fillCopy('arcade.best', { n: 240 }));
  });

  it('đã đăng nhập: kỷ lục và lượt thưởng đã dùng/trần lấy từ máy chủ; game chưa chơi chỉ có lượt', async () => {
    renderHub();
    expect(await game('dew_catcher').findByText(fillCopy('arcade.best', { n: 240 }))).toBeInTheDocument();
    expect(game('dew_catcher').getByText(fillCopy('arcade.result.used', { n: 2, m: 3 }))).toBeInTheDocument();
    expect(await game('refill_rush').findByText(fillCopy('arcade.result.used', { n: 0, m: 3 }))).toBeInTheDocument();
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
    expect(screen.queryByText(/Đã dùng \d+\/\d+ lượt thưởng/)).toBeNull();
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
    expect(screen.queryByText(/Đã dùng \d+\/\d+ lượt thưởng/)).toBeNull();
    expect(mocks.status).not.toHaveBeenCalled();
  });

  it('tài khoản khách theo thiết bị (guest_): coi như khách chơi thử, đọc kỷ lục từ máy, KHÔNG gọi máy chủ', () => {
    mocks.phase = 'device';
    window.localStorage.setItem('tubu.arcade.best.dew_catcher', '120');
    renderHub();
    expect(screen.getByRole('button', { name: 'Chơi thử Hứng Sương Tinh Khiết' })).toBeInTheDocument();
    expect(screen.getAllByText(fillCopy('arcade.guest.demo'))).toHaveLength(1);
    expect(game('dew_catcher').getByText(fillCopy('arcade.best', { n: 120 }))).toBeInTheDocument();
    expect(screen.queryByText(/Đã dùng \d+\/\d+ lượt thưởng/)).toBeNull();
    expect(mocks.status).not.toHaveBeenCalled();
  });

  it('phiên đang khôi phục: chưa gọi máy chủ và chưa coi là khách đã đăng nhập', () => {
    mocks.phase = 'loading';
    renderHub();
    expect(mocks.status).not.toHaveBeenCalled();
    expect(screen.queryByText(/Đã dùng \d+\/\d+ lượt thưởng/)).toBeNull();
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
