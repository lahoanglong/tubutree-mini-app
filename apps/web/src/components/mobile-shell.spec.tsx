// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
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
import { PageHeader } from './ui/page-header';
import { HomeHeader } from './home/home-header';
import { GardenHintBubble } from './garden-hint-bubble';
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

describe('PageHeader (web) ở điện thoại', () => {
  it('một h1, thêm nút lùi nổi như Mini App (ẩn từ md) và gắn with-back-btn lên body', () => {
    const { container } = mount(<PageHeader title="Giỏ hàng" subtitle="3 sản phẩm" backHref="/tai-khoan" />);
    expect(container.querySelectorAll('h1')).toHaveLength(1);
    const floating = [...container.querySelectorAll('button')].find((b) => b.getAttribute('aria-label') === 'Quay lại')!;
    expect(floating.style.position).toBe('fixed');
    // Style inline của nút đặt display:grid nên phải !important mới ẩn được.
    expect(floating.className).toContain('md:!hidden');
    expect(document.body.classList.contains('with-back-btn')).toBe(true);
    const desk = container.querySelector('a[href="/tai-khoan"]')!;
    expect(desk.className).toContain('max-md:hidden');
  });

  it('nút lùi nổi quay lại lịch sử; lịch sử rỗng thì về backHref', () => {
    const { container } = mount(<PageHeader title="X" backHref="/tai-khoan" />);
    const b = [...container.querySelectorAll('button')].find((x) => x.getAttribute('aria-label') === 'Quay lại')!;
    Object.defineProperty(window.history, 'length', { value: 1, configurable: true });
    click(b);
    expect(mocks.push).toHaveBeenCalledWith('/tai-khoan');
    Object.defineProperty(window.history, 'length', { value: 3, configurable: true });
    click(b);
    expect(mocks.back).toHaveBeenCalled();
  });

  it('tiêu đề chừa chỗ cho nút lùi ở điện thoại, không chừa từ md', () => {
    const { container } = mount(<PageHeader title="X" backHref="/" />);
    expect(container.querySelector('h1')!.parentElement!.className).toMatch(/\bpl-12\b.*\bmd:pl-0\b/);
  });
});

describe('BackLink (link "← ..." ngoài PageHeader)', () => {
  it('máy tính giữ link chữ, điện thoại thay bằng nút lùi nổi của Mini App', () => {
    const { container } = mount(<BackLink href="/tai-khoan">← Tài khoản</BackLink>);
    const a = container.querySelector('a')!;
    expect(a.textContent).toBe('← Tài khoản');
    expect(a.className).toContain('max-md:hidden');
    const b = container.querySelector('button')!;
    expect(b.className).toContain('md:!hidden');
    expect(b.className).toContain('h-11');
  });
});

describe('HomeHeader (đầu Trang chủ ở điện thoại)', () => {
  it('logo, chuông thông báo, giỏ; ẩn từ md vì thanh đầu website đảm nhiệm', () => {
    mocks.auth = { user: { fullName: 'An' }, status: 'authenticated' };
    mocks.cart = { itemCount: 2 };
    const { container } = mount(<HomeHeader unreadCount={3} authed />);
    expect(container.firstElementChild!.className).toContain('md:hidden');
    expect(container.querySelector('img')!.getAttribute('alt')).toBe('Tubu Tree');
    expect(container.querySelector('a[href="/tai-khoan/thong-bao"]')!.getAttribute('aria-label')).toBe('Thông báo, 3 chưa đọc');
    expect(container.querySelector('a[href="/gio-hang"]')!.getAttribute('aria-label')).toBe('Giỏ hàng, 2 sản phẩm');
  });

  it('chưa đăng nhập: không có chuông, vẫn có giỏ', () => {
    const { container } = mount(<HomeHeader unreadCount={0} authed={false} />);
    expect(container.querySelector('a[href="/tai-khoan/thong-bao"]')).toBeNull();
    expect(container.querySelector('a[href="/gio-hang"]')).not.toBeNull();
  });
});

describe('GardenHintBubble', () => {
  it('hiện một lần: đánh dấu đã xem ngay, lần sau không hiện lại', async () => {
    const a = mount(<GardenHintBubble onGardenTab={false} />);
    await flush();
    expect(a.container.querySelector('[role="status"]')!.textContent).toContain('Trồng cây mỗi ngày, nhận quà thật');
    expect(localStorage.getItem(GARDEN_HINT_KEY)).toBe('1');
    const b = mount(<GardenHintBubble onGardenTab={false} />);
    await flush();
    expect(b.container.querySelector('[role="status"]')).toBeNull();
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
});
