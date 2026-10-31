// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { QueryClientProvider } from '@tanstack/react-query';
import { click, flush, render, type Rendered } from '@/test-utils/dom';
import { newTestClient } from '@/test-utils/render-hook';

const mocks = vi.hoisted(() => ({ get: vi.fn(), push: vi.fn(), phase: 'guest', desktop: false, now: 0 }));
vi.mock('@/lib/core-http', () => ({ coreHttp: { get: mocks.get, post: vi.fn(), delete: vi.fn() } }));
vi.mock('@/lib/auth-phase', () => ({ useAuthPhase: () => mocks.phase, useAuthRestoring: () => false }));
vi.mock('@/lib/use-flash-sales', async (importOriginal) => ({ ...(await importOriginal<typeof import('@/lib/use-flash-sales')>()), useActiveFlashSales: () => [] }));
vi.mock('@tubutree/app-core/server-clock', async (importOriginal) => ({ ...(await importOriginal<Record<string, unknown>>()), serverNow: () => mocks.now }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: mocks.push }) }));

import { SuggestFeed } from './suggest-feed';

const card = (n: number) => ({
  id: `p${n}`, slug: `sp-${n}`, brand: 'Tubu', name: `Sản phẩm ${n}`, thumbnail: null, basePrice: 100000, salePrice: null, isFeatured: false, inStock: true,
});
const cards = (from: number, n: number) => Array.from({ length: n }, (_, i) => card(from + i));
const page = (data: unknown[], extra: Record<string, number> = {}) => ({ data, meta: { page: 1, limit: 20, total: data.length, ...extra } });
const cat = (id: string, name: string, productCount: number, parentId: string | null = null) => ({ id, parentId, name, slug: id, image: null, sortOrder: 1, productCount, children: [] });

let mounted: Rendered | null = null;
const mount = async (props: Partial<React.ComponentProps<typeof SuggestFeed>> = {}) => {
  mounted = render(
    <QueryClientProvider client={newTestClient()}>
      <SuggestFeed categories={[]} exclude={new Set()} {...props} />
    </QueryClientProvider>,
  );
  await flush(8);
  return mounted.container;
};
const productCalls = () => mocks.get.mock.calls.filter(([path]) => path === '/products');
const tiles = (c: HTMLElement) => Array.from(c.querySelectorAll('a.tubu-tile-link'));
const chipLabels = (c: HTMLElement) => Array.from(c.querySelectorAll('[role="region"][aria-label="Lọc gợi ý theo danh mục"] button')).map((b) => b.textContent);

beforeEach(() => {
  mocks.phase = 'guest';
  mocks.desktop = false;
  // 08:00 ngày 01/11/2026 giờ Việt Nam.
  mocks.now = Date.parse('2026-11-01T01:00:00.000Z');
  mocks.get.mockReset().mockImplementation(async (path: string) => (path === '/products' ? page(cards(1, 4)) : []));
  mocks.push.mockReset();
  window.matchMedia = ((query: string) => ({
    matches: query.includes('min-width: 1024px') ? mocks.desktop : false,
    media: query,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    addListener: () => undefined,
    removeListener: () => undefined,
    onchange: null,
    dispatchEvent: () => false,
  })) as typeof window.matchMedia;
});
afterEach(() => {
  mounted?.unmount();
  mounted = null;
});

describe('SuggestFeed (web) — Gợi ý hôm nay (Q9)', () => {
  it('tiêu đề "Gợi ý hôm nay" bằng SectionHeader; mọi lời gọi gửi seed là ngày Việt Nam YYYYMMDD; hai lần mở cùng ngày gửi cùng seed', async () => {
    const c = await mount();
    expect(c.querySelector('h2')?.textContent).toBe('Gợi ý hôm nay');
    expect(c.querySelector('[data-testid="section-header"]')).not.toBeNull();
    expect(productCalls()[0]).toEqual(['/products', { query: { page: 1, limit: 20, seed: '20261101' } }]);
    mounted!.unmount();
    mocks.get.mockClear();
    await mount();
    expect(productCalls()[0]![1]).toEqual({ query: { page: 1, limit: 20, seed: '20261101' } });
  });

  it('dữ liệu dựng sẵn của máy chủ khớp hạt giống: có lưới ngay ở lần vẽ đầu, không gọi lại trang 1', async () => {
    mounted = render(
      <QueryClientProvider client={newTestClient()}>
        <SuggestFeed categories={[]} exclude={new Set()} initial={page(cards(1, 4)) as never} seed="20261101" />
      </QueryClientProvider>,
    );
    expect(tiles(mounted.container)).toHaveLength(4);
    await flush(8);
    expect(productCalls()).toHaveLength(0);
  });

  it('hạt giống của máy chủ được giữ cho cả lần mở (HTML đầu và lưới sau hydrate cùng một thứ tự), khác hạt giống ngày của máy khách', async () => {
    mounted = render(
      <QueryClientProvider client={newTestClient()}>
        <SuggestFeed categories={[cat('c1', 'Tẩy rửa', 9)]} exclude={new Set()} initial={page(cards(1, 4)) as never} seed="20261031" />
      </QueryClientProvider>,
    );
    await flush(8);
    click(Array.from(mounted.container.querySelectorAll('button')).find((b) => b.textContent === 'Tẩy rửa') ?? null);
    await flush(8);
    expect(productCalls().at(-1)![1]).toEqual({ query: { page: 1, limit: 20, seed: '20261031', category: 'c1' } });
  });

  it('chip: "Tất cả" rồi danh mục tầng 1 nhiều hàng nhất; danh mục con không thành chip; đổi chip lọc theo category kèm seed', async () => {
    const c = await mount({ categories: [cat('c1', 'Mẹ và bé', 5), cat('c2', 'Tẩy rửa', 9), cat('c3', 'Con của mẹ bé', 50, 'c1')] as never });
    expect(chipLabels(c)).toEqual(['Tất cả', 'Tẩy rửa', 'Mẹ và bé']);
    click(Array.from(c.querySelectorAll('button')).find((b) => b.textContent === 'Tẩy rửa') ?? null);
    await flush(8);
    expect(productCalls().at(-1)![1]).toEqual({ query: { page: 1, limit: 20, seed: '20261101', category: 'c2' } });
  });

  it('chưa có danh mục nào: chỉ chip "Tất cả"', async () => {
    expect(chipLabels(await mount())).toEqual(['Tất cả']);
  });

  it('điện thoại: hàng chip dính ngay dưới header 56px (top-14) và tràn mép màn như Mini; từ md không dính', async () => {
    const c = await mount();
    const row = c.querySelector('[role="region"][aria-label="Lọc gợi ý theo danh mục"]') as HTMLElement;
    for (const cls of ['max-md:sticky', 'max-md:top-14', 'max-md:z-10', 'max-md:-mx-4', 'max-md:px-4']) expect(row.className).toContain(cls);
  });

  it('món có slug trong exclude (đã nằm ở kệ trên) không vẽ ở lưới', async () => {
    const c = await mount({ exclude: new Set(['sp-2']) });
    const names = tiles(c).map((t) => t.textContent);
    expect(names).toEqual(['Sản phẩm 1', 'Sản phẩm 3', 'Sản phẩm 4'].map((n) => expect.stringContaining(n)));
  });

  it('điện thoại dừng ở 100 món: không còn "Xem thêm", có dòng hết gợi ý và nút "Vào Danh mục" tới trang sản phẩm', async () => {
    mocks.get.mockImplementation(async () => page(cards(1, 120), { limit: 120, total: 240 }));
    const c = await mount();
    expect(tiles(c)).toHaveLength(100);
    expect(Array.from(c.querySelectorAll('button')).some((b) => b.textContent === 'Xem thêm')).toBe(false);
    expect(c.textContent).toContain('Bạn đã xem hết gợi ý hôm nay');
    click(Array.from(c.querySelectorAll('button')).find((b) => b.textContent === 'Vào Danh mục') ?? null);
    expect(mocks.push).toHaveBeenCalledWith('/san-pham');
  });

  it('máy tính dừng ở 48 món rồi "Xem thêm" dẫn tới trang sản phẩm (không tải tiếp), không có dòng hết gợi ý', async () => {
    mocks.desktop = true;
    mocks.get.mockImplementation(async () => page(cards(1, 60), { limit: 60, total: 240 }));
    const c = await mount();
    expect(tiles(c)).toHaveLength(48);
    expect(c.textContent).not.toContain('Bạn đã xem hết gợi ý hôm nay');
    const more = Array.from(c.querySelectorAll('button')).find((b) => b.textContent === 'Xem thêm');
    click(more ?? null);
    expect(mocks.push).toHaveBeenCalledWith('/san-pham');
    expect(productCalls()).toHaveLength(1);
  });

  it('còn trang sau và chưa tới trần: "Xem thêm" tải trang kế; chưa hết thì không báo hết', async () => {
    mocks.get.mockImplementation(async (_path: string, opts?: { query?: { page?: number } }) =>
      opts?.query?.page === 2 ? { data: cards(21, 20), meta: { page: 2, limit: 20, total: 60 } } : page(cards(1, 20), { total: 60 }),
    );
    const c = await mount();
    expect(c.textContent).not.toContain('Bạn đã xem hết gợi ý hôm nay');
    click(Array.from(c.querySelectorAll('button')).find((b) => b.textContent === 'Xem thêm') ?? null);
    await flush(8);
    expect(tiles(c)).toHaveLength(40);
  });

  it('đã tải hết mà chưa tới trần: báo hết và mời vào Danh mục', async () => {
    const c = await mount();
    expect(c.textContent).toContain('Bạn đã xem hết gợi ý hôm nay');
    expect(Array.from(c.querySelectorAll('button')).some((b) => b.textContent === 'Vào Danh mục')).toBe(true);
  });

  it('khách đã đăng nhập: gợi ý cá nhân kèm seed đứng đầu ở chip "Tất cả", không có ở chip danh mục', async () => {
    mocks.phase = 'authenticated';
    mocks.get.mockImplementation(async (path: string) => (path === '/products/for-you' ? [card(99)] : path === '/products' ? page(cards(1, 4)) : []));
    const c = await mount({ categories: [cat('c1', 'Tẩy rửa', 9)] as never });
    expect(mocks.get).toHaveBeenCalledWith('/products/for-you', { query: { seed: '20261101' } });
    expect(tiles(c)[0]!.textContent).toContain('Sản phẩm 99');
    click(Array.from(c.querySelectorAll('button')).find((b) => b.textContent === 'Tẩy rửa') ?? null);
    await flush(8);
    expect(c.textContent).not.toContain('Sản phẩm 99');
  });

  it('đã tải xong, rỗng, không lỗi → ẩn cả khối: không tiêu đề, không chip', async () => {
    mocks.get.mockImplementation(async () => page([]));
    const c = await mount();
    expect(c.textContent).toBe('');
    expect(c.querySelector('h2')).toBeNull();
  });

  it('trang đầu rỗng do server dựng sẵn (catalog trống) cũng ẩn khối, không chờ tải', async () => {
    const c = await mount({ initial: page([]) as never, seed: '20261101' });
    expect(c.textContent).toBe('');
    expect(productCalls()).toHaveLength(0);
  });

  it('đang tải → vẫn giữ tiêu đề, chip và khung chờ (trang không nhảy)', async () => {
    mocks.get.mockReturnValue(new Promise(() => undefined));
    const c = await mount();
    expect(c.querySelector('h2')?.textContent).toBe('Gợi ý hôm nay');
    expect(chipLabels(c)).toEqual(['Tất cả']);
    expect(c.querySelector('[data-testid="catalog-grid-skeleton"]')).not.toBeNull();
  });

  it('lỗi tải (không phải rỗng) → vẫn hiện khối lỗi kèm "Thử lại", không mất khối im lặng', async () => {
    mocks.get.mockRejectedValue(new Error('x'));
    const c = await mount();
    expect(c.querySelector('[data-testid="home-block-error"]')).not.toBeNull();
    expect(c.querySelector('button[aria-label^="Thử lại"]')).not.toBeNull();
  });
});
