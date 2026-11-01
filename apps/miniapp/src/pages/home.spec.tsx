import { render, screen, waitFor, within, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { describe, it, expect, vi, beforeEach, beforeAll } from 'vitest';

const mocks = vi.hoisted(() => ({
  navigate: vi.fn(),
  fetchProducts: vi.fn(),
  fetchCategories: vi.fn(),
  fetchPurchasedItems: vi.fn(),
  unreadCount: vi.fn(),
  coreGet: vi.fn(),
  auth: { status: 'authenticated' as 'authenticated' | 'guest' | 'loading' | 'error', user: { id: 'u1' } as { id: string } | null },
  onRefresh: undefined as undefined | (() => Promise<unknown> | void),
  restore: vi.fn(),
}));
vi.mock('zmp-ui', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  Page: ({ children }: { children: ReactNode }) => <div className="zaui-page">{children}</div>,
  useNavigate: () => mocks.navigate,
}));
vi.mock('../services/shop-api', () => ({
  fetchProducts: mocks.fetchProducts,
  fetchCategories: mocks.fetchCategories,
  fetchPurchasedItems: mocks.fetchPurchasedItems,
  fetchActiveFlashSales: vi.fn().mockResolvedValue([]),
  fetchUpcomingFlashSales: vi.fn().mockResolvedValue([]),
  getCart: vi.fn(),
}));
// Chuông chỉ đếm: một lời gọi unread-count, không tải danh sách tin (/me/notifications).
vi.mock('../services/core-http', () => ({
  coreHttp: {
    get: (path: string) => {
      mocks.coreGet(path);
      if (path === '/me/notifications/unread-count') return mocks.unreadCount();
      if (path === '/campaigns') return Promise.resolve([]);
      return Promise.reject(new Error(`không mock ${path}`));
    },
  },
}));
vi.mock('../store/auth', () => ({
  useAuthStore: (sel: (s: { status: string; user: { id: string } | null; restore: () => void }) => unknown) => sel({ status: mocks.auth.status, user: mocks.auth.user, restore: mocks.restore }),
}));
// Mỗi khối mới đã có test riêng; ở đây chỉ kiểm thứ tự, khối lỗi/khung chờ của Bán chạy và hành vi cấp trang.
vi.mock('../components/flash-sale', () => ({ FlashSale: () => null, UpcomingFlashSales: () => null }));
vi.mock('../components/reorder/purchased-rail', () => ({ PURCHASED_RAIL_LIMIT: 10, PurchasedRail: () => <section aria-label="Mua lại" /> }));
vi.mock('../components/home/member-card', () => ({
  MemberCard: () => <section aria-label="Thẻ thành viên" />,
  MemberCardSkeleton: () => <div data-testid="member-card-loading" />,
  MemberCardUnavailable: ({ onRetry }: { onRetry: () => void }) => <button data-testid="member-card-unavailable" onClick={onRetry}>Thử lại</button>,
}));
vi.mock('../components/home/todo-strip', () => ({ TodoStrip: () => null, useHomeTodoQueries: () => ({ loading: false }) }));
vi.mock('../components/home/shortcut-grid', () => ({ ShortcutGrid: () => <section aria-label="Lối tắt" /> }));
vi.mock('../components/home/brand-journey', () => ({ BrandJourney: () => null }));
vi.mock('../components/home/community-preview', () => ({ CommunityPreview: () => null }));
vi.mock('../components/home/suggest-feed', () => ({ SuggestFeed: () => <section aria-label="Gợi ý cho bạn" /> }));
vi.mock('../components/home/new-customer-gift', () => ({ NewCustomerGift: () => <section aria-label="Quà khách mới" /> }));
vi.mock('../components/cart-button', () => ({ CartButton: () => null }));
vi.mock('../components/pull-to-refresh', () => ({
  PullToRefresh: ({ onRefresh }: { onRefresh: () => Promise<unknown> | void }) => {
    mocks.onRefresh = onRefresh;
    return null;
  },
}));
vi.mock('../components/wishlist-heart', () => ({ WishlistHeart: () => null }));
vi.mock('../utils/haptic', () => ({ haptic: vi.fn() }));

import HomePage from './home';
import { homeBlockOrder } from '../components/home/home-blocks';
import { homeRenderOrder } from '@tubutree/app-core/home-layout';
import { HOME_KIND_KEY } from '../hooks/use-home-customer-kind';
import { loadHomeBelow } from '../components/home/home-lazy';

// Chunk khối dưới màn đầu nạp thật trước, để test không phụ thuộc tốc độ máy.
beforeAll(() => loadHomeBelow());

const card = (id: string, name: string) => ({
  id, slug: id, brand: 'Tubu', name, thumbnail: null, basePrice: 50000, salePrice: null, isFeatured: true, inStock: true,
});
const PAGE = (items: ReturnType<typeof card>[]) => ({ data: items, meta: { page: 1, limit: 6, total: items.length } });
// Kệ Bán chạy nhất chỉ hiện từ 3 món (SHELVES), nên mock mặc định trả 4 món.
const BEST_PAGE = () => PAGE([1, 2, 3, 4].map((n) => card(`bs${n}`, `Bán chạy ${n}`)));
const BEST_QUERY = { limit: 12, sort: 'best_seller_30d' };

function renderHome() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const utils = render(
    <QueryClientProvider client={qc}>
      <HomePage />
    </QueryClientProvider>,
  );
  return { qc, ...utils };
}
const blockOrder = () => Array.from(document.querySelectorAll<HTMLElement>('[data-home-block]')).map((el) => el.dataset.homeBlock);
const block = (id: string) => document.querySelector<HTMLElement>(`[data-home-block="${id}"]`)!;
const settled = (qc: QueryClient, key: unknown[]) => {
  const s = qc.getQueryState(key)?.status;
  return s === 'success' || s === 'error';
};
const RETURNING = [...homeBlockOrder('returning')];
const NEW = [...homeBlockOrder('new')];
// Chưa biết loại khách thì mọi khối dưới thẻ thành viên là MỘT khung chờ chung, chỉ hiện cùng lúc khi dữ liệu đã chốt.
const UNKNOWN = [...homeRenderOrder('unknown', true)];

describe('HomePage (phương án A, 9 khối)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    mocks.auth.status = 'authenticated';
    mocks.auth.user = { id: 'u1' };
    mocks.onRefresh = undefined;
    mocks.fetchProducts.mockResolvedValue(BEST_PAGE());
    mocks.fetchCategories.mockResolvedValue([]);
    mocks.unreadCount.mockResolvedValue({ count: 0 });
    mocks.fetchPurchasedItems.mockResolvedValue({ items: [], nextCursor: null });
  });

  it('khách mới: thẻ Quà khách mới thay thẻ thành viên, có kệ Bán chạy nhất, không có Mua lại', async () => {
    const { qc } = renderHome();
    await waitFor(() => expect(settled(qc, ['purchased-items', 10])).toBe(true));
    await screen.findByRole('region', { name: 'Bán chạy nhất' });
    expect(mocks.fetchPurchasedItems).toHaveBeenCalledWith({ limit: 10 });
    expect(blockOrder()).toEqual(NEW);
    expect(block('member')).toBeNull();
    expect(NEW).not.toContain('purchased');
    expect(blockOrder()[blockOrder().length - 1]).toBe('suggest');
  });

  it('khách cũ: thẻ thành viên, Việc cần làm, lối tắt, Mua lại, Giờ vàng, Danh mục, ... lưới gợi ý cuối', async () => {
    mocks.fetchPurchasedItems.mockResolvedValue({ items: [{ variationId: 'v1' }], nextCursor: null });
    renderHome();
    await waitFor(() => expect(blockOrder()).toEqual(RETURNING));
    // Giờ vàng đứng TRƯỚC Mua lại (Q6); Bán chạy nhất có ở cả hai loại khách (Q18).
    expect(RETURNING.slice(0, 6)).toEqual(['search', 'member', 'todo', 'banner', 'shortcuts', 'flash']);
    expect(RETURNING.indexOf('flash')).toBeLessThan(RETURNING.indexOf('purchased'));
    expect(RETURNING).toContain('bestSellers');
    expect(screen.getByRole('region', { name: 'Thẻ thành viên' })).toBeInTheDocument();
  });

  it('"Bán chạy nhất" lấy 12 món theo 30 ngày, có hạng, và "Xem tất cả" mở trang Bán chạy nhất (cùng thước đo 30 ngày)', async () => {
    renderHome();
    const best = await screen.findByRole('region', { name: 'Bán chạy nhất' });
    expect(await within(best).findByText('Bán chạy 1')).toBeInTheDocument();
    expect(mocks.fetchProducts).toHaveBeenCalledWith(BEST_QUERY);
    expect(best.querySelectorAll('[data-ds-part="rank"]')).toHaveLength(4);
    await userEvent.setup().click(within(best).getByRole('button', { name: 'Xem tất cả Bán chạy nhất' }));
    expect(mocks.navigate).toHaveBeenLastCalledWith('/best-sellers');
  });

  it('Danh mục dùng 4 phân khúc khi chưa có danh mục thật; không còn "Khám phá vườn"', async () => {
    renderHome();
    expect(await screen.findByRole('button', { name: 'Cho mẹ & bé' })).toBeInTheDocument();
    expect(screen.queryByText(/Khám phá vườn/)).toBeNull();
  });

  it('ô tìm là vỏ: chạm mở /browse?focus=search', async () => {
    renderHome();
    await userEvent.setup().click(screen.getByRole('button', { name: 'Bạn đang tìm gì hôm nay?' }));
    expect(mocks.navigate).toHaveBeenCalledWith('/browse?focus=search');
  });

  it('D7-7: API sập hẳn (Bán chạy lỗi, chưa có dữ liệu) → MỘT dải lỗi cấp trang ngay dưới ô tìm, không thẻ lỗi từng khối; thử lại xong thì dải biến mất', async () => {
    let down = true;
    mocks.fetchProducts.mockImplementation(async () => {
      if (down) throw new Error('boom');
      return BEST_PAGE();
    });
    const { qc } = renderHome();
    await waitFor(() => expect(qc.getQueryState(['products', 'home-best-seller'])?.status).toBe('error'));
    const strip = await screen.findByTestId('home-page-error');
    expect(within(strip).getByText('Chưa tải được Trang chủ')).toBeInTheDocument();
    expect(screen.queryAllByTestId('home-block-error')).toHaveLength(0);
    expect(blockOrder().slice(0, 2)).toEqual(['search', 'pageError']);

    down = false;
    await userEvent.setup().click(within(strip).getByRole('button', { name: 'Thử lại' }));
    expect(await screen.findByText('Bán chạy 1')).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByTestId('home-page-error')).toBeNull());
  });

  it('kệ "Mua lại" lỗi với khách cũ đã được nhớ: vẫn bố cục khách cũ, không dải lỗi cấp trang, không mất loại đã nhớ', async () => {
    localStorage.setItem(HOME_KIND_KEY, JSON.stringify({ userId: 'u1', kind: 'returning' }));
    mocks.fetchPurchasedItems.mockRejectedValue(new Error('boom'));
    const { qc } = renderHome();
    await waitFor(() => expect(qc.getQueryState(['purchased-items', 10])?.status).toBe('error'));
    expect(blockOrder()).toEqual(RETURNING);
    expect(screen.queryByTestId('home-page-error')).toBeNull();
    expect(JSON.parse(localStorage.getItem(HOME_KIND_KEY) ?? 'null')).toEqual({ userId: 'u1', kind: 'returning' });
  });

  it('đang khôi phục phiên (status loading) + đã nhớ khách cũ: bố cục khách cũ; chưa nhớ gì (máy mới hoặc khách cũ đổi máy) thì giữ chỗ thẻ thành viên chờ biết loại, không hứa quà khách mới', async () => {
    localStorage.setItem(HOME_KIND_KEY, JSON.stringify({ userId: 'u1', kind: 'returning' }));
    mocks.auth.status = 'loading';
    mocks.auth.user = null;
    const first = renderHome();
    expect(blockOrder()).toEqual(RETURNING);
    first.unmount();
    localStorage.clear();
    renderHome();
    expect(blockOrder()).toEqual(UNKNOWN);
    expect(screen.queryByRole('region', { name: 'Quà khách mới' })).toBeNull();
  });

  it('R-156: khách cũ mất mạng lúc mở app (status error) và máy đã nhớ khách cũ: bố cục khách cũ kèm thẻ báo lỗi, không quà khách mới; máy chưa nhớ gì thì rơi về khách mới', async () => {
    localStorage.setItem(HOME_KIND_KEY, JSON.stringify({ userId: 'u1', kind: 'returning' }));
    mocks.auth.status = 'error';
    mocks.auth.user = null;
    const first = renderHome();
    expect(blockOrder()).toEqual(RETURNING);
    expect(screen.getByTestId('member-card-unavailable')).toBeInTheDocument();
    act(() => screen.getByTestId('member-card-unavailable').click());
    expect(mocks.restore).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('region', { name: 'Quà khách mới' })).toBeNull();
    first.unmount();
    localStorage.clear();
    renderHome();
    expect(screen.getByRole('region', { name: 'Quà khách mới' })).toBeInTheDocument();
  });

  it('khách cũ cũng thấy kệ Bán chạy nhất nên nhận dải lỗi cấp trang khi API sập hẳn (không thẻ lỗi từng khối)', async () => {
    localStorage.setItem(HOME_KIND_KEY, JSON.stringify({ userId: 'u1', kind: 'returning' }));
    mocks.fetchPurchasedItems.mockResolvedValue({ items: [{ variationId: 'v1', slug: 'da-mua' }], nextCursor: null });
    mocks.fetchProducts.mockRejectedValue(new Error('boom'));
    const { qc } = renderHome();
    await waitFor(() => expect(settled(qc, ['products', 'home-best-seller'])).toBe(true));
    expect(mocks.fetchProducts).toHaveBeenCalledWith(BEST_QUERY);
    expect(await screen.findByTestId('home-page-error')).toBeInTheDocument();
    expect(screen.queryAllByTestId('home-block-error')).toHaveLength(0);
  });

  it('khung chờ Bán chạy nhất có 5 ô thẻ hạng khi đang tải', async () => {
    mocks.fetchProducts.mockReturnValue(new Promise(() => {}));
    renderHome();
    const best = await screen.findByRole('region', { name: 'Bán chạy nhất' });
    expect(within(best).getAllByTestId('catalog-tile-skeleton')).toHaveLength(5);
  });

  it('khách chưa đăng nhập: không gọi notifications/purchased-items, bố cục khách mới', async () => {
    mocks.auth.status = 'guest';
    mocks.auth.user = null;
    renderHome();
    await screen.findByRole('region', { name: 'Bán chạy nhất' });
    // Chỉ banner (công khai) được gọi; không có gì của riêng người dùng.
    expect(mocks.coreGet.mock.calls.map((c) => c[0]).filter((p) => p !== '/campaigns')).toEqual([]);
    expect(mocks.fetchPurchasedItems).not.toHaveBeenCalled();
    expect(blockOrder()).toEqual(NEW);
  });

  it('chuông báo số tin chưa đọc (chỉ khi đã đăng nhập)', async () => {
    mocks.unreadCount.mockResolvedValue({ count: 73 });
    renderHome();
    expect(await screen.findByRole('button', { name: 'Thông báo, 73 chưa đọc' })).toBeInTheDocument();
    // Một lời gọi đếm nhỏ, không tải trang tin nào: khách có hơn 50 tin chưa đọc thấy đúng số như ở Cá nhân.
    expect(mocks.coreGet.mock.calls.map((c) => c[0]).filter((p) => p !== '/campaigns')).toEqual(['/me/notifications/unread-count']);
  });

  it('kéo để làm mới làm mới MỌI truy vấn của Trang chủ', async () => {
    const { qc } = renderHome();
    await screen.findByRole('region', { name: 'Bán chạy nhất' });
    await waitFor(() => expect(mocks.unreadCount).toHaveBeenCalled());
    const before = {
      products: mocks.fetchProducts.mock.calls.length,
      purchased: mocks.fetchPurchasedItems.mock.calls.length,
      categories: mocks.fetchCategories.mock.calls.length,
      unread: mocks.unreadCount.mock.calls.length,
    };
    expect(mocks.onRefresh).toBeDefined();
    await act(async () => {
      await mocks.onRefresh!();
    });
    expect(mocks.fetchProducts.mock.calls.length).toBeGreaterThan(before.products);
    expect(mocks.fetchPurchasedItems.mock.calls.length).toBe(before.purchased + 1);
    expect(mocks.fetchCategories.mock.calls.length).toBe(before.categories + 1);
    expect(mocks.unreadCount.mock.calls.length).toBe(before.unread + 1);
    expect(qc.isFetching()).toBe(0);
  });

  it('có tiêu đề h1 "Tubu Tree" làm điểm mốc của trang', async () => {
    renderHome();
    expect(screen.getByRole('heading', { level: 1, name: 'Tubu Tree' })).toBeInTheDocument();
  });

  describe('thứ tự khối không nhảy sau khung hình đầu (khách cũ mở lạnh)', () => {
    const storeKind = (value: unknown) => localStorage.setItem(HOME_KIND_KEY, typeof value === 'string' ? value : JSON.stringify(value));
    const deferred = <T,>() => {
      let resolve!: (v: T) => void;
      const promise = new Promise<T>((r) => {
        resolve = r;
      });
      return { promise, resolve };
    };
    const storedKind = () => JSON.parse(localStorage.getItem(HOME_KIND_KEY) ?? 'null') as { userId: string; kind: string } | null;

    it('(a) đã nhớ "returning" + purchased-items còn tải: render đúng thứ tự returning ngay từ lần đầu và KHÔNG xê dịch khi dữ liệu về', async () => {
      storeKind({ userId: 'u1', kind: 'returning' });
      const d = deferred<{ items: object[]; nextCursor: null }>();
      mocks.fetchPurchasedItems.mockReturnValue(d.promise);
      const seen = new Set<string>();
      const obs = new MutationObserver(() => seen.add(blockOrder().join('>')));
      obs.observe(document.body, { childList: true, subtree: true });
      const { qc } = renderHome();
      expect(blockOrder()).toEqual(RETURNING);
      seen.add(blockOrder().join('>'));
      await waitFor(() => expect(mocks.fetchPurchasedItems).toHaveBeenCalled());
      expect(settled(qc, ['purchased-items', 10])).toBe(false);
      await act(async () => {
        d.resolve({ items: [{ variationId: 'v1' }], nextCursor: null });
      });
      await waitFor(() => expect(settled(qc, ['purchased-items', 10])).toBe(true));
      obs.disconnect();
      expect(blockOrder()).toEqual(RETURNING);
      expect([...seen]).toEqual([RETURNING.join('>')]);
    });

    it('(b) lần đầu (chưa nhớ gì), đã đăng nhập: "unknown" (giữ chỗ thẻ thành viên, chưa có Mua lại/Quà) khi đang tải, đổi sang "returning" khi có hàng, và nhớ lại', async () => {
      const d = deferred<{ items: object[]; nextCursor: null }>();
      mocks.fetchPurchasedItems.mockReturnValue(d.promise);
      renderHome();
      expect(blockOrder()).toEqual(UNKNOWN);
      expect(screen.getByTestId('member-card-loading')).toBeInTheDocument();
      expect(screen.getByTestId('home-settling')).toBeInTheDocument();
      expect(screen.queryByRole('region', { name: 'Bán chạy nhất' })).toBeNull();
      await act(async () => {
        d.resolve({ items: [{ variationId: 'v1' }], nextCursor: null });
      });
      await waitFor(() => expect(blockOrder()).toEqual(RETURNING));
      expect(storedKind()).toEqual({ userId: 'u1', kind: 'returning' });
    });

    it('(c) loại đã nhớ cập nhật khi truy vấn xong: returning -> danh sách rỗng -> new (và ngược lại)', async () => {
      storeKind({ userId: 'u1', kind: 'returning' });
      const { qc, unmount } = renderHome();
      await waitFor(() => expect(blockOrder()).toEqual(NEW));
      await waitFor(() => expect(storedKind()).toEqual({ userId: 'u1', kind: 'new' }));
      expect(settled(qc, ['purchased-items', 10])).toBe(true);
      unmount();
      mocks.fetchPurchasedItems.mockResolvedValue({ items: [{ variationId: 'v1' }], nextCursor: null });
      renderHome();
      await waitFor(() => expect(storedKind()).toEqual({ userId: 'u1', kind: 'returning' }));
    });

    it('(c2) tải lỗi với khách đã nhớ "returning": giữ thứ tự returning, KHÔNG ghi đè loại đã nhớ', async () => {
      storeKind({ userId: 'u1', kind: 'returning' });
      mocks.fetchPurchasedItems.mockRejectedValue(new Error('500'));
      const { qc } = renderHome();
      await waitFor(() => expect(settled(qc, ['purchased-items', 10])).toBe(true));
      expect(blockOrder()).toEqual(RETURNING);
      expect(storedKind()).toEqual({ userId: 'u1', kind: 'returning' });
    });

    it('(c3) tải lỗi mà chưa nhớ gì: khách mới, không ghi gì', async () => {
      mocks.fetchPurchasedItems.mockRejectedValue(new Error('500'));
      const { qc } = renderHome();
      await waitFor(() => expect(settled(qc, ['purchased-items', 10])).toBe(true));
      await waitFor(() => expect(blockOrder()).toEqual(NEW));
      expect(storedKind()).toBeNull();
    });

    it.each([
      ['không phải JSON', 'không-phải-json'],
      ['kind lạ', JSON.stringify({ userId: 'u1', kind: 'vip' })],
      ['sai dạng', JSON.stringify(['returning'])],
      ['thiếu userId', JSON.stringify({ kind: 'returning' })],
    ])('(d) giá trị lưu hỏng/lạ (%s) bị bỏ qua: đang tải -> "unknown"', async (_name, raw) => {
      localStorage.setItem(HOME_KIND_KEY, raw);
      mocks.fetchPurchasedItems.mockReturnValue(new Promise(() => {}));
      renderHome();
      await waitFor(() => expect(mocks.fetchPurchasedItems).toHaveBeenCalled());
      expect(blockOrder()).toEqual(UNKNOWN);
    });

    it('(e) loại đã nhớ của TÀI KHOẢN KHÁC không được dùng', async () => {
      storeKind({ userId: 'someone-else', kind: 'returning' });
      mocks.fetchPurchasedItems.mockReturnValue(new Promise(() => {}));
      renderHome();
      await waitFor(() => expect(mocks.fetchPurchasedItems).toHaveBeenCalled());
      expect(blockOrder()).toEqual(UNKNOWN);
    });

    it('khách chưa đăng nhập: luôn "new", không đọc loại đã nhớ và không ghi gì', async () => {
      mocks.auth.status = 'guest';
      mocks.auth.user = null;
      storeKind({ userId: 'u1', kind: 'returning' });
      const before = localStorage.getItem(HOME_KIND_KEY);
      renderHome();
      expect(blockOrder()).toEqual(NEW);
      await screen.findByRole('region', { name: 'Bán chạy nhất' });
      expect(blockOrder()).toEqual(NEW);
      expect(localStorage.getItem(HOME_KIND_KEY)).toBe(before);
    });
  });
});
