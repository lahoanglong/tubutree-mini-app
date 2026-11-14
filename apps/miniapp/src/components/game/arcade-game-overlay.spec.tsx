import { StrictMode } from 'react';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ArcadeCompleteResult } from '@tubutree/app-core/api/game';
import type { ArcadeMountOptions, ArcadeResult } from '@tubutree/app-core/arcade/arcade-canvas';
import { arcadeWaterFor } from '@tubutree/app-core/arcade/arcade-config';
import { fillCopy } from '@tubutree/app-core/shop-copy';
import { HttpError } from '../../services/http';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  phase: 'authenticated' as 'authenticated' | 'guest' | 'device',
  login: vi.fn(),
  navigate: vi.fn(),
  submit: vi.fn(),
  mount: vi.fn(),
  options: null as ArcadeMountOptions | null,
  controller: { start: vi.fn(), pause: vi.fn(), resume: vi.fn(), destroy: vi.fn(), resize: vi.fn() },
}));
vi.mock('zmp-ui', async (importOriginal) => ({ ...(await importOriginal<Record<string, unknown>>()), useNavigate: () => mocks.navigate }));
vi.mock('../../store/auth', () => {
  const state = () =>
    mocks.phase === 'authenticated'
      ? { status: 'authenticated', user: { id: 'u1', phone: '0900000001', zaloId: 'zalo-1' } }
      : mocks.phase === 'device'
        ? { status: 'authenticated', user: { id: 'g1', phone: null, zaloId: 'guest_abc' } }
        : { status: mocks.phase === 'loading' ? 'loading' : 'unauthenticated', user: null };
  return { useAuthStore: Object.assign((sel: (s: ReturnType<typeof state>) => unknown) => sel(state()), { getState: state }) };
});
vi.mock('../../hooks/use-login-notice', () => ({ useLoginWithNotice: () => mocks.login }));
vi.mock('../../services/arcade-api', () => ({
  arcadeStatusQuery: { queryKey: ['game', 'arcade'], queryFn: vi.fn() },
  submitArcadeRun: (body: unknown) => mocks.submit(body),
  submitHomeQuiz: vi.fn(),
}));
vi.mock('../../utils/haptic', () => ({ haptic: vi.fn() }));
vi.mock('@tubutree/app-core/arcade/arcade-canvas', () => ({
  mountArcade: (options: ArcadeMountOptions) => {
    mocks.options = options;
    mocks.mount(options);
    return mocks.controller;
  },
}));

import { ArcadeGameOverlay } from './arcade-game-overlay';

const dewRun = (score: number, dodgedHazards = 0): ArcadeResult => ({
  gameId: 'dew_catcher',
  score,
  durationMs: 40_000,
  stats: { score, maxCombo: 4, dewCaught: 20, dodgedHazards, heartsLeft: 2, endedBy: 'time', durationMs: 40_000 },
});
const rushRun = (score: number): ArcadeResult => ({
  gameId: 'refill_rush',
  score,
  durationMs: 45_000,
  stats: { score, correct: 6, wrong: 1, timedOut: 0, maxStreak: 4, feverCount: 0, durationMs: 45_000 },
});
const saved = (over: Partial<ArcadeCompleteResult> = {}): ArcadeCompleteResult => ({
  gameId: 'dew_catcher',
  score: 120,
  bestScore: 120,
  isNewBest: true,
  rewarded: true,
  reason: null,
  waterEarned: 8,
  pointsEarned: 2,
  totalSeeds: 300,
  used: 2,
  cap: 5,
  window: null,
  windowBonus: false,
  ...over,
});

const originalMatchMedia = window.matchMedia;
let onClose: ReturnType<typeof vi.fn>;
function mountOverlay(props: { gameId?: 'dew_catcher' | 'refill_rush'; strict?: boolean } = {}) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const tree = (
    <QueryClientProvider client={qc}>
      <ArcadeGameOverlay gameId={props.gameId ?? 'dew_catcher'} onClose={onClose} />
    </QueryClientProvider>
  );
  const utils = render(props.strict ? <StrictMode>{tree}</StrictMode> : tree);
  return { qc, tree, ...utils };
}
const overlay = () => screen.getByTestId('arcade-overlay');
const phase = () => overlay().dataset.phase;
async function ready() {
  await waitFor(() => expect(mocks.mount).toHaveBeenCalled());
  const play = screen.getByRole('button', { name: /^Chơi( thử)?$/ });
  await waitFor(() => expect(play).not.toHaveAttribute('aria-busy'));
  return play;
}
async function playToEnd(result: ArcadeResult) {
  fireEvent.click(await ready());
  act(() => mocks.options!.onEnd(result));
  await screen.findByTestId('arcade-result');
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.phase = 'authenticated';
  mocks.options = null;
  mocks.submit.mockResolvedValue(saved());
  onClose = vi.fn();
  document.body.style.overflow = '';
  window.localStorage.clear();
});
afterEach(() => {
  vi.restoreAllMocks();
  window.matchMedia = originalMatchMedia;
});

describe('ArcadeGameOverlay: dựng canvas và màn bắt đầu', () => {
  it('là hộp thoại toàn màn có tên, tiêu đề h2, canvas có nhãn đọc màn hình; mountArcade nhận đúng game, canvas và theme', async () => {
    mountOverlay();
    const dialog = screen.getByRole('dialog', { name: 'Hứng Sương Tinh Khiết' });
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(within(dialog).getByRole('heading', { level: 2, name: 'Hứng Sương Tinh Khiết' })).toBeInTheDocument();
    const canvas = screen.getByTestId('arcade-canvas');
    expect(canvas.tagName).toBe('CANVAS');
    expect(canvas).toHaveAttribute('aria-label', fillCopy('arcade.dew.aria'));
    await ready();
    expect(mocks.mount).toHaveBeenCalledTimes(1);
    const options = mocks.options!;
    expect(options.game).toBe('dew_catcher');
    expect(options.canvas).toBe(canvas);
    expect(Object.keys(options.theme).sort()).toEqual(['accent', 'bg', 'cream', 'danger', 'forest', 'ink', 'sage', 'surface']);
    expect(options.reducedMotion).toBe(false);
    expect(typeof options.raf).toBe('function');
    expect(typeof options.caf).toBe('function');
    expect(typeof options.now()).toBe('number');
  });

  it('game Phân Loại Vỏ Chai: tiêu đề, hướng dẫn và nhãn canvas của đúng game', async () => {
    mountOverlay({ gameId: 'refill_rush' });
    await ready();
    expect(mocks.options!.game).toBe('refill_rush');
    expect(screen.getByRole('heading', { level: 2, name: 'Phân Loại Vỏ Chai Thần Tốc' })).toBeInTheDocument();
    expect(within(screen.getByTestId('arcade-ready')).getByText(fillCopy('arcade.rush.how'))).toBeInTheDocument();
    expect(screen.getByTestId('arcade-canvas')).toHaveAttribute('aria-label', fillCopy('arcade.rush.aria'));
  });

  it('khách thấy "Chơi thử" kèm dòng kỷ lục lưu trên máy; người đã đăng nhập thấy "Chơi" và không có dòng đó', async () => {
    mocks.phase = 'guest';
    const guest = mountOverlay();
    await ready();
    expect(screen.getByRole('button', { name: 'Chơi thử' })).toBeInTheDocument();
    expect(within(screen.getByTestId('arcade-ready')).getByText(fillCopy('arcade.guest.demo'))).toBeInTheDocument();
    guest.unmount();
    mocks.mount.mockClear();
    mocks.phase = 'authenticated';
    mountOverlay();
    await ready();
    expect(screen.getByRole('button', { name: 'Chơi' })).toBeInTheDocument();
    expect(screen.queryByText(fillCopy('arcade.guest.demo'))).toBeNull();
  });

  it('nút Chơi báo bận cho tới khi engine nạp xong, bấm lúc đó không bắt đầu ván', async () => {
    mountOverlay();
    const play = screen.getByRole('button', { name: 'Chơi' });
    expect(play).toHaveAttribute('aria-busy', 'true');
    fireEvent.click(play);
    expect(mocks.controller.start).not.toHaveBeenCalled();
    expect(phase()).toBe('ready');
  });

  it('ưu tiên giảm chuyển động của máy được chuyển cho engine', async () => {
    window.matchMedia = vi.fn().mockReturnValue({ matches: true }) as never;
    mountOverlay();
    await ready();
    expect(mocks.options!.reducedMotion).toBe(true);
  });

  it('Strict Mode (mount, dọn, mount lại) vẫn chỉ dựng đúng một engine còn sống', async () => {
    const { unmount } = mountOverlay({ strict: true });
    await ready();
    expect(mocks.mount).toHaveBeenCalledTimes(1);
    expect(mocks.controller.destroy).not.toHaveBeenCalled();
    unmount();
    expect(mocks.controller.destroy).toHaveBeenCalledTimes(1);
  });

  it('đóng lớp phủ huỷ engine; đóng trước khi engine nạp xong thì không dựng gì', async () => {
    const early = mountOverlay();
    early.unmount();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(mocks.mount).not.toHaveBeenCalled();
    const late = mountOverlay();
    await ready();
    late.unmount();
    expect(mocks.controller.destroy).toHaveBeenCalledTimes(1);
  });
});

describe('ArcadeGameOverlay: đang chơi, tạm dừng, đóng', () => {
  it('Chơi: gọi start một lần, sang pha đang chơi; nút Tạm dừng chỉ hiện khi đang chơi', async () => {
    mountOverlay();
    expect(screen.getByLabelText('Tạm dừng').style.visibility).toBe('hidden');
    fireEvent.click(await ready());
    expect(mocks.controller.start).toHaveBeenCalledTimes(1);
    expect(phase()).toBe('playing');
    expect(screen.queryByTestId('arcade-ready')).toBeNull();
    expect(screen.getByRole('button', { name: 'Tạm dừng' }).style.visibility).toBe('visible');
  });

  it('Tạm dừng rồi Tiếp tục: gọi pause và resume đúng một lần mỗi bên', async () => {
    mountOverlay();
    fireEvent.click(await ready());
    fireEvent.click(screen.getByRole('button', { name: 'Tạm dừng' }));
    expect(mocks.controller.pause).toHaveBeenCalledTimes(1);
    expect(phase()).toBe('paused');
    const cover = screen.getByTestId('arcade-paused');
    fireEvent.click(within(cover).getByRole('button', { name: 'Tiếp tục' }));
    expect(mocks.controller.resume).toHaveBeenCalledTimes(1);
    expect(phase()).toBe('playing');
  });

  const setVisibility = (state: 'hidden' | 'visible') => {
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => state });
    document.dispatchEvent(new Event('visibilitychange'));
  };
  afterEach(() => setVisibility('visible'));

  it('tab ẩn khi đang chơi thì tự tạm dừng, quay lại thì chơi tiếp', async () => {
    mountOverlay();
    fireEvent.click(await ready());
    act(() => setVisibility('hidden'));
    expect(mocks.controller.pause).toHaveBeenCalledTimes(1);
    act(() => setVisibility('visible'));
    expect(mocks.controller.resume).toHaveBeenCalledTimes(1);
  });

  it('tạm dừng do khách bấm thì quay lại tab KHÔNG tự chạy lại; chưa chơi thì tab ẩn không làm gì', async () => {
    mountOverlay();
    await ready();
    act(() => setVisibility('hidden'));
    act(() => setVisibility('visible'));
    expect(mocks.controller.pause).not.toHaveBeenCalled();
    expect(mocks.controller.resume).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Chơi' }));
    fireEvent.click(screen.getByRole('button', { name: 'Tạm dừng' }));
    mocks.controller.pause.mockClear();
    act(() => setVisibility('hidden'));
    act(() => setVisibility('visible'));
    expect(mocks.controller.pause).not.toHaveBeenCalled();
    expect(mocks.controller.resume).not.toHaveBeenCalled();
    expect(phase()).toBe('paused');
  });

  it('Esc và nút Đóng ở thanh trên đều gọi onClose', async () => {
    mountOverlay();
    await ready();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
    fireEvent.click(within(screen.getByRole('dialog')).getAllByRole('button', { name: 'Đóng' })[0]!);
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it('khoá cuộn nền khi mở và trả lại khi đóng; trả focus về nút đã mở lớp phủ', async () => {
    document.body.style.overflow = 'auto';
    const opener = document.createElement('button');
    document.body.append(opener);
    opener.focus();
    const { unmount } = mountOverlay();
    expect(document.body.style.overflow).toBe('hidden');
    expect(document.activeElement).toBe(overlay());
    unmount();
    expect(document.body.style.overflow).toBe('auto');
    expect(document.activeElement).toBe(opener);
    opener.remove();
  });

  it('đổi cỡ vùng chơi thì engine được báo cỡ mới theo tỉ lệ điểm ảnh', async () => {
    mountOverlay();
    await ready();
    await waitFor(() => expect(mocks.controller.resize).toHaveBeenCalled());
    const [w, h, dpr] = mocks.controller.resize.mock.calls[0]!;
    expect([typeof w, typeof h, dpr]).toEqual(['number', 'number', 1]);
  });
});

describe('ArcadeGameOverlay: kết quả khi đã đăng nhập', () => {
  it('onEnd bắn hai lần chỉ gửi máy chủ đúng một lần, đúng gameId/score/durationMs; hiện thưởng và kỷ lục mới', async () => {
    mountOverlay();
    fireEvent.click(await ready());
    const run = dewRun(120);
    act(() => {
      mocks.options!.onEnd(run);
      mocks.options!.onEnd(run);
    });
    const panel = await screen.findByTestId('arcade-result');
    await within(panel).findByText(fillCopy('arcade.result.water', { n: 8 }));
    expect(mocks.submit).toHaveBeenCalledTimes(1);
    expect(mocks.submit).toHaveBeenCalledWith({ gameId: 'dew_catcher', score: 120, durationMs: 40_000 });
    expect(phase()).toBe('result');
    expect(within(panel).getByText(fillCopy('arcade.result.score', { n: 120 }))).toBeInTheDocument();
    expect(within(panel).getByText(fillCopy('arcade.result.points', { n: 2 }))).toBeInTheDocument();
    expect(within(panel).getByText(fillCopy('arcade.result.used', { n: 2, m: 5 }))).toBeInTheDocument();
    expect(within(panel).getByText(fillCopy('arcade.newBest'))).toBeInTheDocument();
    expect(within(panel).queryByRole('button', { name: /Đăng nhập/ })).toBeNull();
    expect(mocks.login).not.toHaveBeenCalled();
  });

  it('bảng kết quả là vùng aria-live polite có tiêu đề; gửi chưa xong thì có khung chờ, xong thì mất', async () => {
    let finish!: (value: ArcadeCompleteResult) => void;
    mocks.submit.mockReturnValue(new Promise<ArcadeCompleteResult>((resolve) => (finish = resolve)));
    mountOverlay();
    await playToEnd(dewRun(90));
    const panel = screen.getByTestId('arcade-result');
    expect(within(panel).getByRole('heading', { level: 3, name: fillCopy('arcade.result.title') })).toBeInTheDocument();
    expect(panel.querySelector('[aria-live="polite"]')).not.toBeNull();
    expect(screen.getByTestId('arcade-saving')).toBeInTheDocument();
    await act(async () => finish(saved({ score: 90 })));
    expect(screen.queryByTestId('arcade-saving')).toBeNull();
    expect(screen.getByTestId('arcade-rewards')).toBeInTheDocument();
  });

  it('DAILY_CAP: nói đúng câu hết lượt, không hiện Giọt nước, vẫn hiện kỷ lục và lượt đã dùng', async () => {
    mocks.submit.mockResolvedValue(saved({ rewarded: false, reason: 'DAILY_CAP', waterEarned: 0, pointsEarned: 0, used: 5, cap: 5, bestScore: 150, isNewBest: false }));
    mountOverlay();
    await playToEnd(dewRun(100));
    const panel = screen.getByTestId('arcade-result');
    expect(await within(panel).findByText(fillCopy('arcade.result.capped'))).toBeInTheDocument();
    expect(within(panel).getByText(fillCopy('arcade.result.used', { n: 5, m: 5 }))).toBeInTheDocument();
    expect(within(panel).getByText(fillCopy('arcade.best', { n: 150 }))).toBeInTheDocument();
    expect(within(panel).queryByText(/Nhận \d+ Giọt nước/)).toBeNull();
    expect(within(panel).queryByText(fillCopy('arcade.newBest'))).toBeNull();
  });

  it.each([
    ['TOO_FAST', 'arcade.result.tooFast'],
    ['NOT_REAL_USER', 'arcade.result.notReal'],
    ['DISABLED', 'arcade.result.disabled'],
  ] as const)('lý do %s: hiện đúng câu giải thích và không bịa số lượt đã dùng', async (reason, key) => {
    mocks.submit.mockResolvedValue(saved({ rewarded: false, reason, waterEarned: 0, pointsEarned: 0, used: 0, cap: 5 }));
    mountOverlay();
    await playToEnd(dewRun(100));
    expect(await within(screen.getByTestId('arcade-result')).findByText(fillCopy(key))).toBeInTheDocument();
    expect(screen.queryByText(/Đã dùng \d+\/\d+ lượt thưởng/)).toBeNull();
  });

  it('khung giờ thưởng: có thêm dòng nói rõ được thêm một lượt', async () => {
    mocks.submit.mockResolvedValue(saved({ window: 'SUONG_SOM', windowBonus: true }));
    mountOverlay();
    await playToEnd(dewRun(100));
    expect(await screen.findByText(fillCopy('arcade.result.window'))).toBeInTheDocument();
  });

  it('lỗi mạng: bảng điểm còn nguyên, báo lỗi, Thử lại gửi lại ĐÚNG ván đó một lần và hết nút khi đã lưu', async () => {
    mocks.submit.mockRejectedValueOnce(new Error('mạng'));
    mountOverlay();
    await playToEnd(dewRun(120));
    const panel = screen.getByTestId('arcade-result');
    expect(await within(panel).findByText(fillCopy('arcade.result.error'))).toBeInTheDocument();
    expect(within(panel).getByText(fillCopy('arcade.result.score', { n: 120 }))).toBeInTheDocument();
    expect(mocks.submit).toHaveBeenCalledTimes(1);
    fireEvent.click(within(panel).getByRole('button', { name: 'Thử lại' }));
    await within(panel).findByText(fillCopy('arcade.result.water', { n: 8 }));
    expect(mocks.submit).toHaveBeenCalledTimes(2);
    expect(mocks.submit.mock.calls[1]).toEqual(mocks.submit.mock.calls[0]);
    expect(within(panel).queryByRole('button', { name: 'Thử lại' })).toBeNull();
    expect(within(panel).queryByText(fillCopy('arcade.result.error'))).toBeNull();
  });

  it('hai cú chạm Thử lại cùng nhịp chỉ gửi lại MỘT lần', async () => {
    mocks.submit.mockRejectedValueOnce(new Error('mạng'));
    let finish!: (value: ArcadeCompleteResult) => void;
    mocks.submit.mockReturnValueOnce(new Promise<ArcadeCompleteResult>((resolve) => (finish = resolve)));
    mountOverlay();
    await playToEnd(dewRun(120));
    const panel = screen.getByTestId('arcade-result');
    const retry = await within(panel).findByRole('button', { name: 'Thử lại' });
    act(() => {
      retry.click();
      retry.click();
    });
    expect(mocks.submit).toHaveBeenCalledTimes(2);
    await act(async () => finish(saved()));
    expect(mocks.submit).toHaveBeenCalledTimes(2);
  });

  it('Thử lại bị lỗi tiếp thì vẫn ở bảng điểm với nút Thử lại, không văng ra ngoài', async () => {
    mocks.submit.mockRejectedValue(new Error('mạng'));
    mountOverlay();
    await playToEnd(dewRun(120));
    const panel = screen.getByTestId('arcade-result');
    await within(panel).findByText(fillCopy('arcade.result.error'));
    fireEvent.click(within(panel).getByRole('button', { name: 'Thử lại' }));
    await waitFor(() => expect(mocks.submit).toHaveBeenCalledTimes(2));
    expect(await within(panel).findByRole('button', { name: 'Thử lại' })).toBeInTheDocument();
    expect(phase()).toBe('result');
  });

  const httpError = (status: number) => new HttpError('lỗi', undefined, { status, data: { message: 'lỗi' }, headers: {} });

  it('HTTP 400 (điểm không hợp lệ): nói ván không hợp lệ, KHÔNG mời Thử lại và không gửi lại', async () => {
    mocks.submit.mockRejectedValue(httpError(400));
    mountOverlay();
    await playToEnd(dewRun(120));
    const panel = screen.getByTestId('arcade-result');
    expect(await within(panel).findByText(fillCopy('arcade.result.invalid'))).toBeInTheDocument();
    expect(within(panel).queryByRole('button', { name: 'Thử lại' })).toBeNull();
    expect(within(panel).queryByText(fillCopy('arcade.result.error'))).toBeNull();
    expect(within(panel).getByText(fillCopy('arcade.result.score', { n: 120 }))).toBeInTheDocument();
    expect(within(panel).getByRole('button', { name: 'Chơi lại' })).toBeInTheDocument();
    expect(mocks.submit).toHaveBeenCalledTimes(1);
  });

  it.each([500, 503, 429])('HTTP %i và lỗi mạng: vẫn báo "Chưa lưu được" và giữ nút Thử lại', async (status) => {
    mocks.submit.mockRejectedValue(httpError(status));
    mountOverlay();
    await playToEnd(dewRun(120));
    const panel = screen.getByTestId('arcade-result');
    expect(await within(panel).findByText(fillCopy('arcade.result.error'))).toBeInTheDocument();
    expect(within(panel).getByRole('button', { name: 'Thử lại' })).toBeInTheDocument();
    expect(within(panel).queryByText(fillCopy('arcade.result.invalid'))).toBeNull();
  });

  it('lý do LOW_SCORE: hiện câu điểm thấp chưa tính thưởng, kèm lượt đã dùng đúng như máy chủ trả', async () => {
    mocks.submit.mockResolvedValue(saved({ rewarded: false, reason: 'LOW_SCORE', waterEarned: 0, pointsEarned: 0, used: 1, cap: 4, isNewBest: false, bestScore: 200 }));
    mountOverlay();
    await playToEnd(dewRun(30));
    const panel = screen.getByTestId('arcade-result');
    expect(await within(panel).findByText(fillCopy('arcade.result.lowScore'))).toBeInTheDocument();
    expect(within(panel).getByText(fillCopy('arcade.result.used', { n: 1, m: 4 }))).toBeInTheDocument();
    expect(within(panel).queryByText(/Nhận \d+ Giọt nước/)).toBeNull();
  });

  it('trần lượt thưởng lấy từ máy chủ, không cố định 3: cap 4 và 6 hiện đúng n/m', async () => {
    for (const [used, cap] of [[3, 4], [2, 6]] as const) {
      mocks.submit.mockResolvedValue(saved({ used, cap }));
      mocks.mount.mockClear();
      const view = mountOverlay();
      await playToEnd(dewRun(120));
      expect(await screen.findByText(fillCopy('arcade.result.used', { n: used, m: cap }))).toBeInTheDocument();
      view.unmount();
    }
  });

  it('Chơi lại: start lần hai, bảng điểm cũ biến mất; ván thứ hai gửi riêng một lần (tổng hai lần, không nhân đôi)', async () => {
    mountOverlay();
    await playToEnd(dewRun(120));
    await screen.findByText(fillCopy('arcade.result.water', { n: 8 }));
    fireEvent.click(within(screen.getByTestId('arcade-result')).getByRole('button', { name: 'Chơi lại' }));
    expect(mocks.controller.start).toHaveBeenCalledTimes(2);
    expect(phase()).toBe('playing');
    expect(screen.queryByTestId('arcade-result')).toBeNull();
    act(() => mocks.options!.onEnd(dewRun(60)));
    await screen.findByTestId('arcade-result');
    await waitFor(() => expect(mocks.submit).toHaveBeenCalledTimes(2));
    expect(mocks.submit.mock.calls.map(([body]) => body.score)).toEqual([120, 60]);
  });

  it('Đóng ở bảng điểm gọi onClose', async () => {
    mountOverlay();
    await playToEnd(dewRun(120));
    fireEvent.click(within(screen.getByTestId('arcade-result')).getByRole('button', { name: 'Đóng' }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('Tip có chip sản phẩm: bấm chip đóng lớp phủ rồi đi đúng đường dẫn Mini', async () => {
    mountOverlay();
    await playToEnd(dewRun(120, 5));
    const chip = within(screen.getByTestId('arcade-result')).getByRole('button', { name: 'Xem Nước rửa chén Bồ Hòn' });
    fireEvent.click(chip);
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(mocks.navigate).toHaveBeenCalledWith(`/browse?q=${encodeURIComponent('bồ hòn')}`);
    expect(onClose.mock.invocationCallOrder[0]!).toBeLessThan(mocks.navigate.mock.invocationCallOrder[0]!);
  });

  it('game Vỏ Chai: gửi đúng gameId của game đang chơi', async () => {
    mocks.submit.mockResolvedValue(saved({ gameId: 'refill_rush', score: 80 }));
    mountOverlay({ gameId: 'refill_rush' });
    await playToEnd(rushRun(80));
    await waitFor(() => expect(mocks.submit).toHaveBeenCalledWith({ gameId: 'refill_rush', score: 80, durationMs: 45_000 }));
  });
});

describe('ArcadeGameOverlay: khách chơi thử', () => {
  beforeEach(() => {
    mocks.phase = 'guest';
  });

  it('khách chơi trọn vẹn, không gửi gì lên máy chủ; nút đăng nhập nêu đúng số Giọt nước theo điểm', async () => {
    mountOverlay();
    await playToEnd(dewRun(130));
    const panel = screen.getByTestId('arcade-result');
    const water = arcadeWaterFor('dew_catcher', 130);
    expect(within(panel).getByRole('button', { name: fillCopy('arcade.guest.login', { n: water }) })).toBeInTheDocument();
    expect(within(panel).getByText(fillCopy('arcade.guest.demo'))).toBeInTheDocument();
    expect(mocks.submit).not.toHaveBeenCalled();
    expect(within(panel).queryByText(/Nhận \d+ Giọt nước/)).toBeNull();
  });

  it('số Giọt nước ở nút đăng nhập theo bậc điểm của từng game: 5 cơ bản, 8 khá, 10 giỏi', async () => {
    const cases = [
      ['dew_catcher', dewRun(5), 5],
      ['dew_catcher', dewRun(900), 10],
      ['refill_rush', rushRun(400), 8],
    ] as const;
    for (const [gameId, run, water] of cases) {
      mocks.mount.mockClear();
      const view = mountOverlay({ gameId });
      await playToEnd(run);
      expect(arcadeWaterFor(gameId, run.score)).toBe(water);
      expect(screen.getByRole('button', { name: `Đăng nhập lưu kỷ lục & nhận ngay ${water} Giọt nước vào Vườn` })).toBeInTheDocument();
      view.unmount();
    }
  });

  it('kỷ lục của khách lưu trên máy: ván cao hơn là Kỷ lục mới, ván thấp hơn thì không', async () => {
    mountOverlay();
    await playToEnd(dewRun(100));
    expect(within(screen.getByTestId('arcade-result')).getByText(fillCopy('arcade.newBest'))).toBeInTheDocument();
    expect(window.localStorage.getItem('tubu.arcade.best.dew_catcher')).toBe('100');
    fireEvent.click(screen.getByRole('button', { name: 'Chơi lại' }));
    act(() => mocks.options!.onEnd(dewRun(40)));
    const panel = await screen.findByTestId('arcade-result');
    expect(within(panel).getByText(fillCopy('arcade.best', { n: 100 }))).toBeInTheDocument();
    expect(within(panel).queryByText(fillCopy('arcade.newBest'))).toBeNull();
    expect(window.localStorage.getItem('tubu.arcade.best.dew_catcher')).toBe('100');
  });

  it('bấm nút đăng nhập mở đăng nhập; đăng nhập xong ngay trên bảng điểm thì ván tự được gửi đúng một lần', async () => {
    const { rerender, qc } = mountOverlay();
    await playToEnd(dewRun(130));
    fireEvent.click(screen.getByRole('button', { name: /^Đăng nhập lưu kỷ lục/ }));
    expect(mocks.login).toHaveBeenCalledTimes(1);
    expect(mocks.submit).not.toHaveBeenCalled();
    mocks.phase = 'authenticated';
    const again = () => rerender(<QueryClientProvider client={qc}><ArcadeGameOverlay gameId="dew_catcher" onClose={onClose} /></QueryClientProvider>);
    again();
    await screen.findByText(fillCopy('arcade.result.water', { n: 8 }));
    expect(mocks.submit).toHaveBeenCalledTimes(1);
    expect(mocks.submit).toHaveBeenCalledWith({ gameId: 'dew_catcher', score: 130, durationMs: 40_000 });
    expect(screen.queryByRole('button', { name: /^Đăng nhập lưu kỷ lục/ })).toBeNull();
    again();
    expect(mocks.submit).toHaveBeenCalledTimes(1);
  });

  it('bộ nhớ máy bị chặn: ván vẫn kết thúc và hiện kết quả', async () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('bị chặn');
    });
    mountOverlay();
    await playToEnd(dewRun(100));
    expect(within(screen.getByTestId('arcade-result')).getByText(fillCopy('arcade.result.score', { n: 100 }))).toBeInTheDocument();
  });
});

describe('ArcadeGameOverlay: tài khoản khách theo thiết bị (guest_)', () => {
  beforeEach(() => {
    mocks.phase = 'device';
  });

  it('phiên có nhưng không phải khách thật: "Chơi thử", ván KHÔNG gửi máy chủ, kỷ lục lưu trên máy, hiện nút đăng nhập nêu số Giọt nước', async () => {
    mountOverlay();
    await ready();
    expect(screen.getByRole('button', { name: 'Chơi thử' })).toBeInTheDocument();
    expect(within(screen.getByTestId('arcade-ready')).getByText(fillCopy('arcade.guest.demo'))).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Chơi thử' }));
    act(() => mocks.options!.onEnd(dewRun(900)));
    const panel = await screen.findByTestId('arcade-result');
    expect(mocks.submit).not.toHaveBeenCalled();
    expect(window.localStorage.getItem('tubu.arcade.best.dew_catcher')).toBe('900');
    expect(within(panel).getByText(fillCopy('arcade.newBest'))).toBeInTheDocument();
    fireEvent.click(within(panel).getByRole('button', { name: 'Đăng nhập lưu kỷ lục & nhận ngay 10 Giọt nước vào Vườn' }));
    expect(mocks.login).toHaveBeenCalledTimes(1);
    expect(within(panel).queryByText(fillCopy('arcade.result.notReal'))).toBeNull();
  });

  it('đăng nhập xong thành khách thật ngay trên bảng điểm thì ván tự được gửi đúng một lần', async () => {
    const { rerender, qc } = mountOverlay();
    await playToEnd(dewRun(130));
    expect(mocks.submit).not.toHaveBeenCalled();
    mocks.phase = 'authenticated';
    rerender(
      <QueryClientProvider client={qc}>
        <ArcadeGameOverlay gameId="dew_catcher" onClose={onClose} />
      </QueryClientProvider>,
    );
    await screen.findByText(fillCopy('arcade.result.water', { n: 8 }));
    expect(mocks.submit).toHaveBeenCalledTimes(1);
  });
});

describe('ArcadeGameOverlay: giữ focus trong lớp phủ (aria-modal)', () => {
  const tab = (shiftKey = false) => fireEvent.keyDown(document.activeElement ?? document.body, { key: 'Tab', shiftKey });
  const focusables = () => {
    const root = overlay();
    return Array.from(root.querySelectorAll<HTMLElement>('button, [tabindex]:not([tabindex="-1"])')).filter((el) => el.style.visibility !== 'hidden');
  };

  it('Tab ở phần tử cuối quay về phần tử đầu, Shift+Tab ở phần tử đầu nhảy xuống cuối; nút Tạm dừng ẩn bị bỏ qua', async () => {
    mountOverlay();
    await ready();
    const items = focusables();
    expect(items.map((el) => el.getAttribute('aria-label') ?? el.textContent)).toEqual(['Đóng', fillCopy('arcade.dew.aria'), 'Chơi']);
    items[items.length - 1]!.focus();
    tab();
    expect(document.activeElement).toBe(items[0]);
    tab(true);
    expect(document.activeElement).toBe(items[items.length - 1]);
  });

  it('focus đang nằm ngoài lớp phủ thì Tab kéo về phần tử đầu, Shift+Tab về phần tử cuối', async () => {
    mountOverlay();
    await ready();
    const items = focusables();
    const outside = document.createElement('button');
    document.body.append(outside);
    outside.focus();
    tab();
    expect(document.activeElement).toBe(items[0]);
    outside.focus();
    tab(true);
    expect(document.activeElement).toBe(items[items.length - 1]);
    outside.remove();
  });

  it('khi lớp phủ vừa mở (focus ở khung) Shift+Tab nhảy xuống phần tử cuối, Tab thường để trình duyệt tự đi tiếp', async () => {
    mountOverlay();
    await ready();
    overlay().focus();
    expect(document.activeElement).toBe(overlay());
    const items = focusables();
    const notPrevented = fireEvent.keyDown(overlay(), { key: 'Tab' });
    expect(notPrevented).toBe(true);
    expect(document.activeElement).toBe(overlay());
    tab(true);
    expect(document.activeElement).toBe(items[items.length - 1]);
  });

  it('vòng Tab theo pha: đang chơi thì nút Tạm dừng hiện nên nằm trong vòng; bảng kết quả quay vòng giữa Đóng (thanh trên) và Đóng (cuối bảng)', async () => {
    mountOverlay();
    fireEvent.click(await ready());
    expect(focusables().map((el) => el.getAttribute('aria-label') ?? el.textContent)).toEqual(['Đóng', 'Tạm dừng', fillCopy('arcade.dew.aria')]);
    act(() => mocks.options!.onEnd(dewRun(120)));
    await screen.findByTestId('arcade-result');
    const items = focusables();
    const last = items[items.length - 1]!;
    expect(last).toHaveTextContent('Đóng');
    last.focus();
    tab();
    expect(document.activeElement).toBe(items[0]);
  });

  it('Esc đóng lớp phủ ở mọi pha (sẵn sàng, đang chơi, kết quả)', async () => {
    mountOverlay();
    fireEvent.click(await ready());
    fireEvent.keyDown(document.activeElement ?? document.body, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
    act(() => mocks.options!.onEnd(dewRun(120)));
    await screen.findByTestId('arcade-result');
    fireEvent.keyDown(document.activeElement ?? document.body, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it('đóng thì focus về đúng nút đã mở lớp phủ (kể cả khi mở từ nút trong trang)', async () => {
    const opener = document.createElement('button');
    opener.textContent = 'Mở game';
    document.body.append(opener);
    opener.focus();
    const { unmount } = mountOverlay();
    await ready();
    expect(document.activeElement).not.toBe(opener);
    unmount();
    expect(document.activeElement).toBe(opener);
    opener.remove();
  });
});

describe('ArcadeGameOverlay: tiếp cận được', () => {
  it('mọi nút ở mọi pha đều có tên truy cập; đúng một h2 cho cả lớp phủ', async () => {
    mountOverlay();
    const named = () => screen.getAllByRole('button', { hidden: true }).every((b) => (b.getAttribute('aria-label') ?? b.textContent ?? '').trim().length > 0);
    await ready();
    expect(named()).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Chơi' }));
    expect(named()).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Tạm dừng' }));
    expect(named()).toBe(true);
    fireEvent.click(within(screen.getByTestId('arcade-paused')).getByRole('button', { name: 'Tiếp tục' }));
    act(() => mocks.options!.onEnd(dewRun(120)));
    await screen.findByTestId('arcade-result');
    expect(named()).toBe(true);
    expect(overlay().querySelectorAll('h2')).toHaveLength(1);
  });
});
