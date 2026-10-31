// @vitest-environment jsdom
import { LayoutGrid } from 'lucide-react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { byText, click, flush, render, type Rendered } from '@/test-utils/dom';
import { SEGMENT_ENTRIES, type CategoryEntry } from '@/lib/browse-categories';

const http = vi.hoisted(() => ({ get: vi.fn() }));
vi.mock('@/lib/core-http', () => ({ coreHttp: { get: http.get } }));
vi.mock('@/lib/use-flash-sales', () => ({ useActiveFlashSales: () => [] }));
vi.mock('@/lib/auth-phase', () => ({ useAuthPhase: () => 'guest' }));
vi.mock('next/navigation', () => ({
  usePathname: () => '/san-pham',
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));

import { BrowseHub, type BrowseHubProps } from './browse-hub';

const P = (i: number) => ({ id: `p${i}`, slug: `p${i}`, brand: 'Tubu', name: `Bán chạy ${i}`, thumbnail: null, basePrice: 45000, salePrice: null, isFeatured: false, inStock: true });
const page = (n: number) => ({ data: Array.from({ length: n }, (_, i) => P(i + 1)), meta: { page: 1, limit: 10, total: n } });
const flat = (n: number): CategoryEntry[] => Array.from({ length: n }, (_, i) => ({ kind: 'category', key: `c${i}`, label: `Mục ${i + 1}`, icon: LayoutGrid, image: null }));
const BRANDS = [{ brand: 'Tubu', count: 9 }, { brand: 'Cỏ Mềm', count: 5 }, { brand: 'Xanh', count: 3 }, { brand: 'Lá', count: 2 }];
const handlers = { onPickCategory: vi.fn(), onPickAll: vi.fn(), onPickBrand: vi.fn() };

let mounted: Rendered | null = null;
const mount = (over: Partial<BrowseHubProps> = {}) => {
  mounted?.unmount();
  mounted = render(<BrowseHub entries={SEGMENT_ENTRIES} categoriesLoading={false} placeholderCount={4} brands={BRANDS} {...handlers} {...over} />);
  return mounted.container;
};
const region = (c: ParentNode, name: string) => c.querySelector<HTMLElement>(`section[aria-label="${name}"]`);
const button = (c: ParentNode, name: string) => c.querySelector<HTMLElement>(`button[aria-label="${name}"]`) ?? byText(c, 'button', name);

beforeEach(() => {
  mounted?.unmount();
  mounted = null;
  localStorage.clear();
  vi.clearAllMocks();
  http.get.mockResolvedValue(page(10));
});

describe('BrowseHub', () => {
  it('API best-sellers trả 10: kệ "Bán chạy nhất" có 10 thẻ hạng 1..10, gọi sort=best_seller_30d', async () => {
    const c = mount();
    await flush();
    const rail = region(c, 'Bán chạy nhất')!;
    const ranks = [...rail.querySelectorAll('[data-ds-part="rank"]')].map((n) => n.textContent);
    expect(ranks).toEqual(Array.from({ length: 10 }, (_, i) => `#${i + 1}`));
    expect(http.get).toHaveBeenCalledWith('/products', { query: { sort: 'best_seller_30d', limit: 10 } });
  });

  it('kệ "Xem tất cả" là liên kết thật tới trang Bán chạy nhất', async () => {
    const c = mount();
    await flush();
    const link = region(c, 'Bán chạy nhất')!.querySelector<HTMLAnchorElement>('a[aria-label="Xem tất cả Bán chạy nhất"]')!;
    expect(link.getAttribute('href')).toBe('/ban-chay');
  });

  it('dữ liệu do server đưa vào hiện ngay, không gọi lại /products', async () => {
    const c = mount({ initialBestSellers: page(10).data });
    expect(region(c, 'Bán chạy nhất')!.querySelectorAll('[data-ds-part="rank"]')).toHaveLength(10);
    await flush();
    expect(http.get.mock.calls.filter(([path]) => path === '/products')).toEqual([]);
  });

  it('API trả 2 món: kệ ẩn hẳn, nút "Xem tất cả sản phẩm" vẫn còn', async () => {
    http.get.mockResolvedValue(page(2));
    const c = mount();
    await flush();
    expect(region(c, 'Bán chạy nhất')).toBeNull();
    expect(button(c, 'Xem tất cả sản phẩm')).not.toBeNull();
  });

  it('API lỗi: kệ ẩn, phần còn lại của hub không đổ', async () => {
    http.get.mockRejectedValue(Object.assign(new Error('500'), { status: 500 }));
    const c = mount();
    await flush(8);
    expect(c.textContent).not.toContain('Bán chạy nhất');
    expect(region(c, 'Danh mục')).not.toBeNull();
    expect(button(c, 'Xem tất cả sản phẩm')).not.toBeNull();
  });

  it('cây danh mục rỗng: 4 phân khúc dự phòng vẫn vẽ 4 ô + "Tất cả"; chạm ô gọi onPickCategory', async () => {
    const c = mount({ entries: SEGMENT_ENTRIES });
    const cats = region(c, 'Danh mục')!;
    expect(cats.querySelectorAll('button')).toHaveLength(5);
    click(button(cats, SEGMENT_ENTRIES[0]!.label));
    expect(handlers.onPickCategory).toHaveBeenCalledWith(SEGMENT_ENTRIES[0]);
    await flush();
  });

  it('danh mục gốc phẳng 7 mục: 7 ô + "Tất cả"', async () => {
    const c = mount({ entries: flat(7) });
    expect(region(c, 'Danh mục')!.querySelectorAll('button')).toHaveLength(8);
    await flush();
  });

  it('thứ tự: Danh mục, Đã xem (nếu có), Bán chạy nhất, Thương hiệu, nút Xem tất cả', async () => {
    localStorage.setItem('tubu_recently_viewed', JSON.stringify([{ slug: 'a', name: 'Sản phẩm A', thumbnail: null, viewedAt: 1 }]));
    http.get.mockImplementation(async (_path: string, opts?: { query?: Record<string, unknown> }) =>
      opts?.query?.slugs ? { data: [{ ...P(99), slug: 'a', name: 'Sản phẩm A' }], meta: { page: 1, limit: 1, total: 1 } } : page(10));
    const c = mount();
    await flush();
    expect([...c.querySelectorAll('h2')].map((h) => h.textContent)).toEqual(['Danh mục', 'Đã xem gần đây', 'Bán chạy nhất', 'Thương hiệu']);
    expect(c.lastElementChild!.contains(button(c, 'Xem tất cả sản phẩm'))).toBe(true);
  });

  it('nút lớn → onPickAll; ô thương hiệu → onPickBrand', async () => {
    const c = mount();
    await flush();
    click(button(c, 'Xem tất cả sản phẩm'));
    expect(handlers.onPickAll).toHaveBeenCalledTimes(1);
    click(button(c, 'Xem thương hiệu Cỏ Mềm'));
    expect(handlers.onPickBrand).toHaveBeenCalledWith('Cỏ Mềm');
  });

  it('không có chữ "Top", "Voucher", "cửa hàng" trên hub', async () => {
    const c = mount();
    await flush();
    expect(c.textContent).not.toMatch(/\bTop\b|Voucher|cửa hàng/);
  });
});
