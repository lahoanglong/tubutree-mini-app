// @vitest-environment jsdom
import { useSyncExternalStore } from 'react';
import { act } from 'react';
import { QueryClient } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { click, flush, render, type Rendered } from '@/test-utils/dom';
import { resetFlashSales } from '@/lib/use-flash-sales';

const mocks = vi.hoisted(() => ({ wide: false, subs: new Set<() => void>(), fetchPage: vi.fn() }));
vi.mock('@/lib/use-media-query', () => ({
  useMediaQuery: () =>
    useSyncExternalStore(
      (cb) => {
        mocks.subs.add(cb);
        return () => mocks.subs.delete(cb);
      },
      () => mocks.wide,
    ),
}));
const setWide = (v: boolean) =>
  act(() => {
    mocks.wide = v;
    mocks.subs.forEach((cb) => cb());
  });
vi.mock('@/lib/shop-brand-products', () => ({ fetchBrandProductsPage: mocks.fetchPage }));
vi.mock('@/lib/shop-client', () => ({ getActiveFlashSales: async () => [] }));
vi.mock('@/lib/auth-phase', () => ({ useAuthPhase: () => 'guest' }));
vi.mock('@/lib/core-http', () => ({ coreHttp: { get: async () => [], post: async () => ({}), delete: async () => ({}) } }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: () => undefined }) }));

import { ShopProductsTab } from './shop-products-tab';

const product = (n: number) => ({
  id: `p${n}`, slug: `sp-${n}`, brand: 'Tubu', name: `Sản phẩm ${n}`, thumbnail: null,
  basePrice: 10_000 + n * 1_000, salePrice: null, isFeatured: false, inStock: true, sold: n, createdAt: new Date(2026, 0, n).toISOString(),
});
const PRODUCTS = Array.from({ length: 45 }, (_, i) => product(i + 1));
const slugs = (c: HTMLElement) => Array.from(c.querySelectorAll<HTMLAnchorElement>('a[href^="/san-pham/"]')).map((a) => a.getAttribute('href')!.replace('/san-pham/', ''));
const btn = (c: HTMLElement, name: string) =>
  Array.from(c.querySelectorAll('button')).find((b) => (b.getAttribute('aria-label') ?? b.textContent) === name || b.textContent === name);

let mounted: Rendered[] = [];
const mount = async (ui: React.ReactElement) => {
  const r = render(ui);
  mounted.push(r);
  await flush();
  return r.container;
};
beforeEach(() => {
  resetFlashSales();
  mocks.wide = false;
  mocks.fetchPage.mockReset().mockImplementation(async (_slug: string, q: { page?: number }) => {
    const page = q.page ?? 1;
    return { data: PRODUCTS.slice((page - 1) * 20, page * 20), meta: { total: 45, page, limit: 20 } };
  });
});
afterEach(() => {
  mounted.forEach((m) => m.unmount());
  mounted = [];
});

describe('ShopProductsTab (web) — nguồn local (gian hàng CTV)', () => {
  it('điện thoại: 20 thẻ đầu, "Xem thêm" cộng dồn tới hết 45 rồi biến mất; không có phân trang số', async () => {
    const c = await mount(<ShopProductsTab source={{ kind: 'local', products: PRODUCTS }} />);
    expect(slugs(c)).toHaveLength(20);
    expect(c.querySelector('nav')).toBeNull();
    click(btn(c, 'Xem thêm')!);
    expect(slugs(c)).toHaveLength(40);
    click(btn(c, 'Xem thêm')!);
    expect(slugs(c)).toHaveLength(45);
    expect(btn(c, 'Xem thêm')).toBeUndefined();
  });

  it('từ lg: 20 thẻ và phân trang 3 trang; bấm trang 2 thay danh sách bằng thẻ khác, không có "Xem thêm"', async () => {
    mocks.wide = true;
    const c = await mount(<ShopProductsTab source={{ kind: 'local', products: PRODUCTS }} />);
    expect(slugs(c)).toEqual(PRODUCTS.slice(0, 20).map((p) => p.slug));
    expect(c.querySelectorAll('nav button[aria-label^="Trang "]').length).toBeGreaterThanOrEqual(3);
    expect(btn(c, 'Xem thêm')).toBeUndefined();
    click(btn(c, 'Trang 2')!);
    expect(slugs(c)).toEqual(PRODUCTS.slice(20, 40).map((p) => p.slug));
    click(btn(c, 'Trang 3')!);
    expect(slugs(c)).toHaveLength(5);
  });

  it('đổi sắp xếp: "Mới" đặt món mới nhất lên đầu và về lại trang đầu', async () => {
    mocks.wide = true;
    const c = await mount(<ShopProductsTab source={{ kind: 'local', products: PRODUCTS }} />);
    click(btn(c, 'Trang 2')!);
    click(btn(c, 'Mới')!);
    expect(slugs(c)[0]).toBe('sp-45');
    expect(c.querySelector('[aria-current="page"]')?.textContent).toBe('1');
  });

  it('ở điện thoại thanh sắp xếp dính, từ md trở lên thì không (tránh đè thanh đầu trang của web)', async () => {
    const phone = await mount(<ShopProductsTab source={{ kind: 'local', products: PRODUCTS }} />);
    expect(phone.querySelector<HTMLElement>('[role="group"]')!.parentElement!.style.position).toBe('sticky');
    mocks.wide = true;
    const wide = await mount(<ShopProductsTab source={{ kind: 'local', products: PRODUCTS }} />);
    expect(wide.querySelector<HTMLElement>('[role="group"]')!.parentElement!.style.position).toBe('');
  });

  it('chưa có sản phẩm: thông báo rỗng, không thanh sắp xếp', async () => {
    const c = await mount(<ShopProductsTab source={{ kind: 'local', products: [] }} />);
    expect(c.textContent).toContain('Shop chưa có sản phẩm nào để hiện');
    expect(c.querySelector('[role="group"]')).toBeNull();
  });

  it('đang xem riêng một bộ: chip "<tên>, bỏ lọc" bấm gọi onClear', async () => {
    const onClear = vi.fn();
    const c = await mount(<ShopProductsTab source={{ kind: 'local', products: PRODUCTS }} scope={{ label: 'Bếp xanh', onClear }} />);
    click(btn(c, 'Bếp xanh, bỏ lọc')!);
    expect(onClear).toHaveBeenCalledOnce();
  });
});

describe('ShopProductsTab (web) — nguồn thương hiệu (phân trang thật)', () => {
  it('điện thoại: gọi trang 1 với limit 20, "Xem thêm" gọi trang 2 và nối vào danh sách', async () => {
    const c = await mount(<ShopProductsTab source={{ kind: 'brand', slug: 'fuwa' }} showBrand={false} />);
    expect(mocks.fetchPage).toHaveBeenCalledWith('fuwa', { page: 1, limit: 20, sort: undefined });
    expect(slugs(c)).toHaveLength(20);
    click(btn(c, 'Xem thêm')!);
    await flush();
    expect(mocks.fetchPage).toHaveBeenLastCalledWith('fuwa', { page: 2, limit: 20, sort: undefined });
    expect(slugs(c)).toHaveLength(40);
  });

  it('từ lg: bấm trang 2 gọi API trang 2 và thay danh sách; đổi sắp xếp gửi sort lên API và về trang 1', async () => {
    mocks.wide = true;
    const c = await mount(<ShopProductsTab source={{ kind: 'brand', slug: 'fuwa' }} />);
    click(btn(c, 'Trang 2')!);
    await flush();
    expect(mocks.fetchPage).toHaveBeenLastCalledWith('fuwa', { page: 2, limit: 20, sort: undefined });
    expect(slugs(c)[0]).toBe('sp-21');
    click(btn(c, 'Mới')!);
    await flush();
    expect(mocks.fetchPage).toHaveBeenLastCalledWith('fuwa', { page: 1, limit: 20, sort: 'newest' });
    expect(c.querySelector('[aria-current="page"]')?.textContent).toBe('1');
  });

  it('đổi khổ giữa chừng (điện thoại sang lg và ngược lại): trang đã tải được dùng lại, không gọi trang 1 lần hai', async () => {
    const c = await mount(<ShopProductsTab source={{ kind: 'brand', slug: 'fuwa' }} showBrand={false} />);
    expect(mocks.fetchPage).toHaveBeenCalledTimes(1);
    setWide(true);
    await flush();
    expect(c.querySelector('nav button[aria-label^="Trang "]')).not.toBeNull();
    expect(slugs(c)).toHaveLength(20);
    expect(mocks.fetchPage).toHaveBeenCalledTimes(1);
    setWide(false);
    await flush();
    expect(btn(c, 'Xem thêm')).toBeDefined();
    expect(slugs(c)).toHaveLength(20);
    expect(mocks.fetchPage).toHaveBeenCalledTimes(1);
  });

  it('mở thẳng ở lg: đúng một lần gọi trang 1', async () => {
    mocks.wide = true;
    const c = await mount(<ShopProductsTab source={{ kind: 'brand', slug: 'fuwa' }} showBrand={false} />);
    expect(slugs(c)).toHaveLength(20);
    expect(mocks.fetchPage).toHaveBeenCalledTimes(1);
  });

  it('lỗi tải: báo lỗi có nút Thử lại gọi lại API; thương hiệu rỗng: thông báo rỗng', async () => {
    mocks.fetchPage.mockRejectedValueOnce(new Error('boom'));
    const c = await mount(<ShopProductsTab source={{ kind: 'brand', slug: 'fuwa' }} />);
    expect(c.querySelector('[data-testid="error-message"]')).not.toBeNull();
    click(btn(c, 'Thử lại')!);
    await flush();
    expect(slugs(c)).toHaveLength(20);
    mocks.fetchPage.mockResolvedValue({ data: [], meta: { total: 0, page: 1, limit: 20 } });
    const empty = await mount(<ShopProductsTab source={{ kind: 'brand', slug: 'rong' }} />);
    expect(empty.textContent).toContain('Shop chưa có sản phẩm nào để hiện');
  });
});

describe('ShopProductsTab (web) — nguồn thương hiệu ở điện thoại: khoá "Xem thêm" và "Thử lại" trang kế', () => {
  const page = (from: number, count: number) => ({
    data: PRODUCTS.slice(from - 1, from - 1 + count),
    meta: { total: 45, page: 1, limit: 20 },
  });
  const pending = <T,>() => {
    let resolve!: (v: T) => void;
    const promise = new Promise<T>((res) => {
      resolve = res;
    });
    return { promise, resolve };
  };
  const newClient = () => new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  const mountWith = async (qc: QueryClient) => {
    const r = render(<ShopProductsTab source={{ kind: 'brand', slug: 'fuwa' }} />, qc);
    mounted.push(r);
    await flush();
    return r.container;
  };
  // `queryFn` của danh sách nối dài gọi `qc.fetchQuery` cho từng trang, và `fetchQuery` dùng chung lượt đang bay cho cùng khoá, nên đếm lời gọi `fetchPage` không
  // thấy được lần `fetchNextPage` thứ hai (nó chỉ huỷ lượt cũ rồi chạy lại queryFn). Đếm `fetchQuery` của trang 2 thì thấy: mỗi lần `fetchNextPage` lọt qua khoá là một lần.
  const page2Asks = (fq: { mock: { calls: unknown[][] } }) =>
    fq.mock.calls.filter(([o]) => (o as { queryKey: unknown[] }).queryKey[3] === 2).length;
  const twice = (el: HTMLElement) =>
    act(() => {
      el.click();
      el.click();
    });

  it('chạm đúp "Xem thêm" trong cùng một khung hình: chỉ xin trang 2 một lần; xong thì bấm tiếp xin được trang 3', async () => {
    const qc = newClient();
    const fq = vi.spyOn(qc, 'fetchQuery');
    const c = await mountWith(qc);
    const next = pending<ReturnType<typeof page>>();
    mocks.fetchPage.mockImplementationOnce(() => next.promise);
    twice(btn(c, 'Xem thêm')!);
    await flush(2);
    expect(page2Asks(fq)).toBe(1);
    expect(btn(c, 'Xem thêm')!.getAttribute('aria-busy')).toBe('true');
    await act(async () => next.resolve(page(21, 20)));
    await flush();
    expect(slugs(c)).toHaveLength(40);
    click(btn(c, 'Xem thêm')!);
    await flush();
    expect(slugs(c)).toHaveLength(45);
    expect(mocks.fetchPage).toHaveBeenLastCalledWith('fuwa', { page: 3, limit: 20, sort: undefined });
  });

  it('trang kế lỗi: chạm đúp "Thử lại" trong cùng một khung hình chỉ xin lại một lần; lỗi tiếp thì nhả khoá, bấm lại xin được', async () => {
    const qc = newClient();
    const fq = vi.spyOn(qc, 'fetchQuery');
    const c = await mountWith(qc);
    mocks.fetchPage.mockRejectedValueOnce(new Error('mạng'));
    click(btn(c, 'Xem thêm')!);
    await flush();
    const retry = btn(c, 'Thử lại')!;
    expect(retry).toBeDefined();
    expect(page2Asks(fq)).toBe(1);

    const again = pending<ReturnType<typeof page>>();
    mocks.fetchPage.mockImplementationOnce(() => again.promise);
    twice(retry);
    await flush(2);
    expect(page2Asks(fq)).toBe(2);
    expect(btn(c, 'Thử lại')!.getAttribute('aria-busy')).toBe('true');
    expect(btn(c, 'Thử lại')!.getAttribute('aria-disabled')).toBe('true');
    expect(btn(c, 'Thử lại')!.disabled).toBe(false);

    await act(async () => {
      again.resolve(page(21, 20));
    });
    await flush();
    expect(slugs(c)).toHaveLength(40);
  });

  it('trang kế lỗi hai lần liền: lần hai lỗi thì nhả khoá, bấm lại vẫn xin được', async () => {
    const qc = newClient();
    const fq = vi.spyOn(qc, 'fetchQuery');
    const c = await mountWith(qc);
    mocks.fetchPage.mockRejectedValueOnce(new Error('mạng 1')).mockRejectedValueOnce(new Error('mạng 2'));
    click(btn(c, 'Xem thêm')!);
    await flush();
    click(btn(c, 'Thử lại')!);
    await flush();
    expect(page2Asks(fq)).toBe(2);
    expect(btn(c, 'Thử lại')!.getAttribute('aria-busy')).toBeNull();
    click(btn(c, 'Thử lại')!);
    await flush();
    expect(page2Asks(fq)).toBe(3);
    expect(slugs(c)).toHaveLength(40);
  });

  it('đang chờ trang 2 của "Mới" rồi đổi về "Phổ biến" đã có sẵn: "Xem thêm" của "Phổ biến" xin trang 2 ngay, không bị nuốt vì khoá của "Mới"', async () => {
    const heldNewestPage2 = pending<ReturnType<typeof page>>();
    mocks.fetchPage.mockImplementation(async (_slug: string, q: { page?: number; sort?: string } = {}) => {
      const n = q.page ?? 1;
      if (q.sort === 'newest' && n === 2) return heldNewestPage2.promise;
      return page((n - 1) * 20 + 1, 20);
    });
    const c = await mount(<ShopProductsTab source={{ kind: 'brand', slug: 'fuwa' }} />);
    expect(slugs(c)).toHaveLength(20);

    click(btn(c, 'Mới')!);
    await flush();
    expect(mocks.fetchPage).toHaveBeenCalledWith('fuwa', { page: 1, limit: 20, sort: 'newest' });
    click(btn(c, 'Xem thêm')!);
    await flush();
    expect(mocks.fetchPage).toHaveBeenCalledWith('fuwa', { page: 2, limit: 20, sort: 'newest' });

    click(btn(c, 'Phổ biến')!);
    await flush();
    expect(mocks.fetchPage).not.toHaveBeenCalledWith('fuwa', { page: 2, limit: 20, sort: undefined });
    click(btn(c, 'Xem thêm')!);
    await flush();
    expect(mocks.fetchPage).toHaveBeenCalledWith('fuwa', { page: 2, limit: 20, sort: undefined });
    expect(slugs(c)).toHaveLength(40);

    await act(async () => heldNewestPage2.resolve(page(21, 20)));
  });
});

describe('ShopProductsTab (web) — nguồn thương hiệu: "Thử lại" khi truy vấn đã có data (refetch lần hai huỷ lần đầu)', () => {
  const newClient = () => new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  const mountWith = async (qc: QueryClient) => {
    const r = render(<ShopProductsTab source={{ kind: 'brand', slug: 'fuwa' }} />, qc);
    mounted.push(r);
    await flush();
    return r.container;
  };
  const hold = <T,>() => {
    let resolve!: (v: T) => void;
    const promise = new Promise<T>((res) => {
      resolve = res;
    });
    return { promise, resolve };
  };
  const twice = (el: HTMLElement) =>
    act(() => {
      el.click();
      el.click();
    });
  const emptyPage = { data: [] as unknown[], meta: { total: 0, page: 1, limit: 20 } };
  // Danh sách nối dài gọi trang qua `qc.fetchQuery` và các lời gọi chồng nhau dùng chung một lượt bay, nên đếm `fetchPage` không thấy lần `refetch` thứ hai;
  // đếm `fetchQuery` của trang 1 thì thấy: mỗi lần `refetch` lọt qua khoá là một lần.
  const page1Asks = (fq: { mock: { calls: unknown[][] } }) =>
    fq.mock.calls.filter(([o]) => (o as { queryKey: unknown[] }).queryKey[3] === 1).length;

  it('phân trang số (lg): trang đã tải rồi tải lại lỗi, chạm đúp "Thử lại" trong cùng một khung hình chỉ gọi API thêm một lần', async () => {
    mocks.wide = true;
    const qc = newClient();
    const c = await mountWith(qc);
    expect(slugs(c)).toHaveLength(20);

    mocks.fetchPage.mockRejectedValueOnce(new Error('mạng'));
    await act(async () => {
      await qc.refetchQueries({ queryKey: ['brand-products-page'] });
    });
    await flush(2);
    const retry = btn(c, 'Thử lại')!;
    expect(retry).toBeDefined();
    const before = mocks.fetchPage.mock.calls.length;

    const next = hold<unknown>();
    mocks.fetchPage.mockImplementationOnce(() => next.promise);
    twice(retry);
    await flush(2);
    expect(mocks.fetchPage.mock.calls.length - before).toBe(1);
    expect(btn(c, 'Thử lại')!.getAttribute('aria-busy')).toBe('true');
    expect(btn(c, 'Thử lại')!.getAttribute('aria-disabled')).toBe('true');
    expect(btn(c, 'Thử lại')!.disabled).toBe(false);

    await act(async () => {
      next.resolve({ data: PRODUCTS.slice(0, 20), meta: { total: 45, page: 1, limit: 20 } });
    });
    await flush();
    expect(btn(c, 'Thử lại')).toBeUndefined();
    expect(slugs(c)).toHaveLength(20);
  });

  it('nối dài (điện thoại): thương hiệu rỗng rồi tải lại lỗi, chạm đúp "Thử lại" trong cùng một khung hình chỉ xin trang 1 thêm một lần', async () => {
    const qc = newClient();
    const fq = vi.spyOn(qc, 'fetchQuery');
    mocks.fetchPage.mockResolvedValueOnce(emptyPage);
    const c = await mountWith(qc);
    expect(c.textContent).toContain('Shop chưa có sản phẩm nào để hiện');

    // Trang 1 nằm trong bộ nhớ đệm 60 giây nên `fetchQuery` sẽ trả ngay không gọi API: bỏ nó đi để lần tải lại của danh sách nối dài thật sự đi mạng và lỗi.
    qc.removeQueries({ queryKey: ['brand-products-page'] });
    mocks.fetchPage.mockRejectedValueOnce(new Error('mạng'));
    await act(async () => {
      await qc.refetchQueries({ queryKey: ['brand-products'] });
    });
    await flush(2);
    const retry = btn(c, 'Thử lại')!;
    expect(retry).toBeDefined();
    const before = page1Asks(fq);

    const next = hold<typeof emptyPage>();
    mocks.fetchPage.mockImplementationOnce(() => next.promise);
    twice(retry);
    await flush(2);
    expect(page1Asks(fq) - before).toBe(1);
    expect(btn(c, 'Thử lại')!.getAttribute('aria-busy')).toBe('true');
    expect(btn(c, 'Thử lại')!.getAttribute('aria-disabled')).toBe('true');

    await act(async () => {
      next.resolve(emptyPage);
    });
    await flush();
    expect(btn(c, 'Thử lại')).toBeUndefined();
    expect(c.textContent).toContain('Shop chưa có sản phẩm nào để hiện');
  });
});
