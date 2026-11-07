import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { useState } from 'react';
import { act, fireEvent, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { reviewMediaItems } from '@tubutree/app-core/commerce/review-media';
import { ReviewMediaLightbox } from './review-media-lightbox';

const ITEMS = reviewMediaItems({ images: ['/a.jpg', '/b.jpg'], videoUrl: 'https://v.example/x.mp4' });

function Host({ onClose = () => {}, onAdd, items = ITEMS }: { onClose?: () => void; onAdd?: () => void; items?: typeof ITEMS }) {
  const [index, setIndex] = useState(0);
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
const swipe = (dx: number, dy = 0) => {
  const pad = box().querySelector<HTMLElement>('[style*="touch-action"]')!;
  fireEvent.pointerDown(pad, { clientX: 200, clientY: 300 });
  fireEvent.pointerUp(pad, { clientX: 200 + dx, clientY: 300 + dy });
};

afterEach(() => {
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

  it('không dựng khi đóng hoặc không có tệp', () => {
    const a = render(<ReviewMediaLightbox open={false} onClose={() => {}} items={ITEMS} index={0} onIndexChange={() => {}} author="A" rating={5} />);
    expect(document.querySelector('[data-testid="review-lightbox"]')).toBeNull();
    a.unmount();
    render(<ReviewMediaLightbox open onClose={() => {}} items={[]} index={0} onIndexChange={() => {}} author="A" rating={5} />);
    expect(document.querySelector('[data-testid="review-lightbox"]')).toBeNull();
  });
});
