import { render, screen, waitFor, within, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mocks = vi.hoisted(() => ({
  navigate: vi.fn(),
  fetchProducts: vi.fn(),
  fetchForYou: vi.fn(),
  fetchBrands: vi.fn(),
  fetchCategories: vi.fn(),
  fetchPurchasedItems: vi.fn(),
  getNotifications: vi.fn(),
  auth: { status: 'authenticated' as 'authenticated' | 'guest', user: { id: 'u1' } as { id: string } | null },
  onRefresh: undefined as undefined | (() => Promise<unknown> | void),
}));
vi.mock('zmp-ui', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  Page: ({ children }: { children: ReactNode }) => <div className="zaui-page">{children}</div>,
  useNavigate: () => mocks.navigate,
}));
vi.mock('../services/shop-api', () => ({
  fetchProducts: mocks.fetchProducts,
  fetchForYou: mocks.fetchForYou,
  fetchBrands: mocks.fetchBrands,
  fetchCategories: mocks.fetchCategories,
  fetchPurchasedItems: mocks.fetchPurchasedItems,
  fetchActiveFlashSales: vi.fn().mockResolvedValue([]),
  getCart: vi.fn(),
}));
vi.mock('../services/account-api', () => ({ getNotifications: mocks.getNotifications }));
vi.mock('../store/auth', () => ({
  useAuthStore: (sel: (s: { status: string; user: { id: string } | null }) => unknown) => sel({ status: mocks.auth.status, user: mocks.auth.user }),
}));
// Khối đã có test riêng (4a / Task 19) — ở đây chỉ kiểm thứ tự và nội dung trang.
vi.mock('../components/flash-sale', () => ({ FlashSale: () => null, UpcomingFlashSales: () => null }));
vi.mock('../components/reorder/purchased-rail', () => ({ PURCHASED_RAIL_LIMIT: 10, PurchasedRail: () => <section aria-label="Mua lại" /> }));
vi.mock('../components/home/order-strip', () => ({ OrderStrip: () => null }));
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
import { HOME_KIND_KEY } from '../hooks/use-home-customer-kind';

const card = (id: string, name: string) => ({
  id, slug: id, brand: 'Tubu', name, thumbnail: null, basePrice: 50000, salePrice: null, isFeatured: true, inStock: true,
});
const PAGE = (items: ReturnType<typeof card>[]) => ({ data: items, meta: { page: 1, limit: 6, total: items.length } });

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
/** Query đã xong (success/error) — khác "request đã gọi": lúc đó trang mới thật sự biết khách cũ hay mới. */
const settled = (qc: QueryClient, key: unknown[]) => {
  const s = qc.getQueryState(key)?.status;
  return s === 'success' || s === 'error';
};

describe('HomePage (DS v2, spec 5b.1)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    mocks.auth.status = 'authenticated';
    mocks.auth.user = { id: 'u1' };
    mocks.onRefresh = undefined;
    mocks.fetchProducts.mockImplementation(async (params: { sort?: string }) =>
      params.sort === 'best_seller' ? PAGE([card('bs', 'Bán chạy nhất')]) : PAGE([card('f1', 'Trùng gợi ý'), card('f2', 'Chỉ nổi bật')]),
    );
    mocks.fetchForYou.mockResolvedValue([card('f1', 'Trùng gợi ý')]);
    mocks.fetchBrands.mockResolvedValue([]);
    mocks.fetchCategories.mockResolvedValue([]);
    mocks.getNotifications.mockResolvedValue([]);
  });

  it('khách mới: thứ tự khối "new" (Bán chạy + Danh mục trước Dành cho bạn), kệ Mua lại + dải đơn giữ ô 2-3', async () => {
    mocks.fetchPurchasedItems.mockResolvedValue({ items: [], nextCursor: null });
    const { qc } = renderHome();
    // Đợi purchased-items XONG (không chỉ được gọi) và khối Bán chạy đã vẽ xong rồi mới khẳng định thứ tự.
    await waitFor(() => expect(settled(qc, ['purchased-items', 10])).toBe(true));
    await screen.findByRole('region', { name: 'Bán chạy' });
    expect(mocks.fetchPurchasedItems).toHaveBeenCalledWith({ limit: 10 });
    expect(blockOrder()).toEqual([...homeBlockOrder('new')]);
    expect(blockOrder().slice(1, 3)).toEqual(['purchased', 'orderStrip']);
    expect(blockOrder().indexOf('bestSellers')).toBeLessThan(blockOrder().indexOf('forYou'));
  });

  it('khách cũ: thứ tự khối "returning" sau khi purchased-items có hàng', async () => {
    mocks.fetchPurchasedItems.mockResolvedValue({ items: [{ variationId: 'v1' }], nextCursor: null });
    renderHome();
    await waitFor(() => expect(blockOrder()).toEqual([...homeBlockOrder('returning')]));
    expect(blockOrder().slice(1, 3)).toEqual(['purchased', 'orderStrip']);
    expect(blockOrder().indexOf('forYou')).toBeLessThan(blockOrder().indexOf('bestSellers'));
  });

  it('"Bán chạy" dùng sort=best_seller; "Tubu chọn cho bạn" bỏ SP đã có ở "Dành cho bạn"', async () => {
    mocks.fetchPurchasedItems.mockResolvedValue({ items: [], nextCursor: null });
    renderHome();
    const best = await screen.findByRole('region', { name: 'Bán chạy' });
    // Khối hiện ngay với khung chờ → đợi SP thật rồi mới khẳng định.
    expect(await within(best).findByText('Bán chạy nhất')).toBeInTheDocument();
    expect(mocks.fetchProducts).toHaveBeenCalledWith({ limit: 6, sort: 'best_seller' });
    const featured = await screen.findByRole('region', { name: 'Tubu chọn cho bạn' });
    expect(await within(featured).findByText('Chỉ nổi bật')).toBeInTheDocument();
    expect(within(featured).queryByText('Trùng gợi ý')).toBeNull();
    const forYou = await screen.findByRole('region', { name: 'Dành cho bạn' });
    expect(await within(forYou).findByText('Trùng gợi ý')).toBeInTheDocument();
  });

  it('không còn "Khám phá vườn", hàng phân khúc, hay khối "Cho mẹ và bé"; Danh mục dùng 4 phân khúc khi chưa có danh mục thật', async () => {
    mocks.fetchPurchasedItems.mockResolvedValue({ items: [], nextCursor: null });
    renderHome();
    expect(await screen.findByRole('button', { name: 'Cho mẹ & bé' })).toBeInTheDocument();
    expect(screen.queryByText(/Khám phá vườn/)).toBeNull();
    expect(screen.queryByRole('region', { name: 'Cho mẹ và bé' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Tìm sản phẩm' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Bạn đang tìm gì hôm nay?' })).toBeInTheDocument();
  });

  it('"Xem tất cả" dẫn tới Browse đúng bộ sắp xếp; "Dành cho bạn" không có nút này', async () => {
    mocks.fetchPurchasedItems.mockResolvedValue({ items: [], nextCursor: null });
    renderHome();
    const user = userEvent.setup();
    const best = await screen.findByRole('region', { name: 'Bán chạy' });
    await user.click(within(best).getByRole('button', { name: 'Xem tất cả Bán chạy' }));
    expect(mocks.navigate).toHaveBeenLastCalledWith('/browse?sort=best_seller');
    const newest = await screen.findByRole('region', { name: 'Mới về vườn' });
    await user.click(within(newest).getByRole('button', { name: 'Xem tất cả Mới về vườn' }));
    expect(mocks.navigate).toHaveBeenLastCalledWith('/browse?sort=newest');
    const featured = await screen.findByRole('region', { name: 'Tubu chọn cho bạn' });
    await user.click(within(featured).getByRole('button', { name: 'Xem tất cả Tubu chọn cho bạn' }));
    expect(mocks.navigate).toHaveBeenLastCalledWith('/browse');
    const forYou = await screen.findByRole('region', { name: 'Dành cho bạn' });
    expect(within(forYou).queryByRole('button', { name: /Xem tất cả/ })).toBeNull();
  });

  it('ô tìm là vỏ: chạm mở /browse?focus=search', async () => {
    mocks.fetchPurchasedItems.mockResolvedValue({ items: [], nextCursor: null });
    renderHome();
    await userEvent.setup().click(screen.getByRole('button', { name: 'Bạn đang tìm gì hôm nay?' }));
    expect(mocks.navigate).toHaveBeenCalledWith('/browse?focus=search');
  });

  it('khối lỗi ẩn lặng lẽ: không ErrorState, không tiêu đề trống, các khối còn lại vẫn hiện', async () => {
    mocks.fetchPurchasedItems.mockResolvedValue({ items: [], nextCursor: null });
    mocks.fetchProducts.mockImplementation(async (params: { sort?: string }) => {
      if (params.sort === 'best_seller') throw new Error('boom');
      return PAGE([card('f2', 'Chỉ nổi bật')]);
    });
    const { qc } = renderHome();
    await waitFor(() => expect(qc.getQueryState(['products', 'home-best-seller'])?.status).toBe('error'));
    await screen.findByRole('region', { name: 'Tubu chọn cho bạn' });
    expect(screen.queryByRole('region', { name: 'Bán chạy' })).toBeNull();
    expect(screen.queryByText('Thử lại')).toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('khung chờ mỗi khối có đúng 6 ô (bằng giới hạn thật) khi đang tải', async () => {
    mocks.fetchPurchasedItems.mockResolvedValue({ items: [], nextCursor: null });
    mocks.fetchProducts.mockReturnValue(new Promise(() => {}));
    renderHome();
    const best = await screen.findByRole('region', { name: 'Bán chạy' });
    expect(within(best).getAllByTestId('catalog-tile-skeleton')).toHaveLength(6);
  });

  it('khách chưa đăng nhập: không gọi for-you/notifications/purchased-items, không có "Dành cho bạn"', async () => {
    mocks.auth.status = 'guest';
    const { qc } = renderHome();
    await screen.findByRole('region', { name: 'Bán chạy' });
    await waitFor(() => expect(settled(qc, ['products', 'home-newest'])).toBe(true));
    expect(screen.queryByRole('region', { name: 'Dành cho bạn' })).toBeNull();
    expect(mocks.fetchForYou).not.toHaveBeenCalled();
    expect(mocks.getNotifications).not.toHaveBeenCalled();
    expect(mocks.fetchPurchasedItems).not.toHaveBeenCalled();
    expect(block('forYou')).toBeEmptyDOMElement();
  });

  it('chuông báo số tin chưa đọc (chỉ khi đã đăng nhập)', async () => {
    mocks.fetchPurchasedItems.mockResolvedValue({ items: [], nextCursor: null });
    mocks.getNotifications.mockResolvedValue([{ id: 'n1', status: 'UNREAD' }, { id: 'n2', status: 'READ' }, { id: 'n3', status: 'UNREAD' }]);
    renderHome();
    expect(await screen.findByLabelText(/2/, { selector: '[aria-label*="chưa đọc"]' })).toBeInTheDocument();
  });

  it('kéo để làm mới làm mới MỌI truy vấn của Trang chủ (không chỉ danh sách SP)', async () => {
    mocks.fetchPurchasedItems.mockResolvedValue({ items: [], nextCursor: null });
    const { qc } = renderHome();
    await screen.findByRole('region', { name: 'Bán chạy' });
    await screen.findByRole('region', { name: 'Dành cho bạn' });
    await waitFor(() => expect(mocks.getNotifications).toHaveBeenCalled());
    await waitFor(() => expect(mocks.fetchBrands).toHaveBeenCalled());
    const before = {
      brands: mocks.fetchBrands.mock.calls.length,
      products: mocks.fetchProducts.mock.calls.length,
      forYou: mocks.fetchForYou.mock.calls.length,
      purchased: mocks.fetchPurchasedItems.mock.calls.length,
      categories: mocks.fetchCategories.mock.calls.length,
      notifications: mocks.getNotifications.mock.calls.length,
    };
    expect(mocks.onRefresh).toBeDefined();
    await act(async () => {
      await mocks.onRefresh!();
    });
    expect(mocks.fetchProducts.mock.calls.length).toBe(before.products + 3);
    expect(mocks.fetchForYou.mock.calls.length).toBe(before.forYou + 1);
    expect(mocks.fetchPurchasedItems.mock.calls.length).toBe(before.purchased + 1);
    expect(mocks.fetchCategories.mock.calls.length).toBe(before.categories + 1);
    expect(mocks.getNotifications.mock.calls.length).toBe(before.notifications + 1);
    expect(mocks.fetchBrands.mock.calls.length).toBe(before.brands + 1);
    expect(qc.isFetching()).toBe(0);
  });

  describe('thứ tự khối không nhảy sau khung hình đầu (khách cũ mở lạnh)', () => {
    const RETURNING = [...homeBlockOrder('returning')];
    const NEW = [...homeBlockOrder('new')];
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
      expect(blockOrder()).toEqual(RETURNING); // khung hình đầu tiên
      seen.add(blockOrder().join('>'));
      await waitFor(() => expect(mocks.fetchPurchasedItems).toHaveBeenCalled());
      expect(settled(qc, ['purchased-items', 10])).toBe(false); // vẫn đang tải thật
      await screen.findByRole('region', { name: 'Bán chạy' });
      await act(async () => {
        d.resolve({ items: [{ variationId: 'v1' }], nextCursor: null });
      });
      await waitFor(() => expect(settled(qc, ['purchased-items', 10])).toBe(true));
      await screen.findByRole('region', { name: 'Dành cho bạn' });
      obs.disconnect();
      expect(blockOrder()).toEqual(RETURNING);
      expect([...seen]).toEqual([RETURNING.join('>')]); // chưa từng thấy thứ tự nào khác
    });

    it('(b) lần đầu (chưa nhớ gì): như trước — "new" khi đang tải, đổi sang "returning" khi có hàng, và nhớ lại', async () => {
      const d = deferred<{ items: object[]; nextCursor: null }>();
      mocks.fetchPurchasedItems.mockReturnValue(d.promise);
      renderHome();
      expect(blockOrder()).toEqual(NEW);
      await act(async () => {
        d.resolve({ items: [{ variationId: 'v1' }], nextCursor: null });
      });
      await waitFor(() => expect(blockOrder()).toEqual(RETURNING));
      expect(storedKind()).toEqual({ userId: 'u1', kind: 'returning' });
    });

    it('(c) loại đã nhớ cập nhật khi truy vấn xong: returning -> danh sách rỗng -> new (và ngược lại)', async () => {
      storeKind({ userId: 'u1', kind: 'returning' });
      mocks.fetchPurchasedItems.mockResolvedValue({ items: [], nextCursor: null });
      const { qc, unmount } = renderHome();
      await waitFor(() => expect(blockOrder()).toEqual(NEW));
      await waitFor(() => expect(storedKind()).toEqual({ userId: 'u1', kind: 'new' }));
      expect(settled(qc, ['purchased-items', 10])).toBe(true);
      unmount();
      mocks.fetchPurchasedItems.mockResolvedValue({ items: [{ variationId: 'v1' }], nextCursor: null });
      renderHome();
      await waitFor(() => expect(storedKind()).toEqual({ userId: 'u1', kind: 'returning' }));
    });

    it('(c2) API cũ lỗi (404): thứ tự "new", KHÔNG ghi đè loại đã nhớ', async () => {
      storeKind({ userId: 'u1', kind: 'returning' });
      mocks.fetchPurchasedItems.mockRejectedValue(new Error('404'));
      const { qc } = renderHome();
      await waitFor(() => expect(settled(qc, ['purchased-items', 10])).toBe(true));
      await waitFor(() => expect(blockOrder()).toEqual(NEW));
      expect(storedKind()).toEqual({ userId: 'u1', kind: 'returning' });
    });

    it.each([
      ['không phải JSON', 'không-phải-json'],
      ['kind lạ', JSON.stringify({ userId: 'u1', kind: 'vip' })],
      ['sai dạng', JSON.stringify(['returning'])],
      ['thiếu userId', JSON.stringify({ kind: 'returning' })],
    ])('(d) giá trị lưu hỏng/lạ (%s) bị bỏ qua: đang tải -> "new"', async (_name, raw) => {
      localStorage.setItem(HOME_KIND_KEY, raw);
      mocks.fetchPurchasedItems.mockReturnValue(new Promise(() => {}));
      renderHome();
      await waitFor(() => expect(mocks.fetchPurchasedItems).toHaveBeenCalled());
      expect(blockOrder()).toEqual(NEW);
    });

    it('(e) loại đã nhớ của TÀI KHOẢN KHÁC không được dùng', async () => {
      storeKind({ userId: 'someone-else', kind: 'returning' });
      mocks.fetchPurchasedItems.mockReturnValue(new Promise(() => {}));
      renderHome();
      await waitFor(() => expect(mocks.fetchPurchasedItems).toHaveBeenCalled());
      expect(blockOrder()).toEqual(NEW);
    });

    it('khách chưa đăng nhập: luôn "new", không đọc loại đã nhớ và không ghi gì', async () => {
      mocks.auth.status = 'guest';
      mocks.auth.user = null;
      storeKind({ userId: 'u1', kind: 'returning' });
      const before = localStorage.getItem(HOME_KIND_KEY);
      const { qc } = renderHome();
      expect(blockOrder()).toEqual(NEW);
      await screen.findByRole('region', { name: 'Bán chạy' });
      await waitFor(() => expect(settled(qc, ['products', 'home-newest'])).toBe(true));
      expect(blockOrder()).toEqual(NEW);
      expect(localStorage.getItem(HOME_KIND_KEY)).toBe(before);
    });
  });

  describe('"Tubu chọn cho bạn" giữ 6 ô ổn định khi dữ liệu về', () => {
    const many = (n: number) => Array.from({ length: n }, (_, i) => card(`p${i + 1}`, `SP ${i + 1}`));
    const productsFor = (p: { sort?: string }) => PAGE(p.sort === 'best_seller' ? [card('bs', 'Bán chạy nhất')] : many(12));

    it('đang chờ "Dành cho bạn": vẫn là khung chờ 6 ô, chưa hiện SP (tránh 6 -> 5 ô khi bỏ trùng)', async () => {
      mocks.fetchPurchasedItems.mockResolvedValue({ items: [], nextCursor: null });
      mocks.fetchForYou.mockReturnValue(new Promise(() => {}));
      mocks.fetchProducts.mockImplementation(async (p: { sort?: string }) => productsFor(p));
      const { qc } = renderHome();
      await waitFor(() => expect(settled(qc, ['products', 'home-featured'])).toBe(true));
      const featured = await screen.findByRole('region', { name: 'Tubu chọn cho bạn' });
      expect(within(featured).getAllByTestId('catalog-tile-skeleton')).toHaveLength(6);
      expect(within(featured).queryByText('SP 1')).toBeNull();
    });

    it('xin dư 12 SP rồi bỏ trùng, cắt về 6 SAU khi bỏ trùng → vẫn đủ 6 ô', async () => {
      mocks.fetchPurchasedItems.mockResolvedValue({ items: [], nextCursor: null });
      mocks.fetchForYou.mockResolvedValue([card('p1', 'SP 1'), card('p2', 'SP 2')]);
      mocks.fetchProducts.mockImplementation(async (p: { sort?: string }) => productsFor(p));
      renderHome();
      const featured = await screen.findByRole('region', { name: 'Tubu chọn cho bạn' });
      expect(await within(featured).findByText('SP 3')).toBeInTheDocument();
      expect(within(featured).queryAllByTestId('catalog-tile-skeleton')).toHaveLength(0);
      for (const n of [3, 4, 5, 6, 7, 8]) expect(within(featured).getByText(`SP ${n}`)).toBeInTheDocument();
      for (const n of [1, 2, 9]) expect(within(featured).queryByText(`SP ${n}`)).toBeNull();
      expect(mocks.fetchProducts).toHaveBeenCalledWith({ limit: 12 });
    });

    it('"Dành cho bạn" lỗi: không kẹt ở khung chờ, vẫn hiện 6 SP nổi bật', async () => {
      mocks.fetchPurchasedItems.mockResolvedValue({ items: [], nextCursor: null });
      mocks.fetchForYou.mockRejectedValue(new Error('boom'));
      mocks.fetchProducts.mockImplementation(async (p: { sort?: string }) => productsFor(p));
      renderHome();
      const featured = await screen.findByRole('region', { name: 'Tubu chọn cho bạn' });
      expect(await within(featured).findByText('SP 6')).toBeInTheDocument();
      expect(within(featured).queryByText('SP 7')).toBeNull();
    });
  });

  it('có tiêu đề h1 "Tubu Tree" làm điểm mốc của trang', async () => {
    mocks.fetchPurchasedItems.mockResolvedValue({ items: [], nextCursor: null });
    renderHome();
    expect(screen.getByRole('heading', { level: 1, name: 'Tubu Tree' })).toBeInTheDocument();
  });
});
