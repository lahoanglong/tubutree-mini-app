import { render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { afterEach, beforeAll, describe, it, expect, vi, beforeEach } from 'vitest';

const mocks = vi.hoisted(() => ({
  get: vi.fn(),
  routes: {} as Record<string, (config?: { params?: Record<string, unknown> }) => Promise<{ data: unknown }> | { data: unknown } | Error>,
  status: 'authenticated',
}));
vi.mock('../services/api', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  api: { get: mocks.get, post: vi.fn() },
  getAccessToken: () => (mocks.status === 'authenticated' ? 'tok' : null),
}));
// Khôi phục cuộn cần Router; spec này không dựng Router và không kiểm vị trí cuộn.
vi.mock('../hooks/use-navigation-type', () => ({ useNavigationType: () => 'PUSH' }));
vi.mock('../hooks/use-scroll-restoration', () => ({ useScrollRestoration: () => ({ anchorRef: { current: null } }) }));
vi.mock('zmp-ui', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  Page: ({ children }: { children: ReactNode }) => <div className="zaui-page">{children}</div>,
  useNavigate: () => vi.fn(),
  useLocation: () => ({ pathname: '/', search: '', hash: '', state: null, key: 'default' }),
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
  brands: [{ brand: 'Cobote', count: 3 }, { brand: 'Hector', count: 2 }],
  campaigns: [],
  combos: [],
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
  subscriptions: [],
  notifications: [],
  newCustomerOffer: {
    isNewCustomer: true,
    welcomeVoucher: { code: 'WELCOME-U1', type: 'AMOUNT', value: 25_000, minOrder: 150_000, endAt: '2026-11-17T10:00:00.000Z' },
  },
  wasteOpenRequestCount: 0,
  purchasedLimit: 10,
};

/** Món của lưới "Gợi ý cho bạn" cuối trang: thấy món này là trang đã vẽ tới khối cuối. */
const SUGGEST_ITEM = 'Món gợi ý cho bạn';

const paths = () => mocks.get.mock.calls.map(([url]) => url as string);

/** Lưới "Gợi ý cho bạn" ở cuối trang chỉ tải khi khối sắp vào màn: giữ nó ngoài màn để đếm đúng các request của lần mở Trang chủ. */
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
    // Lưới gợi ý cuối trang (trang 1) không nằm trong request gộp: request riêng, chỉ tải khi khối sắp vào màn. Cộng đồng chỉ là thẻ chen trong lưới đó
    // nên /feed không nằm trong lần mở Trang chủ.
    mocks.routes['/products'] = () => ({ data: PAGE([card('sg', SUGGEST_ITEM)]) });
    mocks.routes['/feed'] = () => ({ data: { posts: [] } });
    // Chuông chỉ đếm bằng một lời gọi nhỏ (cả hộp thư, không dừng ở 50 tin của khối gộp): request riêng của khách đã đăng nhập.
    mocks.routes['/me/summary'] = () => ({ data: { orders: { pending_payment: 0, processing: 0, shipping: 0, delivered: 0, closed: 0, active: 0 }, unreadNotifications: 0, activeSubscriptions: 0 } });
    mocks.get.mockImplementation(async (url: string, config?: { params?: Record<string, unknown> }) => {
      const r = mocks.routes[url];
      if (!r) throw Object.assign(new Error(`404 ${url}`), { response: { status: 404 } });
      const v = await r(config);
      if (v instanceof Error) throw v;
      return v;
    });
  });

  it('đã đăng nhập: dữ liệu Home đến từ 2 request gộp (/home + /home/me) cộng /me/summary (số tin chưa đọc, đơn đang xử lý), vẽ đủ khối; lưới gợi ý cuối trang chưa tải khi chưa tới gần', async () => {
    keepSuggestOffScreen();
    mocks.routes['/home'] = () => ({ data: PUBLIC_FEED });
    mocks.routes['/home/me'] = () => ({ data: ME_FEED });
    renderHome();
    // D2-07b: khối "Quà khách mới" (số công khai + ưu đãi của khách) đi cùng hai request gộp, không thêm request lẻ.
    expect(await screen.findByText(/^Mã 25\.000đ/)).toBeInTheDocument();
    await new Promise((r) => setTimeout(r, 50));
    // Danh sách nhãn đến từ khối gộp /home (thanh chip dưới Danh mục, có vì đủ hai nhãn thật); lưới gợi ý chưa tải vì khối còn ở xa màn.
    expect(screen.getAllByText('Cobote').length).toBeGreaterThan(0);
    expect(screen.queryByText(SUGGEST_ITEM)).toBeNull();
    // Số yêu cầu đổi rác đang mở lấy từ /home/me (không gọi /waste/me). /game/daily là chấm của thẻ Vườn Xanh (W42), cùng khoá truy vấn với
    // thanh đáy vốn đã gọi ở mọi tab gốc, nên trong app thật không thêm request.
    expect(paths().sort()).toEqual(['/game/daily', '/home', '/home/me', '/me/summary']);
    expect(mocks.get.mock.calls.find(([u]) => u === '/home/me')?.[1]).toMatchObject({ params: { purchasedLimit: 10 } });
  });

  it('API gộp cũ chưa có khối số yêu cầu đổi rác: hỏi endpoint nhẹ /waste/me/open-count một lần, không gọi /waste/me', async () => {
    const { wasteOpenRequestCount: _dropped, ...oldMe } = ME_FEED;
    mocks.routes['/home'] = () => ({ data: PUBLIC_FEED });
    mocks.routes['/home/me'] = () => ({ data: oldMe });
    mocks.routes['/waste/me/open-count'] = () => ({ data: { count: 0 } });
    renderHome();
    expect(await screen.findByText(SUGGEST_ITEM)).toBeInTheDocument();
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
    expect(paths().sort()).toEqual(['/config/public', '/game/daily', '/home', '/home/me', '/me/new-customer-offer', '/me/summary']);
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
    expect(await screen.findByText(SUGGEST_ITEM)).toBeInTheDocument();
    await new Promise((r) => setTimeout(r, 50));
    expect(paths().filter((p) => p === '/campaigns')).toHaveLength(1);
    expect(mocks.get.mock.calls.find(([u]) => u === '/campaigns')?.[1]).toMatchObject({ params: { placement: 'HOME_TOP' } });
  });

  it('combo toàn sàn đến từ khối gộp /home: hiện kệ "Combo tiết kiệm", không thêm request /bundles/combos', async () => {
    const bundle = (id: string) => ({
      id, kind: 'BUNDLE_PCT', title: `Combo ${id}`, pct: 10, endAt: new Date(Date.now() + 86_400_000).toISOString(), anchorProductId: null,
      items: ['a', 'b'].map((n) => ({ productId: `${id}${n}`, variationId: `v-${id}${n}`, maxQty: 1, addonPrice: null, inStock: true, product: card(`${id}${n}`, `Món ${id}${n}`) })),
    });
    mocks.routes['/home'] = () => ({ data: { ...PUBLIC_FEED, combos: [bundle('c1'), bundle('c2')] } });
    mocks.routes['/home/me'] = () => ({ data: ME_FEED });
    renderHome();
    expect(await screen.findByRole('region', { name: 'Combo tiết kiệm' })).toBeInTheDocument();
    await new Promise((r) => setTimeout(r, 50));
    expect(paths()).not.toContain('/bundles/combos');
  });

  it('API gộp cũ chưa có khối combos: lùi về một request lẻ /bundles/combos?limit=4, lỗi thì kệ ẩn', async () => {
    const { combos: _dropped, ...oldPublic } = PUBLIC_FEED;
    mocks.routes['/home'] = () => ({ data: oldPublic });
    mocks.routes['/home/me'] = () => ({ data: ME_FEED });
    mocks.routes['/bundles/combos'] = () => ({ data: [] });
    renderHome();
    expect(await screen.findByText(SUGGEST_ITEM)).toBeInTheDocument();
    await new Promise((r) => setTimeout(r, 50));
    expect(paths().filter((p) => p === '/bundles/combos')).toHaveLength(1);
    expect(mocks.get.mock.calls.find(([u]) => u === '/bundles/combos')?.[1]).toMatchObject({ params: { limit: 4 } });
    expect(screen.queryByRole('region', { name: 'Combo tiết kiệm' })).toBeNull();
  });

  it('API cũ chưa có /home (404): lùi về từng request lẻ, trang vẫn đủ nội dung', async () => {
    mocks.routes['/categories'] = () => ({ data: [] });
    mocks.routes['/brands'] = () => ({ data: [{ brand: 'Cobote', count: 3 }, { brand: 'Hector', count: 2 }] });
    mocks.routes['/flash-sales/active'] = () => ({ data: [] });
    mocks.routes['/flash-sales/upcoming'] = () => ({ data: [] });
    mocks.routes['/me/purchased-items'] = () => ({ data: { items: [], nextCursor: null } });
    mocks.routes['/orders/active-count'] = () => ({ data: { count: 0 } });
    mocks.routes['/me/subscriptions'] = () => ({ data: [] });
    renderHome();
    expect(await screen.findByText(SUGGEST_ITEM)).toBeInTheDocument();
    await waitFor(() => expect(paths()).toEqual(expect.arrayContaining(['/home', '/home/me', '/products', '/categories', '/brands'])));
  });

  it('khối null phía server: chỉ khối đó gọi lẻ, khối khác vẫn lấy từ gộp', async () => {
    keepSuggestOffScreen();
    mocks.routes['/home'] = () => ({ data: { ...PUBLIC_FEED, categories: null } });
    mocks.routes['/home/me'] = () => ({ data: ME_FEED });
    mocks.routes['/categories'] = () => ({ data: [{ id: 'c1', parentId: null, name: 'LẻDanhMục', slug: 'le-danh-muc', image: null, sortOrder: 1, productCount: 5 }] });
    renderHome();
    expect((await screen.findAllByRole('button', { name: 'LẻDanhMục' })).length).toBeGreaterThan(0);
    await new Promise((r) => setTimeout(r, 50));
    expect(paths().sort()).toEqual(['/categories', '/game/daily', '/home', '/home/me', '/me/summary']);
  });

  it('kéo để làm mới: khối gộp được tải lại bằng request gộp, không bắn request lẻ', async () => {
    mocks.routes['/home'] = () => ({ data: PUBLIC_FEED });
    mocks.routes['/home/me'] = () => ({ data: ME_FEED });
    const { qc } = renderHome();
    await screen.findByText(SUGGEST_ITEM);
    await new Promise((r) => setTimeout(r, 50));
    mocks.get.mockClear();
    await refreshHomeQueries(qc);
    await new Promise((r) => setTimeout(r, 50));
    const after = paths();
    expect(after.filter((p) => p === '/home').length).toBe(1);
    expect(after.filter((p) => p === '/home/me').length).toBe(1);
    expect(after).not.toContain('/categories');
    expect(after).not.toContain('/brands');
  });
});
