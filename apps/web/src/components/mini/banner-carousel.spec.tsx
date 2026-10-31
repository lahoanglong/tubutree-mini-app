// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, type ReactElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { renderToString } from 'react-dom/server';
import { click } from '@/test-utils/dom';

vi.mock('next/link', () => ({
  default: ({ href, children, ...p }: { href: string; children: React.ReactNode }) => <a href={href} {...p}>{children}</a>,
}));

import { BannerCarousel, type BannerSlide } from './banner-carousel';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const SLIDES: BannerSlide[] = [
  { id: 'a', image: 'https://cdn.example/a.jpg', alt: 'Giảm 20% mỹ phẩm', href: '/campaign/a' },
  { id: 'b', image: 'https://cdn.example/b.jpg', alt: 'Giờ vàng 20:00', href: '/campaign/b' },
  { id: 'c', image: 'https://cdn.example/c.jpg', alt: 'Đổi rác lấy quà', href: '/campaign/c' },
];

let roots: { root: Root; el: HTMLElement }[] = [];
function mountPlain(ui: ReactElement) {
  const el = document.createElement('div');
  document.body.appendChild(el);
  const root = createRoot(el);
  roots.push({ root, el });
  act(() => root.render(ui));
  return {
    rerender: (next: ReactElement) => act(() => root.render(next)),
    unmount: () => { act(() => root.unmount()); el.remove(); },
  };
}

const realMatchMedia = window.matchMedia;
function setReducedMotion(v: boolean | 'missing') {
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    writable: true,
    value: v === 'missing' ? undefined : (media: string) => ({ matches: v, media, onchange: null, addEventListener: () => {}, removeEventListener: () => {}, addListener: () => {}, removeListener: () => {}, dispatchEvent: () => false }),
  });
}
let visibility: 'visible' | 'hidden' = 'visible';
function setVisibility(v: 'visible' | 'hidden') {
  visibility = v;
  act(() => { document.dispatchEvent(new Event('visibilitychange')); });
}
const fire = (el: Element, ev: Event) => act(() => { el.dispatchEvent(ev); });
const advance = (ms: number) => act(() => { vi.advanceTimersByTime(ms); });
const section = () => document.querySelector<HTMLElement>('section[aria-roledescription="carousel"]')!;
const pauseBtn = () => document.querySelector<HTMLButtonElement>('button[aria-label="Dừng tự chuyển"]')!;
const dots = () => Array.from(document.querySelectorAll<HTMLButtonElement>('button[aria-label^="Xem chương trình"]'));
const currentDot = () => dots().findIndex((d) => d.getAttribute('aria-current') === 'true');
const slideEls = () => Array.from(document.querySelectorAll<HTMLElement>('[aria-roledescription="slide"]'));
const link = (name: string) => Array.from(document.querySelectorAll<HTMLAnchorElement>('a')).find((a) => a.textContent === name || a.querySelector('img')?.alt === name)!;

beforeEach(() => {
  vi.useFakeTimers();
  visibility = 'visible';
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => visibility });
  setReducedMotion(false);
});
afterEach(() => {
  roots.forEach(({ root, el }) => {
    try { act(() => root.unmount()); } catch { /* đã gỡ trong test */ }
    el.remove();
  });
  roots = [];
  vi.useRealTimers();
  Object.defineProperty(window, 'matchMedia', { configurable: true, writable: true, value: realMatchMedia });
});

describe('BannerCarousel (web)', () => {
  it('khung: section carousel có tên; slide có tên "alt, i trên n"; chỉ slide đang hiện không inert', () => {
    mountPlain(<BannerCarousel slides={SLIDES} />);
    expect(section().getAttribute('aria-label')).toBe('Chương trình nổi bật');
    expect(slideEls()[0]!.getAttribute('aria-label')).toBe('Giảm 20% mỹ phẩm, 1 trên 3');
    expect(slideEls()[0]!.getAttribute('role')).toBe('group');
    expect(slideEls().map((s) => s.hasAttribute('inert'))).toEqual([false, true, true]);
  });

  it('máy chủ (trước mount): không tự chạy, mọi slide có mặt, chỉ slide đầu không inert', () => {
    const html = renderToString(<BannerCarousel slides={SLIDES} />);
    expect(html).toContain('aria-roledescription="carousel"');
    expect((html.match(/aria-roledescription="slide"/g) ?? []).length).toBe(3);
    expect((html.match(/ inert=""/g) ?? []).length).toBe(2);
    expect(html).toContain('aria-live="polite"');
  });

  it('tự chuyển sau 5 giây: chấm, inert theo slide mới', () => {
    mountPlain(<BannerCarousel slides={SLIDES} />);
    expect(currentDot()).toBe(0);
    advance(4999);
    expect(currentDot()).toBe(0);
    advance(1);
    expect(currentDot()).toBe(1);
    expect(slideEls().map((s) => s.hasAttribute('inert'))).toEqual([true, false, true]);
  });

  it('intervalMs dưới 5000 vẫn chờ đủ 5 giây; từ 5000 trở lên giữ nguyên', () => {
    const m = mountPlain(<BannerCarousel slides={SLIDES} intervalMs={1000} />);
    advance(4999);
    expect(currentDot()).toBe(0);
    advance(1);
    expect(currentDot()).toBe(1);
    m.rerender(<BannerCarousel slides={SLIDES} intervalMs={8000} />);
    advance(7999);
    expect(currentDot()).toBe(1);
    advance(1);
    expect(currentDot()).toBe(2);
  });

  it('khách bật giảm chuyển động, hoặc trình duyệt không có matchMedia: đứng yên', () => {
    setReducedMotion(true);
    const a = mountPlain(<BannerCarousel slides={SLIDES} />);
    advance(20_000);
    expect(currentDot()).toBe(0);
    a.unmount();
    setReducedMotion('missing');
    mountPlain(<BannerCarousel slides={SLIDES} />);
    advance(20_000);
    expect(currentDot()).toBe(0);
  });

  it('nút Dừng đứng đầu thứ tự DOM, aria-pressed phản ánh trạng thái, bấm dừng rồi chạy tiếp', () => {
    mountPlain(<BannerCarousel slides={SLIDES} />);
    expect(pauseBtn().getAttribute('aria-pressed')).toBe('false');
    expect(section().querySelector('button')).toBe(pauseBtn());
    expect(pauseBtn().compareDocumentPosition(slideEls()[0]!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    click(pauseBtn());
    expect(pauseBtn().getAttribute('aria-pressed')).toBe('true');
    advance(20_000);
    expect(currentDot()).toBe(0);
    click(pauseBtn());
    advance(5000);
    expect(currentDot()).toBe(1);
  });

  it('focus vào banner thì dừng, rời ra thì chạy lại; chạm giữ, thả thì chạy lại', () => {
    mountPlain(<BannerCarousel slides={SLIDES} />);
    const a = link('Giảm 20% mỹ phẩm');
    fire(a, new FocusEvent('focusin', { bubbles: true }));
    advance(20_000);
    expect(currentDot()).toBe(0);
    fire(a, new FocusEvent('focusout', { bubbles: true, relatedTarget: null }));
    advance(5000);
    expect(currentDot()).toBe(1);

    fire(section(), new Event('touchstart', { bubbles: true }));
    advance(20_000);
    expect(currentDot()).toBe(1);
    fire(section(), new Event('touchend', { bubbles: true }));
    advance(5000);
    expect(currentDot()).toBe(2);
  });

  it('chuột đứng trong banner thì dừng, rời ra thì chạy lại; ngón tay không tính là rê chuột', () => {
    mountPlain(<BannerCarousel slides={SLIDES} />);
    const ptr = (type: string, pointerType: string) => new PointerEvent(type, { bubbles: true, pointerType });
    fire(section(), ptr('pointerover', 'touch'));
    advance(5000);
    expect(currentDot()).toBe(1);
    fire(section(), ptr('pointerout', 'touch'));
    fire(section(), ptr('pointerover', 'mouse'));
    advance(20_000);
    expect(currentDot()).toBe(1);
    fire(section(), ptr('pointerout', 'mouse'));
    advance(5000);
    expect(currentDot()).toBe(2);
  });

  it('focus nằm trên nút Dừng không giữ banner', () => {
    mountPlain(<BannerCarousel slides={SLIDES} />);
    fire(pauseBtn(), new FocusEvent('focusin', { bubbles: true }));
    advance(5000);
    expect(currentDot()).toBe(1);
  });

  it('tab ẩn thì dừng, hiện lại thì chạy', () => {
    mountPlain(<BannerCarousel slides={SLIDES} />);
    setVisibility('hidden');
    advance(20_000);
    expect(currentDot()).toBe(0);
    setVisibility('visible');
    advance(5000);
    expect(currentDot()).toBe(1);
  });

  it('một slide: không chấm, không nút Dừng, không chuyển; không slide: render rỗng', () => {
    const a = mountPlain(<BannerCarousel slides={SLIDES.slice(0, 1)} />);
    expect(document.querySelector('button')).toBeNull();
    advance(20_000);
    expect(slideEls()).toHaveLength(1);
    expect(slideEls()[0]!.hasAttribute('inert')).toBe(false);
    a.unmount();
    const b = mountPlain(<BannerCarousel slides={[]} />);
    expect(document.querySelector('section')).toBeNull();
    b.unmount();
  });

  it('slides co lại khi đang ở slide cuối: chỉ số kẹp về slide hợp lệ, không lỗi', () => {
    const m = mountPlain(<BannerCarousel slides={SLIDES} />);
    advance(5000);
    advance(5000);
    expect(currentDot()).toBe(2);
    m.rerender(<BannerCarousel slides={SLIDES.slice(0, 2)} />);
    expect(currentDot()).toBe(1);
    expect(slideEls().map((s) => s.hasAttribute('inert'))).toEqual([true, false]);
    advance(5000);
    expect(currentDot()).toBe(0);
  });

  it('aria-live "off" khi đang tự chạy, "polite" khi đã dừng', () => {
    mountPlain(<BannerCarousel slides={SLIDES} />);
    const track = document.querySelector('[aria-live]')!;
    expect(track.getAttribute('aria-live')).toBe('off');
    click(pauseBtn());
    expect(track.getAttribute('aria-live')).toBe('polite');
  });

  it('bấm chấm: tới đúng slide; chấm là nút 44×44 có tên', () => {
    mountPlain(<BannerCarousel slides={SLIDES} />);
    expect(dots().map((d) => d.getAttribute('aria-label'))).toEqual(['Xem chương trình 1', 'Xem chương trình 2', 'Xem chương trình 3']);
    for (const d of dots()) {
      expect(d.style.width).toBe('44px');
      expect(d.style.height).toBe('44px');
    }
    click(dots()[2]!);
    expect(currentDot()).toBe(2);
  });

  it('cả slide là liên kết thật (next/link) tên theo alt, href đúng', () => {
    mountPlain(<BannerCarousel slides={SLIDES} />);
    const a = link('Giờ vàng 20:00');
    expect(a.getAttribute('href')).toBe('/campaign/b');
    expect(a.querySelector('img')!.alt).toBe('Giờ vàng 20:00');
  });

  it('slide đầu tải ngay, các slide sau tải lười', () => {
    mountPlain(<BannerCarousel slides={SLIDES} />);
    expect(Array.from(document.querySelectorAll('img')).map((i) => i.getAttribute('loading'))).toEqual(['eager', 'lazy', 'lazy']);
  });

  it('ảnh lỗi: hiện chữ alt trên nền phụ, liên kết vẫn còn', () => {
    mountPlain(<BannerCarousel slides={SLIDES.slice(0, 2)} />);
    expect(document.querySelectorAll('img')).toHaveLength(2);
    fire(document.querySelector('img')!, new Event('error'));
    expect(document.querySelectorAll('img')).toHaveLength(1);
    expect(link('Giảm 20% mỹ phẩm').textContent).toBe('Giảm 20% mỹ phẩm');
  });
});
