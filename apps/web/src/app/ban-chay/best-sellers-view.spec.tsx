// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { byText, click, flush, render, type Rendered } from '@/test-utils/dom';

// Bản web của pages/best-sellers.spec.tsx (Mini App): tab danh mục tầng 1 trên URL, thẻ hạng 1..n theo vị trí thật, "Xem thêm" ở điện
// thoại, liên kết trang số cho lg, trạng thái rỗng/lỗi, cây danh mục rỗng như PROD.

const nav = vi.hoisted(() => ({
  search: '',
  replaces: [] as string[],
  listeners: new Set<() => void>(),
}));
vi.mock('next/navigation', async () => {
  const React = await import('react');
  return {
    usePathname: () => '/ban-chay',
    useRouter: () => ({
      push: vi.fn(),
      replace: (url: string) => {
        nav.replaces.push(url);
        nav.search = url.includes('?') ? url.slice(url.indexOf('?') + 1) : '';
        nav.listeners.forEach((l) => l());
      },
    }),
    useSearchParams: () =>
      new URLSearchParams(
        React.useSyncExternalStore(
          (cb) => {
            nav.listeners.add(cb);
            return () => nav.listeners.delete(cb);
          },
          () => nav.search,
          () => nav.search,
        ),
      ),
  };
});

const http = vi.hoisted(() => ({ get: vi.fn() }));
vi.mock('@/lib/core-http', () => ({ coreHttp: { get: http.get } }));
vi.mock('@/lib/use-flash-sales', () => ({ useActiveFlashSales: () => [] }));
vi.mock('@/lib/auth-phase', () => ({ useAuthPhase: () => 'guest' }));

import BestSellersView from './best-sellers-view';

const product = (n: number) => ({
  id: `p${n}`, slug: `sp-${n}`, brand: 'Tubu', name: `Sản phẩm ${n}`, thumbnail: null, basePrice: 100000 + n,
  salePrice: null, isFeatured: false, inStock: true,
});
const pageOf = (from: number, count: number, page: number, total: number) => ({
  data: Array.from({ length: count }, (_, i) => product(from + i)),
  meta: { page, limit: 20, total },
});
const cat = (id: string, name: string, productCount = 5) => ({ id, parentId: null, name, slug: id, image: null, sortOrder: 1, productCount, children: [] });
const TREE = [cat('c-skin', 'Chăm sóc da'), cat('c-baby', 'Cho bé'), cat('c-empty', 'Hết hàng', 0)];

let routes: Record<string, (query: Record<string, unknown> | undefined) => unknown>;
const productCalls = () => http.get.mock.calls.filter(([p]) => p === '/products').map(([, o]) => o?.query as Record<string, unknown>);

let mounted: Rendered | null = null;
const mount = (props: Parameters<typeof BestSellersView>[0] = {}) => {
  mounted = render(<BestSellersView {...props} />);
  return mounted;
};
const ranks = (root: ParentNode) => Array.from(root.querySelectorAll('[data-ds-part="rank"]')).map((n) => n.textContent);
const tab = (root: ParentNode, name: string) =>
  [...root.querySelectorAll<HTMLElement>('[role="tablist"][aria-label="Danh mục bán chạy"] [role="tab"]')].find((t) => t.textContent === name) ?? null;

beforeEach(() => {
  nav.search = '';
  nav.replaces = [];
  localStorage.clear();
  http.get.mockReset().mockImplementation(async (path: string, opts?: { query?: Record<string, unknown> }) => {
    const handler = routes[path];
    if (!handler) throw new Error(`đường dẫn lạ ${path}`);
    return handler(opts?.query);
  });
  routes = {
    '/products': (q) => {
      if (q?.category === 'c-baby') return pageOf(100, 3, 1, 3);
      return Number(q?.page) === 2 ? pageOf(21, 20, 2, 45) : pageOf(1, 20, 1, 45);
    },
    '/categories': () => TREE,
    '/flash-sales/active': () => [],
  };
});
afterEach(() => {
  mounted?.unmount();
  mounted = null;
});

describe('BestSellersView — tiêu đề, tab, hạng', () => {
  it('h1 "Bán chạy nhất", breadcrumb, 20 thẻ hạng #1..#20, một lời gọi sort=best_seller_30d limit 20', async () => {
    const { container } = mount();
    await flush();
    expect(container.querySelector('h1')!.textContent).toBe('Bán chạy nhất');
    expect(container.querySelector('nav[aria-label="Breadcrumb"] a[href="/"]')!.textContent).toBe('Trang chủ');
    expect(ranks(container).slice(0, 3)).toEqual(['#1', '#2', '#3']);
    expect(ranks(container)).toHaveLength(20);
    expect(productCalls()).toEqual([{ sort: 'best_seller_30d', limit: 20, page: 1 }]);
  });

  it('tab: tablist có tên, "Tất cả" đang chọn, danh mục hết hàng không thành tab', async () => {
    const { container } = mount();
    await flush();
    const labels = [...container.querySelectorAll('[role="tablist"][aria-label="Danh mục bán chạy"] [role="tab"]')].map((t) => t.textContent);
    expect(labels).toEqual(['Tất cả', 'Chăm sóc da', 'Cho bé']);
    expect(tab(container, 'Tất cả')!.getAttribute('aria-selected')).toBe('true');
    expect(tab(container, 'Cho bé')!.getAttribute('aria-selected')).toBe('false');
  });

  it('chạm tab ghi ?category= bằng replace (không cuộn), bỏ page, tải lại theo danh mục và đánh hạng lại từ #1; "Tất cả" gỡ tham số', async () => {
    nav.search = 'page=2';
    const { container } = mount();
    await flush();
    click(tab(container, 'Cho bé'));
    await flush();
    expect(nav.replaces.at(-1)).toBe('/ban-chay?category=c-baby');
    expect(tab(container, 'Cho bé')!.getAttribute('aria-selected')).toBe('true');
    expect(productCalls().at(-1)).toEqual({ sort: 'best_seller_30d', limit: 20, page: 1, category: 'c-baby' });
    expect(ranks(container)).toEqual(['#1', '#2', '#3']);
    expect(container.querySelector('[role="tabpanel"]')!.getAttribute('aria-label')).toBe('Cho bé');
    click(tab(container, 'Tất cả'));
    await flush();
    expect(nav.replaces.at(-1)).toBe('/ban-chay');
  });

  it('chạm tab khác khi đã cuộn xuống: về đầu trang (window.scrollTo top 0); đang ở đầu trang hoặc chạm lại tab đang chọn thì không cuộn', async () => {
    const scrollTo = vi.spyOn(window, 'scrollTo').mockImplementation(() => {});
    const scrollY = vi.spyOn(window, 'scrollY', 'get');
    try {
      const { container } = mount();
      await flush();
      scrollY.mockReturnValue(0);
      click(tab(container, 'Cho bé'));
      await flush();
      expect(scrollTo).not.toHaveBeenCalled();

      scrollY.mockReturnValue(900);
      click(tab(container, 'Cho bé'));
      await flush();
      expect(scrollTo).not.toHaveBeenCalled();

      click(tab(container, 'Tất cả'));
      await flush();
      expect(scrollTo).toHaveBeenCalledTimes(1);
      expect(scrollTo).toHaveBeenCalledWith(expect.objectContaining({ top: 0 }));
    } finally {
      scrollTo.mockRestore();
      scrollY.mockRestore();
    }
  });

  it('đang lọc theo danh mục mà cây chưa về: vùng danh sách mang tên trang chứ không phải "Tất cả"; cây về thì mang tên danh mục', async () => {
    nav.search = 'category=c-baby';
    let release!: () => void;
    routes['/categories'] = () => new Promise((resolve) => { release = () => resolve(TREE); });
    const { container } = mount();
    await flush();
    expect(container.querySelector('[role="tabpanel"]')!.getAttribute('aria-label')).toBe('Bán chạy nhất');
    release();
    await flush();
    expect(container.querySelector('[role="tabpanel"]')!.getAttribute('aria-label')).toBe('Cho bé');
  });

  it('vào thẳng ?category=<gốc>: tab đó được chọn; id lạ sau khi cây tải thì "Tất cả" không lọc', async () => {
    nav.search = 'category=c-baby';
    const first = mount();
    await flush();
    expect(tab(first.container, 'Cho bé')!.getAttribute('aria-selected')).toBe('true');
    expect(productCalls().at(-1)).toMatchObject({ category: 'c-baby' });
    first.unmount();

    http.get.mockClear();
    nav.search = 'category=da-xoa';
    const second = mount();
    await flush();
    expect(tab(second.container, 'Tất cả')!.getAttribute('aria-selected')).toBe('true');
    expect(productCalls().at(-1)).toEqual({ sort: 'best_seller_30d', limit: 20, page: 1 });
  });

  it('cây danh mục rỗng (như PROD): chỉ còn tab "Tất cả" và danh sách vẫn hiện', async () => {
    routes['/categories'] = () => [];
    const { container } = mount();
    await flush();
    expect(container.querySelectorAll('[role="tablist"] [role="tab"]')).toHaveLength(1);
    expect(ranks(container)).toHaveLength(20);
  });
});

describe('BestSellersView — dữ liệu server, trang số, Xem thêm', () => {
  it('server đưa sẵn trang đầu (initial) thì không gọi /products lần đầu', async () => {
    const { container } = mount({ initial: { category: undefined, startPage: 1, page: pageOf(1, 20, 1, 45) }, categories: TREE });
    expect(ranks(container)).toHaveLength(20);
    await flush();
    expect(productCalls()).toEqual([]);
  });

  it('?page=2 từ server: hạng tiếp nối #21, có Trang trước về /ban-chay và dãy số trang giữ danh mục', async () => {
    nav.search = 'category=c-skin&page=2';
    routes['/products'] = () => pageOf(21, 20, 2, 45);
    const { container } = mount({ initial: { category: 'c-skin', startPage: 2, page: pageOf(21, 20, 2, 45) }, categories: TREE });
    await flush();
    expect(ranks(container)[0]).toBe('#21');
    expect(ranks(container)[19]).toBe('#40');
    const pager = container.querySelector('nav[aria-label="Phân trang"]')!;
    expect(pager.querySelector('a[rel="prev"]')!.getAttribute('href')).toBe('/ban-chay?category=c-skin');
    expect(pager.querySelector('a[aria-label="Trang 1"]')!.getAttribute('href')).toBe('/ban-chay?category=c-skin');
    expect(pager.querySelector('a[aria-label="Trang 3"]')!.getAttribute('href')).toBe('/ban-chay?category=c-skin&page=3');
    expect(pager.querySelector('a[aria-label="Trang 2"]')!.getAttribute('aria-current')).toBe('page');
  });

  it('"Xem thêm" (chỉ điện thoại) tải trang kế: hạng tiếp nối #21, hạng trang 1 giữ nguyên, focus vào thẻ đầu của trang mới', async () => {
    const { container } = mount();
    await flush();
    const more = byText(container, 'button', 'Xem thêm')!;
    expect(more.parentElement!.className).toContain('lg:hidden');
    expect(more.className, 'cùng nút phụ của Mini (khổ điện thoại giống Mini App)').toContain('zaui-btn-secondary');
    click(more);
    await flush();
    expect(productCalls().at(-1)).toMatchObject({ page: 2 });
    expect(ranks(container)).toHaveLength(40);
    expect(ranks(container)[20]).toBe('#21');
    expect(document.activeElement).toBe(container.querySelector('ul[data-testid="catalog-grid"] li:nth-child(21) a'));
  });
});

describe('BestSellersView — rỗng và lỗi', () => {
  it('không có món nào: "Chưa đủ lượt bán để xếp hạng" + lối "Xem sản phẩm trong danh mục" (theo danh mục đang chọn)', async () => {
    routes['/products'] = () => ({ data: [], meta: { page: 1, limit: 20, total: 0 } });
    const first = mount();
    await flush();
    expect(first.container.textContent).toContain('Chưa đủ lượt bán để xếp hạng');
    expect(byText(first.container, 'a', 'Xem sản phẩm trong danh mục')!.getAttribute('href')).toBe('/san-pham?all=1');
    first.unmount();

    nav.search = 'category=c-baby';
    const second = mount();
    await flush();
    expect(byText(second.container, 'a', 'Xem sản phẩm trong danh mục')!.getAttribute('href')).toBe('/san-pham?category=c-baby');
  });

  it('lỗi tải trang đầu: có "Thử lại" và sau đó hiện danh sách', async () => {
    let fail = true;
    routes['/products'] = () => {
      if (fail) throw Object.assign(new Error('500'), { status: 500 });
      return pageOf(1, 20, 1, 45);
    };
    const { container } = mount();
    await flush();
    const retry = byText(container, 'button', 'Thử lại')!;
    expect(retry).not.toBeNull();
    fail = false;
    click(retry);
    await flush();
    expect(ranks(container)).toHaveLength(20);
  });

  it('lỗi ở "Xem thêm": danh sách đã tải giữ nguyên, báo lỗi và "Thử lại" tại chỗ', async () => {
    const { container } = mount();
    await flush();
    let fail = true;
    routes['/products'] = (q) => {
      if (Number(q?.page) === 2 && fail) throw Object.assign(new Error('500'), { status: 500 });
      return pageOf(21, 20, 2, 45);
    };
    click(byText(container, 'button', 'Xem thêm'));
    await flush();
    const alert = container.querySelector('[role="alert"]')!;
    expect(alert).not.toBeNull();
    expect(ranks(container)).toHaveLength(20);
    fail = false;
    click(byText(alert, 'button', 'Thử lại'));
    await flush();
    expect(ranks(container)).toHaveLength(40);
  });

  it('dòng thước đo: "Theo lượt bán 30 ngày qua"; API cũ từ chối best_seller_30d (400) thì lùi về best_seller và ghi "Theo tổng lượt bán"', async () => {
    const first = mount();
    await flush();
    expect(first.container.textContent).toContain('Theo lượt bán 30 ngày qua');
    expect(first.container.textContent).not.toContain('Theo tổng lượt bán');
    first.unmount();

    routes['/products'] = (q) => {
      if (q?.sort === 'best_seller_30d') throw Object.assign(new Error('400'), { status: 400 });
      return pageOf(1, 20, 1, 45);
    };
    const legacy = mount();
    await flush();
    expect(productCalls().map((q) => q?.sort)).toContain('best_seller');
    expect(legacy.container.textContent).toContain('Theo tổng lượt bán');
    expect(legacy.container.textContent).not.toContain('Theo lượt bán 30 ngày qua');
  });
});
