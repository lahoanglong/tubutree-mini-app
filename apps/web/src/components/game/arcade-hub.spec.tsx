// @vitest-environment jsdom
import { act, StrictMode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ArcadeCompleteResult, ArcadeStatus } from '@tubutree/app-core/api/game';
import { fillCopy } from '@tubutree/app-core/shop-copy';
import { ApiError } from '@/lib/client-api';
import type { ArcadeMountOptions } from '@tubutree/app-core/arcade/arcade-canvas';
import { click, flush, render, type Rendered } from '@/test-utils/dom';
import { headingLevels, smallTouchTargets, unnamedControls } from '@/test-utils/a11y';

const m = vi.hoisted(() => ({
  phase: 'authenticated' as string,
  get: vi.fn(),
  post: vi.fn(),
  start: vi.fn(),
  opts: null as ArcadeMountOptions | null,
  ctl: { start: vi.fn(), pause: vi.fn(), resume: vi.fn(), destroy: vi.fn(), resize: vi.fn() },
}));

vi.mock('@/lib/auth-phase', () => ({ useAuthPhase: () => m.phase }));
// `arcade-start` (xin mã ván lúc bấm Chơi) tách khỏi `arcade-complete`: ca đếm lần lưu ván chỉ nhìn `m.post`.
vi.mock('@/lib/core-http', () => ({
  coreHttp: {
    get: (...a: unknown[]) => m.get(...a),
    post: (...a: unknown[]) => (a[0] === '/game/arcade-start' ? m.start(...a) : m.post(...a)),
  },
}));
vi.mock('@tubutree/app-core/arcade/arcade-canvas', () => ({
  mountArcade: (o: ArcadeMountOptions) => {
    m.opts = o;
    return m.ctl;
  },
}));

import { ArcadeHub } from './arcade-hub';
import { ARCADE_PENDING_KEY } from './arcade-pending';

const STATUS: ArcadeStatus = {
  games: {
    dew_catcher: { bestScore: 520, plays: 4, used: 1, cap: 3 },
    refill_rush: { bestScore: 0, plays: 0, used: 0, cap: 3 },
  },
  window: null,
  windowBonus: false,
  nextWindowAt: null,
  quizClaimed: false,
};

let mounted: Rendered | null = null;
const q = (sel: string) => document.querySelector<HTMLElement>(sel);
const card = (id: string) => q(`[data-testid="arcade-card-${id}"]`)!;
const playButton = (label: string) => document.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`)!;
const hubText = () => q('[data-testid="arcade-hub"]')!.textContent ?? '';

async function mountHub() {
  mounted = render(<ArcadeHub />);
  await flush(4);
}

beforeEach(() => {
  m.phase = 'authenticated';
  m.opts = null;
  Object.values(m.ctl).forEach((f) => f.mockReset());
  m.get.mockReset().mockResolvedValue(STATUS);
  m.post.mockReset();
  m.start.mockReset().mockResolvedValue({ runId: 'r1.dew_catcher.1.n.sig', startedAt: '2026-11-15T10:00:00.000Z', expiresAt: '2026-11-15T10:10:00.000Z' });
  localStorage.clear();
  window.history.pushState({}, '', '/vuon-xanh');
});
afterEach(() => {
  mounted?.unmount();
  mounted = null;
  vi.restoreAllMocks();
  vi.useRealTimers();
  document.body.style.overflow = '';
  document.body.innerHTML = '';
});

describe('ArcadeHub: đã đăng nhập', () => {
  it('hai thẻ game có tên, mô tả một dòng, kỷ lục và số lượt dùng lấy từ /game/arcade/status (gọi đúng một lần)', async () => {
    await mountHub();
    expect(m.get).toHaveBeenCalledTimes(1);
    expect(m.get.mock.calls[0]![0]).toBe('/game/arcade/status');
    const dew = card('dew_catcher').textContent!;
    expect(dew).toContain('Hứng Sương Tinh Khiết');
    expect(dew).toContain('Kéo chiếc lá hứng sương, né hoá chất. 40 giây.');
    expect(dew).toContain('Kỷ lục 520');
    expect(q('[data-testid="arcade-used-dew_catcher"]')!.textContent).toBe('Đã dùng 1/3 lượt thưởng hôm nay');
    const rush = card('refill_rush').textContent!;
    expect(rush).toContain('Phân Loại Vỏ Chai Thần Tốc');
    expect(rush).not.toContain('Kỷ lục');
    expect(q('[data-testid="arcade-used-refill_rush"]')!.textContent).toBe('Đã dùng 0/3 lượt thưởng hôm nay');
    expect(hubText()).not.toContain('chơi thử');
  });

  it('hết lượt: hiện số lượt đã dùng bằng cap, nút Chơi vẫn dùng được (còn phá kỷ lục)', async () => {
    m.get.mockResolvedValue({ ...STATUS, games: { ...STATUS.games, dew_catcher: { bestScore: 700, plays: 9, used: 3, cap: 3 } } });
    await mountHub();
    expect(q('[data-testid="arcade-used-dew_catcher"]')!.textContent).toBe('Đã dùng 3/3 lượt thưởng hôm nay');
    expect(playButton('Chơi Hứng Sương Tinh Khiết').disabled).toBe(false);
  });

  it('khung giờ thưởng có +1 lượt: cap 4 hiện đúng 4', async () => {
    m.get.mockResolvedValue({ ...STATUS, windowBonus: true, games: { ...STATUS.games, refill_rush: { bestScore: 0, plays: 2, used: 2, cap: 4 } } });
    await mountHub();
    expect(q('[data-testid="arcade-used-refill_rush"]')!.textContent).toBe('Đã dùng 2/4 lượt thưởng hôm nay');
  });

  it('trạng thái chưa về: chưa có dòng số lượt, nhưng hai nút Chơi đã bấm được', async () => {
    m.get.mockReturnValue(new Promise(() => undefined));
    await mountHub();
    expect(q('[data-testid="arcade-used-dew_catcher"]')).toBeNull();
    expect(playButton('Chơi Hứng Sương Tinh Khiết')).toBeTruthy();
    expect(playButton('Chơi Phân Loại Vỏ Chai Thần Tốc')).toBeTruthy();
  });

  it('trạng thái lỗi mạng: hub vẫn dựng, không ném lỗi, không dòng số lượt', async () => {
    m.get.mockRejectedValue(new Error('mất mạng'));
    await mountHub();
    expect(card('dew_catcher')).toBeTruthy();
    expect(q('[data-testid="arcade-used-dew_catcher"]')).toBeNull();
  });
});

describe('ArcadeHub: khách', () => {
  beforeEach(() => {
    m.phase = 'guest';
  });

  it('không gọi máy chủ; nút là "Chơi thử"; có dòng nói kỷ lục lưu trên máy', async () => {
    await mountHub();
    expect(m.get).not.toHaveBeenCalled();
    expect(playButton('Chơi thử Hứng Sương Tinh Khiết').textContent).toBe('Chơi thử');
    expect(playButton('Chơi thử Phân Loại Vỏ Chai Thần Tốc')).toBeTruthy();
    expect(hubText()).toContain('Bạn đang chơi thử, kỷ lục lưu trên máy này');
    expect(q('[data-testid="arcade-used-dew_catcher"]')).toBeNull();
  });

  it('kỷ lục khách đọc từ localStorage sau khi mount', async () => {
    localStorage.setItem('tubu.arcade.best.dew_catcher', '310');
    await mountHub();
    expect(card('dew_catcher').textContent).toContain('Kỷ lục 310');
    expect(card('refill_rush').textContent).not.toContain('Kỷ lục');
  });

  it('localStorage hỏng: hub vẫn dựng', async () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('chặn');
    });
    await mountHub();
    expect(card('dew_catcher')).toBeTruthy();
    expect(hubText()).not.toContain('Kỷ lục');
  });

  it('chơi một ván trong lớp phủ rồi đóng: kỷ lục mới hiện ngay ở thẻ, chỉ xin mã ván và không lưu gì lên máy chủ', async () => {
    await mountHub();
    click(playButton('Chơi thử Hứng Sương Tinh Khiết'));
    await flush(4);
    click(Array.from(document.querySelectorAll<HTMLButtonElement>('[data-testid="arcade-ready"] button')).find((b) => b.textContent === 'Chơi thử')!);
    await act(async () => m.opts!.onEnd({ gameId: 'dew_catcher', score: 480, durationMs: 40_000, stats: { score: 480, maxCombo: 2, dewCaught: 18, dodgedHazards: 1, heartsLeft: 3, endedBy: 'time', durationMs: 40_000 } }));
    await flush(2);
    click(Array.from(document.querySelectorAll<HTMLButtonElement>('[data-testid="arcade-result"] button')).find((b) => b.textContent === 'Đóng')!);
    await flush(2);
    expect(q('[role="dialog"]')).toBeNull();
    expect(card('dew_catcher').textContent).toContain('Kỷ lục 480');
    expect(m.start).toHaveBeenCalledTimes(1);
    expect(m.start.mock.calls[0]!.slice(0, 2)).toEqual(['/game/arcade-start', { gameId: 'dew_catcher' }]);
    expect(m.post).not.toHaveBeenCalled();
    expect(m.get).not.toHaveBeenCalled();
  });
});

describe('ArcadeHub: mở và đóng lớp phủ', () => {
  it('bấm Chơi mở đúng game; chưa bấm thì không có lớp phủ và bộ vẽ chưa nạp', async () => {
    await mountHub();
    expect(q('[role="dialog"]')).toBeNull();
    expect(m.opts).toBeNull();
    click(playButton('Chơi Phân Loại Vỏ Chai Thần Tốc'));
    await flush(4);
    expect(q('[role="dialog"]')).not.toBeNull();
    expect(m.opts!.game).toBe('refill_rush');
    expect(q('[data-testid="arcade-canvas"]')).not.toBeNull();
  });

  it('Esc đóng lớp phủ, huỷ bộ vẽ và trả focus về nút Chơi vừa bấm', async () => {
    await mountHub();
    const opener = playButton('Chơi Hứng Sương Tinh Khiết');
    opener.focus();
    click(opener);
    await flush(4);
    expect(document.activeElement).not.toBe(opener);
    act(() => void document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })));
    await flush(2);
    expect(q('[role="dialog"]')).toBeNull();
    expect(m.ctl.destroy).toHaveBeenCalledTimes(1);
    expect(document.activeElement).toBe(opener);
    expect(document.body.style.overflow).toBe('');
  });

  it('mở game khác sau khi đóng: bộ vẽ mới gắn đúng game đó', async () => {
    await mountHub();
    click(playButton('Chơi Hứng Sương Tinh Khiết'));
    await flush(4);
    act(() => void document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })));
    await flush(2);
    click(playButton('Chơi Phân Loại Vỏ Chai Thần Tốc'));
    await flush(4);
    expect(m.opts!.game).toBe('refill_rush');
  });
});

describe('ArcadeHub: huy hiệu khung giờ thưởng', () => {
  const at = (iso: string) => vi.useFakeTimers({ toFake: ['Date', 'setInterval', 'clearInterval'], now: new Date(iso) });
  const badge = () => q('[data-testid="arcade-badge"]')!;

  it('trong Sương Sớm (08:30 giờ VN): tô nổi, nói đang là khung', async () => {
    at('2026-11-15T01:30:00Z');
    await mountHub();
    expect(badge().dataset.active).toBe('SUONG_SOM');
    expect(badge().textContent).toContain('Đang là Khung Giờ Sương Sớm: hôm nay bạn có thêm 1 lượt thưởng Game');
  });

  it('ngoài khung (10:00 giờ VN): báo khung kế là Mưa Rào Tối từ 20:00, không tô nổi', async () => {
    at('2026-11-15T03:00:00Z');
    await mountHub();
    expect(badge().dataset.active).toBeUndefined();
    expect(badge().textContent).toContain('Khung tiếp theo: Mưa Rào Tối từ 20:00');
    expect(badge().textContent).toContain('Sương Sớm (06:30–09:00)');
    expect(badge().textContent).toContain('Mưa Rào Tối (20:00–22:00)');
  });

  it('qua 09:00 giờ VN mà không tải lại: huy hiệu tự đổi sau một phút', async () => {
    at('2026-11-15T01:59:30Z');
    await mountHub();
    expect(badge().dataset.active).toBe('SUONG_SOM');
    act(() => void vi.advanceTimersByTime(60_000));
    expect(badge().dataset.active).toBeUndefined();
    expect(badge().textContent).toContain('Khung tiếp theo: Mưa Rào Tối từ 20:00');
  });

  it('gỡ bộ đếm phút khi rời trang', async () => {
    at('2026-11-15T03:00:00Z');
    await mountHub();
    mounted!.unmount();
    mounted = null;
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe('ArcadeHub: bố cục giống Mini', () => {
  const at = (iso: string) => vi.useFakeTimers({ toFake: ['Date', 'setInterval', 'clearInterval'], now: new Date(iso) });

  it('huy hiệu khung giờ: nền dịu khi không có khung, nền xanh nhạt kèm viền trong khi đang chạy (cùng token với Mini), không còn nền cam', async () => {
    at('2026-11-15T03:00:00Z');
    await mountHub();
    const idle = q('[data-testid="arcade-badge"]')!;
    expect(idle.className).toContain('--color-bg-subtle');
    expect(idle.className).not.toContain('--color-action-secondary-bg');
    mounted!.unmount();
    mounted = null;
    vi.useRealTimers();
    at('2026-11-15T01:30:00Z');
    await mountHub();
    const active = q('[data-testid="arcade-badge"]')!;
    expect(active.className).toContain('bg-[var(--color-action-secondary-bg)]');
    expect(active.className).toContain('--color-action-secondary-border');
    expect(active.className).not.toMatch(/promo/);
    expect(active.getAttribute('role')).toBe('note');
    expect(active.innerHTML).not.toMatch(/promo/);
  });

  it('lưới game: từ chỗ đủ rộng hai thẻ đứng cạnh nhau (cột tự chia, mỗi thẻ tối thiểu 18rem), hẹp thì một cột; không dùng max-md', async () => {
    await mountHub();
    const list = card('dew_catcher').parentElement!;
    expect(list.className).toContain('grid');
    expect(list.className).toContain('grid-cols-[repeat(auto-fit,minmax(min(100%,18rem),1fr))]');
    expect(list.className).not.toContain('max-md:');
    expect(Array.from(list.children).map((c) => (c as HTMLElement).dataset.testid)).toEqual(['arcade-card-dew_catcher', 'arcade-card-refill_rush']);
  });

  it('thẻ game kiểu Mini: chữ bên trái, nút Chơi bên phải cùng hàng (không rơi xuống dưới), thẻ viền trắng để nút nổi rõ', async () => {
    m.phase = 'guest';
    await mountHub();
    const row = card('dew_catcher').querySelector('button')!.parentElement!;
    expect(row.className).toContain('flex');
    expect(row.className).toContain('items-center');
    const [text, btn] = Array.from(row.children) as HTMLElement[];
    expect(text!.className).toContain('flex-1');
    expect(text!.className).toContain('min-w-0');
    expect(btn!.tagName).toBe('BUTTON');
    expect(btn!.className).toContain('flex-none');
    expect(btn!.className).toContain('zaui-btn');
  });
});

describe('ArcadeHub: trợ năng', () => {
  it.each(['authenticated', 'guest'])('(%s) nút có tên tiếng Việt, vùng chạm 44px, heading h2 rồi hai h3', async (phase) => {
    m.phase = phase;
    await mountHub();
    expect(unnamedControls(mounted!.container)).toEqual([]);
    expect(smallTouchTargets(mounted!.container)).toEqual([]);
    expect(headingLevels(mounted!.container)).toEqual([2, 3, 3]);
  });

  it('hai nút Chơi có tên khác nhau (người đọc màn hình phân biệt được)', async () => {
    await mountHub();
    const names = Array.from(document.querySelectorAll('button')).map((b) => b.getAttribute('aria-label'));
    expect(new Set(names).size).toBe(names.length);
  });
});

const SAVED = (over: Partial<ArcadeCompleteResult> = {}): ArcadeCompleteResult => ({
  gameId: 'dew_catcher', score: 520, bestScore: 520, isNewBest: true, rewarded: true, reason: null, waterEarned: 8, pointsEarned: 1, totalSeeds: 40,
  used: 2, cap: 4, window: null, windowBonus: false, ...over,
});
const RUN = { gameId: 'dew_catcher', score: 520, durationMs: 40_000, runId: 'r1.dew_catcher.1700000000000.nonce.sig' };
// Mã cấp lúc bấm Chơi (khoảng 100 giây trước), hết hạn 10 phút sau lúc CẤP: ván xong 60 giây trước còn gần 8 phút.
const putPending = (over: Record<string, unknown> = {}) => sessionStorage.setItem(ARCADE_PENDING_KEY, JSON.stringify({ ...RUN, endedAt: Date.now() - 60_000, expiresAt: Date.now() + 8 * 60_000, ...over }));
const pendingRaw = () => sessionStorage.getItem(ARCADE_PENDING_KEY);
const completes = () => m.post.mock.calls.filter((c) => c[0] === '/game/arcade-complete');
const retryBtn = () => Array.from(document.querySelectorAll<HTMLButtonElement>('[data-testid="arcade-pending-error"] button')).find((b) => b.textContent === 'Thử lại') ?? null;

describe('ArcadeHub: gửi nốt ván khách chơi trước khi đăng nhập', () => {
  beforeEach(() => {
    sessionStorage.clear();
    m.post.mockResolvedValue(SAVED());
  });

  it('đã đăng nhập và có ván chờ: gửi đúng MỘT lần với gameId, điểm, thời lượng; xoá khoá; dải báo điểm và phần thưởng', async () => {
    putPending();
    await mountHub();
    expect(completes()).toHaveLength(1);
    expect(completes()[0]!.slice(0, 2)).toEqual(['/game/arcade-complete', RUN]);
    expect(pendingRaw()).toBeNull();
    const banner = q('[data-testid="arcade-pending-saved"]')!;
    expect(banner.textContent).toContain('Đã lưu ván vừa chơi: 520 điểm');
    expect(banner.textContent).toContain('Nhận 8 Giọt nước vào Vườn');
    expect(banner.textContent).toContain('+1 Điểm Xanh');
    expect(banner.textContent).toContain('Đã dùng 2/4 lượt thưởng hôm nay');
    expect(banner.getAttribute('role')).toBe('status');
  });

  it('làm mới game, me, loyalty sau khi gửi', async () => {
    const spy = vi.spyOn(QueryClient.prototype, 'invalidateQueries');
    putPending();
    await mountHub();
    expect(spy.mock.calls.map((c) => JSON.stringify(c[0]?.queryKey))).toEqual(expect.arrayContaining(['["game"]', '["me"]', '["loyalty"]']));
  });

  it('Strict Mode (hiệu ứng chạy hai lần): vẫn đúng một lần gửi', async () => {
    putPending();
    mounted = render(
      <StrictMode>
        <ArcadeHub />
      </StrictMode>,
    );
    await flush(5);
    expect(completes()).toHaveLength(1);
    expect(q('[data-testid="arcade-pending-saved"]')).not.toBeNull();
  });

  it('vào lại sảnh sau khi đã gửi: không gửi lần hai (khoá đã xoá)', async () => {
    putPending();
    await mountHub();
    mounted!.unmount();
    mounted = null;
    await mountHub();
    expect(completes()).toHaveLength(1);
    expect(q('[data-testid="arcade-pending-saved"]')).toBeNull();
  });

  it('hai sảnh dựng cùng lúc cũng chỉ gửi một lần', async () => {
    putPending();
    mounted = render(
      <>
        <ArcadeHub />
        <ArcadeHub />
      </>,
    );
    await flush(5);
    expect(completes()).toHaveLength(1);
  });

  it('ván quá 10 phút: bỏ và xoá, không gửi, không có dải báo', async () => {
    putPending({ endedAt: Date.now() - 11 * 60_000 });
    await mountHub();
    expect(completes()).toHaveLength(0);
    expect(pendingRaw()).toBeNull();
    expect(q('[data-testid="arcade-pending-saved"]')).toBeNull();
  });

  it('mã ván đã hết hạn theo giờ máy chủ cấp mã (dù ván mới xong chưa tới 10 phút): bỏ và xoá, không gửi, không có dải báo', async () => {
    putPending({ endedAt: Date.now() - 60_000, expiresAt: Date.now() - 1_000 });
    await mountHub();
    expect(completes()).toHaveLength(0);
    expect(pendingRaw()).toBeNull();
    expect(q('[data-testid="arcade-pending-saved"]')).toBeNull();
    expect(q('[data-testid="arcade-pending-error"]')).toBeNull();
  });

  it('khách (chưa đăng nhập): không gửi, giữ khoá cho lần đăng nhập sau', async () => {
    m.phase = 'guest';
    putPending();
    await mountHub();
    expect(completes()).toHaveLength(0);
    expect(pendingRaw()).not.toBeNull();
  });

  it('đang khôi phục phiên (loading) thì chưa gửi; có phiên thật rồi mới gửi, đúng một lần', async () => {
    m.phase = 'loading';
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
    putPending();
    mounted = render(<ArcadeHub />, qc);
    await flush(4);
    expect(completes()).toHaveLength(0);
    expect(pendingRaw()).not.toBeNull();
    m.phase = 'authenticated';
    act(() =>
      mounted!.root.render(
        <QueryClientProvider client={qc}>
          <ArcadeHub />
        </QueryClientProvider>,
      ),
    );
    await flush(5);
    expect(completes()).toHaveLength(1);
    expect(pendingRaw()).toBeNull();
  });

  it('sessionStorage hỏng: sảnh vẫn dựng, không gửi, không ném lỗi', async () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('chặn');
    });
    await mountHub();
    expect(card('dew_catcher')).toBeTruthy();
    expect(completes()).toHaveLength(0);
  });

  it('không có ván chờ: không gửi gì và KHÔNG vẽ vùng live nào (không role status hay alert rỗng nằm sẵn trong trang)', async () => {
    await mountHub();
    expect(completes()).toHaveLength(0);
    expect(document.querySelector('[role="status"]')).toBeNull();
    expect(document.querySelector('[role="alert"]')).toBeNull();
    expect(q('[data-testid="arcade-pending-saved"]')).toBeNull();
    expect(q('[data-testid="arcade-pending-error"]')).toBeNull();
  });

  it('đang gửi nốt ván: chưa vẽ vùng live nào', async () => {
    putPending();
    m.post.mockReturnValue(new Promise(() => undefined));
    await mountHub();
    expect(completes()).toHaveLength(1);
    expect(document.querySelector('[role="status"]')).toBeNull();
  });

  it('lỗi gửi nốt ván là role="alert" (đọc ngay), đã lưu là role="status"', async () => {
    putPending();
    m.post.mockRejectedValueOnce(new TypeError('Failed to fetch'));
    await mountHub();
    expect(q('[data-testid="arcade-pending-error"]')!.getAttribute('role')).toBe('alert');
    expect(document.querySelector('[role="status"]')).toBeNull();
  });

  it('ván không được thưởng: dải báo nói lý do (hết lượt), không khoe Giọt nước', async () => {
    m.post.mockResolvedValue(SAVED({ rewarded: false, reason: 'DAILY_CAP', waterEarned: 0, pointsEarned: 0, used: 3, cap: 3, isNewBest: false }));
    putPending();
    await mountHub();
    const banner = q('[data-testid="arcade-pending-saved"]')!.textContent!;
    expect(banner).toContain('Đã lưu ván vừa chơi: 520 điểm');
    expect(banner).toContain('Hết lượt thưởng hôm nay, bạn vẫn phá kỷ lục được 🌿');
    expect(banner).not.toContain('Nhận');
  });

  it('lý do LOW_SCORE: dải báo nói điểm chưa đủ thưởng', async () => {
    m.post.mockResolvedValue(SAVED({ rewarded: false, reason: 'LOW_SCORE', waterEarned: 0, pointsEarned: 0, isNewBest: false }));
    putPending();
    await mountHub();
    expect(q('[data-testid="arcade-pending-saved"]')!.textContent).toContain(fillCopy('arcade.result.lowScore'));
  });

  it('lỗi mạng: báo chưa lưu được, ghi lại khoá chờ (giữ mốc giờ gốc và giờ hết hạn của mã), Thử lại gửi lại đúng ván đó một lần rồi xoá khoá', async () => {
    const endedAt = Date.now() - 120_000;
    const expiresAt = Date.now() + 5 * 60_000;
    putPending({ endedAt, expiresAt });
    m.post.mockRejectedValueOnce(new TypeError('Failed to fetch'));
    await mountHub();
    expect(completes()).toHaveLength(1);
    expect(q('[data-testid="arcade-pending-error"]')!.textContent).toContain(fillCopy('arcade.result.error'));
    expect(JSON.parse(pendingRaw()!)).toEqual({ ...RUN, endedAt, expiresAt });
    const retry = retryBtn()!;
    act(() => {
      retry.click();
      retry.click();
    });
    await flush(5);
    expect(completes()).toHaveLength(2);
    expect(completes()[1]![1]).toEqual(RUN);
    expect(pendingRaw()).toBeNull();
    expect(q('[data-testid="arcade-pending-error"]')).toBeNull();
    expect(q('[data-testid="arcade-pending-saved"]')!.textContent).toContain('Nhận 8 Giọt nước vào Vườn');
  });

  it('lỗi 5xx rồi vào lại sảnh trong 10 phút: gửi tiếp ván còn chờ', async () => {
    putPending();
    m.post.mockRejectedValueOnce(new ApiError('lỗi máy chủ', 503));
    await mountHub();
    expect(retryBtn()).not.toBeNull();
    mounted!.unmount();
    mounted = null;
    await mountHub();
    expect(completes()).toHaveLength(2);
    expect(pendingRaw()).toBeNull();
    expect(q('[data-testid="arcade-pending-saved"]')).not.toBeNull();
  });

  it('HTTP 400: nói ván không hợp lệ, KHÔNG có nút Thử lại và bỏ hẳn ván (không ghi lại khoá)', async () => {
    putPending();
    m.post.mockRejectedValueOnce(new ApiError('Bad Request', 400));
    await mountHub();
    expect(q('[data-testid="arcade-pending-error"]')!.textContent).toContain(fillCopy('arcade.result.invalid'));
    expect(retryBtn()).toBeNull();
    expect(pendingRaw()).toBeNull();
    mounted!.unmount();
    mounted = null;
    await mountHub();
    expect(completes()).toHaveLength(1);
  });

  it('HTTP 409 tạm thời (không mang mã ARCADE_RUN_USED): giữ ván chờ và vẫn có nút Thử lại', async () => {
    putPending();
    m.post.mockRejectedValueOnce(new ApiError('Hồ sơ game đang được cập nhật.', 409));
    await mountHub();
    expect(retryBtn()).not.toBeNull();
    expect(pendingRaw()).not.toBeNull();
  });

  it('HTTP 409 (mã ván đã dùng): nói ván đã được ghi (thông báo trung tính, không phải lỗi), không nút Thử lại, bỏ hẳn ván và làm mới game, me, loyalty', async () => {
    const spy = vi.spyOn(QueryClient.prototype, 'invalidateQueries');
    putPending();
    m.post.mockRejectedValueOnce(new ApiError('Conflict', 409, 'ARCADE_RUN_USED'));
    await mountHub();
    const note = q('[data-testid="arcade-pending-replayed"]')!;
    expect(note.textContent).toContain(fillCopy('arcade.result.replayed'));
    expect(note.textContent).not.toContain(fillCopy('arcade.result.invalid'));
    expect(note.getAttribute('role')).toBe('status');
    expect(q('[data-testid="arcade-pending-error"]')).toBeNull();
    expect(retryBtn()).toBeNull();
    expect(pendingRaw()).toBeNull();
    expect(spy.mock.calls.map((c) => (c[0] as { queryKey: unknown[] }).queryKey[0]).sort()).toEqual(['game', 'loyalty', 'me']);
  });

  it('ván chờ khoá cũ có mã ván nhưng không có giờ hết hạn của mã bị bỏ, không gửi gì lên máy chủ', async () => {
    sessionStorage.setItem(ARCADE_PENDING_KEY, JSON.stringify({ ...RUN, endedAt: Date.now() - 60_000 }));
    await mountHub();
    expect(completes()).toHaveLength(0);
    expect(pendingRaw()).toBeNull();
  });

  it('ván chờ kiểu cũ (không có mã ván) bị bỏ, không gửi gì lên máy chủ', async () => {
    sessionStorage.setItem(ARCADE_PENDING_KEY, JSON.stringify({ gameId: 'dew_catcher', score: 520, durationMs: 40_000, endedAt: Date.now() - 60_000 }));
    await mountHub();
    expect(completes()).toHaveLength(0);
    expect(pendingRaw()).toBeNull();
  });

  it('dải báo có tên truy cập và nút Thử lại đủ 44px', async () => {
    putPending();
    m.post.mockRejectedValueOnce(new Error('mạng'));
    await mountHub();
    expect(unnamedControls(mounted!.container)).toEqual([]);
    expect(smallTouchTargets(mounted!.container)).toEqual([]);
  });
});
