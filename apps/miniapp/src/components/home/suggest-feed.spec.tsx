import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import type * as ZmpUi from 'zmp-ui';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const mocks = vi.hoisted(() => ({
  fetchCatalog: vi.fn(),
  fetchForYou: vi.fn(),
  navigate: vi.fn(),
  authStatus: 'guest' as string,
  navType: 'POP' as string,
  // 08:00 ngày 01/11/2026 giờ Việt Nam.
  now: Date.parse('2026-11-01T01:00:00.000Z'),
}));
vi.mock('zmp-ui', async (importOriginal) => ({ ...(await importOriginal<typeof ZmpUi>()), useNavigate: () => mocks.navigate }));
vi.mock('../../services/shop-api', () => ({
  fetchCatalog: mocks.fetchCatalog,
  fetchForYou: mocks.fetchForYou,
  fetchActiveFlashSales: vi.fn().mockResolvedValue([]),
}));
vi.mock('../../store/auth', () => ({
  useAuthStore: (sel: (s: { status: string }) => unknown) => sel({ status: mocks.authStatus }),
}));
vi.mock('../../hooks/use-navigation-type', () => ({ useNavigationType: () => mocks.navType }));
vi.mock('../../utils/server-clock', () => ({ serverNow: () => mocks.now }));
vi.mock('../wishlist-heart', () => ({ WishlistHeart: () => null }));
vi.mock('../../utils/haptic', () => ({ haptic: vi.fn() }));

import { SuggestFeed, suggestPagesKey } from './suggest-feed';

const TITLE = 'Gợi ý cho bạn';
const card = (n: number) => ({
  id: `p${n}`, slug: `sp-${n}`, brand: 'Tubu', name: `Sản phẩm ${n}`, thumbnail: null, basePrice: 100000, salePrice: null, isFeatured: false, inStock: true,
});
const cards = (from: number, n: number) => Array.from({ length: n }, (_, i) => card(from + i));
const page = (data: unknown[], extra: Record<string, number> = {}) => ({ data, meta: { page: 1, limit: 20, total: data.length, ...extra }, filtersIgnored: false });
const newClient = () => new QueryClient({ defaultOptions: { queries: { retry: false } } });

const mount = (exclude: ReadonlySet<string> = new Set(), client = newClient(), interleave?: ReactNode) =>
  render(
    <QueryClientProvider client={client}>
      <SuggestFeed exclude={exclude} interleave={interleave} />
    </QueryClientProvider>,
  );

describe('SuggestFeed: "Gợi ý cho bạn", một lưới 2 cột cuối Trang chủ (W47)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.navType = 'POP';
    mocks.authStatus = 'guest';
    mocks.fetchForYou.mockResolvedValue([]);
    mocks.fetchCatalog.mockResolvedValue(page(cards(1, 4)));
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('tiêu đề "Gợi ý cho bạn", không có hàng chip hay khối thương hiệu; mọi lời gọi gửi seed là ngày Việt Nam; hai lần mở cùng ngày gửi cùng seed', async () => {
    const first = mount();
    expect(await screen.findByRole('heading', { level: 2, name: TITLE })).toBeInTheDocument();
    expect(screen.getByTestId('home-suggest')).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: /Lọc gợi ý/ })).toBeNull();
    expect(screen.queryByTestId('home-brand-section')).toBeNull();
    await waitFor(() => expect(mocks.fetchCatalog).toHaveBeenCalled());
    expect(mocks.fetchCatalog).toHaveBeenCalledWith({ page: 1, limit: 20, seed: '20261101' });
    first.unmount();
    mount();
    await waitFor(() => expect(mocks.fetchCatalog).toHaveBeenCalledTimes(2));
    expect(mocks.fetchCatalog.mock.calls[1]![0]).toEqual(mocks.fetchCatalog.mock.calls[0]![0]);
  });

  it('quay lại từ PDP: trang 1 đã có trong cache thì dựng lưới ngay dù IntersectionObserver chưa báo gần màn', async () => {
    vi.stubGlobal('IntersectionObserver', class { observe() {} disconnect() {} });
    const client = newClient();
    client.setQueryData(suggestPagesKey('20261101'), { pages: [page(cards(1, 4))], pageParams: [1] });
    mount(new Set(), client);
    expect(await screen.findByText('Sản phẩm 1')).toBeInTheDocument();
  });

  it('mở mới bằng PUSH: cache trang 1 không làm lưới tải ngay, vẫn chờ khối gần màn', async () => {
    mocks.navType = 'PUSH';
    vi.stubGlobal('IntersectionObserver', class { observe() {} disconnect() {} });
    const client = newClient();
    client.setQueryData(suggestPagesKey('20261101'), { pages: [page(cards(1, 4))], pageParams: [1] });
    mount(new Set(), client);
    expect(await screen.findByRole('heading', { level: 2, name: TITLE })).toBeInTheDocument();
    await new Promise((r) => setTimeout(r, 30));
    expect(screen.queryByText('Sản phẩm 1')).toBeNull();
    expect(mocks.fetchCatalog).not.toHaveBeenCalled();
  });

  it('chưa tới gần màn: không gọi API, chỉ có tiêu đề, chưa có khung chờ; gốc quan sát là khung cuộn `.zaui-page`, cách một màn hình thì tải', async () => {
    mocks.authStatus = 'authenticated';
    const observers: { cb: IntersectionObserverCallback; margin?: string; root: Element | null; els: Element[] }[] = [];
    vi.stubGlobal(
      'IntersectionObserver',
      class {
        els: Element[] = [];
        constructor(cb: IntersectionObserverCallback, opts?: IntersectionObserverInit) {
          observers.push({ cb, margin: opts?.rootMargin, root: (opts?.root as Element | null) ?? null, els: this.els });
        }
        observe(el: Element) {
          this.els.push(el);
        }
        disconnect() {}
      },
    );
    render(
      <QueryClientProvider client={newClient()}>
        <div className="zaui-page" data-testid="scroller">
          <SuggestFeed exclude={new Set()} />
        </div>
      </QueryClientProvider>,
    );
    expect(await screen.findByRole('heading', { level: 2, name: TITLE })).toBeInTheDocument();
    expect(screen.queryByTestId('catalog-grid-skeleton')).toBeNull();
    await new Promise((r) => setTimeout(r, 30));
    expect(mocks.fetchCatalog).not.toHaveBeenCalled();
    expect(mocks.fetchForYou).not.toHaveBeenCalled();
    const near = observers.find((o) => o.els.some((el) => el.tagName === 'SECTION'))!;
    expect(near.margin).toBe('100% 0px');
    expect(near.root).toBe(screen.getByTestId('scroller'));
    near.cb([{ isIntersecting: true } as IntersectionObserverEntry], {} as IntersectionObserver);
    await waitFor(() => expect(mocks.fetchCatalog).toHaveBeenCalledWith({ page: 1, limit: 20, seed: '20261101' }));
    expect(mocks.fetchForYou).toHaveBeenCalledWith({ seed: '20261101' });
    expect(await screen.findByText('Sản phẩm 1')).toBeInTheDocument();
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

  it('trang sau tải lỗi khi sentinel đang trong khung: không tự tải lại liên tục, "Xem thêm" là lối thử lại', async () => {
    vi.stubGlobal(
      'IntersectionObserver',
      class {
        constructor(private cb: IntersectionObserverCallback) {}
        observe() {
          this.cb([{ isIntersecting: true } as IntersectionObserverEntry], this as unknown as IntersectionObserver);
        }
        disconnect() {}
      },
    );
    mocks.fetchCatalog.mockImplementation(async ({ page: n }: { page: number }) => {
      if (n === 1) return page(cards(1, 20), { total: 60 });
      throw new Error('mạng lỗi');
    });
    mount();
    await screen.findByRole('button', { name: 'Sản phẩm 1' });
    const pageTwo = () => mocks.fetchCatalog.mock.calls.filter(([a]) => (a as { page: number }).page === 2).length;
    await waitFor(() => expect(pageTwo()).toBe(1));
    await new Promise((r) => setTimeout(r, 80));
    expect(pageTwo()).toBe(1);
    fireEvent.click(await screen.findByRole('button', { name: 'Xem thêm' }));
    await waitFor(() => expect(pageTwo()).toBe(2));
  });

  it('đã tải hết mà chưa tới 100 món: báo hết và mời vào Danh mục', async () => {
    mount();
    await screen.findByRole('button', { name: 'Sản phẩm 1' });
    expect(screen.getByText('Bạn đã xem hết gợi ý hôm nay')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Vào Danh mục' })).toBeInTheDocument();
  });

  it('khách đã đăng nhập: gợi ý cá nhân kèm seed đứng đầu lưới', async () => {
    mocks.authStatus = 'authenticated';
    mocks.fetchForYou.mockResolvedValue([card(99)]);
    mount();
    await screen.findByRole('button', { name: 'Sản phẩm 99' });
    expect(mocks.fetchForYou).toHaveBeenCalledWith({ seed: '20261101' });
    const names = screen.getAllByRole('button', { name: /^Sản phẩm \d+$/ }).map((b) => b.getAttribute('aria-label') ?? b.textContent);
    expect(names[0]).toMatch(/Sản phẩm 99/);
  });

  it('khách vãng lai: không gọi gợi ý cá nhân', async () => {
    mount();
    await screen.findByRole('button', { name: 'Sản phẩm 1' });
    expect(mocks.fetchForYou).not.toHaveBeenCalled();
  });

  it('trang 1 toàn món đã nằm ở kệ trên nhưng còn trang sau: tải tiếp và hiện món của trang 2, không ẩn khối', async () => {
    mocks.fetchCatalog.mockImplementation(async ({ page: n }: { page: number }) =>
      n === 2 ? { data: cards(21, 3), meta: { page: 2, limit: 20, total: 23 }, filtersIgnored: false } : page(cards(1, 20), { total: 23 }),
    );
    mount(new Set(cards(1, 20).map((c) => c.slug)));
    expect(await screen.findByRole('button', { name: 'Sản phẩm 21' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: TITLE })).toBeInTheDocument();
    expect(mocks.fetchCatalog).toHaveBeenCalledTimes(2);
  });

  it('mọi trang đều là món đã nằm ở kệ trên và hết trang: ẩn khối sau khi tải hết', async () => {
    const { container } = mount(new Set(cards(1, 4).map((c) => c.slug)));
    await waitFor(() => expect(container).toBeEmptyDOMElement());
  });

  it('đã tải xong, rỗng, không lỗi: ẩn cả khối, không để tiêu đề trên khoảng trống', async () => {
    mocks.fetchCatalog.mockResolvedValue(page([]));
    const { container } = mount();
    await waitFor(() => expect(container).toBeEmptyDOMElement());
  });

  it('đang tải: giữ tiêu đề và khung chờ (trang không nhảy)', () => {
    mocks.fetchCatalog.mockReturnValue(new Promise(() => undefined));
    mount();
    expect(screen.getByRole('heading', { name: TITLE })).toBeInTheDocument();
    expect(screen.getByTestId('catalog-grid-skeleton')).toBeInTheDocument();
  });

  it('lỗi tải (không phải rỗng): hiện khối lỗi kèm "Thử lại", không mất khối im lặng', async () => {
    mocks.fetchCatalog.mockRejectedValue(new Error('x'));
    mount();
    expect(await screen.findByRole('button', { name: /Thử lại/ })).toBeInTheDocument();
    expect(screen.getByTestId('home-block-error')).toBeInTheDocument();
  });

  describe('thẻ chen (dải Góc Xanh)', () => {
    const chen = <section aria-label="Thẻ chen">chen</section>;

    it('đủ 8 thẻ trở lên: thẻ chen nằm TRONG lưới, ngay sau thẻ thứ 8 (hết hàng thứ tư của lưới 2 cột)', async () => {
      mocks.fetchCatalog.mockResolvedValue(page(cards(1, 12)));
      mount(new Set(), newClient(), chen);
      const slot = await screen.findByTestId('suggest-interleave');
      expect(screen.getByTestId('catalog-grid')).toContainElement(slot);
      expect(Array.from(slot.parentElement!.children).indexOf(slot)).toBe(8);
      expect(screen.getAllByRole('region', { name: 'Thẻ chen' })).toHaveLength(1);
    });

    it('lưới dưới 8 thẻ: không chen, không có thẻ chen nào trên trang', async () => {
      mocks.fetchCatalog.mockResolvedValue(page(cards(1, 5)));
      mount(new Set(), newClient(), chen);
      await screen.findByTestId('catalog-grid');
      expect(screen.queryByTestId('suggest-interleave')).toBeNull();
      expect(screen.queryByRole('region', { name: 'Thẻ chen' })).toBeNull();
    });

    it('đang tải: chưa có thẻ chen (khung chờ lưới không mang nó)', () => {
      mocks.fetchCatalog.mockReturnValue(new Promise(() => undefined));
      mount(new Set(), newClient(), chen);
      expect(screen.queryByRole('region', { name: 'Thẻ chen' })).toBeNull();
    });
  });
});
