import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, useLocation } from 'react-router-dom';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ navigate: vi.fn(), fetchCategories: vi.fn(), coreGet: vi.fn() }));
vi.mock('zmp-ui', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  Page: ({ children }: { children: ReactNode }) => <div className="zaui-page">{children}</div>,
  useNavigate: () => mocks.navigate,
}));
vi.mock('../services/shop-api', () => ({
  fetchCategories: mocks.fetchCategories,
  fetchActiveFlashSales: vi.fn().mockResolvedValue([]),
  getPublicConfig: vi.fn().mockResolvedValue({}),
  fetchProductsBySlugs: vi.fn().mockResolvedValue([]),
}));
vi.mock('../services/core-http', () => ({ coreHttp: { get: mocks.coreGet } }));
vi.mock('../components/back-button', () => ({ default: () => null }));
vi.mock('../components/pull-to-refresh', () => ({ PullToRefresh: () => null }));
vi.mock('../components/wishlist-heart', () => ({ WishlistHeart: () => null }));
vi.mock('../utils/haptic', () => ({ haptic: vi.fn() }));

import BestSellersPage from './best-sellers';

const FUTURE = { v7_startTransition: true, v7_relativeSplatPath: true } as const;
const card = (n: number) => ({ id: `p${n}`, slug: `p${n}`, brand: 'Tubu', name: `Sản phẩm ${n}`, thumbnail: null, basePrice: 100000, salePrice: null, isFeatured: false, inStock: true });
const pageOf = (from: number, count: number, page: number, total: number) => ({
  data: Array.from({ length: count }, (_, i) => card(from + i)),
  meta: { page, limit: 20, total },
});
const cat = (id: string, name: string, productCount = 5) => ({ id, parentId: null, name, slug: id, image: null, sortOrder: 1, productCount, children: [] });
const TREE = [cat('c-skin', 'Chăm sóc da'), cat('c-baby', 'Cho bé'), cat('c-empty', 'Hết hàng', 0)];

const queryOf = (i: number) => mocks.coreGet.mock.calls[i]![1].query as Record<string, unknown>;
const productCalls = () => mocks.coreGet.mock.calls.filter(([p]) => p === '/products').map(([, o]) => o.query as Record<string, unknown>);
const rankLabels = () => Array.from(document.querySelectorAll('[data-ds-part="rank"]')).map((n) => n.textContent);

function Probe() {
  const loc = useLocation();
  return <div data-testid="loc">{loc.pathname + loc.search}</div>;
}
function renderAt(url = '/best-sellers') {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[url]} future={FUTURE}>
        <BestSellersPage />
        <Probe />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}
const tabs = () => within(screen.getByRole('tablist', { name: 'Danh mục bán chạy' }));
const loc = () => screen.getByTestId('loc').textContent;

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  sessionStorage.clear();
  mocks.fetchCategories.mockResolvedValue(TREE);
  mocks.coreGet.mockImplementation(async (_path: string, opts: { query: Record<string, unknown> }) => {
    const { page, category } = opts.query;
    if (category === 'c-baby') return pageOf(100, 3, 1, 3);
    return page === 2 ? pageOf(21, 20, 2, 45) : pageOf(1, 20, 1, 45);
  });
});

describe('BestSellersPage (Mini)', () => {
  it('khách chưa đăng nhập: tải 20 món theo bán chạy 30 ngày, thẻ có hạng #1, #2, ... và tab "Tất cả" đang chọn', async () => {
    renderAt();
    await screen.findByText('Sản phẩm 1');
    expect(productCalls()).toEqual([{ sort: 'best_seller_30d', limit: 20, page: 1 }]);
    expect(screen.getByRole('heading', { level: 1, name: 'Bán chạy nhất' })).toBeInTheDocument();
    expect(rankLabels().slice(0, 3)).toEqual(['#1', '#2', '#3']);
    expect(rankLabels()).toHaveLength(20);
    await waitFor(() => expect(tabs().getAllByRole('tab').map((t) => t.textContent)).toEqual(['Tất cả', 'Chăm sóc da', 'Cho bé']));
    expect(tabs().getByRole('tab', { name: 'Tất cả' })).toHaveAttribute('aria-selected', 'true');
    expect(tabs().getByRole('tab', { name: 'Cho bé' })).toHaveAttribute('aria-selected', 'false');
  });

  it('chạm tab danh mục: URL ?category= (replace), tab được chọn, tải lại theo danh mục và đánh hạng lại từ #1', async () => {
    renderAt();
    await screen.findByText('Sản phẩm 1');
    fireEvent.click(await tabs().findByRole('tab', { name: 'Cho bé' }));
    await screen.findByText('Sản phẩm 100');
    expect(loc()).toBe('/best-sellers?category=c-baby');
    expect(tabs().getByRole('tab', { name: 'Cho bé' })).toHaveAttribute('aria-selected', 'true');
    expect(productCalls().at(-1)).toEqual({ sort: 'best_seller_30d', limit: 20, page: 1, category: 'c-baby' });
    expect(rankLabels()).toEqual(['#1', '#2', '#3']);
    expect(screen.getByRole('tabpanel', { name: 'Cho bé' })).toBeInTheDocument();

    fireEvent.click(tabs().getByRole('tab', { name: 'Tất cả' }));
    await screen.findByText('Sản phẩm 1');
    expect(loc()).toBe('/best-sellers');
  });

  it('vào thẳng ?category=<gốc>: tab đó được chọn và request mang category; id lạ sau khi cây tải thì về "Tất cả" không lọc', async () => {
    const first = renderAt('/best-sellers?category=c-baby');
    await screen.findByText('Sản phẩm 100');
    expect(tabs().getByRole('tab', { name: 'Cho bé' })).toHaveAttribute('aria-selected', 'true');
    first.unmount();

    mocks.coreGet.mockClear();
    renderAt('/best-sellers?category=da-xoa');
    await screen.findByText('Sản phẩm 1');
    await waitFor(() => expect(tabs().getByRole('tab', { name: 'Tất cả' })).toHaveAttribute('aria-selected', 'true'));
    expect(productCalls().at(-1)).toEqual({ sort: 'best_seller_30d', limit: 20, page: 1 });
  });

  it('cây danh mục rỗng hoặc lỗi (như PROD hiện nay): chỉ còn tab "Tất cả", danh sách vẫn hiện', async () => {
    mocks.fetchCategories.mockResolvedValue([]);
    const first = renderAt();
    await screen.findByText('Sản phẩm 1');
    await waitFor(() => expect(mocks.fetchCategories).toHaveBeenCalled());
    expect(tabs().getAllByRole('tab').map((t) => t.textContent)).toEqual(['Tất cả']);
    first.unmount();

    mocks.fetchCategories.mockRejectedValue(new Error('500'));
    renderAt();
    await screen.findByText('Sản phẩm 1');
    await waitFor(() => expect(tabs().getAllByRole('tab')).toHaveLength(1));
  });

  it('"Xem thêm" tải trang 2: hạng tiếp nối #21, hạng trang 1 giữ nguyên; hết trang thì nút biến mất', async () => {
    renderAt();
    await screen.findByText('Sản phẩm 1');
    fireEvent.click(screen.getByRole('button', { name: 'Xem thêm' }));
    await screen.findByText('Sản phẩm 21');
    expect(productCalls().at(-1)).toMatchObject({ page: 2 });
    expect(rankLabels()).toHaveLength(40);
    expect(rankLabels()[0]).toBe('#1');
    expect(rankLabels()[20]).toBe('#21');
    expect(rankLabels()[39]).toBe('#40');
  });

  it('không có món nào: "Chưa đủ lượt bán để xếp hạng" và lối "Xem sản phẩm trong danh mục" (theo danh mục đang chọn)', async () => {
    mocks.coreGet.mockResolvedValue({ data: [], meta: { page: 1, limit: 20, total: 0 } });
    const first = renderAt();
    await screen.findByText('Chưa đủ lượt bán để xếp hạng');
    fireEvent.click(screen.getByRole('button', { name: 'Xem sản phẩm trong danh mục' }));
    expect(mocks.navigate).toHaveBeenLastCalledWith('/browse?all=1');
    first.unmount();

    renderAt('/best-sellers?category=c-baby');
    await screen.findByText('Chưa đủ lượt bán để xếp hạng');
    fireEvent.click(screen.getByRole('button', { name: 'Xem sản phẩm trong danh mục' }));
    expect(mocks.navigate).toHaveBeenLastCalledWith('/browse?category=c-baby');
  });

  it('lỗi tải trang đầu: có "Thử lại" gọi lại và hiện danh sách', async () => {
    mocks.coreGet.mockRejectedValueOnce(Object.assign(new Error('500'), { status: 500 }));
    renderAt();
    const retry = await screen.findByRole('button', { name: 'Thử lại' });
    fireEvent.click(retry);
    await screen.findByText('Sản phẩm 1');
  });

  it('lỗi ở "Xem thêm": danh sách đã tải giữ nguyên, báo lỗi và "Thử lại" tại chỗ', async () => {
    renderAt();
    await screen.findByText('Sản phẩm 1');
    mocks.coreGet.mockRejectedValueOnce(Object.assign(new Error('500'), { status: 500 }));
    fireEvent.click(screen.getByRole('button', { name: 'Xem thêm' }));
    await screen.findByRole('alert');
    expect(screen.getByText('Sản phẩm 1')).toBeInTheDocument();
    fireEvent.click(within(screen.getByRole('alert')).getByRole('button', { name: 'Thử lại' }));
    await screen.findByText('Sản phẩm 21');
  });

  it('API trước P3a từ chối best_seller_30d (400): trang lùi về best_seller, không trắng', async () => {
    mocks.coreGet.mockImplementation(async (_p: string, opts: { query: Record<string, unknown> }) => {
      if (opts.query.sort === 'best_seller_30d') throw Object.assign(new Error('400'), { status: 400 });
      return pageOf(1, 20, 1, 45);
    });
    renderAt();
    await screen.findByText('Sản phẩm 1');
    expect(productCalls().map((q) => q.sort)).toEqual(['best_seller_30d', 'best_seller']);
  });
});
