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
afterEach(() => {
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

  it('không dựng khi đóng hoặc không có tệp', () => {
    const r = mount(<ReviewMediaLightbox open={false} onClose={() => {}} items={ITEMS} index={0} onIndexChange={() => {}} author="A" rating={5} />);
    expect(document.querySelector('[data-testid="review-lightbox"]')).toBeNull();
    r.unmount();
    mounted = [];
    mount(<ReviewMediaLightbox open onClose={() => {}} items={[]} index={0} onIndexChange={() => {}} author="A" rating={5} />);
    expect(document.querySelector('[data-testid="review-lightbox"]')).toBeNull();
  });
});
