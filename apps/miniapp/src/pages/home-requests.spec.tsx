import { render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { afterEach, beforeAll, describe, it, expect, vi, beforeEach } from 'vitest';

const mocks = vi.hoisted(() => ({
  get: vi.fn(),
  routes: {} as Record<string, () => Promise<{ data: unknown }> | { data: unknown } | Error>,
  status: 'authenticated',
}));
vi.mock('../services/api', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  api: { get: mocks.get, post: vi.fn() },
  getAccessToken: () => (mocks.status === 'authenticated' ? 'tok' : null),
}));
vi.mock('zmp-ui', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  Page: ({ children }: { children: ReactNode }) => <div className="zaui-page">{children}</div>,
  useNavigate: () => vi.fn(),
}));
vi.mock('../store/auth', () => {
  const state = () => ({ status: mocks.status, user: { id: 'u1', phone: '0901234567', zaloId: 'z1' } as Record<string, string> | null });
  return { useAuthStore: Object.assign((sel: (s: ReturnType<typeof state>) => unknown) => sel(state()), { getState: state }) };
});
vi.mock('../components/pull-to-refresh', () => ({ PullToRefresh: () => null }));
vi.mock('../components/cart-button', () => ({ CartButton: () => null }));
vi.mock('../components/wishlist-heart', () => ({ WishlistHeart: () => null }));
vi.mock('../utils/haptic', () => ({ haptic: vi.fn() }));

import HomePage from './home';
import { loadHomeBelow } from '../components/home/home-lazy';
import { refreshHomeQueries } from '../components/home/home-blocks';

// Chunk khối dưới màn đầu nạp thật trước (giờ thật): giờ giả không đẩy được import() động.
beforeAll(() => loadHomeBelow());

const card = (id: string, name: string) => ({ id, slug: id, brand: 'Tubu', name, thumbnail: null, basePrice: 50000, salePrice: null, isFeatured: true, inStock: true });
const PAGE = (items: ReturnType<typeof card>[]) => ({ data: items, meta: { page: 1, limit: 6, total: items.length } });

const PUBLIC_FEED = {
  bestSellers: PAGE([card('bs', 'Bán chạy nhất')]),
  featured: PAGE([card('f2', 'Chỉ nổi bật')]),
  newest: PAGE([card('n1', 'Mới nhất')]),
  flashActive: [],
  categories: [],
  brands: [{ brand: 'Cobote', count: 3 }],
  campaigns: [],
  publicConfig: {
    freeshipThreshold: 350_000,
    subscribeDiscountPct: 0.17,
    affiliateWalletMultiplier: 1,
    cashbackHoldDays: 30,
    newCustomer: { welcomeVoucher: { amount: 25_000, minOrder: 150_000 }, firstOrderFreeShip: { enabled: false, minSubtotal: 0 } },
    loyalty: { vndPerPoint: 20_000, vndPerPointRedeem: 1_000 },
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

/** Lưới "Gợi ý hôm nay" ở cuối trang chỉ tải khi khối sắp vào màn: giữ nó ngoài màn để đếm đúng các request của lần mở Trang chủ. */
function keepSuggestOffScreen() {
  vi.stubGlobal(
    'IntersectionObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
}

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
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    mocks.status = 'authenticated';
    mocks.routes = {};
    // Lưới gợi ý cuối trang (trang 1) và xem trước Cộng đồng không nằm trong request gộp: hai request riêng. Lưới chỉ tải khi sắp vào màn.
    mocks.routes['/products'] = () => ({ data: PAGE([card('f2', 'Chỉ nổi bật')]) });
    mocks.routes['/feed'] = () => ({ data: { posts: [] } });
    // Chuông chỉ đếm bằng một lời gọi nhỏ (cả hộp thư, không dừng ở 50 tin của khối gộp): request riêng của khách đã đăng nhập.
    mocks.routes['/me/notifications/unread-count'] = () => ({ data: { count: 0 } });
    mocks.get.mockImplementation(async (url: string) => {
      const r = mocks.routes[url];
      if (!r) throw Object.assign(new Error(`404 ${url}`), { response: { status: 404 } });
      const v = await r();
      if (v instanceof Error) throw v;
      return v;
    });
  });

  it('đã đăng nhập: dữ liệu Home đến từ 2 request gộp (/home + /home/me) cộng Cộng đồng và số tin chưa đọc, vẽ đủ khối; lưới gợi ý cuối trang chưa tải khi chưa tới gần', async () => {
    keepSuggestOffScreen();
    mocks.routes['/home'] = () => ({ data: PUBLIC_FEED });
    mocks.routes['/home/me'] = () => ({ data: ME_FEED });
    renderHome();
    // D2-07b: khối "Quà khách mới" (số công khai + ưu đãi của khách) đi cùng hai request gộp, không thêm request lẻ.
    expect(await screen.findByText(/^Mã 25\.000đ/)).toBeInTheDocument();
    await new Promise((r) => setTimeout(r, 50));
    // Gợi ý cá nhân (khối forYou của /home/me) đứng đầu lưới cuối trang nên cũng chờ lưới tới gần màn.
    expect(screen.queryByText('Gợi ý riêng')).toBeNull();
    // Lưới "Gợi ý hôm nay" (request riêng, xáo theo ngày) chưa tải vì còn ở xa màn; số yêu cầu đổi rác đang mở lấy từ /home/me (không gọi /waste/me).
    expect(paths().sort()).toEqual(['/feed', '/home', '/home/me', '/me/notifications/unread-count']);
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
    keepSuggestOffScreen();
    mocks.status = 'guest';
    mocks.routes['/home'] = () => ({ data: PUBLIC_FEED });
    renderHome();
    expect(await screen.findByRole('region', { name: 'Quà khách mới' })).toBeInTheDocument();
    await new Promise((r) => setTimeout(r, 50));
    // Suất Giờ vàng sắp mở công khai nên khách cũng hỏi (request lẻ, không qua /home/me); không gọi /home/me.
    expect(paths().sort()).toEqual(['/flash-sales/upcoming', '/home']);
  });

  it('API gộp cũ chưa có khối cấu hình/ưu đãi khách mới: hai khối đó lùi về request lẻ, phần còn lại vẫn từ gộp', async () => {
    keepSuggestOffScreen();
    const { publicConfig, ...oldPublic } = PUBLIC_FEED;
    const { newCustomerOffer, ...oldMe } = ME_FEED;
    mocks.routes['/home'] = () => ({ data: oldPublic });
    mocks.routes['/home/me'] = () => ({ data: oldMe });
    mocks.routes['/config/public'] = () => ({ data: publicConfig });
    mocks.routes['/me/new-customer-offer'] = () => ({ data: newCustomerOffer });
    renderHome();
    expect(await screen.findByText(/^Mã 25\.000đ/)).toBeInTheDocument();
    await new Promise((r) => setTimeout(r, 50));
    expect(paths().sort()).toEqual(['/config/public', '/feed', '/home', '/home/me', '/me/new-customer-offer', '/me/notifications/unread-count']);
  });

  it('banner chiến dịch đến từ khối gộp /home: hiện slide, không thêm request /campaigns', async () => {
    const live = {
      id: 'c1', slug: 'giua-thu', title: 'Giữa Thu', image: 'data:image/gif;base64,R0lGODlhAQABAAAAACw=', linkType: 'CAMPAIGN_PAGE', linkValue: null, audience: 'ALL',
      startAt: new Date(Date.now() - 86_400_000).toISOString(), endAt: new Date(Date.now() + 86_400_000).toISOString(),
    };
    mocks.routes['/home'] = () => ({ data: { ...PUBLIC_FEED, campaigns: [live] } });
    mocks.routes['/home/me'] = () => ({ data: ME_FEED });
    renderHome();
    expect(await screen.findByRole('link', { name: 'Giữa Thu' })).toHaveAttribute('href', '/campaign/giua-thu');
    await new Promise((r) => setTimeout(r, 50));
    expect(paths()).not.toContain('/campaigns');
  });

  it('API gộp cũ chưa có khối campaigns: lùi về một request lẻ /campaigns?placement=HOME_TOP', async () => {
    const { campaigns: _dropped, ...oldPublic } = PUBLIC_FEED;
    mocks.routes['/home'] = () => ({ data: oldPublic });
    mocks.routes['/home/me'] = () => ({ data: ME_FEED });
    mocks.routes['/campaigns'] = () => ({ data: [] });
    renderHome();
    expect(await screen.findByText('Gợi ý riêng')).toBeInTheDocument();
    await new Promise((r) => setTimeout(r, 50));
    expect(paths().filter((p) => p === '/campaigns')).toHaveLength(1);
    expect(mocks.get.mock.calls.find(([u]) => u === '/campaigns')?.[1]).toMatchObject({ params: { placement: 'HOME_TOP' } });
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
    renderHome();
    expect(await screen.findByText('Gợi ý lẻ')).toBeInTheDocument();
    await waitFor(() => expect(paths()).toEqual(expect.arrayContaining(['/home', '/home/me', '/products', '/products/for-you', '/categories', '/brands'])));
  });

  it('khối null phía server: chỉ khối đó gọi lẻ, khối khác vẫn lấy từ gộp', async () => {
    keepSuggestOffScreen();
    mocks.routes['/home'] = () => ({ data: { ...PUBLIC_FEED, brands: null } });
    mocks.routes['/home/me'] = () => ({ data: ME_FEED });
    mocks.routes['/brands'] = () => ({ data: [{ brand: 'LẻBrand', count: 1 }] });
    renderHome();
    expect(await screen.findByText('LẻBrand')).toBeInTheDocument();
    await new Promise((r) => setTimeout(r, 50));
    expect(paths().sort()).toEqual(['/brands', '/feed', '/home', '/home/me', '/me/notifications/unread-count']);
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
