import { render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mocks = vi.hoisted(() => ({
  get: vi.fn(),
  routes: {} as Record<string, () => Promise<{ data: unknown }> | { data: unknown } | Error>,
  status: 'authenticated',
}));
vi.mock('../services/api', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  api: { get: mocks.get, post: vi.fn() },
  getAccessToken: () => 'tok',
}));
vi.mock('zmp-ui', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  Page: ({ children }: { children: ReactNode }) => <div className="zaui-page">{children}</div>,
  useNavigate: () => vi.fn(),
}));
vi.mock('../store/auth', () => ({
  useAuthStore: (sel: (s: { status: string; user: Record<string, string> | null }) => unknown) => sel({ status: mocks.status, user: { id: 'u1', phone: '0901234567', zaloId: 'z1' } }),
}));
vi.mock('../components/pull-to-refresh', () => ({ PullToRefresh: () => null }));
vi.mock('../components/cart-button', () => ({ CartButton: () => null }));
vi.mock('../components/wishlist-heart', () => ({ WishlistHeart: () => null }));
vi.mock('../utils/haptic', () => ({ haptic: vi.fn() }));

import HomePage from './home';
import { refreshHomeQueries } from '../components/home/home-blocks';

const card = (id: string, name: string) => ({ id, slug: id, brand: 'Tubu', name, thumbnail: null, basePrice: 50000, salePrice: null, isFeatured: true, inStock: true });
const PAGE = (items: ReturnType<typeof card>[]) => ({ data: items, meta: { page: 1, limit: 6, total: items.length } });

const PUBLIC_FEED = {
  bestSellers: PAGE([card('bs', 'Bán chạy nhất')]),
  featured: PAGE([card('f2', 'Chỉ nổi bật')]),
  newest: PAGE([card('n1', 'Mới nhất')]),
  flashActive: [],
  categories: [],
  brands: [{ brand: 'Cobote', count: 3 }],
  publicConfig: {
    freeshipThreshold: 350_000,
    subscribeDiscountPct: 0.17,
    affiliateWalletMultiplier: 1,
    affiliateMinWithdrawBank: 50_000,
    cashbackHoldDays: 30,
    newCustomer: { welcomeVoucher: { amount: 25_000, minOrder: 150_000 }, firstOrderFreeShip: { enabled: false, minSubtotal: 0 } },
    loyalty: { vndPerPoint: 20_000, vndPerPointRedeem: 1_000 },
    homeNewCustomerLayout: false,
  },
};
const ME_FEED = {
  forYou: [card('fy', 'Gợi ý riêng')],
  flashUpcoming: [],
  purchasedItems: { items: [], nextCursor: null },
  activeOrderCount: { count: 0 },
  shippingOrders: { data: [], meta: { page: 1, limit: 1, total: 0 } },
  subscriptions: [],
  notifications: [],
  newCustomerOffer: {
    isNewCustomer: true,
    welcomeVoucher: { code: 'WELCOME-U1', type: 'AMOUNT', value: 25_000, minOrder: 150_000, endAt: '2026-11-17T10:00:00.000Z' },
  },
  wasteOpenRequestCount: 0,
  purchasedLimit: 10,
};

const paths = () => mocks.get.mock.calls.map(([url]) => url as string);

function renderHome() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const utils = render(
    <QueryClientProvider client={qc}>
      <HomePage />
    </QueryClientProvider>,
  );
  return { qc, ...utils };
}

describe('Trang chủ gộp request (C-037)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    mocks.status = 'authenticated';
    mocks.routes = {};
    // Lưới gợi ý cuối trang (trang 1) và xem trước Cộng đồng không nằm trong request gộp: hai request riêng, luôn có mặt.
    mocks.routes['/products'] = () => ({ data: PAGE([card('f2', 'Chỉ nổi bật')]) });
    mocks.routes['/feed'] = () => ({ data: { posts: [] } });
    mocks.get.mockImplementation(async (url: string) => {
      const r = mocks.routes[url];
      if (!r) throw Object.assign(new Error(`404 ${url}`), { response: { status: 404 } });
      const v = await r();
      if (v instanceof Error) throw v;
      return v;
    });
  });

  it('đã đăng nhập: dữ liệu Home đến từ 2 request gộp (/home + /home/me) cộng lưới gợi ý và Cộng đồng, vẽ đủ khối', async () => {
    mocks.routes['/home'] = () => ({ data: PUBLIC_FEED });
    mocks.routes['/home/me'] = () => ({ data: ME_FEED });
    renderHome();
    expect(await screen.findByText('Gợi ý riêng')).toBeInTheDocument();
    // D2-07b: khối "Quà khách mới" (số công khai + ưu đãi của khách) đi cùng hai request gộp, không thêm request lẻ.
    expect(await screen.findByText('Mã giảm giá chào mừng 25.000đ')).toBeInTheDocument();
    await new Promise((r) => setTimeout(r, 50));
    // Trang đầu của lưới gợi ý (không page, limit 12) lấy từ khối gộp; số yêu cầu đổi rác đang mở cũng lấy từ /home/me (không gọi /waste/me).
    expect(paths().sort()).toEqual(['/feed', '/home', '/home/me']);
    expect(mocks.get.mock.calls.find(([u]) => u === '/home/me')?.[1]).toMatchObject({ params: { purchasedLimit: 10 } });
  });

  it('API gộp cũ chưa có khối số yêu cầu đổi rác: hỏi endpoint nhẹ /waste/me/open-count một lần, không gọi /waste/me', async () => {
    const { wasteOpenRequestCount: _dropped, ...oldMe } = ME_FEED;
    mocks.routes['/home'] = () => ({ data: PUBLIC_FEED });
    mocks.routes['/home/me'] = () => ({ data: oldMe });
    mocks.routes['/waste/me/open-count'] = () => ({ data: { count: 0 } });
    renderHome();
    expect(await screen.findByText('Gợi ý riêng')).toBeInTheDocument();
    await new Promise((r) => setTimeout(r, 50));
    expect(paths().filter((p) => p.startsWith('/waste'))).toEqual(['/waste/me/open-count']);
  });

  it('khách chưa đăng nhập: chỉ /home, không gọi /home/me', async () => {
    mocks.status = 'guest';
    mocks.routes['/home'] = () => ({ data: PUBLIC_FEED });
    renderHome();
    expect(await screen.findByText('Đặt định kỳ giảm 17% mỗi đơn')).toBeInTheDocument();
    await new Promise((r) => setTimeout(r, 50));
    expect(paths().sort()).toEqual(['/home']);
  });

  it('API gộp cũ chưa có khối cấu hình/ưu đãi khách mới: hai khối đó lùi về request lẻ, phần còn lại vẫn từ gộp', async () => {
    const { publicConfig, ...oldPublic } = PUBLIC_FEED;
    const { newCustomerOffer, ...oldMe } = ME_FEED;
    mocks.routes['/home'] = () => ({ data: oldPublic });
    mocks.routes['/home/me'] = () => ({ data: oldMe });
    mocks.routes['/config/public'] = () => ({ data: publicConfig });
    mocks.routes['/me/new-customer-offer'] = () => ({ data: newCustomerOffer });
    renderHome();
    expect(await screen.findByText('Mã giảm giá chào mừng 25.000đ')).toBeInTheDocument();
    await new Promise((r) => setTimeout(r, 50));
    expect(paths().sort()).toEqual(['/config/public', '/feed', '/home', '/home/me', '/me/new-customer-offer']);
  });

  it('API cũ chưa có /home (404): lùi về từng request lẻ, trang vẫn đủ nội dung', async () => {
    mocks.routes['/products/for-you'] = () => ({ data: [card('fy', 'Gợi ý lẻ')] });
    mocks.routes['/categories'] = () => ({ data: [] });
    mocks.routes['/brands'] = () => ({ data: [] });
    mocks.routes['/flash-sales/active'] = () => ({ data: [] });
    mocks.routes['/flash-sales/upcoming'] = () => ({ data: [] });
    mocks.routes['/me/purchased-items'] = () => ({ data: { items: [], nextCursor: null } });
    mocks.routes['/orders/active-count'] = () => ({ data: { count: 0 } });
    mocks.routes['/me/subscriptions'] = () => ({ data: [] });
    mocks.routes['/me/notifications'] = () => ({ data: [] });
    renderHome();
    expect(await screen.findByText('Gợi ý lẻ')).toBeInTheDocument();
    await waitFor(() => expect(paths()).toEqual(expect.arrayContaining(['/home', '/home/me', '/products', '/products/for-you', '/categories', '/brands'])));
  });

  it('khối null phía server: chỉ khối đó gọi lẻ, khối khác vẫn lấy từ gộp', async () => {
    mocks.routes['/home'] = () => ({ data: { ...PUBLIC_FEED, brands: null } });
    mocks.routes['/home/me'] = () => ({ data: ME_FEED });
    mocks.routes['/brands'] = () => ({ data: [{ brand: 'LẻBrand', count: 1 }] });
    renderHome();
    expect(await screen.findByText('LẻBrand')).toBeInTheDocument();
    await new Promise((r) => setTimeout(r, 50));
    expect(paths().sort()).toEqual(['/brands', '/feed', '/home', '/home/me']);
  });

  it('kéo để làm mới: khối gộp được tải lại bằng request gộp, không bắn request lẻ', async () => {
    mocks.routes['/home'] = () => ({ data: PUBLIC_FEED });
    mocks.routes['/home/me'] = () => ({ data: ME_FEED });
    const { qc } = renderHome();
    await screen.findByText('Gợi ý riêng');
    await new Promise((r) => setTimeout(r, 50));
    mocks.get.mockClear();
    await refreshHomeQueries(qc);
    await new Promise((r) => setTimeout(r, 50));
    const after = paths();
    expect(after.filter((p) => p === '/home').length).toBe(1);
    expect(after.filter((p) => p === '/home/me').length).toBe(1);
    expect(after).not.toContain('/categories');
  });
});
