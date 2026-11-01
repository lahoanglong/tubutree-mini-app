// @vitest-environment jsdom
import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { byText, click, flush, render, typeInto, type Rendered } from '@/test-utils/dom';
import { smallTouchTargets, unnamedControls, unlabeledFields } from '@/test-utils/a11y';

// Chép ý nghĩa pages/browse.spec.tsx của Mini App: hub ở gốc (không tải danh sách), danh sách có SortBar dính, trạng thái nằm trong
// URL, gõ chỉ hiện gợi ý, Enter mới ghi q, bộ lọc có đếm, tải thêm, cảnh báo filtersIgnored, đã xem gần đây, trạng thái rỗng/lỗi.

const nav = vi.hoisted(() => ({
  search: '',
  replaces: [] as string[],
  pushes: [] as string[],
  listeners: new Set<() => void>(),
}));
vi.mock('next/navigation', async () => {
  const React = await import('react');
  return {
    usePathname: () => '/san-pham',
    useRouter: () => ({
      push: (url: string) => nav.pushes.push(url),
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

import BrowseView from './browse-view';

const product = (n: number) => ({
  id: `p${n}`, slug: `sp-${n}`, brand: 'Tubu', name: `Sản phẩm ${n}`, thumbnail: null, basePrice: 100000 + n,
  salePrice: null, isFeatured: false, inStock: true,
});
const pageOf = <T,>(items: T[], total: number, page = 1, limit = 20) => ({ data: items, meta: { page, limit, total } });
const CATEGORIES = [
  { id: 'c-goi', parentId: null, name: 'Dầu gội', slug: 'dau-goi', image: null, sortOrder: 1, productCount: 4, children: [] },
  { id: 'c-trong', parentId: null, name: 'Danh mục trống', slug: 'trong', image: null, sortOrder: 2, productCount: 0, children: [] },
];
const BRANDS = [{ brand: 'Tubu', count: 3, slug: 'tubu-xanh' }, { brand: 'Mộc An', count: 2 }];
const child = (id: string, name: string, productCount: number) => ({ id, parentId: 'c-da', name, slug: id, image: null, sortOrder: 1, productCount, children: [] });
const TREE = [
  { id: 'c-da', parentId: null, name: 'Chăm sóc da', slug: 'cham-soc-da', image: null, sortOrder: 1, productCount: 6, children: [child('c-rua', 'Rửa mặt', 3), child('c-nang', 'Chống nắng', 3), child('c-het', 'Mặt nạ', 0)] },
  ...CATEGORIES,
];
/** Gốc không tham số là hub; các ca về danh sách mở bằng `?all=1`. */
const LIST = 'all=1';

let routes: Record<string, (query: Record<string, unknown> | undefined) => unknown>;
const productCalls = () => http.get.mock.calls.filter(([p]) => p === '/products').map(([, o]) => o?.query as Record<string, unknown>);

let mounted: Rendered | null = null;
const mount = (props: Parameters<typeof BrowseView>[0] = {}) => {
  mounted = render(<BrowseView {...props} />);
  return mounted;
};
const buttonByName = (root: ParentNode, name: string | RegExp) =>
  byText(root, 'button', name) ??
  [...root.querySelectorAll<HTMLElement>('button[aria-label]')].find((b) => (typeof name === 'string' ? b.getAttribute('aria-label') === name : name.test(b.getAttribute('aria-label')!))) ??
  null;

beforeEach(() => {
  nav.search = '';
  nav.replaces = [];
  nav.pushes = [];
  localStorage.clear();
  http.get.mockReset().mockImplementation(async (path: string, opts?: { query?: Record<string, unknown> }) => {
    const handler = routes[path];
    if (!handler) throw new Error(`đường dẫn lạ ${path}`);
    return handler(opts?.query);
  });
  routes = {
    '/products': (q) => pageOf([product(1), product(2)], 2, Number(q?.page ?? 1)),
    '/brands': () => BRANDS,
    '/categories': () => CATEGORIES,
    '/search/suggest': () => [{ slug: 'nrc', name: 'Nước rửa chén', thumbnail: null, basePrice: 65000 }],
    '/flash-sales/active': () => [],
  };
});
afterEach(() => {
  mounted?.unmount();
  mounted = null;
  vi.useRealTimers();
});

describe('BrowseView — hub ở gốc', () => {
  it('gốc không tham số: hub có h1 "Danh mục", ô danh mục (bỏ danh mục trống), KHÔNG tải danh sách, không gọi gợi ý', async () => {
    const { container } = mount();
    await flush();
    expect(container.querySelector('h1')!.textContent).toBe('Danh mục');
    expect(buttonByName(container, 'Dầu gội')).not.toBeNull();
    expect(buttonByName(container, 'Tất cả')).not.toBeNull();
    expect(container.textContent).not.toContain('Danh mục trống');
    expect(container.querySelector('[data-testid="result-count"]')).toBeNull();
    expect(container.querySelector('[role="group"][aria-label="Sắp xếp"]')).toBeNull();
    expect(http.get.mock.calls.some(([p]) => p === '/search/suggest')).toBe(false);
    expect(productCalls().filter((q) => q?.page !== undefined)).toEqual([]);
  });

  it('hub gọi kệ Bán chạy nhất một lần với sort=best_seller_30d, 10 món', async () => {
    const { container } = mount();
    await flush();
    expect(productCalls()).toEqual([{ sort: 'best_seller_30d', limit: 10 }]);
    expect(container.querySelector('section[aria-label="Bán chạy nhất"]')).toBeNull();
  });

  it('kệ Bán chạy nhất hiện từ 3 món; server đưa sẵn vào (bestSellers) thì không gọi lại', async () => {
    const ten = Array.from({ length: 10 }, (_, i) => product(i + 1));
    routes['/products'] = () => pageOf(ten, 10, 1, 10);
    const first = mount({ brands: BRANDS, categories: CATEGORIES });
    await flush();
    expect(first.container.querySelectorAll('section[aria-label="Bán chạy nhất"] [data-ds-part="rank"]')).toHaveLength(10);
    first.unmount();
    http.get.mockClear();
    const seeded = mount({ bestSellers: ten, brands: BRANDS, categories: CATEGORIES });
    expect(seeded.container.querySelectorAll('section[aria-label="Bán chạy nhất"] [data-ds-part="rank"]')).toHaveLength(10);
    await flush();
    expect(productCalls()).toEqual([]);
  });

  it('chạm ô danh mục ở hub là PUSH (Back về hub), ghi category vào URL; ô "Tất cả" và nút lớn mở ?all=1', async () => {
    routes['/brands'] = () => [...BRANDS, { brand: 'Xanh', count: 1 }, { brand: 'Lá', count: 1 }];
    const { container } = mount();
    await flush();
    click(buttonByName(container, 'Dầu gội'));
    expect(nav.pushes.at(-1)).toBe('/san-pham?category=c-goi');
    click(buttonByName(container, 'Tất cả'));
    expect(nav.pushes.at(-1)).toBe('/san-pham?all=1');
    click(buttonByName(container, 'Xem tất cả sản phẩm'));
    expect(nav.pushes.at(-1)).toBe('/san-pham?all=1');
    click(buttonByName(container, 'Xem thương hiệu Mộc An'));
    expect(nav.pushes.at(-1)).toBe('/san-pham?brand=M%E1%BB%99c+An');
    expect(nav.replaces).toEqual([]);
  });

  it('PROD chưa có cây danh mục: hub lùi về 4 phân khúc, chạm ô ghi segment', async () => {
    routes['/categories'] = () => [];
    const { container } = mount();
    await flush();
    click(buttonByName(container, 'Sống xanh'));
    expect(nav.pushes.at(-1)).toBe('/san-pham?segment=eco');
  });

  it('API cũ (danh mục phẳng, không productCount): không biết danh mục nào có hàng nên hub dùng 4 phân khúc, không gãy', async () => {
    routes['/categories'] = () => [{ id: 'c-goi', parentId: null, name: 'Dầu gội', slug: 'dau-goi', image: null, sortOrder: 1 }];
    const { container } = mount();
    await flush();
    expect(buttonByName(container, 'Dầu gội')).toBeNull();
    expect(buttonByName(container, 'Sống xanh')).not.toBeNull();
  });

  it('tham số lạ (utm) không đưa trang ra khỏi hub', async () => {
    nav.search = 'utm_source=zalo';
    const { container } = mount();
    await flush();
    expect(container.querySelector('[role="group"][aria-label="Sắp xếp"]')).toBeNull();
    expect(buttonByName(container, 'Xem tất cả sản phẩm')).not.toBeNull();
  });
});

describe('BrowseView — danh sách và trạng thái URL', () => {
  it('?all=1: danh sách không lọc 20 món một trang, SortBar + số kết quả, không có ô danh mục', async () => {
    nav.search = LIST;
    const { container } = mount();
    await flush();
    expect(container.querySelector('h1')!.textContent).toBe('Tất cả sản phẩm');
    expect(container.textContent).toContain('Sản phẩm 1');
    expect(container.querySelector('[data-testid="result-count"]')!.textContent).toBe('2 sản phẩm');
    expect(container.querySelector('section[aria-label="Danh mục"]')).toBeNull();
    expect(container.querySelector('[role="group"][aria-label="Sắp xếp"]')).not.toBeNull();
    expect(http.get.mock.calls.some(([p]) => p === '/search/suggest')).toBe(false);
    expect(productCalls()[0]).toEqual({ page: 1, limit: 20 });
  });

  it('?page=2 ở gốc là danh sách (không phải hub): tải trang 2', async () => {
    nav.search = 'page=2';
    routes['/products'] = (q) => pageOf([product(21)], 40, Number(q?.page), 20);
    const { container } = mount();
    await flush();
    expect(productCalls()[0]).toEqual({ page: 2, limit: 20 });
    expect(container.querySelector('[role="group"][aria-label="Sắp xếp"]')).not.toBeNull();
  });

  it('có q trên URL: ẩn ô danh mục, gọi API với q', async () => {
    nav.search = 'q=nuoc';
    const { container } = mount();
    await flush();
    expect(container.querySelector('section[aria-label="Danh mục"]')).toBeNull();
    expect(productCalls()[0]).toEqual({ page: 1, limit: 20, q: 'nuoc' });
  });

  it('danh sách đầu do server đưa vào hiện ngay, không gọi lại /products khi đúng URL ban đầu', async () => {
    nav.search = LIST;
    const initial = { urlKey: LIST, startPage: 1, page: { ...pageOf([product(7)], 1), filtersIgnored: false } };
    const { container } = mount({ initial, brands: BRANDS, categories: CATEGORIES });
    expect(container.textContent).toContain('Sản phẩm 7');
    await flush();
    expect(productCalls()).toEqual([]);
  });

  it('danh sách đầu của URL khác (khách đã đổi bộ lọc) không được dùng', async () => {
    nav.search = 'sort=newest';
    const initial = { urlKey: '', startPage: 1, page: { ...pageOf([product(7)], 1), filtersIgnored: false } };
    const { container } = mount({ initial });
    await flush();
    expect(container.textContent).not.toContain('Sản phẩm 7');
    expect(productCalls()[0]).toEqual({ page: 1, limit: 20, sort: 'newest' });
  });

  it('gợi ý ở hub: chạm danh mục là PUSH như chạm ô danh mục (Back về hub); trong danh sách là replace', async () => {
    vi.useFakeTimers();
    const hub = mount({ categories: CATEGORIES });
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    const input = hub.container.querySelector<HTMLInputElement>('input[type="search"]')!;
    act(() => input.focus());
    typeInto(input, 'dầu');
    await act(async () => { await vi.advanceTimersByTimeAsync(350); });
    click(buttonByName(hub.container, /Dầu gội/));
    expect(nav.pushes.at(-1)).toBe('/san-pham?category=c-goi');
    expect(nav.replaces).toEqual([]);
    mounted!.unmount();

    nav.pushes = [];
    nav.search = 'q=nuoc';
    const list = mount({ categories: CATEGORIES });
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    const input2 = list.container.querySelector<HTMLInputElement>('input[type="search"]')!;
    act(() => input2.focus());
    typeInto(input2, 'dầu');
    await act(async () => { await vi.advanceTimersByTimeAsync(350); });
    click(buttonByName(list.container, /Dầu gội/));
    expect(nav.replaces.at(-1)).toBe('/san-pham?category=c-goi');
    expect(nav.pushes).toEqual([]);
  });

  it('trong danh sách, chạm danh mục ở cột lọc ghi category vào URL (replace) và xoá q', async () => {
    nav.search = 'q=nuoc';
    const { container } = mount();
    await flush();
    click(container.querySelector<HTMLElement>('[data-testid="filter-sidebar"] button[aria-pressed]:not([aria-pressed="true"])'));
    expect(nav.replaces.at(-1)).toBe('/san-pham?category=c-goi');
    expect(nav.pushes).toEqual([]);
  });

  it('danh mục có con: tiêu đề là tên danh mục (một lần), chip "Tất cả" + con còn hàng; chạm con ghi category của con (replace)', async () => {
    nav.search = 'category=c-da';
    routes['/categories'] = () => TREE;
    const { container } = mount();
    await flush();
    expect([...container.querySelectorAll('h2')].map((h) => h.textContent)).toContain('Chăm sóc da');
    const group = container.querySelector('[role="group"][aria-label="Danh mục con"]')!;
    expect([...group.querySelectorAll('button')].map((b) => b.textContent)).toEqual(['Tất cả', 'Rửa mặt', 'Chống nắng']);
    expect(buttonByName(group, 'Tất cả')!.getAttribute('aria-pressed')).toBe('true');
    expect(container.querySelector('button[aria-label="Bỏ lọc Chăm sóc da"]')).toBeNull();
    click(buttonByName(group, 'Chống nắng'));
    expect(nav.replaces.at(-1)).toBe('/san-pham?category=c-nang');
  });

  it('đang ở danh mục con: tiêu đề là tên con, chip của con được chọn, "Tất cả" quay về cha', async () => {
    nav.search = 'category=c-nang';
    routes['/categories'] = () => TREE;
    const { container } = mount();
    await flush();
    expect([...container.querySelectorAll('h2')].map((h) => h.textContent)).toContain('Chống nắng');
    const group = container.querySelector('[role="group"][aria-label="Danh mục con"]')!;
    expect(buttonByName(group, 'Chống nắng')!.getAttribute('aria-pressed')).toBe('true');
    click(buttonByName(group, 'Tất cả'));
    expect(nav.replaces.at(-1)).toBe('/san-pham?category=c-da');
  });

  it('danh mục gốc không có con: không có hàng chip', async () => {
    nav.search = 'category=c-goi';
    const { container } = mount({ categories: CATEGORIES });
    await flush();
    expect(container.querySelector('[role="group"][aria-label="Danh mục con"]')).toBeNull();
  });

  it('chip đang lọc gỡ được từng cái (tên danh mục đã là tiêu đề nên không lặp thành chip); số bộ lọc ghi trên nút Lọc', async () => {
    nav.search = 'category=c-goi&inStock=1&brand=Tubu';
    const { container } = mount({ categories: CATEGORIES, brands: BRANDS });
    await flush();
    expect(buttonByName(container, 'Bỏ lọc Dầu gội')).toBeNull();
    expect(buttonByName(container, 'Lọc, 2 bộ lọc đang bật')!.textContent).toBe('Lọc (2)');
    click(buttonByName(container, 'Bỏ lọc Còn hàng'));
    expect(nav.replaces.at(-1)).toBe('/san-pham?category=c-goi&brand=Tubu');
  });

  it('có từ khoá thì tên danh mục không làm tiêu đề, và vẫn là chip gỡ được', async () => {
    nav.search = 'q=nuoc&category=c-goi';
    const { container } = mount({ categories: CATEGORIES });
    await flush();
    expect(buttonByName(container, 'Bỏ lọc Dầu gội')).not.toBeNull();
    expect([...container.querySelectorAll('h2')].map((h) => h.textContent)).not.toContain('Dầu gội');
  });

  it('gỡ chip cuối khi đang xem danh sách ở lại danh sách (?all=1), không đẩy về hub', async () => {
    nav.search = 'inStock=1';
    const { container } = mount({ brands: BRANDS });
    await flush();
    click(buttonByName(container, 'Bỏ lọc Còn hàng'));
    expect(nav.replaces.at(-1)).toBe('/san-pham?all=1');
    await flush();
    expect(container.querySelector('[role="group"][aria-label="Sắp xếp"]')).not.toBeNull();
  });

  it('?brand=Tubu: tên thương hiệu là tiêu đề DUY NHẤT (không chip trùng); thêm bộ lọc khác vẫn có chip; nhiều thương hiệu thì mỗi cái là chip', async () => {
    nav.search = 'brand=Tubu';
    const { container } = mount({ brands: BRANDS });
    await flush();
    expect([...container.querySelectorAll('h2')].map((h) => h.textContent)).toContain('Tubu');
    expect(buttonByName(container, 'Bỏ lọc Tubu')).toBeNull();
    mounted!.unmount();

    nav.search = 'brand=Tubu&inStock=1';
    const withStock = mount({ brands: BRANDS });
    await flush();
    expect(buttonByName(withStock.container, 'Bỏ lọc Còn hàng')).not.toBeNull();
    expect(buttonByName(withStock.container, 'Bỏ lọc Tubu')).toBeNull();
    mounted!.unmount();

    nav.search = 'brand=Tubu%2CM%E1%BB%99c+An';
    const two = mount({ brands: BRANDS });
    await flush();
    expect(buttonByName(two.container, 'Bỏ lọc Tubu')).not.toBeNull();
    expect(buttonByName(two.container, 'Bỏ lọc Mộc An')).not.toBeNull();
    expect([...two.container.querySelectorAll('h2')].map((h) => h.textContent)).not.toContain('Tubu');
  });

  it('?category=<id> không có trong cây (link cũ, đã xoá): không tên làm tiêu đề nhưng có chip "Danh mục" gỡ được; cây còn tải thì chưa hiện', async () => {
    nav.search = 'category=c-da-xoa';
    const { container } = mount({ categories: CATEGORIES });
    await flush();
    const chip = buttonByName(container, 'Bỏ lọc Danh mục');
    expect(chip).not.toBeNull();
    click(chip);
    expect(nav.replaces.at(-1)).toBe('/san-pham?all=1');
    mounted!.unmount();

    routes['/categories'] = () => new Promise(() => undefined);
    const loading = mount();
    await flush();
    expect(buttonByName(loading.container, 'Bỏ lọc Danh mục')).toBeNull();
  });

  it('nhãn đã công khai: lọc đúng một nhãn có liên kết tới /brand/:slug', async () => {
    nav.search = 'brand=Tubu';
    const { container } = mount({ brands: BRANDS });
    await flush();
    expect(container.querySelector('a[href="/brand/tubu-xanh"]')!.textContent).toContain('Xem trang thương hiệu Tubu');
    mounted!.unmount();
    nav.search = 'brand=M%E1%BB%99c+An';
    mount({ brands: BRANDS });
    await flush();
    expect(mounted!.container.querySelector('a[href^="/brand/"]')).toBeNull();
  });
});

describe('BrowseView — sắp xếp', () => {
  const sortGroup = (c: ParentNode) => c.querySelector('[role="group"][aria-label="Sắp xếp"]')!;

  it('SortBar: Phổ biến (mặc định) chọn sẵn; chạm tab ghi sort vào URL (replace) và gọi lại danh sách; chạm lại tab đang chọn không làm gì', async () => {
    nav.search = LIST;
    const { container } = mount();
    await flush();
    expect([...sortGroup(container).querySelectorAll('button')].map((b) => b.textContent)).toEqual(['Phổ biến', 'Bán chạy', 'Mới', 'Giá ⇅']);
    expect(buttonByName(sortGroup(container), 'Phổ biến')!.getAttribute('aria-pressed')).toBe('true');
    click(buttonByName(sortGroup(container), 'Bán chạy'));
    expect(nav.replaces.at(-1)).toBe('/san-pham?sort=best_seller');
    await flush();
    expect(productCalls().at(-1)).toEqual({ page: 1, limit: 20, sort: 'best_seller' });
    const count = nav.replaces.length;
    click(buttonByName(sortGroup(container), 'Bán chạy'));
    expect(nav.replaces).toHaveLength(count);
  });

  it('tab Giá gộp hai chiều: chạm lần đầu giá thấp, chạm lại giá cao, nhãn đổi theo chiều', async () => {
    nav.search = LIST;
    const { container } = mount();
    await flush();
    click(buttonByName(sortGroup(container), 'Giá ⇅'));
    expect(nav.replaces.at(-1)).toBe('/san-pham?sort=price_asc');
    await flush();
    expect(buttonByName(sortGroup(container), 'Giá thấp')!.getAttribute('aria-pressed')).toBe('true');
    click(buttonByName(sortGroup(container), 'Giá thấp'));
    expect(nav.replaces.at(-1)).toBe('/san-pham?sort=price_desc');
    await flush();
    expect(buttonByName(sortGroup(container), 'Giá cao')).not.toBeNull();
  });

  it('chọn lại Phổ biến khi chỉ còn sort ở lại danh sách (?all=1), không về hub', async () => {
    nav.search = 'sort=newest';
    const { container } = mount();
    await flush();
    click(buttonByName(sortGroup(container), 'Phổ biến'));
    expect(nav.replaces.at(-1)).toBe('/san-pham?all=1');
  });

  it('đang tìm: tab đầu là "Liên quan"', async () => {
    nav.search = 'q=nuoc';
    const { container } = mount();
    await flush();
    expect(sortGroup(container).querySelector('button')!.textContent).toBe('Liên quan');
  });

  it('SortBar dính dưới ô tìm: khung bọc dính theo --sort-bar-top (đặt ở khung trang), nút Lọc ẩn từ lg (cột lọc đã có)', async () => {
    nav.search = LIST;
    const { container } = mount();
    await flush();
    const wrap = sortGroup(container).parentElement!.parentElement as HTMLElement;
    expect(wrap.className).toContain('sticky');
    expect(wrap.className).toContain('top-[var(--sort-bar-top,0px)]');
    expect(wrap.className).toContain('lg:[&>div>button:last-child]:!hidden');
    expect(wrap.closest('[data-browse-scope]')!.className).toContain('--sort-bar-top');
  });

  describe('đổi sắp xếp / bộ lọc khi đang cuộn sâu: về đầu danh sách', () => {
    /** jsdom không có layout: đặt mép trên điểm đánh dấu đầu danh sách (toạ độ khung nhìn) và vạch dính của thanh sắp xếp. */
    const scrollSpy = (container: HTMLElement, sentinelTop: number, stuckTop = 58) => {
      const sentinel = container.querySelector<HTMLElement>('[data-testid="browse-list-top"]')!;
      vi.spyOn(sentinel, 'getBoundingClientRect').mockReturnValue({ top: sentinelTop, bottom: sentinelTop, left: 0, right: 0, width: 0, height: 0, x: 0, y: sentinelTop, toJSON: () => ({}) });
      (sentinel.nextElementSibling as HTMLElement).style.top = `${stuckTop}px`;
      return vi.spyOn(window, 'scrollBy').mockImplementation(() => undefined);
    };

    it('chạm tab sắp xếp khi điểm đánh dấu đã trượt lên trên vạch dính: cuộn ngược đúng độ lệch, rồi ghi URL', async () => {
      nav.search = LIST;
      const { container } = mount();
      await flush();
      const spy = scrollSpy(container, 140 - 2000);
      click(buttonByName(sortGroup(container), 'Mới'));
      expect(spy).toHaveBeenCalledWith({ top: 140 - 2000 - 58, behavior: 'instant' });
      expect(nav.replaces.at(-1)).toBe('/san-pham?sort=newest');
    });

    it('gỡ chip lọc, chạm chip danh mục con và gửi từ khoá mới cũng về đầu danh sách', async () => {
      nav.search = 'category=c-da&inStock=1';
      routes['/categories'] = () => TREE;
      const { container } = mount();
      await flush();
      const spy = scrollSpy(container, -900);
      click(buttonByName(container, 'Bỏ lọc Còn hàng'));
      expect(spy).toHaveBeenCalledTimes(1);
      click(buttonByName(container.querySelector('[role="group"][aria-label="Danh mục con"]')!, 'Chống nắng'));
      expect(spy).toHaveBeenCalledTimes(2);
      act(() => {
        container.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
      });
      expect(spy).toHaveBeenCalledTimes(3);
    });

    it('khách còn ở gần đầu trang (điểm đánh dấu chưa qua vạch dính) đổi sắp xếp: không bị kéo đi đâu', async () => {
      nav.search = LIST;
      const { container } = mount();
      await flush();
      const spy = scrollSpy(container, 110);
      click(buttonByName(sortGroup(container), 'Bán chạy'));
      expect(spy).not.toHaveBeenCalled();
      expect(nav.replaces.at(-1)).toBe('/san-pham?sort=best_seller');
    });
  });

  it('hàng ô tìm ở điện thoại cao 58px như Mini: ô 46px (44 + viền) trong đệm dọc 6px, giá trị khớp --sort-bar-top:58px', async () => {
    nav.search = LIST;
    const { container } = mount();
    await flush();
    const input = container.querySelector<HTMLInputElement>('input[type="search"]')!;
    expect(input.className).toContain('max-md:h-[46px]');
    expect(input.closest('form')!.className).toContain('max-md:py-1.5');
    expect(input.closest('[data-browse-scope]')!.className).toContain('max-md:[--sort-bar-top:58px]');
  });
});

describe('BrowseView — gõ tìm kiếm', () => {
  it('gõ chỉ hiện gợi ý (không ghi q); Enter ghi q, lưu từ khoá gần đây và thoát chế độ gõ', async () => {
    const { container } = mount();
    await flush();
    const input = container.querySelector<HTMLInputElement>('input[type="search"]')!;
    act(() => input.focus());
    typeInto(input, 'nước');
    expect(nav.replaces).toEqual([]);
    expect(container.querySelector('section[aria-label="Gợi ý tìm kiếm"]')).not.toBeNull();
    expect(buttonByName(container, 'Tìm “nước”')).not.toBeNull();
    act(() => {
      container.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    });
    // Ở hub gửi từ khoá là mở MỚI: PUSH (Back về hub), không replace.
    expect(nav.pushes.at(-1)).toBe('/san-pham?q=n%C6%B0%E1%BB%9Bc');
    expect(nav.replaces).toEqual([]);
    expect(JSON.parse(localStorage.getItem('tubu_recent_searches')!)).toEqual(['nước']);
    expect(container.querySelector('section[aria-label="Gợi ý tìm kiếm"]')).toBeNull();
  });

  it('gợi ý sản phẩm (GET /search/suggest) sau 250ms; chạm sản phẩm đi tới trang sản phẩm', async () => {
    vi.useFakeTimers();
    const { container } = mount();
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    const input = container.querySelector<HTMLInputElement>('input[type="search"]')!;
    act(() => input.focus());
    typeInto(input, 'nước');
    await act(async () => { await vi.advanceTimersByTimeAsync(300); });
    await act(async () => { await vi.advanceTimersByTimeAsync(50); });
    expect(http.get).toHaveBeenCalledWith('/search/suggest', { query: { q: 'nước' } });
    click(buttonByName(container, /Nước rửa chén/));
    expect(nav.pushes).toEqual(['/san-pham/nrc']);
  });

  it('ô trống + có lịch sử: chạm vào ô hiện "Tìm gần đây"; chạm từ khoá ghi q; "Xoá lịch sử tìm" xoá khoá lưu', async () => {
    localStorage.setItem('tubu_recent_searches', JSON.stringify(['xà phòng', 'nước rửa']));
    const { container } = mount();
    await flush();
    act(() => container.querySelector<HTMLInputElement>('input[type="search"]')!.focus());
    expect(container.querySelector('[role="group"][aria-label="Tìm gần đây"]')).not.toBeNull();
    click(buttonByName(container, 'Xoá lịch sử tìm'));
    expect(localStorage.getItem('tubu_recent_searches')).toBeNull();
    expect(container.querySelector('section[aria-label="Gợi ý tìm kiếm"]')).toBeNull();
  });

  it('hub: chạm từ khoá gần đây ở bảng gợi ý là PUSH như chạm ô danh mục (Back về hub)', async () => {
    localStorage.setItem('tubu_recent_searches', JSON.stringify(['xà phòng']));
    const { container } = mount();
    await flush();
    act(() => container.querySelector<HTMLInputElement>('input[type="search"]')!.focus());
    click(buttonByName(container, /xà phòng/));
    expect(nav.pushes).toEqual(['/san-pham?q=x%C3%A0+ph%C3%B2ng']);
    expect(nav.replaces).toEqual([]);
  });

  it('hub: gửi từ khoá trống hoặc toàn khoảng trắng không PUSH và không replace (không chồng mục lịch sử)', async () => {
    const { container } = mount();
    await flush();
    const input = container.querySelector<HTMLInputElement>('input[type="search"]')!;
    act(() => input.focus());
    typeInto(input, '   ');
    act(() => {
      container.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    });
    expect(nav.pushes).toEqual([]);
    expect(nav.replaces).toEqual([]);
  });

  it('danh sách: gửi từ khoá vẫn là replace (không push)', async () => {
    nav.search = LIST;
    const { container } = mount();
    await flush();
    const input = container.querySelector<HTMLInputElement>('input[type="search"]')!;
    act(() => input.focus());
    typeInto(input, 'nước');
    act(() => {
      container.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    });
    expect(nav.replaces.at(-1)).toContain('q=');
    expect(nav.pushes).toEqual([]);
  });

  it('nút Xoá từ khoá bỏ q khỏi URL; "Huỷ" trả ô về q đang lọc', async () => {
    nav.search = 'q=nuoc';
    const { container } = mount();
    await flush();
    const input = container.querySelector<HTMLInputElement>('input[type="search"]')!;
    act(() => input.focus());
    typeInto(input, 'dở dang');
    click(buttonByName(container, 'Huỷ'));
    expect(input.value).toBe('nuoc');
    click(buttonByName(container, 'Xoá từ khoá'));
    expect(nav.replaces.at(-1)).toBe('/san-pham');
  });

  it('?focus=search từ trang chủ: focus ô tìm rồi gỡ cờ khỏi URL', async () => {
    nav.search = 'focus=search';
    const { container } = mount();
    await flush();
    expect(document.activeElement).toBe(container.querySelector('input[type="search"]'));
    expect(nav.replaces.at(-1)).toBe('/san-pham');
  });
});

describe('BrowseView — bộ lọc', () => {
  it('mở sheet: giá, còn hàng, 4 sao, nhãn; nút áp dụng ghi số kết quả; áp dụng ghi URL đúng một lần', async () => {
    nav.search = LIST;
    routes['/products'] = (q) => (q?.limit === 1 ? pageOf([product(1)], 5, 1, 1) : pageOf([product(1), product(2)], 2));
    const { container } = mount({ brands: BRANDS });
    await flush();
    click(buttonByName(container, 'Lọc'));
    const dialog = document.querySelector('[role="dialog"]')!;
    expect(dialog.textContent).toContain('Khoảng giá');
    click(buttonByName(dialog, 'Dưới 100k'));
    click(buttonByName(dialog, 'Chỉ hiện còn hàng'));
    click(buttonByName(dialog, 'Từ 4★ trở lên'));
    click(buttonByName(dialog, 'Mộc An'));
    expect(buttonByName(dialog, /Xem kết quả/)).not.toBeNull();
    await act(async () => { await new Promise((r) => setTimeout(r, 300)); });
    await flush();
    const apply = buttonByName(dialog, 'Xem 5 sản phẩm')!;
    click(apply);
    click(apply);
    expect(nav.replaces).toEqual(['/san-pham?brand=M%E1%BB%99c+An&maxPrice=100000&inStock=1&rating=4']);
    expect(document.querySelector('[role="dialog"]')).toBeNull();
  });

  it('API cũ từ chối bộ lọc mới (400) → hiện mọi kết quả kèm cảnh báo filtersIgnored', async () => {
    nav.search = 'inStock=1';
    routes['/products'] = (q) => {
      if (q?.inStock) throw Object.assign(new Error('bad'), { status: 400 });
      return pageOf([product(1)], 1);
    };
    const { container } = mount();
    await flush();
    expect(container.querySelector('[role="status"]')!.textContent).toContain('Bộ lọc nâng cao chưa dùng được lúc này');
    expect(container.textContent).toContain('Sản phẩm 1');
  });

  it('đã lọc mà không có gì: báo chưa có sản phẩm khớp, "Xoá tìm kiếm & bộ lọc" gỡ hết', async () => {
    nav.search = 'inStock=1&sort=newest';
    routes['/products'] = () => pageOf([], 0);
    const { container } = mount();
    await flush();
    expect(container.textContent).toContain('Chưa có sản phẩm khớp bộ lọc');
    click(buttonByName(container, 'Xoá tìm kiếm & bộ lọc'));
    expect(nav.replaces.at(-1)).toBe('/san-pham?sort=newest');
  });
});

describe('BrowseView — liên kết phân trang cho crawler', () => {
  const seeded = (startPage: number, total: number) => ({
    urlKey: '', startPage, page: { ...pageOf([product(7)], total, startPage, 20), filtersIgnored: false },
  });
  const hrefs = (root: ParentNode) => [...root.querySelectorAll<HTMLAnchorElement>('nav[aria-label="Phân trang"] a[rel]')].map((a) => [a.getAttribute('rel'), a.getAttribute('href')]);

  it('trang 1 còn trang sau: HTML có thẻ a rel=next tới ?page=2, giữ bộ lọc, không có liên kết trang trước', async () => {
    nav.search = 'brand=Tubu';
    const { container } = mount({ initial: { ...seeded(1, 100), urlKey: 'brand=Tubu' } });
    expect(hrefs(container)).toEqual([['next', '/san-pham?brand=Tubu&page=2']]);
  });

  it('bắt đầu từ trang 3: có liên kết trang trước (?page=2) và trang sau (?page=4)', async () => {
    nav.search = 'page=3';
    const { container } = mount({ initial: seeded(3, 100) });
    expect(hrefs(container)).toEqual([['prev', '/san-pham?page=2'], ['next', '/san-pham?page=4']]);
  });

  it('bắt đầu từ trang 2: liên kết trang trước về trang 1 của danh sách (?all=1: /san-pham trơn là hub)', async () => {
    nav.search = 'page=2';
    const { container } = mount({ initial: seeded(2, 100) });
    expect(hrefs(container)[0]).toEqual(['prev', '/san-pham?all=1']);
  });

  it('trang 1 của danh sách ?all=1: liên kết trang sau là ?page=2 (không mang all, để canonical tự trỏ về chính nó)', async () => {
    nav.search = LIST;
    const { container } = mount({ initial: { ...seeded(1, 100), urlKey: LIST } });
    expect(hrefs(container)).toEqual([['next', '/san-pham?page=2']]);
  });

  it('server không seed được (initial=null) mà URL là ?page=3: tải đúng trang 3, liên kết trước ?page=2 và sau ?page=4', async () => {
    nav.search = 'page=3';
    routes['/products'] = (q) => pageOf([product(30)], 200, Number(q?.page), 20);
    const { container } = mount({ initial: null });
    await flush();
    expect(productCalls()[0]).toMatchObject({ page: 3 });
    expect(hrefs(container)).toEqual([['prev', '/san-pham?page=2'], ['next', '/san-pham?page=4']]);
  });

  it('ít sản phẩm, một trang: không vẽ thanh phân trang', async () => {
    nav.search = LIST;
    const { container } = mount({ initial: { ...seeded(1, 5), urlKey: LIST } });
    expect(container.querySelector('nav[aria-label="Phân trang"]')).toBeNull();
  });
});

describe('BrowseView — khung danh sách cho máy tính (tiêu đề, breadcrumb)', () => {
  const crumbs = (root: ParentNode) => [...root.querySelectorAll('nav[aria-label="Breadcrumb"] li')].map((li) => li.textContent);

  it('h1 theo trạng thái: hub "Danh mục", cả danh sách "Tất cả sản phẩm", từ khoá, danh mục con, phân khúc, một nhãn', async () => {
    routes['/categories'] = () => TREE;
    const h1 = async (search: string) => {
      nav.search = search;
      const view = mount({ brands: BRANDS });
      await flush();
      const text = view.container.querySelector('h1')!.textContent;
      view.unmount();
      return text;
    };
    expect(await h1('')).toBe('Danh mục');
    expect(await h1('all=1')).toBe('Tất cả sản phẩm');
    expect(await h1('q=nuoc')).toBe('Kết quả cho "nuoc"');
    expect(await h1('category=c-nang')).toBe('Chống nắng');
    expect(await h1('segment=eco')).toBe('Sống xanh');
    expect(await h1('brand=Tubu')).toBe('Tubu');
  });

  it('h1 có tên danh mục thì tiêu đề h2 của danh sách nhường chỗ (ẩn từ md), số kết quả đứng đầu hàng từ md', async () => {
    nav.search = 'category=c-goi';
    const { container } = mount({ categories: CATEGORIES });
    await flush();
    const h2 = [...container.querySelectorAll('h2')].find((h) => h.textContent === 'Dầu gội')!;
    expect(h2.className).toContain('md:hidden');
    expect(container.querySelector<HTMLElement>('[data-testid="result-count"]')!.className).toContain('md:!ml-0');
  });

  it('breadcrumb "Trang chủ › Danh mục › cha › con" từ cây danh mục; mục cuối là trang hiện tại', async () => {
    nav.search = 'category=c-nang';
    routes['/categories'] = () => TREE;
    const { container } = mount();
    await flush();
    expect(crumbs(container)).toEqual(['Trang chủ', 'Danh mục', 'Chăm sóc da', 'Chống nắng']);
    const links = [...container.querySelectorAll('nav[aria-label="Breadcrumb"] a')].map((a) => a.getAttribute('href'));
    expect(links).toEqual(['/', '/san-pham', '/san-pham?category=c-da']);
    expect(container.querySelector('nav[aria-label="Breadcrumb"] [aria-current="page"]')!.textContent).toBe('Chống nắng');
  });

  it('hub: "Trang chủ › Danh mục"; danh sách tất cả và tìm kiếm có thêm mục cuối là tiêu đề của trang', async () => {
    const hub = mount();
    await flush();
    expect(crumbs(hub.container)).toEqual(['Trang chủ', 'Danh mục']);
    hub.unmount();
    nav.search = 'q=nuoc';
    const search = mount();
    await flush();
    expect(crumbs(search.container)).toEqual(['Trang chủ', 'Danh mục', 'Kết quả cho "nuoc"']);
  });

  it('có cột lọc ở danh sách (từ lg) và không có ở hub', async () => {
    nav.search = LIST;
    const list = mount();
    await flush();
    expect(list.container.querySelector('aside[data-testid="filter-sidebar"]')).not.toBeNull();
    list.unmount();
    nav.search = '';
    const hub = mount();
    await flush();
    expect(hub.container.querySelector('aside[data-testid="filter-sidebar"]')).toBeNull();
  });
});

describe('BrowseView — phân trang số từ lg', () => {
  const seeded = (startPage: number, total: number) => ({
    urlKey: '', startPage, page: { ...pageOf([product(7)], total, startPage, 20), filtersIgnored: false },
  });
  const numbers = (root: ParentNode) => [...root.querySelectorAll<HTMLElement>('nav[aria-label="Phân trang"] ol > li')].map((li) => li.textContent);

  it('trang 5 trên 9: 1 … 4 5 6 … 9 (số là liên kết thật; trang hiện tại có aria-current; mỗi số có tên "Trang n")', async () => {
    nav.search = 'page=5';
    const { container } = mount({ initial: seeded(5, 180) });
    const list = container.querySelector('nav[aria-label="Phân trang"] ol')!;
    expect(list.className).toContain('hidden');
    expect(list.className).toContain('lg:flex');
    expect(numbers(container)).toEqual(['1', '…', '4', '5', '6', '…', '9']);
    const link = (n: number) => list.querySelector<HTMLAnchorElement>(`a[aria-label="Trang ${n}"]`)!;
    expect(link(1).getAttribute('href')).toBe('/san-pham?all=1');
    expect(link(4).getAttribute('href')).toBe('/san-pham?page=4');
    expect(link(9).getAttribute('href')).toBe('/san-pham?page=9');
    expect(link(5).getAttribute('aria-current')).toBe('page');
    expect(link(4).getAttribute('aria-current')).toBeNull();
  });

  it('giữ bộ lọc trong liên kết; trang 1 của danh sách đã lọc không cần all=1', async () => {
    nav.search = 'brand=Tubu&page=2';
    const { container } = mount({ initial: { ...seeded(2, 100), urlKey: 'brand=Tubu' } });
    const hrefOf = (n: number) => container.querySelector<HTMLAnchorElement>(`a[aria-label="Trang ${n}"]`)!.getAttribute('href');
    expect(hrefOf(1)).toBe('/san-pham?brand=Tubu');
    expect(hrefOf(3)).toBe('/san-pham?brand=Tubu&page=3');
  });

  it('nút Trang trước / Trang sau cũ ẩn từ lg (đã có phân trang số)', async () => {
    nav.search = 'page=3';
    const { container } = mount({ initial: seeded(3, 120) });
    const prev = container.querySelector<HTMLElement>('a[rel="prev"]')!;
    expect(prev.parentElement!.className).toContain('lg:hidden');
  });
});

describe('BrowseView — tải thêm, rỗng, lỗi', () => {
  it('còn trang sau: "Xem thêm" tải trang 2 và nối vào cuối, không trùng; hết trang thì ẩn nút', async () => {
    nav.search = LIST;
    routes['/products'] = (q) => (Number(q?.page) === 2 ? pageOf([product(2), product(3)], 3, 2, 2) : pageOf([product(1), product(2)], 3, 1, 2));
    const { container } = mount();
    await flush();
    click(buttonByName(container, 'Xem thêm'));
    await flush();
    expect(productCalls().at(-1)).toEqual({ page: 2, limit: 20 });
    expect(container.querySelectorAll('a[href^="/san-pham/sp-"]')).toHaveLength(3);
    expect(buttonByName(container, 'Xem thêm')).toBeNull();
  });

  it('"Xem thêm" khi đang tải: aria-disabled (không disabled, vẫn focus được), bấm lần hai bị bỏ qua, ẩn từ lg', async () => {
    nav.search = LIST;
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    routes['/products'] = (q) => (Number(q?.page) === 2 ? gate.then(() => pageOf([product(3), product(4)], 4, 2, 2)) : pageOf([product(1), product(2)], 4, 1, 2));
    const { container } = mount();
    await flush();
    const more = () => buttonByName(container, 'Xem thêm')!;
    expect(more().parentElement!.className).toContain('lg:hidden');
    expect(more().getAttribute('aria-disabled')).toBeNull();
    click(more());
    await flush();
    expect(more().getAttribute('aria-disabled')).toBe('true');
    expect(more().hasAttribute('disabled')).toBe(false);
    click(more());
    expect(productCalls().filter((q) => q?.page === 2)).toHaveLength(1);
    release();
    await flush(8);
    expect(container.querySelectorAll('a[href^="/san-pham/sp-"]').length).toBeGreaterThanOrEqual(4);
  });

  it('"Xem thêm" xong: focus chuyển vào liên kết của thẻ đầu trang mới (không mất focus về body)', async () => {
    nav.search = LIST;
    routes['/products'] = (q) => (Number(q?.page) === 2 ? pageOf([product(3), product(4)], 4, 2, 2) : pageOf([product(1), product(2)], 4, 1, 2));
    const { container } = mount();
    await flush();
    const trigger = buttonByName(container, 'Xem thêm')!;
    act(() => trigger.focus());
    click(trigger);
    await flush(8);
    const third = container.querySelector('ul[data-testid="catalog-grid"] li:nth-child(3) a') as HTMLElement;
    expect(third.getAttribute('href')).toBe('/san-pham/sp-3');
    expect(document.activeElement).toBe(third);
  });

  it('trang đầu do server tải là trang 2: "Xem thêm" tải tiếp trang 3', async () => {
    nav.search = 'page=2';
    const initial = { urlKey: '', startPage: 2, page: { ...pageOf([product(7)], 100, 2, 20), filtersIgnored: false } };
    const { container } = mount({ initial });
    await flush();
    click(buttonByName(container, 'Xem thêm'));
    await flush();
    expect(productCalls().at(-1)).toEqual({ page: 3, limit: 20 });
  });

  it('vào thẳng ?page=3, đổi bộ lọc rồi gỡ: về lại trang 1, không dùng lại danh sách bắt đầu từ trang 3', async () => {
    nav.search = 'page=3';
    routes['/products'] = (q) => pageOf([product(Number(q?.page ?? 1) * 10)], 100, Number(q?.page ?? 1), 20);
    const initial = { urlKey: '', startPage: 3, page: { ...pageOf([product(30)], 100, 3, 20), filtersIgnored: false } };
    const { container } = mount({ initial });
    await flush();
    expect(container.querySelector('a[href="/san-pham/sp-30"]')).not.toBeNull();
    click(buttonByName(container, 'Dầu gội'));
    await flush();
    click(buttonByName(container, 'Tất cả sản phẩm'));
    await flush(8);
    expect(productCalls().at(-1)).toEqual({ page: 1, limit: 20 });
    expect(container.querySelector('a[href="/san-pham/sp-30"]')).toBeNull();
    expect(container.querySelector('a[href="/san-pham/sp-10"]')).not.toBeNull();
  });

  it('tìm không ra: nói rõ từ khoá, không đổ lỗi cho bộ lọc, có lối thoát', async () => {
    nav.search = 'q=xyz';
    routes['/products'] = () => pageOf([], 0);
    const { container } = mount();
    await flush();
    expect(container.textContent).toContain('Không tìm thấy "xyz"');
    expect(buttonByName(container, 'Xoá tìm kiếm & bộ lọc')).not.toBeNull();
  });

  it('catalog trống ở danh sách ?all=1: báo chưa có sản phẩm, không có nút xoá bộ lọc', async () => {
    nav.search = LIST;
    routes['/products'] = () => pageOf([], 0);
    const { container } = mount();
    await flush();
    expect(container.textContent).toContain('Chưa có sản phẩm');
    expect(buttonByName(container, 'Xoá tìm kiếm & bộ lọc')).toBeNull();
  });

  it('lỗi tải lần đầu: báo lỗi và "Thử lại" tải lại được', async () => {
    nav.search = LIST;
    let fail = true;
    routes['/products'] = () => {
      if (fail) throw new Error('Mất kết nối');
      return pageOf([product(1)], 1);
    };
    const { container } = mount();
    await flush(8);
    expect(container.querySelector('[role="alert"]')!.textContent).toContain('Mất kết nối');
    expect(container.querySelector('[data-testid="result-count"]')!.textContent?.trim()).toBe('');
    fail = false;
    click(buttonByName(container, 'Thử lại'));
    await flush(8);
    expect(container.textContent).toContain('Sản phẩm 1');
  });

  it('lỗi khi "Xem thêm": giữ nguyên danh sách, báo và thử lại tại chỗ', async () => {
    nav.search = LIST;
    let failPage2 = true;
    routes['/products'] = (q) => {
      if (Number(q?.page) === 2) {
        if (failPage2) throw new Error('down');
        return pageOf([product(3)], 3, 2, 2);
      }
      return pageOf([product(1), product(2)], 3, 1, 2);
    };
    const { container } = mount();
    await flush();
    click(buttonByName(container, 'Xem thêm'));
    await flush(8);
    expect(container.textContent).toContain('Không tải thêm được sản phẩm');
    expect(container.textContent).toContain('Sản phẩm 1');
    failPage2 = false;
    click(buttonByName(container, 'Thử lại'));
    await flush(8);
    expect(container.textContent).toContain('Sản phẩm 3');
  });
});

describe('BrowseView — đã xem gần đây', () => {
  const stored = [{ slug: 'sp-9', name: 'Đã xem 9', thumbnail: null, viewedAt: 1 }, { slug: 'an', name: 'Đã ẩn', thumbnail: null, viewedAt: 2 }];

  it('ở trang gốc: dải hiện tên từ máy, giá hiện hành theo slug; sản phẩm đã ẩn/chưa duyệt biến mất', async () => {
    localStorage.setItem('tubu_recently_viewed', JSON.stringify(stored));
    routes['/products'] = (q) =>
      q?.slugs ? pageOf([{ ...product(9), slug: 'sp-9', name: 'Đã xem 9', basePrice: 150000 }], 1) : pageOf([product(1)], 1);
    const { container } = mount();
    await flush();
    const rail = container.querySelector('section[aria-label="Đã xem gần đây"]')!;
    expect(rail.querySelectorAll('[data-ds="product-tile"]')).toHaveLength(1);
    expect(rail.textContent).toContain('150.000đ');
    expect(rail.querySelector('a')!.getAttribute('href')).toBe('/san-pham/sp-9');
  });

  it('chưa xem gì thì không vẽ dải', async () => {
    const { container } = mount();
    await flush();
    expect(container.querySelector('section[aria-label="Đã xem gần đây"]')).toBeNull();
  });

  it('đang có q: dải ẩn khi có kết quả, hiện lại làm lối đi tiếp khi tìm không ra', async () => {
    localStorage.setItem('tubu_recently_viewed', JSON.stringify([stored[0]]));
    routes['/products'] = (q) => (q?.slugs ? pageOf([{ ...product(9), slug: 'sp-9', name: 'Đã xem 9' }], 1) : pageOf([product(1)], 1));
    nav.search = 'q=nuoc';
    const withResults = mount();
    await flush();
    expect(withResults.container.querySelector('section[aria-label="Đã xem gần đây"]')).toBeNull();
    withResults.unmount();
    routes['/products'] = (q) => (q?.slugs ? pageOf([{ ...product(9), slug: 'sp-9', name: 'Đã xem 9' }], 1) : pageOf([], 0));
    const none = mount();
    await flush();
    expect(none.container.querySelector('section[aria-label="Đã xem gần đây"]')).not.toBeNull();
  });
});

describe('BrowseView — truy cập', () => {
  // Chip của bộ thành phần Mini mở rộng vùng chạm tới 44px bằng ::after (`tubu-hit-44`), jsdom không dàn trang nên không đo được.
  const smallTargets = (root: ParentNode) => smallTouchTargets(root).filter((html) => !html.includes('tubu-hit-44'));

  it('danh sách: mọi điều khiển có tên, ô tìm có nhãn, vùng chạm 44px', async () => {
    nav.search = 'q=nuoc&inStock=1';
    const { container } = mount({ brands: BRANDS, categories: CATEGORIES });
    await flush();
    expect(unnamedControls(container)).toEqual([]);
    expect(unlabeledFields(container)).toEqual([]);
    expect(smallTargets(container)).toEqual([]);
  });

  it('hub: mọi điều khiển có tên, ô tìm có nhãn, vùng chạm 44px', async () => {
    const { container } = mount({ brands: BRANDS, categories: CATEGORIES });
    await flush();
    expect(unnamedControls(container)).toEqual([]);
    expect(unlabeledFields(container)).toEqual([]);
    expect(smallTargets(container)).toEqual([]);
  });
});

// Kiểu Mini App ở điện thoại (pages/browse.tsx): tiêu đề chỉ cho trình đọc màn hình, ô tìm dạng viên + nút giỏ cùng hàng, SortBar dính
// thay hàng chip + nút "Bộ lọc"; từ md giữ giao diện máy tính.
describe('BrowseView — kiểu Mini App ở điện thoại', () => {
  it('h1 chỉ cho trình đọc màn hình ở điện thoại, hiện từ md', async () => {
    const { container } = mount();
    await flush();
    expect(container.querySelector('h1')!.className).toContain('max-md:sr-only');
  });

  it('ô tìm dạng viên ở điện thoại; nút giỏ cùng hàng chỉ ở điện thoại, đổi thành "Huỷ" khi đang gõ', async () => {
    const { container } = mount();
    await flush();
    expect(container.querySelector('#browse-q')!.className).toContain('max-md:rounded-full');
    const cart = container.querySelector<HTMLAnchorElement>('a[href="/gio-hang"]')!;
    expect(cart.className).toContain('md:hidden');
    act(() => container.querySelector<HTMLInputElement>('#browse-q')!.focus());
    await flush();
    expect(container.querySelector('a[href="/gio-hang"]')).toBeNull();
    expect(buttonByName(container, 'Huỷ')).not.toBeNull();
  });

  it('danh sách: SortBar cao 44px đứng trước tiêu đề + số kết quả, rồi tới lưới; không còn hàng chip sắp xếp cũ', async () => {
    nav.search = 'category=c-goi';
    const { container } = mount({ categories: CATEGORIES });
    await flush();
    const bar = container.querySelector('[role="group"][aria-label="Sắp xếp"]')!;
    const heading = container.querySelector('[data-testid="result-count"]')!;
    const grid = container.querySelector('a[href^="/san-pham/sp-"]')!;
    expect(bar.compareDocumentPosition(heading) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(heading.compareDocumentPosition(grid) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    for (const b of bar.querySelectorAll<HTMLElement>('button')) expect(parseFloat(b.style.minHeight)).toBeGreaterThanOrEqual(44);
    expect(container.querySelector('[role="group"][aria-label="Đổi danh mục"]')).toBeNull();
  });
});
