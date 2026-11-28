// @vitest-environment jsdom
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { XMAS_TREE_KEY, xmasTreeCopy as c, type OrnamentProgress } from '@tubutree/app-core/seasonal/xmas-tree';
import { click, flush, render, type Rendered } from '@/test-utils/dom';

const m = vi.hoisted(() => ({
  play: vi.fn(),
  user: { id: 'u1', fullName: 'Lan', referralCode: 'LAN01' } as { id: string; fullName?: string; referralCode?: string } | null,
}));
vi.mock('@/lib/sfx', () => ({ sfx: { play: (cue: string) => m.play(cue) } }));
vi.mock('@/lib/auth-context', () => ({ useAuth: () => ({ user: m.user }) }));
vi.mock('@/components/mini', () => ({
  BottomSheet: ({ open, title, footer, children }: { open: boolean; title: string; footer?: ReactNode; children: ReactNode }) =>
    open ? (
      <div role="dialog" aria-label={title}>
        {children}
        {footer}
      </div>
    ) : null,
  Button: ({ onPress, loading, children }: { onPress: () => void; loading?: boolean; children: ReactNode }) => (
    <button type="button" data-testid="xmas-share" disabled={loading} onClick={onPress}>
      {children}
    </button>
  ),
}));

import ChristmasGarden from './christmas-garden';

const NEW: OrnamentProgress = { streakDays: 0, activeToday: false, drops: 0, harvested: 0 };
let mounted: Rendered | null = null;
const q = (id: string) => document.querySelector<HTMLElement>(`[data-testid="${id}"]`)!;
const stored = () => JSON.parse(localStorage.getItem(XMAS_TREE_KEY) ?? 'null') as { u: string[]; on: string[] } | null;
const mount = (progress: OrnamentProgress = NEW) => {
  mounted = render(<ChristmasGarden progress={progress} plain={<span data-testid="plain-tree" />} />);
  click(q('xmas-decorate'));
};

function fakeCanvas() {
  const ctx = new Proxy(
    { measureText: (s: string) => ({ width: s.length * 14 }), createLinearGradient: () => ({ addColorStop: vi.fn() }) } as Record<string, unknown>,
    { get: (t, k: string) => (k in t ? t[k] : vi.fn()), set: () => true },
  );
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(ctx as unknown as CanvasRenderingContext2D);
  vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation((cb: BlobCallback) => cb(new Blob(['png'], { type: 'image/png' })));
  vi.stubGlobal(
    'Path2D',
    class {
      constructor(readonly d: string) {}
    },
  );
}

function setNavigator(nav: Partial<Pick<Navigator, 'share' | 'canShare' | 'clipboard'>>) {
  for (const k of ['share', 'canShare', 'clipboard'] as const) Object.defineProperty(navigator, k, { value: nav[k], configurable: true });
}

beforeEach(() => {
  localStorage.clear();
  m.play.mockClear();
  m.user = { id: 'u1', fullName: 'Lan', referralCode: 'LAN01' };
  setNavigator({});
});
afterEach(() => {
  mounted?.unmount();
  mounted = null;
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('ChristmasGarden (web): khay trang trí', () => {
  it('cùng luật với Mini: mở + treo (chuông), cất (pop), món khoá chỉ nhắc, lưu trên máy', () => {
    mount();
    expect(q('xmas-tree').getAttribute('aria-label')).toBe(c.treeAria(0));
    expect(document.querySelector('[role="dialog"]')!.getAttribute('aria-label')).toBe(c.sheetTitle);
    expect(document.querySelectorAll('.tubu-xgd-slot')).toHaveLength(6);

    click(q('xmas-slot-star'));
    expect(q('xmas-slot-star').getAttribute('data-state')).toBe('on');
    expect(q('xmas-msg').textContent).toBe(c.unlocked(c.names.star));
    expect(m.play).toHaveBeenLastCalledWith('bell');
    expect(stored()).toEqual({ u: ['star'], on: ['star'] });

    click(q('xmas-slot-star'));
    expect(q('xmas-slot-star').getAttribute('data-state')).toBe('off');
    expect(m.play).toHaveBeenLastCalledWith('pop');

    m.play.mockClear();
    click(q('xmas-slot-gifts'));
    expect(q('xmas-slot-gifts').getAttribute('data-state')).toBe('locked');
    expect(q('xmas-msg').textContent).toBe(c.hints.gifts);
    expect(m.play).not.toHaveBeenCalled();
    expect(stored()).toEqual({ u: ['star'], on: [] });
  });
});

describe('ChristmasGarden (web): chia sẻ thiệp', () => {
  it('trình duyệt nhận tệp: Web Share gửi ảnh PNG kèm lời mời có mã giới thiệu', async () => {
    fakeCanvas();
    const share = vi.fn(() => Promise.resolve());
    setNavigator({ share, canShare: () => true });
    localStorage.setItem(XMAS_TREE_KEY, JSON.stringify({ u: ['star', 'lights'], on: ['star', 'lights'] }));
    mount();
    click(q('xmas-share'));
    await flush(3);
    expect(share).toHaveBeenCalledTimes(1);
    const arg = (share.mock.calls[0] as unknown as [ShareData])[0];
    expect(arg.title).toBe(c.zaloTitle('Lan'));
    expect(arg.files).toHaveLength(1);
    expect(arg.files![0]!.type).toBe('image/png');
    expect(arg.text).toContain(c.zaloText(2));
    expect(arg.text).toContain('/vuon-xanh?ref=LAN01');
  });

  it('không nhận tệp nhưng có Web Share: chia sẻ link; khách bấm huỷ thì im lặng', async () => {
    fakeCanvas();
    const share = vi.fn(() => Promise.reject(new DOMException('cancel', 'AbortError')));
    setNavigator({ share, canShare: () => false });
    mount();
    click(q('xmas-share'));
    await flush(3);
    expect(share).toHaveBeenCalledWith({ title: c.zaloTitle('Lan'), text: c.zaloText(0), url: `${window.location.origin}/vuon-xanh?ref=LAN01` });
    expect(q('xmas-msg').textContent).toBe('');
  });

  it('không có Web Share: tải ảnh PNG về máy và báo đã tải', async () => {
    fakeCanvas();
    const createUrl = vi.fn(() => 'blob:thiep');
    vi.stubGlobal('URL', Object.assign(URL, { createObjectURL: createUrl, revokeObjectURL: vi.fn() }));
    const clicked = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);
    mount();
    click(q('xmas-share'));
    await flush(3);
    expect(createUrl).toHaveBeenCalledTimes(1);
    expect(clicked).toHaveBeenCalledTimes(1);
    expect(q('xmas-msg').textContent).toBe(c.saved);
  });

  it('không có canvas lẫn Web Share: sao chép link; hồ sơ không mã giới thiệu thì link không kèm ref', async () => {
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
    const writeText = vi.fn(() => Promise.resolve());
    setNavigator({ clipboard: { writeText } as unknown as Clipboard });
    m.user = { id: 'u1' };
    mount();
    click(q('xmas-share'));
    await flush(3);
    expect(writeText).toHaveBeenCalledWith(`${window.location.origin}/vuon-xanh`);
    expect(q('xmas-msg').textContent).toBe(c.copied);
  });

  it('ảnh dựng sẵn khi mở sheet: bấm chia sẻ gọi Web Share ngay (không đợi vẽ lại); trình duyệt từ chối (NotAllowedError) thì tải ảnh về', async () => {
    fakeCanvas();
    const toBlob = vi.mocked(HTMLCanvasElement.prototype.toBlob);
    const share = vi.fn(() => Promise.reject(new DOMException('no gesture', 'NotAllowedError')));
    setNavigator({ share, canShare: () => true });
    vi.stubGlobal('URL', Object.assign(URL, { createObjectURL: vi.fn(() => 'blob:thiep'), revokeObjectURL: vi.fn() }));
    const clicked = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);
    mount();
    await flush(2);
    const built = toBlob.mock.calls.length;
    expect(built).toBe(1);
    click(q('xmas-share'));
    expect(share).toHaveBeenCalledTimes(1);
    await flush(3);
    expect(toBlob.mock.calls.length).toBe(built);
    expect(clicked).toHaveBeenCalledTimes(1);
    expect(q('xmas-msg').textContent).toBe(c.saved);
  });

  it('lỗi khác khi chia sẻ: báo thử lại, nút mở lại', async () => {
    fakeCanvas();
    setNavigator({ share: vi.fn(() => Promise.reject(new Error('boom'))), canShare: () => true });
    mount();
    click(q('xmas-share'));
    await flush(3);
    expect(q('xmas-msg').textContent).toBe(c.shareFailed);
    expect(q('xmas-share').hasAttribute('disabled')).toBe(false);
  });
});
