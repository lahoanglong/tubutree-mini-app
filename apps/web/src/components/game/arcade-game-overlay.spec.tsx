// @vitest-environment jsdom
import { act } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ArcadeCompleteResult } from '@tubutree/app-core/api/game';
import type { ArcadeMountOptions, ArcadeResult } from '@tubutree/app-core/arcade/arcade-canvas';
import { click, flush, render, type Rendered } from '@/test-utils/dom';
import { headingLevels, smallTouchTargets, unnamedControls } from '@/test-utils/a11y';
import { fillCopy } from '@tubutree/app-core/shop-copy';
import { ApiError } from '@/lib/client-api';
import { ARCADE_PENDING_KEY } from './arcade-pending';

const m = vi.hoisted(() => ({
  phase: 'authenticated' as string,
  post: vi.fn(),
  ctl: { start: vi.fn(), pause: vi.fn(), resume: vi.fn(), destroy: vi.fn(), resize: vi.fn() },
  opts: null as ArcadeMountOptions | null,
  mount: vi.fn(),
}));

vi.mock('@/lib/auth-phase', () => ({ useAuthPhase: () => m.phase }));
vi.mock('@/lib/core-http', () => ({ coreHttp: { get: vi.fn(), post: (...a: unknown[]) => m.post(...a) } }));
// jsdom không có canvas 2D: bộ vẽ thật đã có spec ở app-core, ở đây chỉ kiểm cách lớp phủ gắn và điều khiển nó.
vi.mock('@tubutree/app-core/arcade/arcade-canvas', () => ({
  mountArcade: (o: ArcadeMountOptions) => {
    m.mount(o);
    m.opts = o;
    return m.ctl;
  },
}));

import { ArcadeGameOverlay } from './arcade-game-overlay';

const DEW_STATS = { score: 520, maxCombo: 3, dewCaught: 20, dodgedHazards: 4, heartsLeft: 2, endedBy: 'time' as const, durationMs: 40_000 };
const RUSH_STATS = { score: 300, correct: 12, wrong: 1, timedOut: 0, maxStreak: 6, feverCount: 1, durationMs: 45_000 };
const dewRun = (score = 520, over: Partial<typeof DEW_STATS> = {}): ArcadeResult => ({ gameId: 'dew_catcher', score, durationMs: 40_000, stats: { ...DEW_STATS, score, ...over } });
const SAVED = (over: Partial<ArcadeCompleteResult> = {}): ArcadeCompleteResult => ({
  gameId: 'dew_catcher', score: 520, bestScore: 520, isNewBest: true, rewarded: true, reason: null, waterEarned: 8, pointsEarned: 1, totalSeeds: 40,
  used: 1, cap: 3, window: null, windowBonus: false, ...over,
});

let mounted: Rendered | null = null;
let onClose = vi.fn();
const dialog = () => document.querySelector<HTMLElement>('[role="dialog"]');
const btn = (text: string) => Array.from(document.querySelectorAll<HTMLButtonElement>('button')).find((b) => b.textContent === text) ?? null;
const labelled = (label: string) => document.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`);
const canvas = () => document.querySelector<HTMLCanvasElement>('[data-testid="arcade-canvas"]')!;
const status = () => document.querySelector('[role="status"][aria-live="polite"]')!.textContent;
const text = () => dialog()!.textContent ?? '';

const client = () => new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
let qc = client();
async function open(gameId: 'dew_catcher' | 'refill_rush' = 'dew_catcher') {
  mounted = render(<ArcadeGameOverlay gameId={gameId} onClose={onClose} />, qc);
  await flush(4);
}
async function play() {
  click(btn('Chơi') ?? btn('Chơi thử'));
  await flush(1);
}
async function finish(run: ArcadeResult = dewRun()) {
  await act(async () => m.opts!.onEnd(run));
  await flush(4);
}

beforeEach(() => {
  m.phase = 'authenticated';
  qc = client();
  m.opts = null;
  m.mount.mockClear();
  Object.values(m.ctl).forEach((f) => f.mockReset());
  m.post.mockReset().mockResolvedValue(SAVED());
  onClose = vi.fn();
  localStorage.clear();
  window.history.pushState({}, '', '/vuon-xanh');
});
afterEach(() => {
  mounted?.unmount();
  mounted = null;
  vi.restoreAllMocks();
  document.body.style.overflow = '';
  document.body.innerHTML = '';
});

describe('ArcadeGameOverlay: mở lớp phủ', () => {
  it('hộp thoại có tên là tên game; canvas gắn mountArcade đúng game, có nhãn tiếng Việt, focus được và chặn cuộn cảm ứng', async () => {
    await open();
    const d = dialog()!;
    expect(d.getAttribute('aria-modal')).toBe('true');
    expect(document.getElementById(d.getAttribute('aria-labelledby')!)!.textContent).toBe('Hứng Sương Tinh Khiết');
    expect(m.mount).toHaveBeenCalledTimes(1);
    expect(m.opts!.game).toBe('dew_catcher');
    expect(m.opts!.canvas).toBe(canvas());
    expect(canvas().tabIndex).toBe(0);
    expect(canvas().getAttribute('aria-label')).toContain('Hứng Sương Tinh Khiết');
    expect(canvas().className).toContain('touch-none');
    expect(m.ctl.start).not.toHaveBeenCalled();
  });

  it('theme đủ tám màu lấy từ token ngữ nghĩa, không có hex', async () => {
    await open();
    expect(Object.keys(m.opts!.theme).sort()).toEqual(['accent', 'bg', 'cream', 'danger', 'forest', 'ink', 'sage', 'surface']);
    expect(Object.values(m.opts!.theme).join(' ')).not.toMatch(/#[0-9a-f]{3,6}/i);
  });

  it('màn bắt đầu nêu cách chơi và phím mũi tên; bấm Chơi mới chạy ván và đưa focus vào canvas', async () => {
    await open();
    expect(text()).toContain('Kéo chiếc lá sang trái, phải để hứng sương');
    expect(text()).toContain('Bàn phím: mũi tên trái, phải để di chuyển chiếc lá.');
    await play();
    expect(m.ctl.start).toHaveBeenCalledTimes(1);
    expect(document.querySelector('[data-testid="arcade-ready"]')).toBeNull();
    expect(document.activeElement).toBe(canvas());
  });

  it('Refill Rush: tên, cách chơi và phím riêng của game', async () => {
    await open('refill_rush');
    expect(m.opts!.game).toBe('refill_rush');
    expect(text()).toContain('Phân Loại Vỏ Chai Thần Tốc');
    expect(text()).toContain('Bàn phím: mũi tên trái, phải, xuống để chọn trạm.');
  });

  it('khoá cuộn nền khi mở và trả lại khi đóng', async () => {
    await open();
    expect(document.body.style.overflow).toBe('hidden');
    mounted!.unmount();
    mounted = null;
    expect(document.body.style.overflow).toBe('');
  });

  it('prefers-reduced-motion được chuyển cho bộ vẽ', async () => {
    window.matchMedia = vi.fn().mockReturnValue({ matches: true }) as unknown as typeof window.matchMedia;
    await open();
    expect(m.opts!.reducedMotion).toBe(true);
    // @ts-expect-error gỡ bản giả cho các ca sau
    delete window.matchMedia;
  });

  it('đóng: huỷ bộ vẽ (gỡ lắng nghe), trả focus về nút đã mở', async () => {
    const opener = document.createElement('button');
    document.body.appendChild(opener);
    opener.focus();
    await open();
    expect(document.activeElement).not.toBe(opener);
    mounted!.unmount();
    mounted = null;
    expect(m.ctl.destroy).toHaveBeenCalledTimes(1);
    expect(document.activeElement).toBe(opener);
  });
});

describe('ArcadeGameOverlay: đo khung canvas và theme', () => {
  const size = (w: number, h: number) => {
    Object.defineProperty(HTMLElement.prototype, 'clientWidth', { configurable: true, get: () => w });
    Object.defineProperty(HTMLElement.prototype, 'clientHeight', { configurable: true, get: () => h });
  };
  afterEach(() => {
    Reflect.deleteProperty(HTMLElement.prototype, 'clientWidth');
    Reflect.deleteProperty(HTMLElement.prototype, 'clientHeight');
    Reflect.deleteProperty(globalThis, 'ResizeObserver');
  });

  it('đo bằng clientWidth/clientHeight (cỡ bố cục), không bằng getBoundingClientRect đang bị scale 0.97 của hiệu ứng mở', async () => {
    size(480, 660);
    // Hộp thoại đang `scale(0.97)`: khung đo bằng getBoundingClientRect nhỏ hơn cỡ thật 3%.
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({ width: 465.6, height: 640.2, x: 0, y: 0, top: 0, left: 0, right: 465.6, bottom: 640.2, toJSON: () => ({}) });
    Object.defineProperty(window, 'devicePixelRatio', { configurable: true, value: 2 });
    await open();
    expect(m.ctl.resize).toHaveBeenCalledWith(480, 660, 2);
    expect(m.ctl.resize).not.toHaveBeenCalledWith(465.6, 640.2, 2);
    Reflect.deleteProperty(window, 'devicePixelRatio');
  });

  it('ResizeObserver bắn lại thì đo lại theo cỡ mới (xoay màn hình, đổi cỡ cửa sổ)', async () => {
    size(480, 660);
    let fire: () => void = () => undefined;
    const observe = vi.fn();
    const disconnect = vi.fn();
    class FakeRO {
      constructor(cb: () => void) {
        fire = cb;
      }
      observe = observe;
      disconnect = disconnect;
    }
    (globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = FakeRO;
    await open();
    expect(observe).toHaveBeenCalledTimes(1);
    size(400, 520);
    act(() => fire());
    expect(m.ctl.resize).toHaveBeenLastCalledWith(400, 520, 1);
    mounted!.unmount();
    mounted = null;
    expect(disconnect).toHaveBeenCalledTimes(1);
  });

  it('không có ResizeObserver: nghe sự kiện resize của cửa sổ và gỡ khi đóng', async () => {
    size(300, 500);
    await open();
    size(310, 520);
    act(() => void window.dispatchEvent(new Event('resize')));
    expect(m.ctl.resize).toHaveBeenLastCalledWith(310, 520, 1);
    mounted!.unmount();
    mounted = null;
    const calls = m.ctl.resize.mock.calls.length;
    act(() => void window.dispatchEvent(new Event('resize')));
    expect(m.ctl.resize.mock.calls.length).toBe(calls);
  });

  it('theme đọc cùng token với Mini (arcade-theme.ts): dải đất, Combo và chữ ra cùng màu', async () => {
    vi.spyOn(window, 'getComputedStyle').mockReturnValue({ getPropertyValue: (token: string) => `val(${token})` } as unknown as CSSStyleDeclaration);
    await open();
    expect(m.opts!.theme).toEqual({
      bg: 'val(--color-bg-subtle)',
      surface: 'val(--color-bg-surface)',
      forest: 'val(--color-text-brand)',
      sage: 'val(--color-action-secondary-border)',
      cream: 'val(--color-track)',
      ink: 'val(--color-text-primary)',
      accent: 'val(--color-flash-fg)',
      danger: 'val(--color-text-danger)',
    });
  });
});

describe('ArcadeGameOverlay: bàn phím', () => {
  const key = (k: string, init: KeyboardEventInit = {}) => act(() => void document.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true, ...init })));

  it('Esc đóng lớp phủ', async () => {
    await open();
    key('Escape');
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('Esc khi đang chơi cũng đóng (ván bỏ dở không gửi máy chủ)', async () => {
    await open();
    await play();
    key('Escape');
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(m.post).not.toHaveBeenCalled();
  });

  it('Tab không rơi ra nền: từ phần tử cuối quay về đầu, Shift+Tab từ đầu về cuối', async () => {
    const background = document.createElement('button');
    background.textContent = 'Nền';
    document.body.appendChild(background);
    await open();
    await play();
    const items = Array.from(dialog()!.querySelectorAll<HTMLElement>('button, [tabindex="0"]'));
    const first = items[0]!;
    const last = items[items.length - 1]!;
    last.focus();
    key('Tab');
    expect(document.activeElement).toBe(first);
    expect(document.activeElement).not.toBe(background);
    first.focus();
    key('Tab', { shiftKey: true });
    expect(document.activeElement).toBe(last);
    expect(dialog()!.contains(document.activeElement)).toBe(true);
  });

  it('canvas nằm trong vòng Tab của lớp phủ', async () => {
    await open();
    await play();
    expect(Array.from(dialog()!.querySelectorAll<HTMLElement>('button, [tabindex="0"]'))).toContain(canvas());
  });
});

describe('ArcadeGameOverlay: tạm dừng', () => {
  const visibility = (hidden: boolean) =>
    act(() => {
      Object.defineProperty(document, 'hidden', { configurable: true, value: hidden });
      document.dispatchEvent(new Event('visibilitychange'));
    });
  afterEach(() => void Reflect.deleteProperty(document, 'hidden'));

  it('tab ẩn thì tạm dừng, hiện lại thì chạy tiếp', async () => {
    await open();
    await play();
    visibility(true);
    expect(m.ctl.pause).toHaveBeenCalledTimes(1);
    visibility(false);
    expect(m.ctl.resume).toHaveBeenCalledTimes(1);
  });

  it('chưa bấm Chơi thì tab ẩn không đụng tới bộ vẽ', async () => {
    await open();
    visibility(true);
    visibility(false);
    expect(m.ctl.pause).not.toHaveBeenCalled();
    expect(m.ctl.resume).not.toHaveBeenCalled();
  });

  it('nút Tạm dừng đổi thành Tiếp tục; đang tạm dừng bằng tay thì tab hiện lại không tự chạy tiếp', async () => {
    await open();
    expect(labelled('Tạm dừng')).toBeNull();
    await play();
    click(labelled('Tạm dừng'));
    expect(m.ctl.pause).toHaveBeenCalledTimes(1);
    expect(labelled('Tiếp tục')).not.toBeNull();
    visibility(true);
    visibility(false);
    expect(m.ctl.resume).not.toHaveBeenCalled();
    click(labelled('Tiếp tục'));
    expect(m.ctl.resume).toHaveBeenCalledTimes(1);
  });
});

describe('ArcadeGameOverlay: khách (chưa đăng nhập)', () => {
  beforeEach(() => {
    m.phase = 'guest';
  });

  it('nút bắt đầu là "Chơi thử"', async () => {
    await open();
    expect(btn('Chơi thử')).toBeTruthy();
    expect(btn('Chơi')).toBeNull();
  });

  it.each([
    [300, 5],
    [400, 8],
    [899, 8],
    [900, 10],
  ])('cuối ván điểm %i: nút đăng nhập hứa đúng %i Giọt nước, không gọi máy chủ', async (score, water) => {
    await open();
    await play();
    await finish(dewRun(score));
    const link = Array.from(dialog()!.querySelectorAll('a')).find((a) => a.textContent?.includes('Đăng nhập'))!;
    expect(link.textContent).toBe(`Đăng nhập lưu kỷ lục & nhận ngay ${water} Giọt nước vào Vườn`);
    expect(link.getAttribute('href')).toBe('/dang-nhap?returnTo=%2Fvuon-xanh');
    expect(m.post).not.toHaveBeenCalled();
  });

  it('kỷ lục lưu localStorage khoá tubu.arcade.best.<game>; ván thấp hơn không hạ kỷ lục và không có huy hiệu Kỷ lục mới', async () => {
    await open();
    await play();
    await finish(dewRun(520));
    expect(text()).toContain('Kỷ lục mới');
    expect(text()).toContain('Kỷ lục 520');
    expect(localStorage.getItem('tubu.arcade.best.dew_catcher')).toBe('520');
    click(btn('Chơi lại'));
    await finish(dewRun(100));
    expect(text()).not.toContain('Kỷ lục mới');
    expect(text()).toContain('Kỷ lục 520');
    expect(localStorage.getItem('tubu.arcade.best.dew_catcher')).toBe('520');
  });

  it('localStorage hỏng: vẫn chơi và hiện kết quả, không ném lỗi', async () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('chặn');
    });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('đầy');
    });
    await open();
    await play();
    await finish(dewRun(450));
    expect(text()).toContain('Bạn đạt 450 điểm');
    expect(text()).toContain('Kỷ lục mới');
    expect(text()).toContain('Bạn đang chơi thử, kỷ lục lưu trên máy này');
  });
});

describe('ArcadeGameOverlay: đã đăng nhập, lưu kết quả', () => {
  it('gửi completeArcade đúng một lần với ba trường của ván, kể cả khi onEnd bắn hai lần', async () => {
    await open();
    await play();
    await act(async () => {
      m.opts!.onEnd(dewRun(520));
      m.opts!.onEnd(dewRun(520));
    });
    await flush(4);
    expect(m.post).toHaveBeenCalledTimes(1);
    expect(m.post).toHaveBeenCalledWith('/game/arcade-complete', { gameId: 'dew_catcher', score: 520, durationMs: 40_000 });
  });

  it('không gọi lại khi render lại sau khi lưu xong', async () => {
    await open();
    await play();
    await finish();
    act(() =>
      mounted!.root.render(
        <QueryClientProvider client={qc}>
          <ArcadeGameOverlay gameId="dew_catcher" onClose={onClose} />
        </QueryClientProvider>,
      ),
    );
    await flush(4);
    expect(m.post).toHaveBeenCalledTimes(1);
  });

  it('hiện giọt nước, Điểm Xanh, used/cap, kỷ lục và huy hiệu Kỷ lục mới từ máy chủ; làm mới game, me, loyalty', async () => {
    const spy = vi.spyOn(QueryClient.prototype, 'invalidateQueries');
    await open();
    await play();
    await finish();
    expect(text()).toContain('Bạn đạt 520 điểm');
    expect(text()).toContain('Nhận 8 Giọt nước vào Vườn');
    expect(text()).toContain('+1 Điểm Xanh');
    expect(text()).toContain('Đã dùng 1/3 lượt thưởng hôm nay');
    expect(text()).toContain('Kỷ lục mới');
    expect(text()).toContain('Kỷ lục 520');
    expect(spy.mock.calls.map((c) => JSON.stringify(c[0]?.queryKey))).toEqual(expect.arrayContaining(['["game"]', '["me"]', '["loyalty"]']));
    expect(dialog()!.querySelector('a[href^="/dang-nhap"]')).toBeNull();
  });

  it('ván trong khung giờ thưởng nêu thêm 1 lượt', async () => {
    m.post.mockResolvedValue(SAVED({ windowBonus: true, window: 'SUONG_SOM', used: 4, cap: 4 }));
    await open();
    await play();
    await finish();
    expect(text()).toContain('Đã dùng 4/4 lượt thưởng hôm nay');
    expect(text()).toContain('Nhờ khung giờ thưởng, hôm nay bạn có thêm 1 lượt');
  });

  it('hết lượt thưởng (DAILY_CAP): chữ thân thiện, vẫn có kỷ lục và số lượt, không khoe giọt nước', async () => {
    m.post.mockResolvedValue(SAVED({ rewarded: false, reason: 'DAILY_CAP', waterEarned: 0, pointsEarned: 0, used: 3, cap: 3, isNewBest: false, bestScore: 700 }));
    await open();
    await play();
    await finish();
    expect(text()).toContain('Hết lượt thưởng hôm nay, bạn vẫn phá kỷ lục được 🌿');
    expect(text()).toContain('Đã dùng 3/3 lượt thưởng hôm nay');
    expect(text()).toContain('Kỷ lục 700');
    expect(text()).not.toContain('Nhận');
    expect(text()).not.toContain('Kỷ lục mới');
  });

  it.each([
    ['TOO_FAST', 'Bạn chơi liên tiếp quá nhanh nên ván này chưa tính thưởng'],
    ['DISABLED', 'Phần thưởng mini game đang tạm nghỉ, kỷ lục của bạn vẫn được lưu'],
    ['NOT_REAL_USER', 'Liên kết Zalo để các ván sau nhận Giọt nước'],
  ] as const)('lý do %s: câu ngắn trung tính', async (reason, expected) => {
    m.post.mockResolvedValue(SAVED({ rewarded: false, reason, waterEarned: 0, pointsEarned: 0, isNewBest: false }));
    await open();
    await play();
    await finish();
    expect(text()).toContain(expected);
    expect(text()).not.toContain('Giọt nước vào Vườn');
  });

  it('lỗi mạng: giữ bảng điểm, báo chưa lưu được; Thử lại gửi lại ĐÚNG ván đó một lần và hết nút khi xong', async () => {
    m.post.mockRejectedValueOnce(new Error('mất mạng'));
    await open();
    await play();
    await finish(dewRun(640));
    expect(text()).toContain('Bạn đạt 640 điểm');
    expect(text()).toContain('Chưa lưu được ván này. Bạn thử lại nhé.');
    expect(m.post).toHaveBeenCalledTimes(1);
    const retry = btn('Thử lại')!;
    click(retry);
    await flush(4);
    expect(m.post).toHaveBeenCalledTimes(2);
    expect(m.post.mock.calls[1]![1]).toEqual(m.post.mock.calls[0]![1]);
    expect(text()).toContain('Nhận 8 Giọt nước vào Vườn');
    expect(btn('Thử lại')).toBeNull();
    expect(text()).not.toContain('Chưa lưu được ván này');
  });

  it('Thử lại bấm đúp trong lúc đang gửi chỉ gửi một lần', async () => {
    m.post.mockRejectedValueOnce(new Error('lỗi')).mockImplementationOnce(() => new Promise(() => undefined));
    await open();
    await play();
    await finish();
    const retry = btn('Thử lại')!;
    act(() => {
      retry.click();
      retry.click();
    });
    await flush(2);
    expect(m.post).toHaveBeenCalledTimes(2);
  });

  it('Chơi lại: bộ vẽ chạy lại, bảng điểm cũ biến mất và ván mới có lượt gửi riêng (mỗi ván đúng một lần)', async () => {
    await open();
    await play();
    await finish(dewRun(520));
    click(btn('Chơi lại'));
    await flush(1);
    expect(m.ctl.start).toHaveBeenCalledTimes(2);
    expect(document.querySelector('[data-testid="arcade-result"]')).toBeNull();
    await act(async () => {
      m.opts!.onEnd(dewRun(610));
      m.opts!.onEnd(dewRun(610));
    });
    await flush(4);
    expect(m.post).toHaveBeenCalledTimes(2);
    expect(m.post.mock.calls[1]![1]).toEqual({ gameId: 'dew_catcher', score: 610, durationMs: 40_000 });
  });

  it('nút Đóng trên bảng điểm gọi onClose', async () => {
    await open();
    await play();
    await finish();
    click(Array.from(document.querySelectorAll<HTMLButtonElement>('[data-testid="arcade-result"] button')).find((b) => b.textContent === 'Đóng')!);
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

describe('ArcadeGameOverlay: lỗi máy chủ theo mã HTTP', () => {
  const retryButton = () => Array.from(document.querySelectorAll<HTMLButtonElement>('[data-testid="arcade-result"] button')).find((b) => b.textContent === 'Thử lại') ?? null;

  it('HTTP 400 (ván bị từ chối): nói ván không hợp lệ, KHÔNG có nút Thử lại, không tự gửi lại', async () => {
    m.post.mockRejectedValue(new ApiError('Bad Request', 400));
    await open();
    await play();
    await finish(dewRun(640));
    expect(text()).toContain('Bạn đạt 640 điểm');
    expect(text()).toContain(fillCopy('arcade.result.invalid'));
    expect(text()).not.toContain(fillCopy('arcade.result.error'));
    expect(retryButton()).toBeNull();
    await flush(4);
    expect(m.post).toHaveBeenCalledTimes(1);
  });

  it('HTTP 400 rồi Chơi lại: ván mới vẫn gửi và nhận thưởng bình thường', async () => {
    m.post.mockRejectedValueOnce(new ApiError('Bad Request', 400));
    await open();
    await play();
    await finish(dewRun(640));
    click(btn('Chơi lại'));
    await finish(dewRun(700));
    expect(m.post).toHaveBeenCalledTimes(2);
    expect(text()).toContain('Nhận 8 Giọt nước vào Vườn');
    expect(text()).not.toContain(fillCopy('arcade.result.invalid'));
  });

  it.each([503, 500])('HTTP %i (lỗi phía máy chủ): vẫn mời Thử lại và gửi lại đúng ván đó', async (status) => {
    m.post.mockRejectedValueOnce(new ApiError('lỗi máy chủ', status));
    await open();
    await play();
    await finish(dewRun(640));
    expect(text()).toContain(fillCopy('arcade.result.error'));
    expect(text()).not.toContain(fillCopy('arcade.result.invalid'));
    click(retryButton());
    await flush(4);
    expect(m.post).toHaveBeenCalledTimes(2);
    expect(text()).toContain('Nhận 8 Giọt nước vào Vườn');
  });

  it('lỗi mạng (không có mã HTTP): mời Thử lại', async () => {
    m.post.mockRejectedValueOnce(new TypeError('Failed to fetch'));
    await open();
    await play();
    await finish();
    expect(retryButton()).not.toBeNull();
    expect(text()).toContain(fillCopy('arcade.result.error'));
  });

  it('lý do LOW_SCORE: nói điểm chưa đủ để thưởng, không khoe Giọt nước', async () => {
    m.post.mockResolvedValue(SAVED({ rewarded: false, reason: 'LOW_SCORE', waterEarned: 0, pointsEarned: 0, isNewBest: false, bestScore: 700 }));
    await open();
    await play();
    await finish(dewRun(120));
    expect(text()).toContain(fillCopy('arcade.result.lowScore'));
    expect(text()).toContain('Kỷ lục 700');
    expect(text()).not.toContain('Giọt nước vào Vườn');
  });

  it('lý do lạ máy chủ thêm sau: không nói sai, vẫn hiện điểm và kỷ lục', async () => {
    m.post.mockResolvedValue(SAVED({ rewarded: false, reason: 'TUONG_LAI' as never, waterEarned: 0, pointsEarned: 0, isNewBest: false, bestScore: 700 }));
    await open();
    await play();
    await finish(dewRun(120));
    expect(text()).toContain('Bạn đạt 120 điểm');
    expect(text()).toContain('Kỷ lục 700');
    expect(text()).not.toContain('Giọt nước vào Vườn');
  });

  it('số lượt đúng như máy chủ trả: trần lớn hơn 3 vẫn hiện nguyên (used 2/cap 5)', async () => {
    m.post.mockResolvedValue(SAVED({ used: 2, cap: 5 }));
    await open();
    await play();
    await finish();
    expect(text()).toContain('Đã dùng 2/5 lượt thưởng hôm nay');
  });
});

describe('ArcadeGameOverlay: khách bấm Đăng nhập thì ván được nhớ qua vòng đăng nhập', () => {
  beforeEach(() => {
    m.phase = 'guest';
    sessionStorage.clear();
  });
  const loginLink = () => Array.from(dialog()!.querySelectorAll('a')).find((a) => a.textContent?.includes('Đăng nhập'))!;
  const pending = () => JSON.parse(sessionStorage.getItem(ARCADE_PENDING_KEY) ?? 'null');

  it('chưa bấm nút thì chưa nhớ gì (chơi xong rồi đóng không để lại ván chờ)', async () => {
    await open();
    await play();
    await finish(dewRun(520));
    expect(sessionStorage.getItem(ARCADE_PENDING_KEY)).toBeNull();
  });

  it('bấm nút đăng nhập: ghi gameId, điểm, thời lượng và mốc giờ vào sessionStorage trước khi chuyển trang', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(1_700_000_000_000);
    await open();
    await play();
    await finish(dewRun(520));
    const link = loginLink();
    link.addEventListener('click', (e) => e.preventDefault());
    click(link);
    expect(pending()).toEqual({ gameId: 'dew_catcher', score: 520, durationMs: 40_000, endedAt: 1_700_000_000_000 });
    expect(link.getAttribute('href')).toBe('/dang-nhap?returnTo=%2Fvuon-xanh');
  });

  it('ván của game khác được ghi đúng gameId; chơi lại ván cao hơn rồi bấm thì ghi đè ván cũ', async () => {
    await open('refill_rush');
    await play();
    await finish({ gameId: 'refill_rush', score: 300, durationMs: 45_000, stats: RUSH_STATS });
    loginLink().addEventListener('click', (e) => e.preventDefault());
    click(loginLink());
    expect(pending()).toMatchObject({ gameId: 'refill_rush', score: 300, durationMs: 45_000 });
    click(btn('Chơi lại'));
    await finish({ gameId: 'refill_rush', score: 450, durationMs: 45_000, stats: { ...RUSH_STATS, score: 450 } });
    loginLink().addEventListener('click', (e) => e.preventDefault());
    click(loginLink());
    expect(pending()).toMatchObject({ score: 450 });
  });

  it('sessionStorage hỏng: bảng điểm và nút đăng nhập vẫn hiện đúng, bấm không ném lỗi', async () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('đầy');
    });
    await open();
    await play();
    await finish(dewRun(520));
    const link = loginLink();
    expect(link.textContent).toBe('Đăng nhập lưu kỷ lục & nhận ngay 8 Giọt nước vào Vườn');
    expect(link.getAttribute('href')).toBe('/dang-nhap?returnTo=%2Fvuon-xanh');
    link.addEventListener('click', (e) => e.preventDefault());
    expect(() => click(link)).not.toThrow();
  });
});

describe('ArcadeGameOverlay: kết quả, Tip và trợ năng', () => {
  it('có vùng aria-live đọc điểm và phần thưởng; focus chuyển vào bảng điểm', async () => {
    await open();
    await play();
    expect(status()).toBe('');
    await finish();
    expect(status()).toContain('Bạn đạt 520 điểm');
    expect(status()).toContain('Nhận 8 Giọt nước vào Vườn');
    expect(document.activeElement).toBe(document.querySelector('[data-testid="arcade-result"]'));
  });

  it('Tip theo thống kê: né từ 3 giọt hoá chất thì có chip tới tìm kiếm Bồ Hòn của web', async () => {
    await open();
    await play();
    await finish(dewRun(520, { dodgedHazards: 5 }));
    expect(text()).toContain('Bạn vừa né 5 giọt hoá chất!');
    const chip = Array.from(dialog()!.querySelectorAll('a')).find((a) => a.textContent === 'Xem Nước rửa chén Bồ Hòn')!;
    expect(chip.getAttribute('href')).toBe(`/san-pham?q=${encodeURIComponent('bồ hòn')}`);
  });

  it('Tip Refill Rush: chip tới /doi-rac', async () => {
    await open('refill_rush');
    await play();
    await finish({ gameId: 'refill_rush', score: 300, durationMs: 45_000, stats: RUSH_STATS });
    expect(text()).toContain('Mỗi vỏ chai TubuTree giữ lại đều đổi được Điểm Xanh & Quà tặng!');
    expect(Array.from(dialog()!.querySelectorAll('a')).find((a) => a.textContent === 'Mang vỏ chai đi Đổi rác')!.getAttribute('href')).toBe('/doi-rac');
  });

  it('nút có tên, vùng chạm đủ lớn, heading hợp lệ (h2 rồi h3) ở màn bắt đầu và bảng điểm', async () => {
    await open();
    expect(unnamedControls(dialog()!)).toEqual([]);
    expect(smallTouchTargets(dialog()!)).toEqual([]);
    await play();
    await finish(dewRun(520, { dodgedHazards: 5 }));
    expect(unnamedControls(dialog()!)).toEqual([]);
    expect(smallTouchTargets(dialog()!)).toEqual([]);
    expect(headingLevels(dialog()!)).toEqual([2, 3]);
  });

  it('chip của Tip cao tối thiểu 44px (2,75rem), vẫn là liên kết thật', async () => {
    await open();
    await play();
    await finish(dewRun(520, { dodgedHazards: 5 }));
    const chip = Array.from(dialog()!.querySelectorAll<HTMLAnchorElement>('a')).find((a) => a.textContent === 'Xem Nước rửa chén Bồ Hòn')!;
    expect(chip.style.minHeight).toBe('2.75rem');
    expect(chip.getAttribute('href')).toBe(`/san-pham?q=${encodeURIComponent('bồ hòn')}`);
  });

  it('dòng gợi ý bàn phím vẫn có trong DOM nhưng ẩn trên màn chạm (pointer: coarse) bằng CSS', async () => {
    await open();
    const keys = document.querySelector<HTMLElement>('[data-testid="arcade-keys"]')!;
    expect(keys.textContent).toBe('Bàn phím: mũi tên trái, phải để di chuyển chiếc lá.');
    expect(keys.className).toContain('[@media(pointer:coarse)]:hidden');
    expect(keys.className).not.toContain('max-md:');
  });

  it('nút Đóng và Chơi lại đủ 44px (min-height tường minh)', async () => {
    await open();
    await play();
    await finish();
    for (const b of [labelled('Đóng')!, btn('Chơi lại')!]) expect(parseFloat(b.style.minHeight || '0')).toBeGreaterThanOrEqual(44);
  });
});
