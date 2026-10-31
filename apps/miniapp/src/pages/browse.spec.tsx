import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes, useLocation, useNavigate as useRouterNavigate, useNavigationType } from 'react-router-dom';
import type { ReactNode } from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const mocks = vi.hoisted(() => ({
  navigate: vi.fn(), fetchCatalog: vi.fn(), fetchBrands: vi.fn(), fetchCategories: vi.fn(), suggestProducts: vi.fn(), coreGet: vi.fn(),
  routerNavigate: undefined as undefined | ((to: string) => void),
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
  fetchProductsBySlugs: vi.fn().mockResolvedValue([{ id: 'id-old-1', slug: 'old-1', brand: 'Tubu', name: 'Sản phẩm xem trước', thumbnail: null, basePrice: 45000, salePrice: null, isFeatured: false, inStock: true }]),
}));
vi.mock('../services/core-http', () => ({ coreHttp: { get: mocks.coreGet } }));
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
const pageOf = (data: ReturnType<typeof card>[], filtersIgnored = false) => ({ data, meta: { page: 1, limit: 20, total: data.length }, filtersIgnored });
const cat = (id: string, name: string, productCount: number, children: unknown[] = []) => ({ id, parentId: null, name, slug: id, image: null, productCount, children });

function Probe() {
  const loc = useLocation();
  const navType = useNavigationType();
  const go = useRouterNavigate();
  mocks.routerNavigate = (to) => go(to);
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
    mocks.coreGet.mockResolvedValue({ data: [], meta: { page: 1, limit: 10, total: 0 } });
    // `useNavigate` của zmp-ui bị thay bằng vi.fn(): chuyển các lượt mở Danh mục vào router thật để thấy URL đổi.
    mocks.navigate.mockImplementation((to: unknown) => {
      if (typeof to === 'string' && to.startsWith('/browse')) mocks.routerNavigate?.(to);
    });
  });

  describe('hub (gốc /browse)', () => {
    it('có Danh mục (4 phân khúc khi chưa có danh mục thật) + ô "Tất cả" + nút "Xem tất cả sản phẩm"; KHÔNG có lưới, KHÔNG gọi fetchCatalog', async () => {
      renderAt('/browse');
      await screen.findByRole('button', { name: 'Cho mẹ & bé' });
      const region = screen.getByRole('region', { name: 'Danh mục' });
      expect(within(region).getAllByRole('button')).toHaveLength(5);
      expect(within(region).getByRole('button', { name: 'Tất cả' })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Xem tất cả sản phẩm' })).toBeInTheDocument();
      expect(screen.queryByTestId('catalog-grid')).toBeNull();
      expect(screen.queryByRole('group', { name: 'Sắp xếp' })).toBeNull();
      expect(screen.queryByText('Xu hướng')).toBeNull();
      await wait(50);
      expect(mocks.fetchCatalog).not.toHaveBeenCalled();
    });

    it('cây danh mục thật (có productCount) → mỗi danh mục có hàng một ô; chạm ô → PUSH /browse?category=<id>', async () => {
      mocks.fetchCategories.mockResolvedValue([cat('da', 'Chăm sóc da', 5), cat('rong', 'Danh mục rỗng', 0), cat('nha', 'Nhà sạch', 3)]);
      renderAt('/browse');
      const tile = await screen.findByRole('button', { name: 'Chăm sóc da' });
      expect(screen.queryByRole('button', { name: 'Danh mục rỗng' })).toBeNull();
      fireEvent.click(tile);
      expect(mocks.navigate).toHaveBeenCalledWith('/browse?category=da');
      await waitFor(() => expect(loc()).toBe('/browse?category=da'));
      await waitFor(() => expect(catalogCalls().some((q) => q.category === 'da')).toBe(true));
    });

    it('chạm ô phân khúc → PUSH /browse?segment=…; ô thương hiệu → PUSH /browse?brand=…', async () => {
      mocks.fetchBrands.mockResolvedValue([{ brand: 'Tubu', count: 9 }, { brand: 'Cỏ Mềm', count: 5 }, { brand: 'Xanh', count: 3 }, { brand: 'Lá', count: 2 }]);
      renderAt('/browse');
      fireEvent.click(await screen.findByRole('button', { name: 'Cho mẹ & bé' }));
      expect(mocks.navigate).toHaveBeenCalledWith('/browse?segment=mom_baby');
      await waitFor(() => expect(loc()).toBe('/browse?segment=mom_baby'));
    });

    it('thương hiệu: đủ 4 nhãn mới có lưới; chạm → /browse?brand=<tên>', async () => {
      mocks.fetchBrands.mockResolvedValue([{ brand: 'Tubu', count: 9 }, { brand: 'Cỏ Mềm', count: 5 }, { brand: 'Xanh', count: 3 }, { brand: 'Lá', count: 2 }]);
      renderAt('/browse');
      fireEvent.click(await screen.findByRole('button', { name: 'Xem thương hiệu Cỏ Mềm' }));
      expect(mocks.navigate).toHaveBeenCalledWith('/browse?brand=C%E1%BB%8F+M%E1%BB%81m');
    });

    it('"Xem tất cả sản phẩm" → PUSH /browse?all=1 → thanh sắp xếp + lưới, tải 20 món mỗi trang', async () => {
      renderAt('/browse');
      fireEvent.click(await screen.findByRole('button', { name: 'Xem tất cả sản phẩm' }));
      expect(mocks.navigate).toHaveBeenCalledWith('/browse?all=1');
      await waitFor(() => expect(loc()).toBe('/browse?all=1'));
      expect(await screen.findByRole('group', { name: 'Sắp xếp' })).toBeInTheDocument();
      await screen.findByTestId('catalog-grid');
      expect(catalogCalls()[0]).toMatchObject({ page: 1, limit: 20 });
    });

    it('kệ Bán chạy nhất lấy sort=best_seller_30d, không đi qua fetchCatalog', async () => {
      mocks.coreGet.mockResolvedValue({ data: Array.from({ length: 10 }, (_, i) => card(`b${i}`, `Bán chạy ${i}`)), meta: { page: 1, limit: 10, total: 10 } });
      renderAt('/browse');
      expect(await screen.findByRole('region', { name: 'Bán chạy nhất' })).toBeInTheDocument();
      expect(mocks.coreGet).toHaveBeenCalledWith('/products', { query: { sort: 'best_seller_30d', limit: 10 } });
      expect(mocks.fetchCatalog).not.toHaveBeenCalled();
    });

    it('quay lại hub từ danh sách bằng Back không tải lại danh sách ở hub và vẫn là hub (URL sạch)', async () => {
      renderAt('/browse?all=1');
      await listPainted();
      act(() => { mocks.routerNavigate?.('/browse'); });
      expect(await screen.findByRole('region', { name: 'Danh mục' })).toBeInTheDocument();
      expect(screen.queryByTestId('catalog-grid')).toBeNull();
    });
  });

  it('trang có đúng một h1 (ẩn về mặt hình ảnh) làm điểm mốc cho trình đọc màn hình, ở cả hub lẫn danh sách', async () => {
    const { unmount } = renderAt('/browse');
    await screen.findByRole('region', { name: 'Danh mục' });
    expect(screen.getAllByRole('heading', { level: 1 }).map((h) => h.textContent)).toEqual(['Danh mục']);
    unmount();
    renderAt('/browse?all=1');
    await listPainted();
    expect(screen.getAllByRole('heading', { level: 1 }).map((h) => h.textContent)).toEqual(['Danh mục']);
  });

  it('header có nút giỏ khi không gõ (CartButton), và không có nút "Huỷ"', async () => {
    renderAt('/browse?all=1');
    await listPainted();
    expect(screen.getByRole('button', { name: 'Giỏ hàng' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Huỷ' })).toBeNull();
  });

  it('?focus=search: ô tìm được focus, bỏ focus khỏi URL, hiện gợi ý thay nội dung + nút "Huỷ" (giỏ nhường chỗ)', async () => {
    localStorage.setItem('tubu_recent_searches', JSON.stringify(['nước rửa']));
    renderAt('/browse?focus=search');
    const input = screen.getByRole('searchbox', { name: 'Tìm sản phẩm' });
    await waitFor(() => expect(document.activeElement).toBe(input));
    await waitFor(() => expect(loc()).toBe('/browse'));
    expect(screen.getByRole('region', { name: 'Gợi ý tìm kiếm' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Huỷ' })).toBeInTheDocument();
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
    await waitFor(() => expect(catalogCalls().some((q) => q.q === 'nuoc rua' && q.limit === 20)).toBe(true));
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

  it('"Huỷ" thoát chế độ gõ, trả ô tìm về q của URL và hiện lại nội dung', async () => {
    renderAt('/browse?q=nuoc');
    await listPainted();
    const input = screen.getByRole('searchbox');
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: 'dang go do' } });
    expect(screen.queryByRole('group', { name: 'Sắp xếp' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Huỷ' }));
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

  describe('thanh sắp xếp và tiêu đề danh sách', () => {
    it('bốn tab Phổ biến · Bán chạy · Mới · Giá ⇅; có từ khoá thì tab đầu là "Liên quan"', async () => {
      const { unmount } = renderAt('/browse?all=1');
      await listPainted();
      const group = screen.getByRole('group', { name: 'Sắp xếp' });
      expect(within(group).getAllByRole('button').map((b) => b.textContent)).toEqual(['Phổ biến', 'Bán chạy', 'Mới', 'Giá ⇅']);
      expect(screen.getByRole('button', { name: 'Phổ biến' })).toHaveAttribute('aria-pressed', 'true');
      unmount();
      renderAt('/browse?q=nuoc');
      await listPainted();
      expect(screen.getByRole('button', { name: 'Liên quan' })).toHaveAttribute('aria-pressed', 'true');
      expect(screen.queryByRole('button', { name: 'Phổ biến' })).toBeNull();
    });

    it('chạm "Bán chạy" → sort=best_seller (replace) và bỏ all=1 (đã có sắp xếp thì không cần)', async () => {
      renderAt('/browse?all=1');
      fireEvent.click(await screen.findByRole('button', { name: 'Bán chạy' }));
      await waitFor(() => expect(loc()).toBe('/browse?sort=best_seller'));
      expect(navType()).toBe('REPLACE');
      await waitFor(() => expect(catalogCalls().some((q) => q.sort === 'best_seller')).toBe(true));
    });

    it('tab Giá đảo chiều mỗi lần chạm: thấp → cao; tên đọc nói rõ chiều đang xếp', async () => {
      renderAt('/browse?all=1');
      await listPainted();
      fireEvent.click(screen.getByRole('button', { name: 'Giá, chạm để xếp từ thấp đến cao' }));
      await waitFor(() => expect(loc()).toBe('/browse?sort=price_asc'));
      const asc = await screen.findByRole('button', { name: 'Giá từ thấp đến cao, chạm để đổi chiều' });
      expect(asc).toHaveAttribute('aria-pressed', 'true');
      expect(asc).toHaveTextContent('Giá thấp');
      fireEvent.click(asc);
      await waitFor(() => expect(loc()).toBe('/browse?sort=price_desc'));
      const desc = await screen.findByRole('button', { name: 'Giá từ cao đến thấp, chạm để đổi chiều' });
      expect(desc).toHaveAttribute('aria-pressed', 'true');
      expect(desc).toHaveTextContent('Giá cao');
      await waitFor(() => expect(catalogCalls().some((q) => q.sort === 'price_desc')).toBe(true));
    });

    it('"Phổ biến" từ ?sort=best_seller → ?all=1: ở lại danh sách, không về hub', async () => {
      renderAt('/browse?sort=best_seller');
      fireEvent.click(await screen.findByRole('button', { name: 'Phổ biến' }));
      await waitFor(() => expect(loc()).toBe('/browse?all=1'));
      expect(screen.getByRole('group', { name: 'Sắp xếp' })).toBeInTheDocument();
      expect(screen.queryByRole('region', { name: 'Danh mục' })).toBeNull();
    });

    it('nút "Lọc" nằm trong thanh sắp xếp, đếm số loại lọc đang bật: "Lọc (2)"', async () => {
      renderAt('/browse?inStock=1&rating=4');
      await listPainted();
      const bar = screen.getByRole('group', { name: 'Sắp xếp' }).parentElement as HTMLElement;
      expect(within(bar).getByRole('button', { name: 'Lọc, 2 bộ lọc đang bật' })).toHaveTextContent('Lọc (2)');
    });

    it('?category=<cha có con>: một tiêu đề h2 là tên cha, caption số sản phẩm, hàng chip "Tất cả" + con, không chip lọc trùng tên', async () => {
      mocks.fetchCategories.mockResolvedValue([cat('da', 'Chăm sóc da', 5, [cat('rua', 'Rửa mặt', 2), cat('nang', 'Chống nắng', 3)])]);
      renderAt('/browse?category=da');
      await listPainted();
      expect(screen.getAllByText('Chăm sóc da')).toHaveLength(1);
      expect(screen.getByRole('heading', { level: 2, name: 'Chăm sóc da' })).toBeInTheDocument();
      expect(screen.getByTestId('result-count')).toHaveTextContent('2 sản phẩm');
      const chips = screen.getByRole('group', { name: 'Danh mục con' });
      expect(within(chips).getAllByRole('button').map((b) => b.textContent)).toEqual(['Tất cả', 'Rửa mặt', 'Chống nắng']);
      expect(screen.queryByRole('button', { name: 'Bỏ lọc Chăm sóc da' })).toBeNull();
      fireEvent.click(within(chips).getByRole('button', { name: 'Chống nắng' }));
      await waitFor(() => expect(loc()).toBe('/browse?category=nang'));
      expect(await screen.findByRole('heading', { level: 2, name: 'Chống nắng' })).toBeInTheDocument();
      fireEvent.click(within(screen.getByRole('group', { name: 'Danh mục con' })).getByRole('button', { name: 'Tất cả' }));
      await waitFor(() => expect(loc()).toBe('/browse?category=da'));
    });

    it('danh mục không có con (hoặc API cũ trả danh sách phẳng): không có hàng chip, vẫn có tiêu đề và danh sách', async () => {
      mocks.fetchCategories.mockResolvedValue([{ id: 'da', name: 'Chăm sóc da', slug: 'da', image: null, productCount: 5 }]);
      renderAt('/browse?category=da');
      await listPainted();
      expect(screen.getByRole('heading', { level: 2, name: 'Chăm sóc da' })).toBeInTheDocument();
      expect(screen.queryByRole('group', { name: 'Danh mục con' })).toBeNull();
    });

    it('có từ khoá + danh mục: tiêu đề nhường ô tìm, danh mục thành chip lọc gỡ được', async () => {
      mocks.fetchCategories.mockResolvedValue([cat('da', 'Chăm sóc da', 5)]);
      renderAt('/browse?q=nuoc&category=da');
      expect(await screen.findByRole('button', { name: 'Bỏ lọc Chăm sóc da' })).toBeInTheDocument();
      expect(screen.queryByRole('heading', { level: 2 })).toBeNull();
    });
  });

  it('áp dụng bộ lọc → URL đủ tham số + filter_applied cho từng loại đổi', async () => {
    renderAt('/browse?all=1');
    fireEvent.click(await screen.findByRole('button', { name: 'Lọc' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Chỉ hiện còn hàng' }));
    fireEvent.click(screen.getByRole('button', { name: 'Từ 4★ trở lên' }));
    fireEvent.click(await screen.findByRole('button', { name: /^Xem 2 sản phẩm$/ }, { timeout: 2000 }));
    await waitFor(() => expect(loc()).toBe('/browse?inStock=1&rating=4'));
    expect(mocks.trackFilterApplied.mock.calls.map(([t]) => t)).toEqual(['in_stock', 'rating']);
    expect(await screen.findByRole('button', { name: 'Bỏ lọc Còn hàng' })).toBeInTheDocument();
  });

  it('link cũ ?inStock=1 → chip gỡ được; gỡ chip cuối → ?all=1 (ở lại danh sách, không về hub)', async () => {
    renderAt('/browse?inStock=1');
    fireEvent.click(await screen.findByRole('button', { name: 'Bỏ lọc Còn hàng' }));
    await waitFor(() => expect(loc()).toBe('/browse?all=1'));
    expect(await screen.findByRole('group', { name: 'Sắp xếp' })).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'Danh mục' })).toBeNull();
  });

  it('link cũ ?brand=Tubu: tên thương hiệu là tiêu đề DUY NHẤT (không chip trùng), có lối sang trang thương hiệu; thêm bộ lọc khác vẫn có chip', async () => {
    mocks.fetchBrands.mockResolvedValue([{ brand: 'Tubu', count: 2, slug: 'tubu-xanh' }]);
    renderAt('/browse?brand=Tubu');
    expect(await screen.findByRole('heading', { level: 2, name: 'Tubu' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Bỏ lọc Tubu' })).toBeNull();
    expect(await screen.findByRole('button', { name: 'Xem trang thương hiệu Tubu' })).toBeInTheDocument();
    expect(screen.queryByText(/nhãn hàng/i)).toBeNull();
  });

  it('?brand=Tubu kèm ?inStock=1: chỉ chip "Còn hàng" hiện; hai thương hiệu thì không có tiêu đề nên cả hai là chip', async () => {
    renderAt('/browse?brand=Tubu&inStock=1');
    expect(await screen.findByRole('button', { name: 'Bỏ lọc Còn hàng' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Bỏ lọc Tubu' })).toBeNull();
  });

  it('?brand=Tubu,Mộc An: nhiều thương hiệu không có tiêu đề, mỗi thương hiệu là một chip gỡ được', async () => {
    renderAt('/browse?brand=Tubu,M%E1%BB%99c%20An');
    expect(await screen.findByRole('button', { name: 'Bỏ lọc Tubu' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Bỏ lọc Mộc An' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { level: 2 })).toBeNull();
  });

  it('link từ Trang chủ ?segment=eco → lọc theo phân khúc, tên phân khúc là tiêu đề DUY NHẤT (không chip trùng)', async () => {
    renderAt('/browse?segment=eco');
    expect(await screen.findByRole('heading', { level: 2, name: 'Sống xanh' })).toBeInTheDocument();
    await waitFor(() => expect(catalogCalls().some((q) => q.segment === 'eco')).toBe(true));
    expect(screen.getAllByText('Sống xanh')).toHaveLength(1);
    expect(screen.queryByRole('button', { name: 'Bỏ lọc Sống xanh' })).toBeNull();
    expect(screen.queryByRole('group', { name: 'Đổi danh mục' })).toBeNull();
  });

  it('suggest ở hub: chạm danh mục trong gợi ý → ?segment=… là PUSH như chạm ô danh mục (Back về hub, không rời Danh mục)', async () => {
    renderAt('/browse');
    const input = screen.getByRole('searchbox');
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: 'me' } });
    const region = await screen.findByRole('region', { name: 'Gợi ý tìm kiếm' });
    fireEvent.click(within(region).getByRole('button', { name: /Cho mẹ & bé/ }));
    await waitFor(() => expect(loc()).toBe('/browse?segment=mom_baby'));
    expect(navType()).toBe('PUSH');
    await waitFor(() => expect(catalogCalls().some((q) => q.segment === 'mom_baby')).toBe(true));
  });

  it('suggest trong danh sách: chạm danh mục → đổi phạm vi bằng REPLACE, bỏ q', async () => {
    renderAt('/browse?q=nuoc');
    const input = screen.getByRole('searchbox');
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: 'me' } });
    const region = await screen.findByRole('region', { name: 'Gợi ý tìm kiếm' });
    fireEvent.click(within(region).getByRole('button', { name: /Cho mẹ & bé/ }));
    await waitFor(() => expect(loc()).toBe('/browse?segment=mom_baby'));
    expect(navType()).toBe('REPLACE');
  });

  it('?category=<id> không có trong cây (link cũ, danh mục đã xoá): không tiêu đề nhưng có chip "Danh mục" để khách thấy và gỡ bộ lọc', async () => {
    mocks.fetchCategories.mockResolvedValue([cat('da', 'Chăm sóc da', 5)]);
    renderAt('/browse?category=cat-da-xoa');
    const chip = await screen.findByRole('button', { name: 'Bỏ lọc Danh mục' });
    expect(screen.queryByRole('heading', { level: 2 })).toBeNull();
    fireEvent.click(chip);
    await waitFor(() => expect(loc()).toBe('/browse?all=1'));
  });

  it('?category=<id> trong lúc cây còn tải: chưa hiện chip dự phòng (tên thật sẽ thành tiêu đề, không nháy chip rồi mất)', async () => {
    mocks.fetchCategories.mockReturnValue(new Promise(() => undefined));
    renderAt('/browse?category=da');
    await screen.findByRole('group', { name: 'Sắp xếp' });
    expect(screen.queryByRole('button', { name: 'Bỏ lọc Danh mục' })).toBeNull();
  });

  it('chạm kết quả khi đang tìm → search_result_clicked { q, position (1-based), source, slug }', async () => {
    renderAt('/browse?q=nuoc');
    fireEvent.click(await screen.findByRole('button', { name: 'Xà phòng' }));
    expect(mocks.trackSearchResultClicked).toHaveBeenCalledWith({ q: 'nuoc', position: 2, source: 'results', slug: 'p2' });
    expect(mocks.navigate).toHaveBeenCalledWith('/product/p2', { state: { listSource: 'search' } });
  });

  it('chạm SP khi chỉ duyệt (không q) → KHÔNG bắn search_result_clicked, listSource=browse', async () => {
    renderAt('/browse?all=1');
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

  it('không có kết quả, chỉ còn bộ lọc → "Xoá tìm kiếm & bộ lọc" ra ?all=1 (danh sách, không về hub)', async () => {
    mocks.fetchCatalog.mockResolvedValue(pageOf([]));
    renderAt('/browse?inStock=1');
    fireEvent.click(await screen.findByRole('button', { name: 'Xoá tìm kiếm & bộ lọc' }));
    await waitFor(() => expect(loc()).toBe('/browse?all=1'));
  });

  it('lỗi tải → ErrorState "Thử lại" gọi lại', async () => {
    mocks.fetchCatalog.mockRejectedValueOnce(new Error('network'));
    renderAt('/browse?all=1');
    fireEvent.click(await screen.findByRole('button', { name: 'Thử lại' }));
    await waitFor(() => expect(mocks.fetchCatalog.mock.calls.length).toBeGreaterThanOrEqual(2));
    expect(await screen.findByRole('button', { name: 'Xà phòng' })).toBeInTheDocument();
  });

  describe('"Đã xem gần đây"', () => {
    beforeEach(() => {
      recordRecentlyViewed({ slug: 'old-1', name: 'Sản phẩm xem trước', thumbnail: null }, 1);
    });

    it('hub: hiện dải (không cần tải danh sách)', async () => {
      renderAt('/browse');
      expect(await screen.findByRole('region', { name: 'Đã xem gần đây' })).toBeInTheDocument();
      expect(mocks.fetchCatalog).not.toHaveBeenCalled();
    });

    it('danh sách đầy đủ ?all=1 có kết quả → dải không hiện (chỉ hub và trạng thái không có kết quả)', async () => {
      renderAt('/browse?all=1');
      await listPainted();
      expect(screen.queryByRole('region', { name: 'Đã xem gần đây' })).toBeNull();
    });

    it('đang tìm có kết quả → dải không hiện', async () => {
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

  describe('"Xem thêm" khi danh sách đổi giữa hai lần tải (phân trang theo số trang)', () => {
    it('sản phẩm cuối trang 1 lặp lại ở đầu trang 2 (bán chạy xếp lại, hàng mới về) → lưới chỉ hiện một lần, không cảnh báo key trùng', async () => {
      mocks.fetchCatalog.mockImplementation(async (q: { page: number }) =>
        q.page === 1
          ? { data: [card('p1', 'Nước rửa chén'), card('p2', 'Xà phòng')], meta: { page: 1, limit: 30, total: 32 } }
          : { data: [card('p2', 'Xà phòng'), card('p3', 'Bột giặt')], meta: { page: 2, limit: 30, total: 32 } },
      );
      const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
      try {
        renderAt('/browse?q=nuoc');
        fireEvent.click(await screen.findByRole('button', { name: 'Xem thêm' }));
        expect(await screen.findByRole('button', { name: 'Bột giặt' })).toBeInTheDocument();
        expect(screen.getAllByRole('button', { name: 'Xà phòng' })).toHaveLength(1);
        expect(errors.mock.calls.filter((c) => /same key|unique "key"/.test(String(c[0])))).toEqual([]);
      } finally {
        errors.mockRestore();
      }
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
      fireEvent.click(screen.getByRole('button', { name: 'Mới' }));
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
    const hubVisible = async () => {
      expect(await screen.findByRole('button', { name: 'Cho mẹ & bé' })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Xem tất cả sản phẩm' })).toBeInTheDocument();
    };
    const listVisible = async () => {
      expect(await screen.findByRole('group', { name: 'Sắp xếp' })).toBeInTheDocument();
      expect(await screen.findByRole('button', { name: 'Nước rửa chén' })).toBeInTheDocument();
    };

    it('?focus=search (không có lịch sử): ô tìm được focus, có "Huỷ", vẫn thấy hub', async () => {
      renderAt('/browse?focus=search');
      const input = screen.getByRole('searchbox', { name: 'Tìm sản phẩm' });
      await waitFor(() => expect(document.activeElement).toBe(input));
      await waitFor(() => expect(loc()).toBe('/browse'));
      expect(screen.getByRole('button', { name: 'Huỷ' })).toBeInTheDocument();
      expect(screen.queryByRole('region', { name: 'Gợi ý tìm kiếm' })).toBeNull();
      await hubVisible();
    });

    it('chạm vào ô tìm ở trang gốc (không có lịch sử) → hub vẫn hiện; gõ chữ đầu tiên mới chuyển sang gợi ý', async () => {
      renderAt('/browse');
      await hubVisible();
      fireEvent.focus(screen.getByRole('searchbox'));
      expect(screen.getByRole('button', { name: 'Huỷ' })).toBeInTheDocument();
      await hubVisible();
      fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'nu' } });
      expect(await screen.findByRole('region', { name: 'Gợi ý tìm kiếm' })).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Xem tất cả sản phẩm' })).toBeNull();
    });

    it('đang ở danh sách, chạm vào ô tìm (không có lịch sử) → thanh sắp xếp và sản phẩm vẫn hiện', async () => {
      renderAt('/browse?all=1');
      await listPainted();
      fireEvent.focus(screen.getByRole('searchbox'));
      expect(screen.getByRole('button', { name: 'Huỷ' })).toBeInTheDocument();
      await listVisible();
    });

    it('chạm tab sắp xếp khi đang ở chế độ gõ mà ô trống → thoát chế độ gõ: "Huỷ" biến mất, giỏ hàng trở lại', async () => {
      renderAt('/browse?all=1');
      await listPainted();
      fireEvent.focus(screen.getByRole('searchbox'));
      expect(screen.getByRole('button', { name: 'Huỷ' })).toBeInTheDocument();
      fireEvent.click(screen.getByRole('button', { name: 'Bán chạy' }));
      await waitFor(() => expect(loc()).toBe('/browse?sort=best_seller'));
      expect(screen.queryByRole('button', { name: 'Huỷ' })).toBeNull();
      expect(screen.getByRole('button', { name: 'Giỏ hàng' })).toBeInTheDocument();
    });

    it('đã có q trong URL, khách xoá chữ trong ô rồi chạm chip sắp xếp → ô tìm trả về q đang lọc (không để ô trống trong khi lưới vẫn là kết quả của q)', async () => {
      renderAt('/browse?q=nuoc');
      await listPainted();
      const input = screen.getByRole('searchbox');
      fireEvent.focus(input);
      fireEvent.change(input, { target: { value: '' } });
      expect(screen.getByRole('group', { name: 'Sắp xếp' })).toBeInTheDocument();
      fireEvent.click(screen.getByRole('button', { name: 'Bán chạy' }));
      await waitFor(() => expect(loc()).toBe('/browse?q=nuoc&sort=best_seller'));
      expect(screen.getByRole('searchbox')).toHaveValue('nuoc');
      expect(screen.queryByRole('button', { name: 'Huỷ' })).toBeNull();
    });

    it('cùng tình huống với chip lọc đang bật: gỡ chip thoát chế độ gõ và ô tìm trả về q đang lọc', async () => {
      renderAt('/browse?q=nuoc&brand=Tubu');
      await listPainted();
      const input = screen.getByRole('searchbox');
      fireEvent.focus(input);
      fireEvent.change(input, { target: { value: '' } });
      fireEvent.click(screen.getByRole('button', { name: 'Bỏ lọc Tubu' }));
      await waitFor(() => expect(loc()).toBe('/browse?q=nuoc'));
      expect(screen.getByRole('searchbox')).toHaveValue('nuoc');
      expect(screen.queryByRole('button', { name: 'Huỷ' })).toBeNull();
    });

    it('có lịch sử + ô trống → vẫn hiện lịch sử (thay nội dung hub)', async () => {
      localStorage.setItem('tubu_recent_searches', JSON.stringify(['nước rửa']));
      renderAt('/browse');
      await hubVisible();
      fireEvent.focus(screen.getByRole('searchbox'));
      expect(await screen.findByRole('region', { name: 'Gợi ý tìm kiếm' })).toBeInTheDocument();
      expect(screen.queryByRole('region', { name: 'Danh mục' })).toBeNull();
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
      renderAt('/browse?all=1');
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

  describe('API sản phẩm lỗi ở lần tải đầu (D6-08)', () => {
    it('hiện khối lỗi + "Thử lại" và KHÔNG ghi "0 sản phẩm" (khách không nghĩ cửa hàng hết hàng)', async () => {
      mocks.fetchCatalog.mockRejectedValue(new Error('network'));
      renderAt('/browse?all=1');
      expect(await screen.findByRole('button', { name: 'Thử lại' })).toBeInTheDocument();
      expect(screen.queryByText('0 sản phẩm')).toBeNull();
      expect(screen.getByTestId('result-count').textContent?.trim()).toBe('');
    });
  });

  describe('khung chờ Danh mục', () => {
    it('dựng đúng số ô của lần tải trước (không mặc định 4) khi danh sách danh mục còn đang tải', async () => {
      localStorage.setItem(CATEGORY_COUNT_KEY, '6');
      mocks.fetchCategories.mockReturnValue(new Promise(() => undefined));
      renderAt('/browse');
      const grid = await screen.findByTestId('category-grid-loading');
      expect(grid.children).toHaveLength(7); // 6 ô của lần tải trước + ô "Tất cả"
      expect(mocks.fetchCatalog).not.toHaveBeenCalled();
    });
  });

  describe('Review Focus 4b — quay lại từ trang sản phẩm', () => {
    it('mở lại URL đã lưu (Back) phục hồi ĐỦ q, sắp xếp và bộ lọc: ô tìm, chip sắp xếp, chip lọc, tham số gọi API', async () => {
      renderAt('/browse?q=nuoc&sort=newest&inStock=1&rating=4&minPrice=100000&maxPrice=200000&brand=Tubu');
      expect(screen.getByRole('searchbox')).toHaveValue('nuoc');
      await listPainted();
      expect(screen.getByRole('button', { name: 'Mới' })).toHaveAttribute('aria-pressed', 'true');
      for (const chip of ['Bỏ lọc Tubu', 'Bỏ lọc Còn hàng', 'Bỏ lọc Từ 4★']) expect(screen.getByRole('button', { name: chip })).toBeInTheDocument();
      expect(catalogCalls()[0]).toMatchObject({
        q: 'nuoc', sort: 'newest', inStock: true, minRating: 4, minPrice: 100000, maxPrice: 200000, brand: 'Tubu',
      });
    });

    it('đổi sắp xếp / áp bộ lọc / gỡ chip / gửi tìm kiếm đều là REPLACE — không chồng thêm mục lịch sử', async () => {
      renderAt('/browse?all=1');
      await listPainted();
      expect(navType()).toBe('POP'); // đối chứng: mới vào trang

      fireEvent.click(screen.getByRole('button', { name: 'Mới' }));
      await waitFor(() => expect(loc()).toBe('/browse?sort=newest'));
      expect(navType()).toBe('REPLACE');

      fireEvent.click(screen.getByRole('button', { name: 'Lọc' }));
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

      const scroller = () => document.querySelector('.zaui-page') as HTMLElement;
      /** jsdom không có layout: đặt toạ độ khung nhìn của điểm đánh dấu đầu danh sách và mép dưới hàng ô tìm dính. */
      const placeAt = (sentinelTop: number, stuckBottom: number) => {
        const rect = (v: Partial<DOMRect>) => ({ top: 0, bottom: 0, left: 0, right: 0, width: 0, height: 0, x: 0, y: 0, toJSON: () => ({}), ...v }) as DOMRect;
        vi.spyOn(screen.getByTestId('browse-list-top'), 'getBoundingClientRect').mockReturnValue(rect({ top: sentinelTop }));
        vi.spyOn(screen.getByTestId('browse-search-row'), 'getBoundingClientRect').mockReturnValue(rect({ bottom: stuckBottom }));
      };

      it('đổi sắp xếp khi đang cuộn sâu: về đầu danh sách (thanh sắp xếp chạm thanh dính), không giữ vị trí cũ làm khuất hai hàng đầu', async () => {
        renderAt('/browse?all=1');
        await listPainted();
        const s = scroller();
        s.scrollTop = 2000;
        placeAt(140 - 2000, 58); // đầu danh sách nằm ở y=140 của trang; hàng ô tìm dính cao tới 58
        fireEvent.click(screen.getByRole('button', { name: 'Mới' }));
        expect(s.scrollTop).toBe(140 - 58);
        await waitFor(() => expect(loc()).toBe('/browse?sort=newest'));
        expect(navType()).toBe('REPLACE');
      });

      it('áp bộ lọc và gỡ chip lọc khi đang cuộn sâu cũng về đầu danh sách', async () => {
        renderAt('/browse?inStock=1');
        await listPainted();
        const s = scroller();
        s.scrollTop = 1500;
        placeAt(180 - 1500, 58);
        fireEvent.click(screen.getByRole('button', { name: 'Bỏ lọc Còn hàng' }));
        expect(s.scrollTop).toBe(180 - 58);
        await waitFor(() => expect(loc()).toBe('/browse?all=1'));

        s.scrollTop = 1200;
        placeAt(180 - 1200, 58);
        fireEvent.click(await screen.findByRole('button', { name: 'Lọc' }));
        fireEvent.click(await screen.findByRole('button', { name: 'Chỉ hiện còn hàng' }));
        s.scrollTop = 1200;
        fireEvent.click(await screen.findByRole('button', { name: /^Xem 2 sản phẩm$/ }, { timeout: 2000 }));
        expect(s.scrollTop).toBe(180 - 58);
      });

      it('khách còn ở gần đầu trang (chưa cuộn qua đầu danh sách) đổi sắp xếp: không bị kéo đi đâu', async () => {
        renderAt('/browse?all=1');
        await listPainted();
        const s = scroller();
        s.scrollTop = 30;
        placeAt(140 - 30, 58);
        fireEvent.click(screen.getByRole('button', { name: 'Bán chạy' }));
        expect(s.scrollTop).toBe(30);
        await waitFor(() => expect(loc()).toBe('/browse?sort=best_seller'));
      });

      it('hub cũng khôi phục theo khoá rỗng khi mở lại bằng Back, ngay khi hub đã vẽ (không cần danh sách)', async () => {
        const values = new WeakMap<Element, number>();
        Object.defineProperty(Element.prototype, 'scrollTop', {
          configurable: true,
          get(this: Element) { return this.isConnected ? values.get(this) ?? 0 : 0; },
          set(this: Element, v: number) { values.set(this, v); },
        });
        sessionStorage.setItem(SCROLL_KEY_PREFIX, '420');
        renderAt('/browse');
        const scroller = document.querySelector('.zaui-page') as HTMLElement;
        await screen.findByRole('region', { name: 'Danh mục' });
        expect(scroller.scrollTop).toBe(420);
        expect(mocks.fetchCatalog).not.toHaveBeenCalled();
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
        fireEvent.click(screen.getByRole('button', { name: 'Huỷ' }));
        await listPainted();
        expect(scroller.scrollTop).toBe(500);
      });
    });
  });
});
