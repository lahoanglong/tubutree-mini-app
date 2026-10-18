// @vitest-environment jsdom
import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { byText, click, flush, render, typeInto, type Rendered } from '@/test-utils/dom';
import { smallTouchTargets, unnamedControls, unlabeledFields } from '@/test-utils/a11y';

// Chép ý nghĩa pages/browse.spec.tsx của Mini App: trạng thái nằm trong URL, gõ chỉ hiện gợi ý, Enter mới ghi q, lưới danh
// mục khi chưa có truy vấn, chip sắp xếp, bộ lọc có đếm, tải thêm, cảnh báo filtersIgnored, đã xem gần đây, trạng thái rỗng/lỗi.

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

import BrowseView from './browse-view';

const product = (n: number) => ({
  id: `p${n}`, slug: `sp-${n}`, brand: 'Tubu', name: `Sản phẩm ${n}`, thumbnail: null, basePrice: 100000 + n,
  salePrice: null, isFeatured: false, inStock: true,
});
const pageOf = <T,>(items: T[], total: number, page = 1, limit = 24) => ({ data: items, meta: { page, limit, total } });
const CATEGORIES = [
  { id: 'c-goi', parentId: null, name: 'Dầu gội', slug: 'dau-goi', image: null, sortOrder: 1, productCount: 4 },
  { id: 'c-trong', parentId: null, name: 'Danh mục trống', slug: 'trong', image: null, sortOrder: 2, productCount: 0 },
];
const BRANDS = [{ brand: 'Tubu', count: 3, slug: 'tubu-xanh' }, { brand: 'Mộc An', count: 2 }];

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

describe('BrowseView — danh sách và trạng thái URL', () => {
  it('chưa có truy vấn: lưới danh mục (bỏ danh mục trống) + danh sách sản phẩm; vào thẳng /san-pham không gọi gợi ý', async () => {
    const { container } = mount();
    await flush();
    expect(container.querySelector('h1')!.textContent).toBe('Khám phá');
    expect(buttonByName(container, 'Dầu gội')).not.toBeNull();
    expect(container.textContent).not.toContain('Danh mục trống');
    expect(container.textContent).toContain('Sản phẩm 1');
    expect(container.querySelector('[data-testid="result-count"]')!.textContent).toBe('2 sản phẩm');
    expect(http.get.mock.calls.some(([p]) => p === '/search/suggest')).toBe(false);
    expect(productCalls()[0]).toEqual({ page: 1, limit: 24 });
  });

  it('có q trên URL: ẩn lưới danh mục, gọi API với q', async () => {
    nav.search = 'q=nuoc';
    const { container } = mount();
    await flush();
    expect(container.querySelector('section[aria-label="Danh mục"]')).toBeNull();
    expect(productCalls()[0]).toEqual({ page: 1, limit: 24, q: 'nuoc' });
  });

  it('danh sách đầu do server đưa vào hiện ngay, không gọi lại /products khi đúng URL ban đầu', async () => {
    const initial = { urlKey: '', startPage: 1, page: { ...pageOf([product(7)], 1), filtersIgnored: false } };
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
    expect(productCalls()[0]).toEqual({ page: 1, limit: 24, sort: 'newest' });
  });

  it('chạm danh mục ghi category vào URL (replace) và xoá q; phân khúc dự phòng ghi segment', async () => {
    const { container } = mount();
    await flush();
    click(buttonByName(container, 'Dầu gội'));
    expect(nav.replaces.at(-1)).toBe('/san-pham?category=c-goi');
    routes['/categories'] = () => [];
    nav.search = '';
    mounted!.unmount();
    const again = mount();
    await flush();
    click(buttonByName(again.container, 'Sống xanh'));
    expect(nav.replaces.at(-1)).toBe('/san-pham?segment=eco');
  });

  it('chip đang lọc hiện tên danh mục và gỡ được từng cái; số bộ lọc ghi trên nút Bộ lọc', async () => {
    nav.search = 'category=c-goi&inStock=1&brand=Tubu';
    const { container } = mount({ categories: CATEGORIES, brands: BRANDS });
    await flush();
    expect(buttonByName(container, 'Bỏ lọc Dầu gội')).not.toBeNull();
    expect(buttonByName(container, 'Bộ lọc (2)')).not.toBeNull();
    click(buttonByName(container, 'Bỏ lọc Còn hàng'));
    expect(nav.replaces.at(-1)).toBe('/san-pham?category=c-goi&brand=Tubu');
  });

  it('nhãn đã công khai: lọc đúng một nhãn có liên kết tới /brand/:slug', async () => {
    nav.search = 'brand=Tubu';
    const { container } = mount({ brands: BRANDS });
    await flush();
    expect(container.querySelector('a[href="/brand/tubu-xanh"]')!.textContent).toContain('Xem trang nhãn hàng Tubu');
    mounted!.unmount();
    nav.search = 'brand=M%E1%BB%99c+An';
    mount({ brands: BRANDS });
    await flush();
    expect(mounted!.container.querySelector('a[href^="/brand/"]')).toBeNull();
  });
});

describe('BrowseView — sắp xếp', () => {
  it('năm chip: Gợi ý (mặc định) chọn sẵn; chạm chip ghi sort vào URL, chạm lại chip đang chọn không làm gì', async () => {
    const { container } = mount();
    await flush();
    const group = container.querySelector('[role="group"][aria-label="Sắp xếp"]')!;
    expect([...group.querySelectorAll('button')].map((b) => b.textContent)).toEqual(['Gợi ý', 'Bán chạy', 'Mới nhất', 'Giá tăng', 'Giá giảm']);
    expect(buttonByName(group, 'Gợi ý')!.getAttribute('aria-pressed')).toBe('true');
    click(buttonByName(group, 'Giá tăng'));
    expect(nav.replaces.at(-1)).toBe('/san-pham?sort=price_asc');
    await flush();
    expect(productCalls().at(-1)).toEqual({ page: 1, limit: 24, sort: 'price_asc' });
    const count = nav.replaces.length;
    click(buttonByName(container.querySelector('[role="group"][aria-label="Sắp xếp"]')!, 'Giá tăng'));
    expect(nav.replaces).toHaveLength(count);
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
    expect(nav.replaces.at(-1)).toBe('/san-pham?q=n%C6%B0%E1%BB%9Bc');
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

  it('nút Xoá từ khoá bỏ q khỏi URL; "Hủy" trả ô về q đang lọc', async () => {
    nav.search = 'q=nuoc';
    const { container } = mount();
    await flush();
    const input = container.querySelector<HTMLInputElement>('input[type="search"]')!;
    act(() => input.focus());
    typeInto(input, 'dở dang');
    click(buttonByName(container, 'Hủy'));
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
    routes['/products'] = (q) => (q?.limit === 1 ? pageOf([product(1)], 5, 1, 1) : pageOf([product(1), product(2)], 2));
    const { container } = mount({ brands: BRANDS });
    await flush();
    click(buttonByName(container, 'Bộ lọc'));
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
    expect(container.textContent).toContain('Bộ lọc nâng cao chưa dùng được lúc này');
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

describe('BrowseView — tải thêm, rỗng, lỗi', () => {
  it('còn trang sau: "Xem thêm" tải trang 2 và nối vào cuối, không trùng; hết trang thì ẩn nút', async () => {
    routes['/products'] = (q) => (Number(q?.page) === 2 ? pageOf([product(2), product(3)], 3, 2, 2) : pageOf([product(1), product(2)], 3, 1, 2));
    const { container } = mount();
    await flush();
    click(buttonByName(container, 'Xem thêm'));
    await flush();
    expect(productCalls().at(-1)).toEqual({ page: 2, limit: 24 });
    expect(container.querySelectorAll('a[href^="/san-pham/sp-"]')).toHaveLength(3);
    expect(buttonByName(container, 'Xem thêm')).toBeNull();
  });

  it('trang đầu do server tải là trang 2: "Xem thêm" tải tiếp trang 3', async () => {
    const initial = { urlKey: '', startPage: 2, page: { ...pageOf([product(7)], 100, 2, 24), filtersIgnored: false } };
    const { container } = mount({ initial });
    await flush();
    click(buttonByName(container, 'Xem thêm'));
    await flush();
    expect(productCalls().at(-1)).toEqual({ page: 3, limit: 24 });
  });

  it('tìm không ra: nói rõ từ khoá, không đổ lỗi cho bộ lọc, có lối thoát', async () => {
    nav.search = 'q=xyz';
    routes['/products'] = () => pageOf([], 0);
    const { container } = mount();
    await flush();
    expect(container.textContent).toContain('Không tìm thấy "xyz"');
    expect(buttonByName(container, 'Xoá tìm kiếm & bộ lọc')).not.toBeNull();
  });

  it('catalog trống ở trang gốc: báo chưa có sản phẩm, không có nút xoá bộ lọc', async () => {
    routes['/products'] = () => pageOf([], 0);
    const { container } = mount();
    await flush();
    expect(container.textContent).toContain('Chưa có sản phẩm');
    expect(buttonByName(container, 'Xoá tìm kiếm & bộ lọc')).toBeNull();
  });

  it('lỗi tải lần đầu: báo lỗi và "Thử lại" tải lại được', async () => {
    let fail = true;
    routes['/products'] = () => {
      if (fail) throw new Error('Mất kết nối');
      return pageOf([product(1)], 1);
    };
    const { container } = mount();
    await flush(8);
    expect(container.querySelector('[role="alert"]')!.textContent).toContain('Mất kết nối');
    fail = false;
    click(buttonByName(container, 'Thử lại'));
    await flush(8);
    expect(container.textContent).toContain('Sản phẩm 1');
  });

  it('lỗi khi "Xem thêm": giữ nguyên danh sách, báo và thử lại tại chỗ', async () => {
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
    expect(rail.querySelectorAll('li')).toHaveLength(1);
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
  it('mọi điều khiển có tên, ô tìm có nhãn, vùng chạm 44px', async () => {
    nav.search = 'q=nuoc&inStock=1';
    const { container } = mount({ brands: BRANDS, categories: CATEGORIES });
    await flush();
    expect(unnamedControls(container)).toEqual([]);
    expect(unlabeledFields(container)).toEqual([]);
    expect(smallTouchTargets(container)).toEqual([]);
  });
});
