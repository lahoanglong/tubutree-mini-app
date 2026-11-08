import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { useState } from 'react';
import { act, fireEvent, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { reviewMediaItems } from '@tubutree/app-core/commerce/review-media';
import { ReviewMediaLightbox } from './review-media-lightbox';

const ITEMS = reviewMediaItems({ images: ['/a.jpg', '/b.jpg'], videoUrl: 'https://v.example/x.mp4' });

function Host({ onClose = () => {}, onAdd, items = ITEMS, start = 0 }: { onClose?: () => void; onAdd?: () => void; items?: typeof ITEMS; start?: number }) {
  const [index, setIndex] = useState(start);
  return (
    <ReviewMediaLightbox
      open
      onClose={onClose}
      items={items}
      index={index}
      onIndexChange={setIndex}
      author="Lan"
      rating={4}
      verifiedPurchase
      comment="Giao nhanh, đóng gói kỹ."
      resolveSrc={(s) => (s.startsWith('/') ? `https://api.test${s}` : s)}
      onAdd={onAdd}
    />
  );
}

const box = () => document.querySelector<HTMLElement>('[data-testid="review-lightbox"]')!;
const counter = () => box().querySelector('[aria-live="polite"]')!.textContent;
const key = (k: string) => fireEvent.keyDown(document, { key: k });
/** Gửi một phím rồi trả về true nếu có handler đã `preventDefault`. */
const prevented = (k: string, init: KeyboardEventInit = {}, target: Document | Element = document) => !fireEvent.keyDown(target, { key: k, ...init });
/** Dựng lightbox với `index` cố định (không tự cập nhật) để đo đích mà phím gửi cho `onIndexChange`. */
function renderAt(index: number, items = ITEMS) {
  const onIndexChange = vi.fn();
  render(<ReviewMediaLightbox open onClose={() => {}} items={items} index={index} onIndexChange={onIndexChange} author="Lan" rating={4} />);
  return onIndexChange;
}
/** Hộp modal khác mở SAU lightbox (portal cuối DOM). */
function openModalAbove() {
  const other = document.createElement('div');
  other.setAttribute('aria-modal', 'true');
  document.body.appendChild(other);
  cleanups.push(() => other.remove());
  return other;
}
/** Nút của trang phía sau lightbox. */
function addPageButton() {
  const outside = document.createElement('button');
  document.body.appendChild(outside);
  cleanups.push(() => outside.remove());
  return outside;
}
/** Đếm phím keydown nổi bọt tới window. */
function watchWindowKeys() {
  const spy = vi.fn();
  window.addEventListener('keydown', spy);
  cleanups.push(() => window.removeEventListener('keydown', spy));
  return spy;
}
const swipe = (dx: number, dy = 0) => {
  const pad = box().querySelector<HTMLElement>('[style*="touch-action"]')!;
  fireEvent.pointerDown(pad, { clientX: 200, clientY: 300 });
  fireEvent.pointerUp(pad, { clientX: 200 + dx, clientY: 300 + dy });
};

/** Việc dọn của từng test (phần tử gắn thêm vào body, listener trên window, stub): chạy cả khi test hỏng giữa chừng. */
const cleanups: Array<() => void> = [];
afterEach(() => {
  cleanups.splice(0).forEach((fn) => fn());
  document.body.style.overflow = '';
});

describe('ReviewMediaLightbox (Mini)', () => {
  it('hộp thoại modal: nền .review-lightbox, bộ đếm "1 / 3" số đều, người mua, số sao, Đã mua hàng, nhận xét', () => {
    render(<Host />);
    expect(box().getAttribute('role')).toBe('dialog');
    expect(box().getAttribute('aria-modal')).toBe('true');
    expect(box().className).toContain('review-lightbox');
    expect(counter()).toBe('1 / 3');
    expect(box().querySelector<HTMLElement>('[aria-live="polite"]')!.style.fontVariantNumeric).toBe('tabular-nums');
    expect(box().textContent).toContain('Lan');
    expect(box().querySelector('[aria-label="4 sao"]')).not.toBeNull();
    expect(box().textContent).toContain('Đã mua hàng');
    expect(box().textContent).toContain('Giao nhanh, đóng gói kỹ.');
    expect(box().querySelector('img')!.getAttribute('src')).toBe('https://api.test/a.jpg');
  });

  it('khoá cuộn trang khi mở, trả lại khi đóng; focus vào nút ×', () => {
    document.body.style.overflow = 'auto';
    const { unmount } = render(<Host />);
    expect(document.body.style.overflow).toBe('hidden');
    expect(document.activeElement).toBe(box().querySelector('button[aria-label="Đóng"]'));
    unmount();
    expect(document.body.style.overflow).toBe('auto');
  });

  it('nút Sau/Trước đổi tệp và quay vòng; tệp cuối là video có điều khiển', () => {
    render(<Host />);
    fireEvent.click(box().querySelector('button[aria-label="Tệp sau"]')!);
    expect(counter()).toBe('2 / 3');
    fireEvent.click(box().querySelector('button[aria-label="Tệp sau"]')!);
    expect(counter()).toBe('3 / 3');
    expect(box().querySelector('video')!.hasAttribute('controls')).toBe(true);
    expect(box().querySelector('img')).toBeNull();
    fireEvent.click(box().querySelector('button[aria-label="Tệp sau"]')!);
    expect(counter()).toBe('1 / 3');
    fireEvent.click(box().querySelector('button[aria-label="Tệp trước"]')!);
    expect(counter()).toBe('3 / 3');
  });

  it('phím ← → chuyển tệp; Esc đóng', () => {
    const onClose = vi.fn();
    render(<Host onClose={onClose} />);
    key('ArrowRight');
    expect(counter()).toBe('2 / 3');
    key('ArrowLeft');
    key('ArrowLeft');
    expect(counter()).toBe('3 / 3');
    key('Escape');
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('vuốt ngang chuyển tệp; vuốt ngắn hoặc chéo dọc thì không', () => {
    render(<Host />);
    swipe(-80, 5);
    expect(counter()).toBe('2 / 3');
    swipe(90);
    expect(counter()).toBe('1 / 3');
    swipe(-30);
    expect(counter()).toBe('1 / 3');
    swipe(-70, 120);
    expect(counter()).toBe('1 / 3');
  });

  it('đang ở video: kéo thanh tua và phím ← → của trình phát không chuyển tệp', () => {
    render(<Host />);
    key('ArrowRight');
    key('ArrowRight');
    expect(counter()).toBe('3 / 3');
    const video = box().querySelector('video')!;
    const pad = box().querySelector<HTMLElement>('[style*="touch-action"]')!;
    fireEvent.pointerDown(video, { clientX: 200, clientY: 300 });
    fireEvent.pointerUp(pad, { clientX: 60, clientY: 300 });
    expect(counter()).toBe('3 / 3');
    fireEvent.keyDown(video, { key: 'ArrowLeft' });
    expect(counter()).toBe('3 / 3');
    swipe(120);
    expect(counter()).toBe('2 / 3');
  });

  it('lớp phủ nằm trên thanh back của Zalo (z-index 500, như chi tiết thông báo); × đứng đầu thanh, chừa góc phải cho capsule', () => {
    render(<Host />);
    const css = readFileSync(resolve(__dirname, '../css/tokens.css'), 'utf8');
    expect(/\.review-lightbox \{[^}]*\}/.exec(css)?.[0]).toMatch(/z-index: 500;/);
    expect(/\.review-lightbox__bar \{[^}]*\}/.exec(css)?.[0]).toMatch(/justify-content: flex-start;/);
    const bar = box().querySelector('.review-lightbox__bar')!;
    expect(bar.firstElementChild!.getAttribute('aria-label')).toBe('Đóng');
  });

  it('một tệp: không có nút Trước/Sau, mũi tên và vuốt không làm gì', () => {
    render(<Host items={ITEMS.slice(0, 1)} />);
    expect(box().querySelector('button[aria-label="Tệp sau"]')).toBeNull();
    expect(box().querySelector('button[aria-label="Tệp trước"]')).toBeNull();
    key('ArrowRight');
    swipe(-100);
    expect(counter()).toBe('1 / 1');
  });

  it('nút back của Zalo (popstate) đóng lightbox; mở thì đẩy một mục lịch sử', () => {
    const onClose = vi.fn();
    const push = vi.spyOn(window.history, 'pushState');
    render(<Host onClose={onClose} />);
    expect(push).toHaveBeenCalledTimes(1);
    act(() => void window.dispatchEvent(new PopStateEvent('popstate')));
    expect(onClose).toHaveBeenCalledTimes(1);
    push.mockRestore();
  });

  it('mọi nút ≥ 44px, có tên; có onAdd thì chân có "Thêm vào giỏ", không có thì không', () => {
    const onAdd = vi.fn();
    const a = render(<Host onAdd={onAdd} />);
    // Số đo 44px nằm ở css/tokens.css (jsdom không nạp CSS): ở đây khoá việc mọi nút dùng đúng lớp có 44px, vùng chạm thật do e2e (review-lightbox.miniapp.spec.ts) đo.
    for (const b of Array.from(box().querySelectorAll<HTMLElement>('button'))) {
      expect(b.getAttribute('aria-label') ?? b.textContent).toBeTruthy();
      expect(b.className).toMatch(/review-lightbox__(btn|add)\b/);
    }
    const css = readFileSync(resolve(__dirname, '../css/tokens.css'), 'utf8');
    for (const cls of ['btn', 'add']) {
      const rule = new RegExp(`\\.review-lightbox__${cls} \\{[^}]*\\}`).exec(css)?.[0] ?? '';
      expect(rule, `.review-lightbox__${cls}`).toMatch(cls === 'btn' ? /width: 44px;[\s\S]*height: 44px;/ : /min-height: 44px;/);
    }
    const add = Array.from(box().querySelectorAll('button')).find((b) => b.textContent?.includes('Thêm vào giỏ'))!;
    fireEvent.click(add);
    expect(onAdd).toHaveBeenCalledTimes(1);
    a.unmount();
    render(<Host />);
    expect(box().textContent).not.toContain('Thêm vào giỏ');
  });

  it('khung hộp thoại nhận focus được (tabIndex -1) và không vẽ viền focus', () => {
    render(<Host />);
    expect(box().getAttribute('tabindex')).toBe('-1');
    const css = readFileSync(resolve(__dirname, '../css/tokens.css'), 'utf8');
    expect(/\.review-lightbox \{[^}]*\}/.exec(css)?.[0]).toMatch(/outline: none;/);
  });

  it('Tab/Shift+Tab quay vòng giữa nút đầu và nút cuối; ở giữa thì để trình duyệt tự chuyển', () => {
    render(<Host />);
    const buttons = Array.from(box().querySelectorAll<HTMLElement>('button'));
    const first = buttons[0]!;
    const last = buttons[buttons.length - 1]!;
    last.focus();
    expect(prevented('Tab')).toBe(true);
    expect(document.activeElement).toBe(first);
    expect(prevented('Tab', { shiftKey: true })).toBe(true);
    expect(document.activeElement).toBe(last);
    buttons[1]!.focus();
    expect(prevented('Tab')).toBe(false);
    expect(prevented('Tab', { shiftKey: true })).toBe(false);
    expect(document.activeElement).toBe(buttons[1]);
  });

  it('focus đang ở ngoài hộp hoặc ở chính khung: Tab kéo vào nút đầu, Shift+Tab kéo vào nút cuối', () => {
    render(<Host />);
    const buttons = Array.from(box().querySelectorAll<HTMLElement>('button'));
    const first = buttons[0]!;
    const last = buttons[buttons.length - 1]!;
    const outside = addPageButton();
    outside.focus();
    expect(prevented('Tab')).toBe(true);
    expect(document.activeElement).toBe(first);
    outside.focus();
    expect(prevented('Tab', { shiftKey: true })).toBe(true);
    expect(document.activeElement).toBe(last);
    box().focus();
    expect(document.activeElement).toBe(box());
    expect(prevented('Tab')).toBe(false);
    expect(prevented('Tab', { shiftKey: true })).toBe(true);
    expect(document.activeElement).toBe(last);
  });

  it.each([
    { withAdd: false, tabWraps: true },
    { withAdd: true, tabWraps: false },
  ])('focus ở ô nhận xét (nằm ngoài danh sách Tab, onAdd=$withAdd): Tab quay vòng=$tabWraps, Shift+Tab luôn để trình duyệt tự lùi', ({ withAdd, tabWraps }) => {
    render(<Host onAdd={withAdd ? () => {} : undefined} />);
    const first = box().querySelector<HTMLElement>('button')!;
    const comment = box().querySelector<HTMLElement>('.review-lightbox__comment')!;
    comment.tabIndex = -1;
    comment.focus();
    expect(document.activeElement).toBe(comment);
    expect(prevented('Tab')).toBe(tabWraps);
    if (tabWraps) expect(document.activeElement).toBe(first);
    comment.focus();
    expect(prevented('Tab', { shiftKey: true })).toBe(false);
    expect(document.activeElement).toBe(comment);
  });

  it('video có điều khiển nằm trong vòng Tab của hộp; focus đang ở video thì Tab để trình phát tự xử', () => {
    render(<Host items={ITEMS.slice(2)} />);
    const video = box().querySelector('video')!;
    const close = box().querySelector<HTMLElement>('button[aria-label="Đóng"]')!;
    const focusVideo = vi.spyOn(video, 'focus');
    close.focus();
    expect(prevented('Tab')).toBe(false);
    expect(prevented('Tab', { shiftKey: true })).toBe(true);
    expect(focusVideo).toHaveBeenCalledTimes(1);
    // Nút của trình phát nằm trong shadow DOM: activeElement vẫn là <video> dù focus đang ở một nút trong đó.
    const stub = vi.spyOn(document, 'activeElement', 'get').mockReturnValue(video);
    cleanups.push(() => stub.mockRestore());
    expect(prevented('Tab')).toBe(false);
    expect(prevented('Tab', { shiftKey: true })).toBe(false);
  });

  it('Esc đóng và không nổi bọt lên window; Esc khi đang gõ IME bị bỏ qua; ← → Home End chặn hành vi mặc định', () => {
    const onClose = vi.fn();
    const onWindowKey = watchWindowKeys();
    render(<Host onClose={onClose} />);
    expect(prevented('Escape', { isComposing: true })).toBe(false);
    expect(onClose).not.toHaveBeenCalled();
    expect(prevented('Escape')).toBe(false);
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onWindowKey).toHaveBeenCalledTimes(1);
    for (const k of ['ArrowRight', 'ArrowLeft', 'Home', 'End']) expect(prevented(k), k).toBe(true);
  });

  it('hộp modal khác mở sau giữ bàn phím: Esc, ← →, Home/End, Tab không tác động lên lightbox; đóng hộp đó thì lightbox nhận phím lại', () => {
    const onClose = vi.fn();
    const onIndexChange = vi.fn();
    render(<ReviewMediaLightbox open onClose={onClose} items={ITEMS} index={1} onIndexChange={onIndexChange} author="Lan" rating={4} />);
    const buttons = Array.from(box().querySelectorAll<HTMLElement>('button'));
    const last = buttons[buttons.length - 1]!;
    const above = openModalAbove();
    const onWindowKey = watchWindowKeys();
    last.focus();
    const keys = ['Escape', 'ArrowLeft', 'ArrowRight', 'Home', 'End', 'Tab'];
    for (const k of keys) expect(prevented(k), k).toBe(false);
    expect(onWindowKey).toHaveBeenCalledTimes(keys.length);
    expect(onClose).not.toHaveBeenCalled();
    expect(onIndexChange).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(last);
    above.remove();
    expect(prevented('ArrowRight')).toBe(true);
    expect(onIndexChange).toHaveBeenCalledWith(2);
    key('Escape');
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it.each([
    { index: 99, pressed: 'ArrowRight', to: 0 },
    { index: 99, pressed: 'ArrowLeft', to: 1 },
    { index: -2, pressed: 'ArrowRight', to: 1 },
    { index: -2, pressed: 'ArrowLeft', to: 2 },
  ])('index $index ngoài khoảng: $pressed bước tiếp từ vị trí đã kẹp, tới $to', ({ index, pressed, to }) => {
    const onIndexChange = renderAt(index);
    expect(counter()).toBe(index > 0 ? '3 / 3' : '1 / 3');
    key(pressed);
    expect(onIndexChange).toHaveBeenCalledTimes(1);
    expect(onIndexChange).toHaveBeenCalledWith(to);
  });

  it('Home/End nhảy về tệp đầu và tệp cuối', () => {
    render(<Host start={1} />);
    expect(prevented('End')).toBe(true);
    expect(counter()).toBe('3 / 3');
    expect(prevented('Home')).toBe(true);
    expect(counter()).toBe('1 / 3');
  });

  it.each([
    { index: 0, pressed: 'Home', calls: [] },
    { index: 0, pressed: 'End', calls: [2] },
    { index: 2, pressed: 'End', calls: [] },
    { index: 2, pressed: 'Home', calls: [0] },
    { index: 99, pressed: 'End', calls: [] },
    { index: 99, pressed: 'Home', calls: [0] },
    { index: -2, pressed: 'Home', calls: [] },
    { index: -2, pressed: 'End', calls: [2] },
  ])('index $index: $pressed gọi onIndexChange với $calls (không gọi thừa khi đã ở đầu/cuối)', ({ index, pressed, calls }) => {
    const onIndexChange = renderAt(index);
    expect(prevented(pressed)).toBe(true);
    expect(onIndexChange.mock.calls.map((c) => c[0])).toEqual(calls);
  });

  it('đang focus trên video: Home/End/← → là phím của trình phát, không chuyển tệp và không bị chặn', () => {
    render(<Host start={2} />);
    const video = box().querySelector('video')!;
    for (const k of ['Home', 'End', 'ArrowLeft', 'ArrowRight']) expect(prevented(k, {}, video), k).toBe(false);
    expect(counter()).toBe('3 / 3');
  });

  it('một tệp: Home/End/← → không làm gì và không chặn phím', () => {
    const onIndexChange = renderAt(0, ITEMS.slice(0, 1));
    for (const k of ['Home', 'End', 'ArrowLeft', 'ArrowRight']) expect(prevented(k), k).toBe(false);
    expect(onIndexChange).not.toHaveBeenCalled();
  });

  it('không dựng khi đóng hoặc không có tệp', () => {
    const a = render(<ReviewMediaLightbox open={false} onClose={() => {}} items={ITEMS} index={0} onIndexChange={() => {}} author="A" rating={5} />);
    expect(document.querySelector('[data-testid="review-lightbox"]')).toBeNull();
    a.unmount();
    render(<ReviewMediaLightbox open onClose={() => {}} items={[]} index={0} onIndexChange={() => {}} author="A" rating={5} />);
    expect(document.querySelector('[data-testid="review-lightbox"]')).toBeNull();
  });
});
