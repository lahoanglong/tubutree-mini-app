import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes, useLocation, useNavigate as useRouterNavigate, useNavigationType } from 'react-router-dom';
import type { ReactNode } from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const mocks = vi.hoisted(() => ({
  navigate: vi.fn(), fetchCatalog: vi.fn(), fetchBrands: vi.fn(), fetchCategories: vi.fn(), suggestProducts: vi.fn(),
  trackFilterApplied: vi.fn(), trackSearchPerformed: vi.fn(), trackSearchResultClicked: vi.fn(),
}));
vi.mock('zmp-ui', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  Page: ({ children }: { children: ReactNode }) => <div className="zaui-page">{children}</div>,
  useNavigate: () => mocks.navigate,
}));
vi.mock('../services/shop-api', () => ({
  fetchCatalog: mocks.fetchCatalog, fetchBrands: mocks.fetchBrands, fetchCategories: mocks.fetchCategories,
  suggestProducts: mocks.suggestProducts, fetchActiveFlashSales: vi.fn().mockResolvedValue([]), getCart: vi.fn(),
}));
vi.mock('../services/discovery-events', () => ({
  trackFilterApplied: mocks.trackFilterApplied, trackSearchPerformed: mocks.trackSearchPerformed, trackSearchResultClicked: mocks.trackSearchResultClicked,
}));
vi.mock('../store/auth', () => ({ useAuthStore: (sel: (s: { status: string }) => unknown) => sel({ status: 'idle' }) }));
vi.mock('../components/wishlist-heart', () => ({ WishlistHeart: () => null }));
vi.mock('../components/pull-to-refresh', () => ({ PullToRefresh: () => null }));
vi.mock('../utils/haptic', () => ({ haptic: vi.fn() }));

import { SUGGEST_DEBOUNCE_MS } from '../hooks/use-suggest';
import { SCROLL_KEY_PREFIX } from '../hooks/use-scroll-restoration';
import { CATEGORY_COUNT_KEY } from '../hooks/use-categories';
import { recordRecentlyViewed } from '../utils/recently-viewed';
import { forgetTrackedSearch } from '../utils/search-tracking';
import BrowsePage from './browse';

const FUTURE = { v7_startTransition: true, v7_relativeSplatPath: true } as const;
const card = (id: string, name: string) => ({ id, slug: id, brand: 'Tubu', name, thumbnail: null, basePrice: 100000, salePrice: null, isFeatured: false, inStock: true });
const pageOf = (data: ReturnType<typeof card>[], filtersIgnored = false) => ({ data, meta: { page: 1, limit: 30, total: data.length }, filtersIgnored });

function Probe() {
  const loc = useLocation();
  const navType = useNavigationType();
  return (
    <>
      <div data-testid="loc">{loc.pathname + loc.search}</div>
      <div data-testid="nav-type">{navType}</div>
    </>
  );
}
function renderAt(url: string) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[url]} future={FUTURE}>
        <BrowsePage />
        <Probe />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}
/** Browse + một trang "sản phẩm" giả lập; nút điều khiển lịch sử như người dùng (đi PDP, Back, mở lại bằng PUSH). */
function NavControls() {
  const go = useRouterNavigate();
  return (
    <>
      <button type="button" onClick={() => go('/product/x')}>to-pdp</button>
      <button type="button" onClick={() => go(-1)}>history-back</button>
      <button type="button" onClick={() => go('/browse?q=nuoc')}>push-search</button>
    </>
  );
}
function renderWithPdp(url: string) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[url]} future={FUTURE}>
        <Routes>
          <Route path="/browse" element={<BrowsePage />} />
          <Route path="/product/:slug" element={<div data-testid="pdp" />} />
        </Routes>
        <NavControls />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}
const loc = () => screen.getByTestId('loc').textContent;
const navType = () => screen.getByTestId('nav-type').textContent;
const catalogCalls = () => mocks.fetchCatalog.mock.calls.map(([q]) => q as Record<string, unknown>);
/** Danh sách đã vẽ xong: số kết quả hiện ra (khung chờ đã biến mất) và lưới SP có mặt. */
const listPainted = async () => {
  await screen.findByText('2 sản phẩm');
  await screen.findByTestId('catalog-grid');
};
const wait = (ms: number) => act(() => new Promise<void>((r) => setTimeout(r, ms)));

describe('BrowsePage (DS v2, spec 5b.2)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    forgetTrackedSearch();
    localStorage.clear();
    sessionStorage.clear();
    mocks.fetchCatalog.mockResolvedValue(pageOf([card('p1', 'Nước rửa chén'), card('p2', 'Xà phòng')]));
    mocks.fetchBrands.mockResolvedValue([{ brand: 'Tubu', count: 2 }]);
    mocks.fetchCategories.mockResolvedValue([]);
    mocks.suggestProducts.mockResolvedValue([]);
  });

  it('gốc: Danh mục (4 phân khúc khi chưa có danh mục thật), sắp xếp, số kết quả, lưới SP; không còn "Xu hướng"', async () => {
    renderAt('/browse');
    expect(await screen.findByRole('button', { name: 'Cho mẹ & bé' })).toBeInTheDocument();
    expect(screen.getByRole('group', { name: 'Sắp xếp' })).toBeInTheDocument();
    expect(await screen.findByText('2 sản phẩm')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Nước rửa chén' })).toBeInTheDocument();
    expect(screen.queryByText('Xu hướng')).toBeNull();
    expect(catalogCalls()[0]).toMatchObject({ page: 1, limit: 30, q: undefined });
  });

  it('header có nút giỏ khi không gõ (CartButton), và không có nút "Hủy"', async () => {
    renderAt('/browse');
    await listPainted();
    expect(screen.getByRole('button', { name: 'Giỏ hàng' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Hủy' })).toBeNull();
  });

  it('?focus=search: ô tìm được focus, bỏ focus khỏi URL, hiện gợi ý thay nội dung + nút "Hủy" (giỏ nhường chỗ)', async () => {
    localStorage.setItem('tubu_recent_searches', JSON.stringify(['nước rửa']));
    renderAt('/browse?focus=search');
    const input = screen.getByRole('searchbox', { name: 'Tìm sản phẩm' });
    await waitFor(() => expect(document.activeElement).toBe(input));
    await waitFor(() => expect(loc()).toBe('/browse'));
    expect(screen.getByRole('region', { name: 'Gợi ý tìm kiếm' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Hủy' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Giỏ hàng' })).toBeNull();
    expect(screen.queryByRole('group', { name: 'Sắp xếp' })).toBeNull();
  });

  it('gõ chỉ gợi ý (không tải kết quả); Enter mới ghi q vào URL, lưu từ khoá gần đây, bắn search_performed', async () => {
    renderAt('/browse');
    const input = screen.getByRole('searchbox');
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: 'nuoc rua' } });
    await waitFor(() => expect(mocks.suggestProducts).toHaveBeenCalledWith('nuoc rua'));
    expect(catalogCalls().some((q) => q.q === 'nuoc rua')).toBe(false);
    fireEvent.submit(screen.getByRole('search'));
    await waitFor(() => expect(loc()).toBe('/browse?q=nuoc+rua'));
    await waitFor(() => expect(catalogCalls().some((q) => q.q === 'nuoc rua' && q.limit === 30)).toBe(true));
    await waitFor(() => expect(mocks.trackSearchPerformed).toHaveBeenCalledWith({ q: 'nuoc rua', resultsCount: 2 }));
    expect(JSON.parse(localStorage.getItem('tubu_recent_searches')!)).toEqual(['nuoc rua']);
    // Gửi xong thì ô tìm rời chế độ gõ: nút giỏ quay lại, gợi ý biến mất.
    expect(await screen.findByRole('button', { name: 'Giỏ hàng' })).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'Gợi ý tìm kiếm' })).toBeNull();
  });

  it('vào thẳng /browse?q=… KHÔNG bắn request gợi ý; chỉ khi chạm vào ô mới bắn (đối chứng)', async () => {
    renderAt('/browse?q=nuoc');
    await listPainted();
    await wait(SUGGEST_DEBOUNCE_MS + 150);
    expect(mocks.suggestProducts).not.toHaveBeenCalled();
    fireEvent.focus(screen.getByRole('searchbox'));
    await waitFor(() => expect(mocks.suggestProducts).toHaveBeenCalledWith('nuoc'));
  });

  it('chọn một sản phẩm gợi ý → search_result_clicked (source suggest) + mở PDP với listSource search_suggest', async () => {
    mocks.suggestProducts.mockResolvedValue([{ id: 'p9', slug: 'p9', name: 'Nước rửa tay', brand: 'Tubu', thumbnail: null, basePrice: 50000, salePrice: null }]);
    renderAt('/browse');
    const input = screen.getByRole('searchbox');
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: 'rua tay' } });
    fireEvent.click(await screen.findByRole('button', { name: /Nước rửa tay/ }));
    expect(mocks.trackSearchResultClicked).toHaveBeenCalledWith({ q: 'rua tay', position: 1, source: 'suggest', slug: 'p9' });
    expect(mocks.navigate).toHaveBeenCalledWith('/product/p9', { state: { listSource: 'search_suggest' } });
  });

  it('"Hủy" thoát chế độ gõ, trả ô tìm về q của URL và hiện lại nội dung', async () => {
    renderAt('/browse?q=nuoc');
    await listPainted();
    const input = screen.getByRole('searchbox');
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: 'dang go do' } });
    expect(screen.queryByRole('group', { name: 'Sắp xếp' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Hủy' }));
    expect(screen.getByRole('searchbox')).toHaveValue('nuoc');
    expect(await screen.findByRole('group', { name: 'Sắp xếp' })).toBeInTheDocument();
    expect(loc()).toBe('/browse?q=nuoc');
  });

  it('nút xoá ô tìm: bỏ q khỏi URL và trả focus về ô để bàn phím không đóng', async () => {
    renderAt('/browse?q=nuoc');
    await listPainted();
    fireEvent.click(screen.getByRole('button', { name: 'Xoá từ khoá' }));
    await waitFor(() => expect(loc()).toBe('/browse'));
    expect(screen.getByRole('searchbox')).toHaveValue('');
    expect(document.activeElement).toBe(screen.getByRole('searchbox'));
  });

  it('chip "Bán chạy" → URL sort=best_seller (replace) → tải lại với sort', async () => {
    renderAt('/browse');
    fireEvent.click(await screen.findByRole('button', { name: 'Bán chạy' }));
    await waitFor(() => expect(loc()).toBe('/browse?sort=best_seller'));
    await waitFor(() => expect(catalogCalls().some((q) => q.sort === 'best_seller')).toBe(true));
  });

  it('áp dụng bộ lọc → URL đủ tham số + filter_applied cho từng loại đổi', async () => {
    renderAt('/browse');
    fireEvent.click(await screen.findByRole('button', { name: 'Bộ lọc' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Chỉ hiện còn hàng' }));
    fireEvent.click(screen.getByRole('button', { name: 'Từ 4★ trở lên' }));
    fireEvent.click(await screen.findByRole('button', { name: /^Xem 2 sản phẩm$/ }, { timeout: 2000 }));
    await waitFor(() => expect(loc()).toBe('/browse?inStock=1&rating=4'));
    expect(mocks.trackFilterApplied.mock.calls.map(([t]) => t)).toEqual(['in_stock', 'rating']);
    expect(await screen.findByRole('button', { name: 'Bỏ lọc Còn hàng' })).toBeInTheDocument();
  });

  it('link cũ ?brand=Tubu → chip gỡ được; gỡ → URL sạch', async () => {
    renderAt('/browse?brand=Tubu');
    fireEvent.click(await screen.findByRole('button', { name: 'Bỏ lọc Tubu' }));
    await waitFor(() => expect(loc()).toBe('/browse'));
  });

  it('link từ Trang chủ ?segment=eco → lọc theo phân khúc, chip tên phân khúc, bỏ khỏi lưới Danh mục gốc', async () => {
    renderAt('/browse?segment=eco');
    expect(await screen.findByRole('button', { name: 'Bỏ lọc Sống xanh' })).toBeInTheDocument();
    await waitFor(() => expect(catalogCalls().some((q) => q.segment === 'eco')).toBe(true));
    expect(screen.queryByRole('button', { name: 'Cho mẹ & bé' })).toBeNull(); // không còn ở trạng thái gốc → không có lưới Danh mục
  });

  it('chạm một ô Danh mục → URL ?segment=… (replace), bỏ q', async () => {
    renderAt('/browse');
    fireEvent.click(await screen.findByRole('button', { name: 'Cho mẹ & bé' }));
    await waitFor(() => expect(loc()).toBe('/browse?segment=mom_baby'));
    await waitFor(() => expect(catalogCalls().some((q) => q.segment === 'mom_baby')).toBe(true));
  });

  it('chạm kết quả khi đang tìm → search_result_clicked { q, position (1-based), source, slug }', async () => {
    renderAt('/browse?q=nuoc');
    fireEvent.click(await screen.findByRole('button', { name: 'Xà phòng' }));
    expect(mocks.trackSearchResultClicked).toHaveBeenCalledWith({ q: 'nuoc', position: 2, source: 'results', slug: 'p2' });
    expect(mocks.navigate).toHaveBeenCalledWith('/product/p2', { state: { listSource: 'search' } });
  });

  it('chạm SP khi chỉ duyệt (không q) → KHÔNG bắn search_result_clicked, listSource=browse', async () => {
    renderAt('/browse');
    fireEvent.click(await screen.findByRole('button', { name: 'Xà phòng' }));
    expect(mocks.navigate).toHaveBeenCalledWith('/product/p2', { state: { listSource: 'browse' } });
    expect(mocks.trackSearchResultClicked).not.toHaveBeenCalled();
  });

  it('API cũ bỏ qua bộ lọc → câu báo nhẹ, vẫn có kết quả', async () => {
    mocks.fetchCatalog.mockResolvedValue(pageOf([card('p1', 'Nước rửa chén')], true));
    renderAt('/browse?inStock=1');
    expect(await screen.findByText(/Bộ lọc nâng cao chưa dùng được/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Nước rửa chén' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Thử lại' })).toBeNull();
  });

  it('không có kết quả → EmptyState + "Xoá tìm kiếm & bộ lọc" (giữ sort)', async () => {
    mocks.fetchCatalog.mockResolvedValue(pageOf([]));
    renderAt('/browse?q=zzz&inStock=1&sort=newest');
    expect(await screen.findByText('Không tìm thấy "zzz"')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Xoá tìm kiếm & bộ lọc' }));
    await waitFor(() => expect(loc()).toBe('/browse?sort=newest'));
  });

  it('lỗi tải → ErrorState "Thử lại" gọi lại', async () => {
    mocks.fetchCatalog.mockRejectedValueOnce(new Error('network'));
    renderAt('/browse');
    fireEvent.click(await screen.findByRole('button', { name: 'Thử lại' }));
    await waitFor(() => expect(mocks.fetchCatalog.mock.calls.length).toBeGreaterThanOrEqual(2));
    expect(await screen.findByRole('button', { name: 'Xà phòng' })).toBeInTheDocument();
  });

  describe('"Đã xem gần đây"', () => {
    beforeEach(() => {
      recordRecentlyViewed({ slug: 'old-1', name: 'Sản phẩm xem trước', thumbnail: null, price: 45000 }, 1);
    });

    it('trang gốc: hiện dải, và ẩn khi đang tìm có kết quả', async () => {
      renderAt('/browse');
      await listPainted();
      expect(screen.getByRole('region', { name: 'Đã xem gần đây' })).toBeInTheDocument();
    });

    it('đang tìm có kết quả → dải không hiện (chỉ gốc và trạng thái không có kết quả)', async () => {
      renderAt('/browse?q=nuoc');
      await listPainted();
      expect(screen.queryByRole('region', { name: 'Đã xem gần đây' })).toBeNull();
    });

    it('tìm không ra kết quả → dải vẫn hiện để khách có đường đi tiếp', async () => {
      mocks.fetchCatalog.mockResolvedValue(pageOf([]));
      renderAt('/browse?q=zzz');
      expect(await screen.findByText('Không tìm thấy "zzz"')).toBeInTheDocument();
      expect(screen.getByRole('region', { name: 'Đã xem gần đây' })).toBeInTheDocument();
    });
  });

  describe('"Xem thêm" (phân trang)', () => {
    it('tải trang 2, nối vào lưới, và KHÔNG bắn lại search_performed cho cùng một lượt tìm', async () => {
      mocks.fetchCatalog.mockImplementation(async (q: { page: number }) =>
        q.page === 1
          ? { data: [card('p1', 'Nước rửa chén'), card('p2', 'Xà phòng')], meta: { page: 1, limit: 30, total: 31 } }
          : { data: [card('p3', 'Bột giặt')], meta: { page: 2, limit: 30, total: 31 } },
      );
      renderAt('/browse?q=nuoc');
      fireEvent.click(await screen.findByRole('button', { name: 'Xem thêm' }));
      expect(await screen.findByRole('button', { name: 'Bột giặt' })).toBeInTheDocument();
      expect(catalogCalls().map((q) => q.page)).toEqual([1, 2]);
      expect(screen.queryByRole('button', { name: 'Xem thêm' })).toBeNull(); // 3/31 đã tải hết trang cuối
      await waitFor(() => expect(mocks.trackSearchPerformed).toHaveBeenCalledTimes(1));
    });
  });

  describe('search_performed — một quy tắc: mỗi khoá tìm (q + sắp xếp + lọc) ghi một lần', () => {
    it('Back từ trang sản phẩm (Browse unmount rồi mount lại với cache cũ, cùng URL) KHÔNG ghi thêm; mở lại cùng từ khoá bằng PUSH thì ghi', async () => {
      renderWithPdp('/browse?q=nuoc');
      await listPainted();
      await waitFor(() => expect(mocks.trackSearchPerformed).toHaveBeenCalledTimes(1));

      fireEvent.click(screen.getByRole('button', { name: 'to-pdp' }));
      await screen.findByTestId('pdp');
      fireEvent.click(screen.getByRole('button', { name: 'history-back' }));
      await listPainted(); // Browse đã mount lại và vẽ xong danh sách từ cache
      expect(mocks.trackSearchPerformed).toHaveBeenCalledTimes(1);

      fireEvent.click(screen.getByRole('button', { name: 'to-pdp' }));
      await screen.findByTestId('pdp');
      fireEvent.click(screen.getByRole('button', { name: 'push-search' }));
      await listPainted();
      await waitFor(() => expect(mocks.trackSearchPerformed).toHaveBeenCalledTimes(2));
    });

    it('cùng từ khoá, đổi sắp xếp → khoá mới → ghi lại (quy tắc nhất quán)', async () => {
      renderAt('/browse?q=nuoc');
      await listPainted();
      await waitFor(() => expect(mocks.trackSearchPerformed).toHaveBeenCalledTimes(1));
      fireEvent.click(screen.getByRole('button', { name: 'Mới nhất' }));
      await waitFor(() => expect(loc()).toBe('/browse?q=nuoc&sort=newest'));
      await waitFor(() => expect(mocks.trackSearchPerformed).toHaveBeenCalledTimes(2));
      expect(mocks.trackSearchPerformed).toHaveBeenLastCalledWith({ q: 'nuoc', resultsCount: 2 });
    });

    it('xoá từ khoá rồi gõ lại đúng từ khoá cũ vẫn là một lượt tìm mới', async () => {
      renderAt('/browse?q=nuoc');
      await listPainted();
      await waitFor(() => expect(mocks.trackSearchPerformed).toHaveBeenCalledTimes(1));
      fireEvent.click(screen.getByRole('button', { name: 'Xoá từ khoá' }));
      await waitFor(() => expect(loc()).toBe('/browse'));
      fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'nuoc' } });
      fireEvent.submit(screen.getByRole('search'));
      await waitFor(() => expect(loc()).toBe('/browse?q=nuoc'));
      await waitFor(() => expect(mocks.trackSearchPerformed).toHaveBeenCalledTimes(2));
    });
  });

  describe('chế độ gõ khi chưa có lịch sử tìm (khách mới) — nội dung duyệt KHÔNG biến mất', () => {
    const contentVisible = async () => {
      expect(await screen.findByRole('button', { name: 'Cho mẹ & bé' })).toBeInTheDocument();
      expect(screen.getByRole('group', { name: 'Sắp xếp' })).toBeInTheDocument();
      expect(await screen.findByRole('button', { name: 'Nước rửa chén' })).toBeInTheDocument();
    };

    it('?focus=search (không có lịch sử): ô tìm được focus, có "Hủy", vẫn thấy lưới Danh mục, sắp xếp và sản phẩm', async () => {
      renderAt('/browse?focus=search');
      const input = screen.getByRole('searchbox', { name: 'Tìm sản phẩm' });
      await waitFor(() => expect(document.activeElement).toBe(input));
      await waitFor(() => expect(loc()).toBe('/browse'));
      expect(screen.getByRole('button', { name: 'Hủy' })).toBeInTheDocument();
      expect(screen.queryByRole('region', { name: 'Gợi ý tìm kiếm' })).toBeNull();
      await contentVisible();
    });

    it('chạm vào ô tìm ở trang gốc (không có lịch sử) → nội dung vẫn hiện; gõ chữ đầu tiên mới chuyển sang gợi ý', async () => {
      renderAt('/browse');
      await listPainted();
      fireEvent.focus(screen.getByRole('searchbox'));
      expect(screen.getByRole('button', { name: 'Hủy' })).toBeInTheDocument();
      await contentVisible();
      fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'nu' } });
      expect(await screen.findByRole('region', { name: 'Gợi ý tìm kiếm' })).toBeInTheDocument();
      expect(screen.queryByRole('group', { name: 'Sắp xếp' })).toBeNull();
    });

    it('có lịch sử + ô trống → vẫn hiện lịch sử (thay nội dung)', async () => {
      localStorage.setItem('tubu_recent_searches', JSON.stringify(['nước rửa']));
      renderAt('/browse');
      await listPainted();
      fireEvent.focus(screen.getByRole('searchbox'));
      expect(await screen.findByRole('region', { name: 'Gợi ý tìm kiếm' })).toBeInTheDocument();
      expect(screen.queryByRole('group', { name: 'Sắp xếp' })).toBeNull();
    });
  });

  describe('lỗi khi đã có dữ liệu — giữ danh sách, thử lại ngay tại chỗ', () => {
    it('"Xem thêm" lỗi: lưới giữ nguyên (không ErrorState toàn trang), có thông báo + "Thử lại" gọi lại đúng trang 2', async () => {
      let failPage2 = true;
      mocks.fetchCatalog.mockImplementation(async (q: { page: number }) => {
        if (q.page === 1) return { data: [card('p1', 'Nước rửa chén'), card('p2', 'Xà phòng')], meta: { page: 1, limit: 30, total: 31 } };
        if (failPage2) throw new Error('network');
        return { data: [card('p3', 'Bột giặt')], meta: { page: 2, limit: 30, total: 31 } };
      });
      renderAt('/browse');
      fireEvent.click(await screen.findByRole('button', { name: 'Xem thêm' }));
      expect(await screen.findByText('Không tải thêm được sản phẩm')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Nước rửa chén' })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Xà phòng' })).toBeInTheDocument();
      expect(screen.getByRole('group', { name: 'Sắp xếp' })).toBeInTheDocument();

      failPage2 = false;
      fireEvent.click(screen.getByRole('button', { name: 'Thử lại' }));
      expect(await screen.findByRole('button', { name: 'Bột giặt' })).toBeInTheDocument();
      expect(catalogCalls().map((q) => q.page)).toEqual([1, 2, 2]);
      expect(screen.queryByText('Không tải thêm được sản phẩm')).toBeNull();
    });
  });

  describe('khung chờ Danh mục', () => {
    it('dựng đúng số ô của lần tải trước (không mặc định 4) khi danh sách danh mục còn đang tải', async () => {
      localStorage.setItem(CATEGORY_COUNT_KEY, '6');
      mocks.fetchCategories.mockReturnValue(new Promise(() => undefined));
      renderAt('/browse');
      const grid = await screen.findByTestId('category-grid-loading');
      expect(grid.children).toHaveLength(6);
    });
  });

  describe('Review Focus 4b — quay lại từ trang sản phẩm', () => {
    it('mở lại URL đã lưu (Back) phục hồi ĐỦ q, sắp xếp và bộ lọc: ô tìm, chip sắp xếp, chip lọc, tham số gọi API', async () => {
      renderAt('/browse?q=nuoc&sort=newest&inStock=1&rating=4&minPrice=100000&maxPrice=200000&brand=Tubu');
      expect(screen.getByRole('searchbox')).toHaveValue('nuoc');
      await listPainted();
      expect(screen.getByRole('button', { name: 'Mới nhất' })).toHaveAttribute('aria-pressed', 'true');
      for (const chip of ['Bỏ lọc Tubu', 'Bỏ lọc Còn hàng', 'Bỏ lọc Từ 4★']) expect(screen.getByRole('button', { name: chip })).toBeInTheDocument();
      expect(catalogCalls()[0]).toMatchObject({
        q: 'nuoc', sort: 'newest', inStock: true, minRating: 4, minPrice: 100000, maxPrice: 200000, brand: 'Tubu',
      });
    });

    it('đổi sắp xếp / áp bộ lọc / gỡ chip / gửi tìm kiếm đều là REPLACE — không chồng thêm mục lịch sử', async () => {
      renderAt('/browse');
      await listPainted();
      expect(navType()).toBe('POP'); // đối chứng: mới vào trang

      fireEvent.click(screen.getByRole('button', { name: 'Mới nhất' }));
      await waitFor(() => expect(loc()).toBe('/browse?sort=newest'));
      expect(navType()).toBe('REPLACE');

      fireEvent.click(screen.getByRole('button', { name: 'Bộ lọc' }));
      fireEvent.click(await screen.findByRole('button', { name: 'Chỉ hiện còn hàng' }));
      fireEvent.click(await screen.findByRole('button', { name: /^Xem 2 sản phẩm$/ }, { timeout: 2000 }));
      await waitFor(() => expect(loc()).toBe('/browse?inStock=1&sort=newest'));
      expect(navType()).toBe('REPLACE');

      fireEvent.click(await screen.findByRole('button', { name: 'Bỏ lọc Còn hàng' }));
      await waitFor(() => expect(loc()).toBe('/browse?sort=newest'));
      expect(navType()).toBe('REPLACE');

      fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'nuoc' } });
      fireEvent.submit(screen.getByRole('search'));
      await waitFor(() => expect(loc()).toBe('/browse?q=nuoc&sort=newest'));
      expect(navType()).toBe('REPLACE');
    });

    describe('vị trí cuộn', () => {
      const original = Object.getOwnPropertyDescriptor(Element.prototype, 'scrollTop');
      beforeEach(() => {
        // jsdom không có layout: scrollTop luôn 0 và không ghi được. Thay bằng bản ghi/đọc được và GIỚI HẠN
        // như trình duyệt thật — chưa có lưới SP trong DOM (trang chưa dài ra) thì không cuộn được xa → 0.
        const values = new WeakMap<Element, number>();
        Object.defineProperty(Element.prototype, 'scrollTop', {
          configurable: true,
          get(this: Element) { return this.isConnected ? values.get(this) ?? 0 : 0; },
          set(this: Element, v: number) { values.set(this, document.querySelector('[data-testid="catalog-grid"]') ? v : 0); },
        });
      });
      afterEach(() => {
        if (original) Object.defineProperty(Element.prototype, 'scrollTop', original);
      });

      it('mở lại bằng POP (Back) khôi phục đúng vị trí SAU KHI trang 1 của danh sách đã vẽ — không sớm hơn', async () => {
        sessionStorage.setItem(`${SCROLL_KEY_PREFIX}q=nuoc&sort=newest`, '640');
        let release: (v: unknown) => void = () => undefined;
        mocks.fetchCatalog.mockReturnValue(new Promise((r) => { release = r; }));
        renderAt('/browse?q=nuoc&sort=newest');
        const scroller = document.querySelector('.zaui-page') as HTMLElement;
        await waitFor(() => expect(mocks.fetchCatalog).toHaveBeenCalled());
        expect(scroller.scrollTop).toBe(0); // danh sách chưa có → chưa khôi phục (và chưa "dùng mất" lượt khôi phục)
        await act(async () => { release(pageOf([card('p1', 'Nước rửa chén'), card('p2', 'Xà phòng')])); });
        await listPainted();
        expect(scroller.scrollTop).toBe(640);
      });

      it('đang ở chế độ gõ (gợi ý thay nội dung, trang ngắn) chưa khôi phục; thoát gõ thì khôi phục', async () => {
        sessionStorage.setItem(`${SCROLL_KEY_PREFIX}q=nuoc`, '500');
        localStorage.setItem('tubu_recent_searches', JSON.stringify(['nước rửa']));
        renderAt('/browse?q=nuoc&focus=search');
        const scroller = document.querySelector('.zaui-page') as HTMLElement;
        await waitFor(() => expect(mocks.fetchCatalog).toHaveBeenCalled());
        await screen.findByRole('region', { name: 'Gợi ý tìm kiếm' });
        await wait(50);
        expect(scroller.scrollTop).toBe(0);
        fireEvent.click(screen.getByRole('button', { name: 'Hủy' }));
        await listPainted();
        expect(scroller.scrollTop).toBe(500);
      });
    });
  });
});
