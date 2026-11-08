// @vitest-environment jsdom
import { useState } from 'react';
import { act } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { reviewMediaItems } from '@tubutree/app-core/commerce/review-media';
import { click, render, type Rendered } from '@/test-utils/dom';
import { smallTouchTargets, unnamedControls } from '@/test-utils/a11y';
import { ReviewMediaLightbox } from './review-media-lightbox';

const ITEMS = reviewMediaItems({ images: ['/a.jpg', '/b.jpg'], videoUrl: 'https://v.example/x.mp4' });

let mounted: Rendered[] = [];
/** Việc dọn của từng test (phần tử gắn thêm vào body, listener trên window, stub): chạy cả khi test hỏng giữa chừng. */
const cleanups: Array<() => void> = [];
afterEach(() => {
  cleanups.splice(0).forEach((fn) => fn());
  mounted.forEach((m) => m.unmount());
  mounted = [];
  document.body.style.overflow = '';
});

function Host({ onClose = () => {}, onAdd, start = 0, items = ITEMS }: { onClose?: () => void; onAdd?: () => void; start?: number; items?: typeof ITEMS }) {
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
const mount = (ui: React.ReactElement) => {
  const r = render(ui);
  mounted.push(r);
  return r;
};
const box = () => document.querySelector<HTMLElement>('[data-testid="review-lightbox"]')!;
const counter = () => box().querySelector('[aria-live="polite"]')!.textContent;
const key = (k: string) => act(() => void document.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true })));
/** Gửi một phím rồi trả về true nếu có handler đã `preventDefault`. */
const prevented = (k: string, init: KeyboardEventInit = {}, target: EventTarget = document) => {
  const ev = new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true, ...init });
  act(() => void target.dispatchEvent(ev));
  return ev.defaultPrevented;
};
/** Dựng lightbox với `index` cố định (không tự cập nhật) để đo đích mà phím gửi cho `onIndexChange`. */
function mountAt(index: number, items = ITEMS) {
  const onIndexChange = vi.fn();
  mount(<ReviewMediaLightbox open onClose={() => {}} items={items} index={index} onIndexChange={onIndexChange} author="Lan" rating={4} />);
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
const pointer = (type: string, x: number, y: number) =>
  act(() => {
    const ev = new MouseEvent(type, { bubbles: true, clientX: x, clientY: y });
    box().querySelector('[style*="touch-action"]')!.dispatchEvent(ev);
  });

describe('ReviewMediaLightbox (web)', () => {
  it('hộp thoại modal toàn màn hình: nền .review-lightbox, bộ đếm "1 / 3" số đều, người mua, số sao, Đã mua hàng, nhận xét', () => {
    mount(<Host />);
    expect(box().getAttribute('role')).toBe('dialog');
    expect(box().getAttribute('aria-modal')).toBe('true');
    expect(box().className).toContain('review-lightbox');
    expect(box().className).toContain('fixed inset-0');
    expect(counter()).toBe('1 / 3');
    expect(box().querySelector('[aria-live="polite"]')!.className).toContain('tabular-nums');
    expect(box().textContent).toContain('Lan');
    expect(box().querySelector('[aria-label="4 sao"]')).not.toBeNull();
    expect(box().textContent).toContain('Đã mua hàng');
    expect(box().textContent).toContain('Giao nhanh, đóng gói kỹ.');
    expect(box().querySelector<HTMLImageElement>('img')!.src).toBe('https://api.test/a.jpg');
  });

  it('khoá cuộn trang khi mở và trả lại khi đóng; focus vào nút ×', () => {
    document.body.style.overflow = 'auto';
    const r = mount(<Host />);
    expect(document.body.style.overflow).toBe('hidden');
    expect(document.activeElement).toBe(box().querySelector('button[aria-label="Đóng"]'));
    r.unmount();
    mounted = [];
    expect(document.body.style.overflow).toBe('auto');
  });

  it('nút Sau/Trước đổi tệp, quay vòng; tệp cuối là video có điều khiển', () => {
    mount(<Host />);
    click(box().querySelector('button[aria-label="Tệp sau"]'));
    expect(counter()).toBe('2 / 3');
    expect(box().querySelector<HTMLImageElement>('img')!.src).toBe('https://api.test/b.jpg');
    click(box().querySelector('button[aria-label="Tệp sau"]'));
    expect(counter()).toBe('3 / 3');
    const video = box().querySelector('video')!;
    expect(video.getAttribute('src')).toBe('https://v.example/x.mp4');
    expect(video.hasAttribute('controls')).toBe(true);
    expect(box().querySelector('img')).toBeNull();
    click(box().querySelector('button[aria-label="Tệp sau"]'));
    expect(counter()).toBe('1 / 3');
    click(box().querySelector('button[aria-label="Tệp trước"]'));
    expect(counter()).toBe('3 / 3');
  });

  it('phím ← → chuyển tệp; Esc đóng', () => {
    const onClose = vi.fn();
    mount(<Host onClose={onClose} />);
    key('ArrowRight');
    expect(counter()).toBe('2 / 3');
    key('ArrowLeft');
    key('ArrowLeft');
    expect(counter()).toBe('3 / 3');
    key('Escape');
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('vuốt ngang chuyển tệp; vuốt ngắn hoặc dọc thì không', () => {
    mount(<Host />);
    pointer('pointerdown', 200, 300);
    pointer('pointerup', 120, 305);
    expect(counter()).toBe('2 / 3');
    pointer('pointerdown', 100, 300);
    pointer('pointerup', 190, 300);
    expect(counter()).toBe('1 / 3');
    pointer('pointerdown', 200, 300);
    pointer('pointerup', 170, 300);
    expect(counter()).toBe('1 / 3');
    pointer('pointerdown', 200, 300);
    pointer('pointerup', 130, 420);
    expect(counter()).toBe('1 / 3');
  });

  it('đang ở video: kéo thanh tua và phím ← → của trình phát không chuyển tệp', () => {
    mount(<Host start={2} />);
    expect(counter()).toBe('3 / 3');
    const video = box().querySelector('video')!;
    act(() => void video.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, clientX: 200, clientY: 300 })));
    pointer('pointerup', 60, 300);
    expect(counter()).toBe('3 / 3');
    act(() => void video.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true })));
    expect(counter()).toBe('3 / 3');
    key('ArrowLeft');
    expect(counter()).toBe('2 / 3');
  });

  it('một tệp: không có nút Trước/Sau, phím mũi tên và vuốt không làm gì', () => {
    mount(<Host items={ITEMS.slice(0, 1)} />);
    expect(box().querySelector('button[aria-label="Tệp sau"]')).toBeNull();
    expect(box().querySelector('button[aria-label="Tệp trước"]')).toBeNull();
    key('ArrowRight');
    pointer('pointerdown', 200, 300);
    pointer('pointerup', 100, 300);
    expect(counter()).toBe('1 / 1');
  });

  it('vùng chạm ≥ 44px, nút có tên, đóng bằng ×', () => {
    const onClose = vi.fn();
    mount(<Host onClose={onClose} />);
    expect(unnamedControls(box())).toEqual([]);
    for (const b of Array.from(box().querySelectorAll('button'))) expect(b.className).toMatch(/h-11 w-11|min-h-11/);
    click(box().querySelector('button[aria-label="Đóng"]'));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('có onAdd thì chân có nút Thêm vào giỏ; không có thì không', () => {
    const onAdd = vi.fn();
    const a = mount(<Host onAdd={onAdd} />);
    const add = Array.from(box().querySelectorAll('button')).find((b) => b.textContent?.includes('Thêm vào giỏ'))!;
    expect(smallTouchTargets(box())).toEqual([]);
    click(add);
    expect(onAdd).toHaveBeenCalledTimes(1);
    a.unmount();
    mounted = [];
    mount(<Host />);
    expect(box().textContent).not.toContain('Thêm vào giỏ');
  });

  it('Tab quay vòng trong hộp (không rơi ra trang phía sau)', () => {
    mount(<Host />);
    const buttons = Array.from(box().querySelectorAll<HTMLElement>('button'));
    buttons[buttons.length - 1]!.focus();
    const ev = new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true });
    act(() => void document.dispatchEvent(ev));
    expect(ev.defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(buttons[0]);
  });

  it('khung hộp thoại nhận focus được (tabIndex -1) và không vẽ viền focus', () => {
    mount(<Host />);
    expect(box().getAttribute('tabindex')).toBe('-1');
    expect(box().className).toContain('outline-none');
  });

  it('Tab/Shift+Tab quay vòng giữa nút đầu và nút cuối; ở giữa thì để trình duyệt tự chuyển', () => {
    mount(<Host />);
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
    mount(<Host />);
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
    mount(<Host onAdd={withAdd ? () => {} : undefined} />);
    const first = box().querySelector<HTMLElement>('button')!;
    const comment = box().querySelector<HTMLElement>('p')!;
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
    mount(<Host items={ITEMS.slice(2)} />);
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
    mount(<Host onClose={onClose} />);
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
    mount(<ReviewMediaLightbox open onClose={onClose} items={ITEMS} index={1} onIndexChange={onIndexChange} author="Lan" rating={4} />);
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
    const onIndexChange = mountAt(index);
    expect(counter()).toBe(index > 0 ? '3 / 3' : '1 / 3');
    key(pressed);
    expect(onIndexChange).toHaveBeenCalledTimes(1);
    expect(onIndexChange).toHaveBeenCalledWith(to);
  });

  it('Home/End nhảy về tệp đầu và tệp cuối', () => {
    mount(<Host start={1} />);
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
    const onIndexChange = mountAt(index);
    expect(prevented(pressed)).toBe(true);
    expect(onIndexChange.mock.calls.map((c) => c[0])).toEqual(calls);
  });

  it('đang focus trên video: Home/End/← → là phím của trình phát, không chuyển tệp và không bị chặn', () => {
    mount(<Host start={2} />);
    const video = box().querySelector('video')!;
    for (const k of ['Home', 'End', 'ArrowLeft', 'ArrowRight']) expect(prevented(k, {}, video), k).toBe(false);
    expect(counter()).toBe('3 / 3');
  });

  it('một tệp: Home/End/← → không làm gì và không chặn phím', () => {
    const onIndexChange = mountAt(0, ITEMS.slice(0, 1));
    for (const k of ['Home', 'End', 'ArrowLeft', 'ArrowRight']) expect(prevented(k), k).toBe(false);
    expect(onIndexChange).not.toHaveBeenCalled();
  });

  it('không dựng khi đóng hoặc không có tệp', () => {
    const r = mount(<ReviewMediaLightbox open={false} onClose={() => {}} items={ITEMS} index={0} onIndexChange={() => {}} author="A" rating={5} />);
    expect(document.querySelector('[data-testid="review-lightbox"]')).toBeNull();
    r.unmount();
    mounted = [];
    mount(<ReviewMediaLightbox open onClose={() => {}} items={[]} index={0} onIndexChange={() => {}} author="A" rating={5} />);
    expect(document.querySelector('[data-testid="review-lightbox"]')).toBeNull();
  });
});
