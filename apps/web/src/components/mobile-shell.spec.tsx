// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { click, flush, render, type Rendered } from '@/test-utils/dom';

// Vỏ trang ở khổ điện thoại (< md) phải là Mini App; từ md trở lên giữ giao diện máy tính. jsdom không có media query nên kiểm bằng lớp `md:`.
const mocks = vi.hoisted(() => ({
  pathname: '/san-pham/abc',
  back: vi.fn(),
  push: vi.fn(),
  auth: { user: null as { fullName: string } | null, status: 'anonymous' },
  cart: { itemCount: 0 },
}));
vi.mock('next/navigation', () => ({ usePathname: () => mocks.pathname, useRouter: () => ({ back: mocks.back, push: mocks.push }) }));
vi.mock('@/lib/auth-context', () => ({ useAuth: () => mocks.auth }));
vi.mock('@tanstack/react-query', async (orig) => ({ ...(await orig<object>()), useQuery: () => ({ data: mocks.cart }) }));
vi.mock('@/lib/shop-client', () => ({ getCart: vi.fn() }));
vi.mock('@/lib/cart-key', () => ({ useCartKey: () => ['cart'] }));
vi.mock('@/lib/api', () => ({ getPublicSupport: async () => ({ hotline: '0984606774', email: 'a@b.vn', community: null }) }));
vi.mock('@/lib/route-map', async (orig) => ({ ...(await orig<object>()), isWebRouteReady: () => true }));

import SiteHeader from './site-header';
import SiteFooter from './site-footer';
import BackLink from './back-link';
import BackButton from './mini/back-button';
import { PageHeader } from './ui/page-header';
import { HomeHeader } from './home/home-header';
import { GARDEN_HINT_AUTO_HIDE_MS, GARDEN_HINT_DELAY_MS, GardenHintBubble } from './garden-hint-bubble';
import { GARDEN_HINT_KEY } from './garden-hint';

let mounted: Rendered[] = [];
const mount = (ui: React.ReactElement) => {
  const r = render(ui);
  mounted.push(r);
  return r;
};
beforeEach(() => {
  mocks.pathname = '/san-pham/abc';
  mocks.back.mockClear();
  mocks.push.mockClear();
  mocks.cart = { itemCount: 0 };
  document.body.className = '';
  localStorage.clear();
});
afterEach(() => {
  mounted.forEach((m) => m.unmount());
  mounted = [];
});

describe('thanh đầu và chân trang website', () => {
  it('thanh đầu ẩn dưới md, hiện từ md', () => {
    const header = renderToStaticMarkup(<SiteHeader />).match(/<header[^>]*>/)?.[0] ?? '';
    expect(header).toMatch(/\bhidden\b/);
    expect(header).toMatch(/\bmd:block\b/);
  });

  it('chân trang ẩn dưới md, hiện từ md', async () => {
    const footer = renderToStaticMarkup(await SiteFooter()).match(/<footer[^>]*>/)?.[0] ?? '';
    expect(footer).toMatch(/\bhidden\b/);
    expect(footer).toMatch(/\bmd:block\b/);
  });
});

describe('chân trang điện thoại', () => {
  it('có hotline và đủ link chính sách dưới md', async () => {
    const html = renderToStaticMarkup(await SiteFooter());
    const compact = html.slice(html.indexOf('aria-label="Hỗ trợ và chính sách"'));
    expect(compact).toContain('tel:0984606774');
    expect(compact).toContain('/chinh-sach/');
    expect(html.match(/<footer[^>]*>/g)![1]).toMatch(/\bmd:hidden\b/);
  });
});

describe('PageHeader (web) ở điện thoại', () => {
  it('một h1, chỉ còn link quay lại cho máy tính; nút lùi nổi do layout gắn một lần', () => {
    const { container } = mount(<PageHeader title="Giỏ hàng" subtitle="3 sản phẩm" backHref="/tai-khoan" />);
    expect(container.querySelectorAll('h1')).toHaveLength(1);
    expect(container.querySelector('button[aria-label="Quay lại"]')).toBeNull();
    const desk = container.querySelector('a[href="/tai-khoan"]')!;
    expect(desk.className).toContain('max-md:hidden');
  });

  it('layout gắn đúng một nút lùi nổi cho trang con không có backHref (như app.tsx của Mini App)', () => {
    mocks.pathname = '/doi-rac';
    const { container } = mount(<><PageHeader title="Đổi rác" /><BackButton className="md:!hidden" /></>);
    const buttons = container.querySelectorAll('button[aria-label="Quay lại"]');
    expect(buttons).toHaveLength(1);
    const b = buttons[0] as HTMLElement;
    expect(b.style.position).toBe('fixed');
    expect(b.className).toContain('md:!hidden');
    expect(document.body.classList.contains('with-back-btn')).toBe(true);
  });

  it('layout gắn nút lùi trong HideOnPortals, cạnh BottomNav', () => {
    const layout = readFileSync(join(__dirname, '../app/layout.tsx'), 'utf8');
    expect(layout).toMatch(/<HideOnPortals>\s*<BackButton className="md:!hidden" \/>/);
  });

  it('tiêu đề chừa chỗ cho nút lùi ở điện thoại, không chừa từ md', () => {
    const { container } = mount(<PageHeader title="X" backHref="/" />);
    expect(container.querySelector('h1')!.parentElement!.className).toContain('max-md:pl-12');
  });
});

describe('khung trang có thanh tiêu đề dùng chung', () => {
  it('globals.css kéo khung lên sát mép khi con trực tiếp là PageHeader, chỉ dưới md', () => {
    const css = readFileSync(join(__dirname, '../app/globals.css'), 'utf8');
    const media = css.slice(css.indexOf('@media (max-width: 767px) {\n  body {'));
    expect(media).toMatch(/main:has\(> header\[data-page-bleed\]\)\s*\{\s*padding-top: 0;/);
  });

  it('không còn lớp bọc thanh tiêu đề riêng của từng nhóm màn', () => {
    const ui = readFileSync(join(__dirname, 'loyalty/mini-surface.tsx'), 'utf8');
    expect(ui).not.toMatch(/export function Mini(Title)?Bar/);
    expect(readFileSync(join(__dirname, 'order-mobile/mobile-ui.tsx'), 'utf8')).not.toContain('export function TitleBand');
  });
});

describe('BackLink (link "← ..." ngoài PageHeader)', () => {
  it('máy tính giữ link chữ, điện thoại dùng nút lùi nổi của layout', () => {
    const { container } = mount(<BackLink href="/tai-khoan">← Tài khoản</BackLink>);
    const a = container.querySelector('a')!;
    expect(a.textContent).toBe('← Tài khoản');
    expect(a.className).toContain('max-md:hidden');
    expect(container.querySelector('button')).toBeNull();
  });
});

describe('HomeHeader (đầu Trang chủ ở điện thoại)', () => {
  it('logo, chuông thông báo, giỏ; ẩn từ md vì thanh đầu website đảm nhiệm', () => {
    mocks.auth = { user: { fullName: 'An' }, status: 'authenticated' };
    mocks.cart = { itemCount: 2 };
    const { container } = mount(<HomeHeader unreadCount={3} />);
    expect(container.firstElementChild!.className).toContain('md:hidden');
    expect(container.querySelector('img')!.getAttribute('alt')).toBe('Tubu Tree');
    expect(container.querySelector('a[href="/tai-khoan/thong-bao"]')!.getAttribute('aria-label')).toBe('Thông báo, 3 chưa đọc');
    expect(container.querySelector('a[href="/gio-hang"]')!.getAttribute('aria-label')).toBe('Giỏ hàng, 2 sản phẩm');
  });

  it('huy hiệu như CountBadge của Mini App: 18px, màu promo-solid, chữ 11', () => {
    mocks.auth = { user: { fullName: 'An' }, status: 'authenticated' };
    mocks.cart = { itemCount: 2 };
    const { container } = mount(<HomeHeader unreadCount={3} />);
    const badges = Array.from(container.querySelectorAll<HTMLElement>('[data-testid="count-badge"]'));
    expect(badges).toHaveLength(2);
    for (const b of badges) {
      expect(b.style.minWidth).toBe('18px');
      expect(b.style.background).toBe('var(--color-promo-solid-bg)');
      expect(b.style.fontSize).toBe('11px');
    }
  });

  it('chưa đăng nhập: vẫn có chuông (không huy hiệu) và giỏ, như Mini App; trang Thông báo tự đòi đăng nhập', () => {
    const { container } = mount(<HomeHeader unreadCount={0} />);
    expect(container.querySelector('a[href="/tai-khoan/thong-bao"]')!.getAttribute('aria-label')).toBe('Thông báo');
    expect(container.querySelector('[data-testid="count-badge"]')).toBeNull();
    expect(container.querySelector('a[href="/gio-hang"]')).not.toBeNull();
  });
});

describe('GardenHintBubble', () => {
  const settle = async () => {
    await act(async () => {
      await new Promise((r) => setTimeout(r, GARDEN_HINT_DELAY_MS + 50));
    });
  };

  it('hiện một lần: đánh dấu đã xem lúc hiện, lần sau không hiện lại', async () => {
    const a = mount(<GardenHintBubble onGardenTab={false} />);
    expect(a.container.querySelector('[role="status"]')).toBeNull();
    await settle();
    expect(a.container.querySelector('[role="status"]')!.textContent).toContain('Trồng cây mỗi ngày, nhận quà thật');
    expect(localStorage.getItem(GARDEN_HINT_KEY)).toBe('1');
    const b = mount(<GardenHintBubble onGardenTab={false} />);
    await settle();
    expect(b.container.querySelector('[role="status"]')).toBeNull();
  });

  it('bấm vào bóng mở Vườn Xanh (liên kết thật) và tắt bóng', async () => {
    const a = mount(<GardenHintBubble onGardenTab={false} />);
    await settle();
    const link = a.container.querySelector('[role="status"] a')!;
    expect(link.getAttribute('href')).toBe('/vuon-xanh');
    click(a.container.querySelector('[role="status"]'));
    expect(a.container.querySelector('[role="status"]')).toBeNull();
  });

  it('cao ít nhất 44px để chạm tắt được (D6-16)', async () => {
    const a = mount(<GardenHintBubble onGardenTab={false} />);
    await settle();
    const bubble = a.container.querySelector<HTMLElement>('[role="status"]')!;
    expect(Number.parseFloat(bubble.style.minHeight)).toBeGreaterThanOrEqual(44);
  });

  it('tự tắt sau 5 giây để không che nội dung phía sau thanh tab (D6-16)', async () => {
    vi.useFakeTimers();
    try {
      const a = mount(<GardenHintBubble onGardenTab={false} />);
      act(() => {
        vi.advanceTimersByTime(GARDEN_HINT_DELAY_MS + 10);
      });
      expect(a.container.querySelector('[role="status"]')).not.toBeNull();
      act(() => {
        vi.advanceTimersByTime(GARDEN_HINT_AUTO_HIDE_MS - 1);
      });
      expect(a.container.querySelector('[role="status"]')).not.toBeNull();
      act(() => {
        vi.advanceTimersByTime(1);
      });
      expect(a.container.querySelector('[role="status"]')).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it('khách cuộn trang thì bóng tắt ngay', async () => {
    const a = mount(<GardenHintBubble onGardenTab={false} />);
    await settle();
    expect(a.container.querySelector('[role="status"]')).not.toBeNull();
    act(() => {
      document.dispatchEvent(new Event('scroll'));
    });
    expect(a.container.querySelector('[role="status"]')).toBeNull();
  });

  it('có lớp phủ đang mở thì chưa hiện và chưa đánh dấu đã xem', async () => {
    const overlay = document.createElement('div');
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    document.body.appendChild(overlay);
    const a = mount(<GardenHintBubble onGardenTab={false} />);
    await settle();
    expect(a.container.querySelector('[role="status"]')).toBeNull();
    expect(localStorage.getItem(GARDEN_HINT_KEY)).toBeNull();
    overlay.remove();
  });

  it('đang ở tab Vườn Xanh thì không hiện và đánh dấu đã xem', async () => {
    const a = mount(<GardenHintBubble onGardenTab />);
    await flush();
    expect(a.container.querySelector('[role="status"]')).toBeNull();
    expect(localStorage.getItem(GARDEN_HINT_KEY)).toBe('1');
  });
});

describe('globals.css', () => {
  const css = readFileSync(join(__dirname, '../app/globals.css'), 'utf8');
  it('trang con có nút lùi nổi được đệm đỉnh 48px chỉ ở dưới md, như body.with-back-btn .page của Mini App', () => {
    expect(css).toMatch(/@media \(max-width: 767px\)[\s\S]*body\.with-back-btn\s*\{[^}]*padding-top:\s*calc\(var\(--safe-top\) \+ 48px\)/);
  });
  it('trang hero (sản phẩm, thương hiệu, gian hàng) bỏ đệm 48px như .page-bleed của Mini App', () => {
    expect(css).toMatch(/body\.with-back-btn:has\(\[data-page-bleed\]\)\s*\{[^}]*padding-top:\s*var\(--safe-top\)/);
    for (const f of ['san-pham/[slug]', 'brand/[slug]', 's/[slug]']) {
      expect(readFileSync(join(__dirname, '../app', f, 'page.tsx'), 'utf8')).toContain('data-page-bleed');
    }
  });
});
