// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flush, render, type Rendered } from '@/test-utils/dom';
import { smallTouchTargets, unnamedControls } from '@/test-utils/a11y';

const mocks = vi.hoisted(() => ({ renderPoster: vi.fn() }));
vi.mock('@/lib/share-poster-png', () => ({ renderPoster: (i: unknown) => mocks.renderPoster(i) }));
vi.mock('@/components/ui/qr-code', () => ({ QrCode: ({ value }: { value: string }) => <div data-testid="qr">{value}</div> }));

import { SharePoster } from './share-poster';
import { useActionLock } from './storefront-share';

const STORE = { kind: 'store', title: 'Góc xanh', path: '/s/goc-xanh', referralCode: 'CTV1' } as const;
const PNG = 'data:image/png;base64,iVBORw0KGgo=';
const FILE = new File([new Uint8Array([1])], 'tubutree-goc-xanh.png', { type: 'image/png' });
const DONE = { url: 'https://tubutree.com/s/goc-xanh?ref=CTV1', png: PNG, fileName: 'tubutree-goc-xanh.png', file: FILE };

let mounted: Rendered[] = [];
const notes: unknown[] = [];

/** Bảng thật dùng `useActionLock` của storefront-share: ảnh chung khoá với nút chia sẻ/chép. */
function Host({ busy }: { busy?: boolean }) {
  const lock = useActionLock();
  return <SharePoster input={STORE} lock={busy ? { ...lock, busy: true } : lock} onNote={(n) => notes.push(n)} />;
}
const mount = (busy?: boolean) => {
  const r = render(<Host busy={busy} />);
  mounted.push(r);
  return r;
};
const link = () => document.querySelector<HTMLAnchorElement>('a[download]')!;
const press = () => {
  const ev = new MouseEvent('click', { bubbles: true, cancelable: true });
  link().dispatchEvent(ev);
  return ev;
};

beforeEach(() => {
  mocks.renderPoster.mockReset().mockResolvedValue(DONE);
  notes.length = 0;
  Object.defineProperty(navigator, 'canShare', { value: undefined, configurable: true });
  Object.defineProperty(navigator, 'share', { value: undefined, configurable: true });
});
afterEach(() => {
  mounted.forEach((m) => m.unmount());
  mounted = [];
});

describe('SharePoster (web)', () => {
  it('đang vẽ: khung chờ role=status có tên; vẽ xong: ảnh có chữ thay thế, nút "Lưu ảnh" là <a download> trỏ PNG', async () => {
    let resolve!: (v: typeof DONE) => void;
    mocks.renderPoster.mockReturnValue(new Promise((r) => (resolve = r)));
    mount();
    await flush();
    expect(document.querySelector('[role="status"]')!.getAttribute('aria-label')).toBe('Đang tạo ảnh có mã QR');
    resolve(DONE);
    await flush();
    const img = document.querySelector('img')!;
    expect(img.getAttribute('src')).toBe(PNG);
    expect(img.getAttribute('alt')).toBe('Ảnh có mã QR: Góc xanh');
    expect(link().getAttribute('href')).toBe(PNG);
    expect(link().getAttribute('download')).toBe('tubutree-goc-xanh.png');
    expect(link().textContent).toBe('Lưu ảnh');
    expect(document.querySelector('figcaption')!.textContent).toBe('Nhấn giữ ảnh để lưu hoặc gửi');
    expect(document.querySelector('[role="status"]')).toBeNull();
    expect(mocks.renderPoster).toHaveBeenCalledWith(STORE);
    expect(unnamedControls(document.body)).toEqual([]);
    expect(smallTouchTargets(document.body)).toEqual([]);
  });

  it('máy không chia sẻ được tệp: bấm để trình duyệt tải ảnh (không chặn); không báo "đã lưu" vì trình duyệt trong app có thể bỏ qua lệnh tải', async () => {
    mount();
    await flush();
    expect(press().defaultPrevented).toBe(false);
    expect(notes).toEqual([null]);
  });

  it('máy chia sẻ được tệp: nút thành "Gửi ảnh", mở hộp chia sẻ với tệp PNG; khách đóng hộp thì không báo gì', async () => {
    const share = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'canShare', { value: () => true, configurable: true });
    Object.defineProperty(navigator, 'share', { value: share, configurable: true });
    mount();
    await flush();
    expect(link().textContent).toBe('Gửi ảnh');
    const ev = press();
    await flush();
    expect(ev.defaultPrevented).toBe(true);
    expect(share).toHaveBeenCalledWith({ files: [FILE], title: 'Góc xanh' });
    expect(notes).toEqual([null]);

    share.mockRejectedValueOnce(new DOMException('đóng', 'AbortError'));
    press();
    await flush();
    expect(notes).toEqual([null]);
  });

  it('hộp chia sẻ báo lỗi (không phải khách đóng): tải ảnh thay, không báo lỗi', async () => {
    Object.defineProperty(navigator, 'canShare', { value: () => true, configurable: true });
    Object.defineProperty(navigator, 'share', { value: vi.fn().mockRejectedValue(new Error('NotAllowed')), configurable: true });
    const clicked: string[] = [];
    const spy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
      clicked.push(`${this.download}|${this.getAttribute('href')}`);
    });
    try {
      mount();
      await flush();
      press();
      await flush();
    } finally {
      spy.mockRestore();
    }
    expect(clicked).toEqual([`tubutree-goc-xanh.png|${PNG}`]);
    expect(notes).toEqual([null]);
  });

  it('bảng đang bận việc khác: nút báo aria-disabled, bấm không tải, không chia sẻ', async () => {
    const share = vi.fn();
    Object.defineProperty(navigator, 'canShare', { value: () => true, configurable: true });
    Object.defineProperty(navigator, 'share', { value: share, configurable: true });
    mount(true);
    await flush();
    expect(link().getAttribute('aria-disabled')).toBe('true');
    const ev = press();
    await flush();
    expect(ev.defaultPrevented).toBe(true);
    expect(share).not.toHaveBeenCalled();
    expect(notes).toEqual([]);
  });

  it('trình duyệt không có canvas hoặc không nạp được bộ vẽ: QR thường của link web công khai, không có nút tải', async () => {
    mocks.renderPoster.mockResolvedValue({ ...DONE, png: '', file: null });
    mount();
    await flush();
    expect(document.querySelector('[data-testid="qr"]')!.textContent).toBe(DONE.url);
    expect(document.querySelector('a[download]')).toBeNull();
    mounted.forEach((m) => m.unmount());
    mounted = [];

    mocks.renderPoster.mockRejectedValue(new Error('chunk'));
    mount();
    await flush();
    expect(document.querySelector('[data-testid="qr"]')!.textContent).toBe('https://tubutree.com/s/goc-xanh?ref=CTV1');
    expect(document.querySelector('a[download]')).toBeNull();
    expect(document.querySelector('[role="status"]')).toBeNull();
  });
});
