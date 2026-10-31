// @vitest-environment jsdom
import { useSyncExternalStore } from 'react';
import { act } from 'react';
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
