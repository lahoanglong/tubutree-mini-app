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
  getPublicConfig: vi.fn(),
  getNewCustomerOffer: vi.fn(),
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
  getPublicConfig: mocks.getPublicConfig,
}));
vi.mock('../services/account-api', () => ({ getNotifications: mocks.getNotifications, getNewCustomerOffer: mocks.getNewCustomerOffer }));
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

const PUBLIC_CONFIG = {
  freeshipThreshold: 350_000,
  subscribeDiscountPct: 0.17,
  affiliateWalletMultiplier: 1,
  affiliateMinWithdrawBank: 50_000,
  cashbackHoldDays: 30,
  loyalty: { vndPerPoint: 20_000, vndPerPointRedeem: 1_000 },
  homeNewCustomerLayout: false,
};

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
    mocks.getPublicConfig.mockResolvedValue(PUBLIC_CONFIG);
    mocks.getNewCustomerOffer.mockResolvedValue({ isNewCustomer: true, welcomeVoucher: null });
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

  it('C-084: một khối lỗi hiện thông báo + "Thử lại" ngay tại chỗ, khối khác vẫn hiện; thử lại chỉ tải lại khối đó', async () => {
    mocks.fetchPurchasedItems.mockResolvedValue({ items: [], nextCursor: null });
    let bestFails = true;
    mocks.fetchProducts.mockImplementation(async (params: { sort?: string }) => {
      if (params.sort === 'best_seller') {
        if (bestFails) throw new Error('boom');
        return PAGE([card('bs', 'Bán chạy nhất')]);
      }
      return PAGE([card('f2', 'Chỉ nổi bật')]);
    });
    const { qc } = renderHome();
    await waitFor(() => expect(qc.getQueryState(['products', 'home-best-seller'])?.status).toBe('error'));
    const featured = await screen.findByRole('region', { name: 'Tubu chọn cho bạn' });
    expect(await within(featured).findByText('Chỉ nổi bật')).toBeInTheDocument();
    const best = screen.getByRole('region', { name: 'Bán chạy' });
    expect(within(best).getByText('Có chút trục trặc, thử lại nhé')).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: /^Thử lại/ })).toHaveLength(1);

    const callsBefore = mocks.fetchProducts.mock.calls.length;
    bestFails = false;
    await userEvent.setup().click(within(best).getByRole('button', { name: 'Thử lại Bán chạy' }));
    expect(await within(screen.getByRole('region', { name: 'Bán chạy' })).findByText('Bán chạy nhất')).toBeInTheDocument();
    expect(mocks.fetchProducts.mock.calls.length).toBe(callsBefore + 1);
    expect(screen.queryByRole('button', { name: /^Thử lại/ })).toBeNull();
  });

  it('D7-7: API sập hẳn (cả 3 lưới SP lỗi) → MỘT dải lỗi cấp trang + một nút "Thử lại", không còn thẻ lỗi từng khối; thử lại xong thì dải biến mất', async () => {
    mocks.fetchPurchasedItems.mockRejectedValue(new Error('boom'));
    mocks.fetchForYou.mockRejectedValue(new Error('boom'));
    let down = true;
    mocks.fetchProducts.mockImplementation(async (params: { sort?: string }) => {
      if (down) throw new Error('boom');
      return params.sort === 'best_seller' ? PAGE([card('bs', 'Bán chạy nhất')]) : PAGE([card('f2', 'Chỉ nổi bật')]);
    });
    const { qc } = renderHome();
    await waitFor(() => {
      for (const key of [['products', 'home-best-seller'], ['products', 'home-featured'], ['products', 'home-newest']]) {
        expect(qc.getQueryState(key)?.status).toBe('error');
      }
    });
    const strip = await screen.findByTestId('home-page-error');
    expect(within(strip).getByText('Chưa tải được Trang chủ')).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: /Thử lại/ })).toHaveLength(1);
    expect(screen.queryAllByTestId('home-block-error')).toHaveLength(0);
    expect(screen.queryByRole('region', { name: 'Bán chạy' })).toBeNull();
    // Dải nằm ngay dưới ô tìm, không ở cuối trang.
    expect(blockOrder().slice(0, 2)).toEqual(['search', 'pageError']);

    down = false;
    await userEvent.setup().click(within(strip).getByRole('button', { name: 'Thử lại' }));
    expect(await screen.findByText('Bán chạy nhất')).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByTestId('home-page-error')).toBeNull());
  });

  it('D7-7: chỉ MỘT phần lỗi (còn khối khác tải được) → vẫn là thẻ lỗi từng khối, không có dải lỗi cấp trang', async () => {
    mocks.fetchPurchasedItems.mockResolvedValue({ items: [], nextCursor: null });
    mocks.fetchProducts.mockImplementation(async (params: { sort?: string }) => {
      if (params.sort === 'best_seller') throw new Error('boom');
      return PAGE([card('f2', 'Chỉ nổi bật')]);
    });
    renderHome();
    await screen.findByRole('button', { name: 'Thử lại Bán chạy' });
    expect(screen.queryByTestId('home-page-error')).toBeNull();
  });

  it('C-084: "Tubu chọn cho bạn" lỗi → khối lỗi, "Thử lại" gọi lại đúng danh sách nổi bật', async () => {
    mocks.fetchPurchasedItems.mockResolvedValue({ items: [], nextCursor: null });
    let featuredFails = true;
    mocks.fetchProducts.mockImplementation(async (params: { sort?: string; limit?: number }) => {
      if (params.sort === 'best_seller') return PAGE([card('bs', 'Bán chạy nhất')]);
      if (params.limit === 12 && featuredFails) throw new Error('boom');
      return PAGE([card('f2', 'Chỉ nổi bật')]);
    });
    renderHome();
    const retry = await screen.findByRole('button', { name: 'Thử lại Tubu chọn cho bạn' });
    featuredFails = false;
    await userEvent.setup().click(retry);
    expect(await within(screen.getByRole('region', { name: 'Tubu chọn cho bạn' })).findByText('Chỉ nổi bật')).toBeInTheDocument();
  });

  it('C-084: "Dành cho bạn" lỗi → khối lỗi có "Thử lại"', async () => {
    mocks.fetchPurchasedItems.mockResolvedValue({ items: [], nextCursor: null });
    mocks.fetchForYou.mockRejectedValueOnce(new Error('boom')).mockResolvedValue([card('f1', 'Trùng gợi ý')]);
    renderHome();
    await userEvent.setup().click(await screen.findByRole('button', { name: 'Thử lại Dành cho bạn' }));
    expect(await within(screen.getByRole('region', { name: 'Dành cho bạn' })).findByText('Trùng gợi ý')).toBeInTheDocument();
  });

  it('C-084: kệ "Mua lại" lỗi (không phải 404) → khối lỗi + "Thử lại"; 404 của API cũ vẫn ẩn lặng lẽ', async () => {
    mocks.fetchPurchasedItems.mockRejectedValueOnce(new Error('boom')).mockResolvedValue({ items: [], nextCursor: null });
    const { qc, unmount } = renderHome();
    await waitFor(() => expect(qc.getQueryState(['purchased-items', 10])?.status).toBe('error'));
    const rail = await screen.findByRole('region', { name: 'Mua lại' });
    expect(rail.closest('[data-home-block]')).toHaveAttribute('data-home-block', 'purchased');
    await userEvent.setup().click(within(rail).getByRole('button', { name: 'Thử lại Mua lại' }));
    await waitFor(() => expect(qc.getQueryState(['purchased-items', 10])?.status).toBe('success'));
    expect(screen.queryByRole('button', { name: 'Thử lại Mua lại' })).toBeNull();
    unmount();

    const notFound = Object.assign(new Error('404'), { isHttpError: true, response: { status: 404, data: {} } });
    mocks.fetchPurchasedItems.mockReset().mockRejectedValue(notFound);
    const second = renderHome();
    await waitFor(() => expect(second.qc.getQueryState(['purchased-items', 10])?.status).toBe('error'));
    expect(screen.queryByRole('button', { name: 'Thử lại Mua lại' })).toBeNull();
  });

  describe('tải lại nền khi đang lỗi (React Query v5 đưa query lỗi về pending): khối không chớp khung chờ', () => {
    const deferred = () => {
      let resolve: (v: unknown) => void = () => {};
      const promise = new Promise((r) => { resolve = r; });
      return { promise, resolve };
    };

    it('"Bán chạy" đang lỗi rồi tải lại: giữ khối lỗi (nút báo đang tải), KHÔNG đổi sang khung chờ; xong mới hiện SP', async () => {
      mocks.fetchPurchasedItems.mockResolvedValue({ items: [], nextCursor: null });
      const second = deferred();
      let call = 0;
      mocks.fetchProducts.mockImplementation(async (params: { sort?: string }) => {
        if (params.sort !== 'best_seller') return PAGE([card('f2', 'Chỉ nổi bật')]);
        call += 1;
        if (call === 1) throw new Error('boom');
        await second.promise;
        return PAGE([card('bs', 'Bán chạy nhất')]);
      });
      const { qc } = renderHome();
      await waitFor(() => expect(qc.getQueryState(['products', 'home-best-seller'])?.status).toBe('error'));
      await screen.findByRole('button', { name: 'Thử lại Bán chạy' });

      let refetching: Promise<unknown> = Promise.resolve();
      act(() => {
        refetching = qc.refetchQueries({ queryKey: ['products', 'home-best-seller'] });
      });
      await waitFor(() => expect(call).toBe(2));
      const best = screen.getByRole('region', { name: 'Bán chạy' });
      expect(within(best).queryByTestId('catalog-grid-skeleton')).toBeNull();
      expect(within(best).getByText('Có chút trục trặc, thử lại nhé')).toBeInTheDocument();
      expect(within(best).getByRole('button', { name: 'Thử lại Bán chạy' })).toHaveAttribute('aria-busy', 'true');

      await act(async () => {
        second.resolve(null);
        await refetching;
      });
      await waitFor(() => expect(within(screen.getByRole('region', { name: 'Bán chạy' })).getByText('Bán chạy nhất')).toBeInTheDocument());
    });

    it('"Dành cho bạn" thử lại sau lỗi: "Tubu chọn cho bạn" đang hiện SP không bị đẩy về khung chờ', async () => {
      mocks.fetchPurchasedItems.mockResolvedValue({ items: [], nextCursor: null });
      const second = deferred();
      mocks.fetchForYou.mockRejectedValueOnce(new Error('boom')).mockImplementationOnce(async () => {
        await second.promise;
        return [card('f1', 'Trùng gợi ý')];
      });
      const { qc } = renderHome();
      await waitFor(() => expect(qc.getQueryState(['for-you'])?.status).toBe('error'));
      const featured = await screen.findByRole('region', { name: 'Tubu chọn cho bạn' });
      expect(await within(featured).findByText('Chỉ nổi bật')).toBeInTheDocument();

      let refetching: Promise<unknown> = Promise.resolve();
      act(() => {
        refetching = qc.refetchQueries({ queryKey: ['for-you'] });
      });
      await waitFor(() => expect(mocks.fetchForYou).toHaveBeenCalledTimes(2));
      const during = screen.getByRole('region', { name: 'Tubu chọn cho bạn' });
      expect(within(during).queryByTestId('catalog-grid-skeleton')).toBeNull();
      expect(within(during).getByText('Chỉ nổi bật')).toBeInTheDocument();
      expect(within(screen.getByRole('region', { name: 'Dành cho bạn' })).getByRole('button', { name: 'Thử lại Dành cho bạn' })).toHaveAttribute('aria-busy', 'true');

      await act(async () => {
        second.resolve(null);
        await refetching;
      });
      await waitFor(() => expect(within(screen.getByRole('region', { name: 'Dành cho bạn' })).getByText('Trùng gợi ý')).toBeInTheDocument());
    });

    it('kệ "Mua lại" đang lỗi rồi tải lại: khối lỗi ở lại (nút báo đang tải), không nhường chỗ cho kệ/khung chờ', async () => {
      const second = deferred();
      mocks.fetchPurchasedItems.mockRejectedValueOnce(new Error('boom')).mockImplementationOnce(async () => {
        await second.promise;
        return { items: [], nextCursor: null };
      });
      const { qc } = renderHome();
      await waitFor(() => expect(qc.getQueryState(['purchased-items', 10])?.status).toBe('error'));
      await screen.findByRole('button', { name: 'Thử lại Mua lại' });

      let refetching: Promise<unknown> = Promise.resolve();
      act(() => {
        refetching = qc.refetchQueries({ queryKey: ['purchased-items', 10] });
      });
      await waitFor(() => expect(mocks.fetchPurchasedItems).toHaveBeenCalledTimes(2));
      expect(screen.getByRole('button', { name: 'Thử lại Mua lại' })).toHaveAttribute('aria-busy', 'true');

      await act(async () => {
        second.resolve(null);
        await refetching;
      });
      await waitFor(() => expect(screen.queryByRole('button', { name: 'Thử lại Mua lại' })).toBeNull());
    });
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
    expect(await screen.findByLabelText(/2/, { selector: 'span[aria-label*="chưa đọc"]' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Thông báo, 2 chưa đọc' })).toBeInTheDocument();
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

  // D2-07b + D7 việc 1: khối "Quà khách mới" và cờ bố cục home.new_customer_layout (mặc định bật ở API).
  describe('khối "Quà khách mới" và cờ home.new_customer_layout', () => {
    it('cờ tắt (mặc định): giữ thứ tự cũ của khách mới, khối Quà khách mới đứng ngay sau Danh mục', async () => {
      mocks.fetchPurchasedItems.mockResolvedValue({ items: [], nextCursor: null });
      renderHome();
      expect(await screen.findByRole('region', { name: 'Quà khách mới' })).toBeInTheDocument();
      expect(blockOrder()).toEqual([...homeBlockOrder('new', false)]);
      expect(blockOrder().slice(0, 7)).toEqual(['search', 'purchased', 'orderStrip', 'flash', 'bestSellers', 'categories', 'welcome']);
      expect(block('welcome')).toContainElement(screen.getByRole('region', { name: 'Quà khách mới' }));
    });

    it('cờ bật: sau khi cấu hình về, Quà khách mới rồi Danh mục lên trước giờ vàng', async () => {
      mocks.getPublicConfig.mockResolvedValue({ ...PUBLIC_CONFIG, homeNewCustomerLayout: true });
      mocks.fetchPurchasedItems.mockResolvedValue({ items: [], nextCursor: null });
      renderHome();
      await waitFor(() => expect(blockOrder()).toEqual([...homeBlockOrder('new', true)]));
      expect(blockOrder().slice(0, 6)).toEqual(['search', 'purchased', 'orderStrip', 'welcome', 'categories', 'flash']);
      expect(await screen.findByRole('region', { name: 'Quà khách mới' })).toBeInTheDocument();
    });

    it('cấu hình công khai chưa về hoặc lỗi → bố cục cũ (không đổi thứ tự khi chưa chắc)', async () => {
      mocks.getPublicConfig.mockRejectedValue(new Error('boom'));
      mocks.fetchPurchasedItems.mockResolvedValue({ items: [], nextCursor: null });
      renderHome();
      await screen.findByRole('region', { name: 'Bán chạy' });
      expect(blockOrder()).toEqual([...homeBlockOrder('new', false)]);
    });

    it('khách cũ: bố cục khách cũ kể cả khi cờ bật, và không có khối Quà khách mới', async () => {
      mocks.getPublicConfig.mockResolvedValue({ ...PUBLIC_CONFIG, homeNewCustomerLayout: true });
      mocks.fetchPurchasedItems.mockResolvedValue({ items: [{ variationId: 'v1' }], nextCursor: null });
      renderHome();
      await waitFor(() => expect(blockOrder()).toEqual([...homeBlockOrder('returning')]));
      await screen.findByRole('region', { name: 'Dành cho bạn' });
      expect(screen.queryByRole('region', { name: 'Quà khách mới' })).toBeNull();
    });

    it('khách cũ đã được nhớ từ lần trước: ngay từ khung hình đầu không mount khối, không gọi API ưu đãi khách mới', async () => {
      localStorage.setItem(HOME_KIND_KEY, JSON.stringify({ userId: 'u1', kind: 'returning' }));
      mocks.fetchPurchasedItems.mockResolvedValue({ items: [{ variationId: 'v1' }], nextCursor: null });
      renderHome();
      await screen.findByRole('region', { name: 'Dành cho bạn' });
      expect(mocks.getNewCustomerOffer).not.toHaveBeenCalled();
    });

    it('khách mới nhưng đã có đơn chờ giao (API: không còn là khách mới) → không hiện khối', async () => {
      mocks.getNewCustomerOffer.mockResolvedValue({ isNewCustomer: false, welcomeVoucher: null });
      mocks.fetchPurchasedItems.mockResolvedValue({ items: [], nextCursor: null });
      renderHome();
      await screen.findByRole('region', { name: 'Bán chạy' });
      await waitFor(() => expect(mocks.getNewCustomerOffer).toHaveBeenCalled());
      expect(screen.queryByRole('region', { name: 'Quà khách mới' })).toBeNull();
    });
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

describe('HomePage: dải "Mua trong Mini App tích nhiều hơn" không đổi bố cục khối', () => {
  const loyalty = (claim: boolean) => ({ vndPerPoint: 50, vndPerPointRedeem: 1_000, earnPct: 2, marketplaceEarnPct: 1, marketplaceClaimEnabled: claim });
  const setup = (opts: { claim: boolean; layout: boolean }) => {
    vi.clearAllMocks();
    localStorage.clear();
    mocks.auth.status = 'authenticated';
    mocks.auth.user = { id: 'u1' };
    mocks.fetchProducts.mockResolvedValue(PAGE([card('f1', 'Sản phẩm')]));
    mocks.fetchForYou.mockResolvedValue([]);
    mocks.fetchBrands.mockResolvedValue([]);
    mocks.fetchCategories.mockResolvedValue([]);
    mocks.getNotifications.mockResolvedValue([]);
    mocks.getNewCustomerOffer.mockResolvedValue({ isNewCustomer: true, welcomeVoucher: null });
    mocks.getPublicConfig.mockResolvedValue({ ...PUBLIC_CONFIG, loyalty: loyalty(opts.claim), homeNewCustomerLayout: opts.layout });
  };

  it.each([
    { claim: true, layout: false },
    { claim: true, layout: true },
    { claim: false, layout: false },
    { claim: false, layout: true },
  ])('khách mới (claim=$claim, layout=$layout): thứ tự khối giữ nguyên, dải nằm trong khối Quà khách mới, không trong dải đơn', async (opts) => {
    setup(opts);
    mocks.fetchPurchasedItems.mockResolvedValue({ items: [], nextCursor: null });
    const { qc } = renderHome();
    await waitFor(() => expect(settled(qc, ['purchased-items', 10])).toBe(true));
    await screen.findByRole('region', { name: 'Bán chạy' });
    await waitFor(() => expect(blockOrder()).toEqual([...homeBlockOrder('new', opts.layout)]));
    await waitFor(() => expect(block('welcome').querySelector('[data-testid="points-boost"]') !== null).toBe(opts.claim));
    expect(block('orderStrip').querySelector('[data-testid="points-boost"]')).toBeNull();
    if (opts.layout) expect(blockOrder().slice(0, 4)).toEqual(['search', 'purchased', 'orderStrip', 'welcome']);
    if (opts.claim) expect(block('welcome')).toHaveTextContent('tích gấp đôi');
  });

  it.each([true, false])('khách cũ (claim=%s): thứ tự khối giữ nguyên; dải nằm ngay sau dải đơn, khối welcome không có', async (claim) => {
    setup({ claim, layout: true });
    mocks.fetchPurchasedItems.mockResolvedValue({ items: [{ variationId: 'v1' }], nextCursor: null });
    renderHome();
    await waitFor(() => expect(blockOrder()).toEqual([...homeBlockOrder('returning', true)]));
    await waitFor(() => expect(within(block('orderStrip')).queryByTestId('points-boost') !== null).toBe(true));
    expect(block('orderStrip')).toHaveTextContent(claim ? 'tích gấp đôi' : 'Tích 2% tiền hàng thành Điểm Xanh khi mua trong Mini App');
    expect(document.querySelector('[data-home-block="welcome"]')).toBeNull();
  });
});

