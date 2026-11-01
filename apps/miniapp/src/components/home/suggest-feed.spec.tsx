import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type * as ZmpUi from 'zmp-ui';
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mocks = vi.hoisted(() => ({
  fetchCatalog: vi.fn(),
  fetchForYou: vi.fn(),
  fetchCategories: vi.fn(),
  navigate: vi.fn(),
  authStatus: 'guest' as string,
  // 08:00 ngày 01/11/2026 giờ Việt Nam.
  now: Date.parse('2026-11-01T01:00:00.000Z'),
}));
vi.mock('zmp-ui', async (importOriginal) => ({ ...(await importOriginal<typeof ZmpUi>()), useNavigate: () => mocks.navigate }));
vi.mock('../../services/shop-api', () => ({
  fetchCatalog: mocks.fetchCatalog,
  fetchForYou: mocks.fetchForYou,
  fetchCategories: mocks.fetchCategories,
  fetchActiveFlashSales: vi.fn().mockResolvedValue([]),
}));
vi.mock('../../store/auth', () => ({
  useAuthStore: (sel: (s: { status: string }) => unknown) => sel({ status: mocks.authStatus }),
}));
vi.mock('../../utils/server-clock', () => ({ serverNow: () => mocks.now }));
vi.mock('../wishlist-heart', () => ({ WishlistHeart: () => null }));
vi.mock('../../utils/haptic', () => ({ haptic: vi.fn() }));

import { SuggestFeed } from './suggest-feed';

const card = (n: number) => ({
  id: `p${n}`, slug: `sp-${n}`, brand: 'Tubu', name: `Sản phẩm ${n}`, thumbnail: null, basePrice: 100000, salePrice: null, isFeatured: false, inStock: true,
});
const cards = (from: number, n: number) => Array.from({ length: n }, (_, i) => card(from + i));
const page = (data: unknown[], extra: Record<string, number> = {}) => ({ data, meta: { page: 1, limit: 20, total: data.length, ...extra }, filtersIgnored: false });
const cat = (id: string, name: string, productCount: number, parentId: string | null = null) => ({ id, parentId, name, slug: id, image: null, sortOrder: 1, productCount });

const mount = (exclude: ReadonlySet<string> = new Set()) =>
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <SuggestFeed exclude={exclude} />
    </QueryClientProvider>,
  );

describe('SuggestFeed — Gợi ý hôm nay (Q9)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    mocks.authStatus = 'guest';
    mocks.fetchForYou.mockResolvedValue([]);
    mocks.fetchCategories.mockResolvedValue([]);
    mocks.fetchCatalog.mockResolvedValue(page(cards(1, 4)));
  });

  it('tiêu đề "Gợi ý hôm nay"; mọi lời gọi gửi seed là ngày Việt Nam YYYYMMDD; hai lần mở cùng ngày gửi cùng seed', async () => {
    const first = mount();
    expect(await screen.findByRole('heading', { level: 2, name: 'Gợi ý hôm nay' })).toBeInTheDocument();
    await waitFor(() => expect(mocks.fetchCatalog).toHaveBeenCalled());
    expect(mocks.fetchCatalog).toHaveBeenCalledWith({ page: 1, limit: 20, seed: '20261101' });
    first.unmount();
    mount();
    await waitFor(() => expect(mocks.fetchCatalog).toHaveBeenCalledTimes(2));
    expect(mocks.fetchCatalog.mock.calls[1]![0]).toEqual(mocks.fetchCatalog.mock.calls[0]![0]);
  });

  it('lưới ở cuối trang: chưa tới gần màn thì không gọi API (lần mở Trang chủ bớt một request), chỉ có tiêu đề và chip, chưa có khung chờ; cách màn một màn hình thì tải', async () => {
    mocks.authStatus = 'authenticated';
    const observers: { cb: IntersectionObserverCallback; margin?: string; els: Element[] }[] = [];
    vi.stubGlobal(
      'IntersectionObserver',
      class {
        els: Element[] = [];
        constructor(cb: IntersectionObserverCallback, opts?: IntersectionObserverInit) {
          observers.push({ cb, margin: opts?.rootMargin, els: this.els });
        }
        observe(el: Element) {
          this.els.push(el);
        }
        disconnect() {}
      },
    );
    try {
      mount();
      expect(await screen.findByRole('heading', { level: 2, name: 'Gợi ý hôm nay' })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Tất cả' })).toBeInTheDocument();
      expect(screen.queryByTestId('catalog-grid-skeleton')).toBeNull();
      await new Promise((r) => setTimeout(r, 30));
      expect(mocks.fetchCatalog).not.toHaveBeenCalled();
      expect(mocks.fetchForYou).not.toHaveBeenCalled();
      const near = observers.find((o) => o.els.some((el) => el.tagName === 'SECTION'))!;
      expect(near.margin).toBe('100% 0px');
      near.cb([{ isIntersecting: true } as IntersectionObserverEntry], {} as IntersectionObserver);
      await waitFor(() => expect(mocks.fetchCatalog).toHaveBeenCalledWith({ page: 1, limit: 20, seed: '20261101' }));
      expect(mocks.fetchForYou).toHaveBeenCalledWith({ seed: '20261101' });
      expect(await screen.findByText('Sản phẩm 1')).toBeInTheDocument();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('chip: "Tất cả" rồi danh mục tầng 1 nhiều hàng nhất; danh mục con không thành chip; đổi chip lọc theo category kèm seed', async () => {
    mocks.fetchCategories.mockResolvedValue([cat('c1', 'Mẹ và bé', 5), cat('c2', 'Tẩy rửa', 9), cat('c3', 'Con của mẹ bé', 50, 'c1')]);
    mount();
    const chips = await screen.findByRole('region', { name: 'Lọc gợi ý theo danh mục' });
    await waitFor(() => expect(chips.querySelectorAll('button')).toHaveLength(3));
    expect(Array.from(chips.querySelectorAll('button')).map((b) => b.textContent)).toEqual(['Tất cả', 'Tẩy rửa', 'Mẹ và bé']);
    fireEvent.click(screen.getByRole('button', { name: 'Tẩy rửa' }));
    await waitFor(() => expect(mocks.fetchCatalog).toHaveBeenLastCalledWith({ page: 1, limit: 20, seed: '20261101', category: 'c2' }));
  });

  it('chưa có danh mục nào: chỉ chip "Tất cả"', async () => {
    mount();
    const chips = await screen.findByRole('region', { name: 'Lọc gợi ý theo danh mục' });
    expect(chips.querySelectorAll('button')).toHaveLength(1);
  });

  it('hàng chip dính ngay dưới header 56px khi lưới cuộn tới', async () => {
    mount();
    const chips = await screen.findByRole('region', { name: 'Lọc gợi ý theo danh mục' });
    expect(chips).toHaveStyle({ position: 'sticky', top: 'calc(var(--safe-top) + 56px)' });
  });

  it('món có slug trong exclude (đã nằm ở kệ trên) không vẽ ở lưới', async () => {
    mount(new Set(['sp-2']));
    expect(await screen.findByRole('button', { name: 'Sản phẩm 1' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Sản phẩm 2' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Sản phẩm 3' })).toBeInTheDocument();
  });

  it('dừng ở 100 món: không còn "Xem thêm", có dòng hết gợi ý và nút "Vào Danh mục" tới /browse', async () => {
    mocks.fetchCatalog.mockResolvedValue(page(cards(1, 120), { limit: 120, total: 240 }));
    mount();
    await screen.findByRole('button', { name: 'Sản phẩm 1' });
    expect(screen.getAllByRole('button', { name: /^Sản phẩm \d+$/ })).toHaveLength(100);
    expect(screen.queryByRole('button', { name: 'Xem thêm' })).toBeNull();
    expect(screen.getByText('Bạn đã xem hết gợi ý hôm nay')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Vào Danh mục' }));
    expect(mocks.navigate).toHaveBeenCalledWith('/browse');
  });

  it('còn trang sau và chưa tới trần: có "Xem thêm"; chưa hết thì không báo hết', async () => {
    mocks.fetchCatalog.mockResolvedValue(page(cards(1, 20), { total: 60 }));
    mount();
    expect(await screen.findByRole('button', { name: 'Xem thêm' })).toBeInTheDocument();
    expect(screen.queryByText('Bạn đã xem hết gợi ý hôm nay')).toBeNull();
  });

  it('đã tải hết mà chưa tới 100 món: báo hết và mời vào Danh mục', async () => {
    mount();
    await screen.findByRole('button', { name: 'Sản phẩm 1' });
    expect(screen.getByText('Bạn đã xem hết gợi ý hôm nay')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Vào Danh mục' })).toBeInTheDocument();
  });

  it('khách đã đăng nhập: gợi ý cá nhân kèm seed đứng đầu ở chip "Tất cả", không có ở chip danh mục', async () => {
    mocks.authStatus = 'authenticated';
    mocks.fetchCategories.mockResolvedValue([cat('c1', 'Tẩy rửa', 9)]);
    mocks.fetchForYou.mockResolvedValue([card(99)]);
    mount();
    await screen.findByRole('button', { name: 'Sản phẩm 99' });
    expect(mocks.fetchForYou).toHaveBeenCalledWith({ seed: '20261101' });
    const names = screen.getAllByRole('button', { name: /^Sản phẩm \d+$/ }).map((b) => b.getAttribute('aria-label') ?? b.textContent);
    expect(names[0]).toMatch(/Sản phẩm 99/);
    fireEvent.click(screen.getByRole('button', { name: 'Tẩy rửa' }));
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Sản phẩm 99' })).toBeNull());
  });

  it('trang 1 toàn món đã nằm ở kệ trên nhưng còn trang sau: tải tiếp và hiện món của trang 2, không ẩn khối', async () => {
    mocks.fetchCatalog.mockImplementation(async ({ page: n }: { page: number }) =>
      n === 2 ? { data: cards(21, 3), meta: { page: 2, limit: 20, total: 23 }, filtersIgnored: false } : page(cards(1, 20), { total: 23 }),
    );
    mount(new Set(cards(1, 20).map((c) => c.slug)));
    expect(await screen.findByRole('button', { name: 'Sản phẩm 21' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Gợi ý hôm nay' })).toBeInTheDocument();
    expect(mocks.fetchCatalog).toHaveBeenCalledTimes(2);
  });

  it('mọi trang đều là món đã nằm ở kệ trên và hết trang: ẩn khối sau khi tải hết', async () => {
    mocks.fetchCatalog.mockResolvedValue(page(cards(1, 4)));
    const { container } = mount(new Set(cards(1, 4).map((c) => c.slug)));
    await waitFor(() => expect(container).toBeEmptyDOMElement());
  });

  it('đã tải xong, rỗng, không lỗi → ẩn cả khối: không tiêu đề, không chip', async () => {
    mocks.fetchCatalog.mockResolvedValue(page([]));
    const { container } = mount();
    await waitFor(() => expect(container).toBeEmptyDOMElement());
  });

  it('đang tải → vẫn giữ tiêu đề, chip và khung chờ (trang không nhảy)', () => {
    mocks.fetchCatalog.mockReturnValue(new Promise(() => undefined));
    mount();
    expect(screen.getByRole('heading', { name: 'Gợi ý hôm nay' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Tất cả' })).toBeInTheDocument();
    expect(screen.getByTestId('catalog-grid-skeleton')).toBeInTheDocument();
  });

  it('lỗi tải (không phải rỗng) → vẫn hiện khối lỗi kèm "Thử lại", không mất khối im lặng', async () => {
    mocks.fetchCatalog.mockRejectedValue(new Error('x'));
    mount();
    expect(await screen.findByRole('button', { name: /Thử lại/ })).toBeInTheDocument();
    expect(screen.getByTestId('home-block-error')).toBeInTheDocument();
  });
});
