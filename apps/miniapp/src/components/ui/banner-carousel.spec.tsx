import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type * as ZmpUi from 'zmp-ui';

const mocks = vi.hoisted(() => ({ navigate: vi.fn() }));
vi.mock('zmp-ui', async (importOriginal) => ({ ...(await importOriginal<typeof ZmpUi>()), useNavigate: () => mocks.navigate }));

import { BannerCarousel, type BannerSlide } from './banner-carousel';

const SLIDES: BannerSlide[] = [
  { id: 'a', image: 'https://cdn.example/a.jpg', alt: 'Giảm 20% mỹ phẩm', href: '/campaign/a' },
  { id: 'b', image: 'https://cdn.example/b.jpg', alt: 'Giờ vàng 20:00', href: '/campaign/b' },
  { id: 'c', image: 'https://cdn.example/c.jpg', alt: 'Đổi rác lấy quà', href: '/campaign/c' },
];

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
const advance = (ms: number) => act(() => { vi.advanceTimersByTime(ms); });
const dots = () => screen.getAllByRole('button', { name: /^Xem chương trình/ });
const currentDot = () => dots().findIndex((d) => d.getAttribute('aria-current') === 'true');
const slideEls = () => Array.from(document.querySelectorAll<HTMLElement>('[aria-roledescription="slide"]'));

beforeEach(() => {
  vi.useFakeTimers();
  visibility = 'visible';
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => visibility });
  setReducedMotion(false);
  vi.clearAllMocks();
});
afterEach(() => {
  vi.useRealTimers();
  Object.defineProperty(window, 'matchMedia', { configurable: true, writable: true, value: realMatchMedia });
});

describe('BannerCarousel', () => {
  it('khung: section carousel có tên; slide có tên "alt, i trên n"; chỉ slide đang hiện không inert', () => {
    render(<BannerCarousel slides={SLIDES} />);
    const section = screen.getByRole('region', { name: 'Chương trình nổi bật' });
    expect(section).toHaveAttribute('aria-roledescription', 'carousel');
    expect(screen.getByRole('group', { name: 'Giảm 20% mỹ phẩm, 1 trên 3' })).toHaveAttribute('aria-roledescription', 'slide');
    expect(slideEls().map((s) => s.hasAttribute('inert'))).toEqual([false, true, true]);
  });

  it('tự chuyển sau 5 giây: chấm, inert theo slide mới', () => {
    render(<BannerCarousel slides={SLIDES} />);
    expect(currentDot()).toBe(0);
    advance(4999);
    expect(currentDot()).toBe(0);
    advance(1);
    expect(currentDot()).toBe(1);
    expect(slideEls().map((s) => s.hasAttribute('inert'))).toEqual([true, false, true]);
  });

  it('intervalMs dưới 5000 vẫn chờ đủ 5 giây; từ 5000 trở lên giữ nguyên', () => {
    const { rerender } = render(<BannerCarousel slides={SLIDES} intervalMs={1000} />);
    advance(4999);
    expect(currentDot()).toBe(0);
    advance(1);
    expect(currentDot()).toBe(1);
    rerender(<BannerCarousel slides={SLIDES} intervalMs={8000} />);
    advance(7999);
    expect(currentDot()).toBe(1);
    advance(1);
    expect(currentDot()).toBe(2);
  });

  it('khách bật giảm chuyển động, hoặc trình duyệt không có matchMedia: đứng yên', () => {
    setReducedMotion(true);
    const a = render(<BannerCarousel slides={SLIDES} />);
    advance(20_000);
    expect(currentDot()).toBe(0);
    a.unmount();
    setReducedMotion('missing');
    render(<BannerCarousel slides={SLIDES} />);
    advance(20_000);
    expect(currentDot()).toBe(0);
  });

  it('nút Dừng đứng trước slide đầu, aria-pressed phản ánh trạng thái, bấm dừng rồi chạy tiếp', () => {
    const { container } = render(<BannerCarousel slides={SLIDES} />);
    const pause = screen.getByRole('button', { name: 'Dừng tự chuyển' });
    expect(pause).toHaveAttribute('aria-pressed', 'false');
    expect(pause.compareDocumentPosition(slideEls()[0]!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(container.querySelector('button')).toBe(pause);
    fireEvent.click(pause);
    expect(pause).toHaveAttribute('aria-pressed', 'true');
    advance(20_000);
    expect(currentDot()).toBe(0);
    fireEvent.click(pause);
    expect(pause).toHaveAttribute('aria-pressed', 'false');
    advance(5000);
    expect(currentDot()).toBe(1);
  });

  it('focus vào banner thì dừng, rời ra thì chạy lại; chạm giữ, thả thì chạy lại', () => {
    render(<BannerCarousel slides={SLIDES} />);
    const link = screen.getByRole('link', { name: 'Giảm 20% mỹ phẩm' });
    fireEvent.focus(link);
    advance(20_000);
    expect(currentDot()).toBe(0);
    fireEvent.blur(link);
    advance(5000);
    expect(currentDot()).toBe(1);

    const section = screen.getByRole('region', { name: 'Chương trình nổi bật' });
    fireEvent.touchStart(section);
    advance(20_000);
    expect(currentDot()).toBe(1);
    fireEvent.touchEnd(section);
    advance(5000);
    expect(currentDot()).toBe(2);
  });

  it('chuột đứng trong banner thì dừng, rời ra thì chạy lại; ngón tay (pointerType touch) không tính là rê chuột', () => {
    render(<BannerCarousel slides={SLIDES} />);
    const section = screen.getByRole('region', { name: 'Chương trình nổi bật' });
    fireEvent.pointerEnter(section, { pointerType: 'touch' });
    advance(5000);
    expect(currentDot()).toBe(1);
    fireEvent.pointerLeave(section, { pointerType: 'touch' });
    fireEvent.pointerEnter(section, { pointerType: 'mouse' });
    advance(20_000);
    expect(currentDot()).toBe(1);
    fireEvent.pointerLeave(section, { pointerType: 'mouse' });
    advance(5000);
    expect(currentDot()).toBe(2);
  });

  it('focus nằm trên nút Dừng không giữ banner', () => {
    render(<BannerCarousel slides={SLIDES} />);
    const pause = screen.getByRole('button', { name: 'Dừng tự chuyển' });
    fireEvent.focus(pause);
    advance(5000);
    expect(currentDot()).toBe(1);
  });

  it('focus dời từ liên kết sang nút Dừng rồi bấm dừng/chạy tiếp: banner chuyển lại sau 5 giây (không kẹt vì cờ focus cũ)', () => {
    render(<BannerCarousel slides={SLIDES} />);
    const link = screen.getByRole('link', { name: 'Giảm 20% mỹ phẩm' });
    const pause = screen.getByRole('button', { name: 'Dừng tự chuyển' });
    fireEvent.focus(link);
    advance(20_000);
    expect(currentDot()).toBe(0);
    fireEvent.blur(link, { relatedTarget: pause });
    fireEvent.focus(pause);
    fireEvent.click(pause);
    expect(pause).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(pause);
    expect(pause).toHaveAttribute('aria-pressed', 'false');
    advance(5000);
    expect(currentDot()).toBe(1);
  });

  it('focus dời từ chấm sang liên kết trong banner vẫn giữ; rời hẳn ra ngoài mới chạy lại', () => {
    render(<BannerCarousel slides={SLIDES} />);
    const link = screen.getByRole('link', { name: 'Giảm 20% mỹ phẩm' });
    const dot = dots()[0]!;
    fireEvent.focus(dot);
    fireEvent.blur(dot, { relatedTarget: link });
    fireEvent.focus(link);
    advance(20_000);
    expect(currentDot()).toBe(0);
    fireEvent.blur(link, { relatedTarget: document.body });
    advance(5000);
    expect(currentDot()).toBe(1);
  });

  it('tab ẩn thì dừng, hiện lại thì chạy', () => {
    render(<BannerCarousel slides={SLIDES} />);
    setVisibility('hidden');
    advance(20_000);
    expect(currentDot()).toBe(0);
    setVisibility('visible');
    advance(5000);
    expect(currentDot()).toBe(1);
  });

  it('một slide: không chấm, không nút Dừng, không chuyển; không slide: render rỗng', () => {
    const a = render(<BannerCarousel slides={SLIDES.slice(0, 1)} />);
    expect(screen.queryByRole('button')).toBeNull();
    advance(20_000);
    expect(slideEls()).toHaveLength(1);
    expect(slideEls()[0]!.hasAttribute('inert')).toBe(false);
    a.unmount();
    const { container } = render(<BannerCarousel slides={[]} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('slides co lại khi đang ở slide cuối: chỉ số kẹp về slide hợp lệ, không lỗi', () => {
    const { rerender } = render(<BannerCarousel slides={SLIDES} />);
    advance(5000);
    advance(5000);
    expect(currentDot()).toBe(2);
    rerender(<BannerCarousel slides={SLIDES.slice(0, 2)} />);
    expect(currentDot()).toBe(1);
    expect(slideEls().map((s) => s.hasAttribute('inert'))).toEqual([true, false]);
    advance(5000);
    expect(currentDot()).toBe(0);
  });

  it('aria-live "off" khi đang tự chạy, "polite" khi đã dừng', () => {
    render(<BannerCarousel slides={SLIDES} />);
    const track = document.querySelector('[aria-live]')!;
    expect(track).toHaveAttribute('aria-live', 'off');
    fireEvent.click(screen.getByRole('button', { name: 'Dừng tự chuyển' }));
    expect(track).toHaveAttribute('aria-live', 'polite');
  });

  it('bấm chấm: tới đúng slide; chấm là nút 44×44 có tên', () => {
    render(<BannerCarousel slides={SLIDES} />);
    expect(dots().map((d) => d.getAttribute('aria-label'))).toEqual(['Xem chương trình 1', 'Xem chương trình 2', 'Xem chương trình 3']);
    for (const d of dots()) {
      expect(d.style.width).toBe('44px');
      expect(d.style.height).toBe('44px');
    }
    fireEvent.click(dots()[2]!);
    expect(currentDot()).toBe(2);
  });

  it('cả slide là liên kết tên theo alt; bấm điều hướng tới href', () => {
    render(<BannerCarousel slides={SLIDES} />);
    fireEvent.click(screen.getByRole('link', { name: 'Giờ vàng 20:00' }));
    expect(mocks.navigate).toHaveBeenCalledTimes(1);
    expect(mocks.navigate).toHaveBeenCalledWith('/campaign/b');
  });

  it('slide đầu tải ngay, các slide sau tải lười', () => {
    render(<BannerCarousel slides={SLIDES} />);
    const imgs = Array.from(document.querySelectorAll('img'));
    expect(imgs.map((i) => i.getAttribute('loading'))).toEqual(['eager', 'lazy', 'lazy']);
  });

  it('ảnh lỗi: hiện chữ alt trên nền phụ, liên kết vẫn còn', () => {
    render(<BannerCarousel slides={SLIDES.slice(0, 2)} />);
    expect(document.querySelectorAll('img')).toHaveLength(2);
    fireEvent.error(document.querySelector('img')!);
    expect(document.querySelectorAll('img')).toHaveLength(1);
    expect(screen.getByText('Giảm 20% mỹ phẩm')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Giảm 20% mỹ phẩm' })).toBeInTheDocument();
  });
});
