// @vitest-environment jsdom
import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ArcadeStatus } from '@tubutree/app-core/api/game';
import type { ArcadeMountOptions } from '@tubutree/app-core/arcade/arcade-canvas';
import { click, flush, render, type Rendered } from '@/test-utils/dom';
import { headingLevels, smallTouchTargets, unnamedControls } from '@/test-utils/a11y';

const m = vi.hoisted(() => ({
  phase: 'authenticated' as string,
  get: vi.fn(),
  post: vi.fn(),
  opts: null as ArcadeMountOptions | null,
  ctl: { start: vi.fn(), pause: vi.fn(), resume: vi.fn(), destroy: vi.fn(), resize: vi.fn() },
}));

vi.mock('@/lib/auth-phase', () => ({ useAuthPhase: () => m.phase }));
vi.mock('@/lib/core-http', () => ({ coreHttp: { get: (...a: unknown[]) => m.get(...a), post: (...a: unknown[]) => m.post(...a) } }));
vi.mock('@tubutree/app-core/arcade/arcade-canvas', () => ({
  mountArcade: (o: ArcadeMountOptions) => {
    m.opts = o;
    return m.ctl;
  },
}));

import { ArcadeHub } from './arcade-hub';

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

  it('chơi một ván trong lớp phủ rồi đóng: kỷ lục mới hiện ngay ở thẻ, không có request nào', async () => {
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
