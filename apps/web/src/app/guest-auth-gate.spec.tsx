// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flush, render, type Rendered } from '@/test-utils/dom';

// BUYERWEB-1: khách chưa đăng nhập có status='idle' VĨNH VIỄN sau khi lượt khôi phục phiên xong
// (initialized=true). Bốn trang cần đăng nhập từng coi 'idle' là "đang tải" nên chỉ hiện "Đang tải…" mãi,
// không bao giờ tới nhánh "Vui lòng đăng nhập".

const mocks = vi.hoisted(() => ({
  auth: {
    user: null as null | Record<string, unknown>,
    status: 'idle' as string,
    initialized: true,
    logout: vi.fn(),
    startZaloLogin: vi.fn(),
    handleCallback: vi.fn(),
  },
}));
vi.mock('@/lib/auth-context', () => ({ useAuth: () => mocks.auth }));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  useParams: () => ({ code: 'TB-77' }),
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock('@/lib/shop-client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/shop-client')>()),
  getCart: vi.fn(async () => {
    throw new Error('không được gọi giỏ khi chưa đăng nhập');
  }),
  getAddresses: vi.fn(async () => []),
  getPublicConfig: async () => ({}),
  fetchOrder: vi.fn(),
  fetchOrdersPage: vi.fn(),
}));
vi.mock('@/lib/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/api')>()),
  getPublicSupport: async () => ({ hotline: '0984 606 774', email: 'tubutree@gmail.com' }),
}));

import CartPage from './gio-hang/page';
import CheckoutPage from './thanh-toan/page';
import AccountPage from './tai-khoan/page';
import OrderDetailPage from './tai-khoan/don-hang/[code]/page';
import WishlistPage from './tai-khoan/yeu-thich/page';

let mounted: Rendered[] = [];
const mount = (ui: Parameters<typeof render>[0]) => {
  const r = render(ui);
  mounted.push(r);
  return r;
};

beforeEach(() => {
  mocks.auth.status = 'idle';
  mocks.auth.initialized = true;
  mocks.auth.user = null;
});
afterEach(() => {
  mounted.forEach((m) => m.unmount());
  mounted = [];
});

type PageCase = [string, () => JSX.Element, string];
const CORE: PageCase[] = [
  ['/gio-hang', () => <CartPage />, '/gio-hang'],
  ['/thanh-toan', () => <CheckoutPage />, '/thanh-toan'],
  ['/tai-khoan', () => <AccountPage />, '/tai-khoan'],
  ['/tai-khoan/don-hang/[code]', () => <OrderDetailPage />, '/tai-khoan/don-hang/TB-77'],
];
const SHOP: PageCase[] = [['/tai-khoan/yeu-thich', () => <WishlistPage />, '/tai-khoan/yeu-thich']];
const ORDER: PageCase[] = [];
const ACCOUNT: PageCase[] = [];
const LOYALTY: PageCase[] = [];
const COMMUNITY: PageCase[] = [];
const AFFILIATE: PageCase[] = [];
const GAME: PageCase[] = [];
const PRO: PageCase[] = [];
const RECYCLE: PageCase[] = [];
const PAGES: PageCase[] = [...CORE, ...SHOP, ...ORDER, ...ACCOUNT, ...LOYALTY, ...COMMUNITY, ...AFFILIATE, ...GAME, ...PRO, ...RECYCLE];

describe.each(PAGES)('khách chưa đăng nhập mở %s', (_name, page, returnTo) => {
  it('thấy nút đăng nhập Zalo mang theo returnTo, không kẹt ở "Đang tải…"', async () => {
    const { container } = mount(page());
    await flush();
    expect(container.textContent).not.toContain('Đang tải…');
    const login = container.querySelector<HTMLAnchorElement>('a[href^="/dang-nhap"]');
    expect(login).not.toBeNull();
    expect(login!.textContent).toContain('Đăng nhập với Zalo');
    expect(login!.getAttribute('href')).toBe(`/dang-nhap?returnTo=${encodeURIComponent(returnTo)}`);
  });

  it('lúc đang khôi phục phiên (initialized=false) vẫn hiện "Đang tải…", chưa chớp màn đăng nhập', async () => {
    mocks.auth.initialized = false;
    const { container } = mount(page());
    await flush();
    expect(container.textContent).toContain('Đang tải…');
    expect(container.querySelector('a[href^="/dang-nhap"]')).toBeNull();
  });

  it('status=loading (đang đổi mã Zalo lấy phiên) cũng chỉ hiện "Đang tải…"', async () => {
    mocks.auth.status = 'loading';
    const { container } = mount(page());
    await flush();
    expect(container.textContent).toContain('Đang tải…');
    expect(container.querySelector('a[href^="/dang-nhap"]')).toBeNull();
  });
});
