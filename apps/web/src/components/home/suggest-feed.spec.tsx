// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { QueryClientProvider } from '@tanstack/react-query';
import { click, flush, render, type Rendered } from '@/test-utils/dom';
import { newTestClient } from '@/test-utils/render-hook';

const mocks = vi.hoisted(() => ({ get: vi.fn(), push: vi.fn(), phase: 'guest', desktop: false, wide: false, now: 0 }));
vi.mock('@/lib/core-http', () => ({ coreHttp: { get: mocks.get, post: vi.fn(), delete: vi.fn() } }));
vi.mock('@/lib/auth-phase', () => ({ useAuthPhase: () => mocks.phase, useAuthRestoring: () => false }));
vi.mock('@/lib/use-flash-sales', async (importOriginal) => ({ ...(await importOriginal<typeof import('@/lib/use-flash-sales')>()), useActiveFlashSales: () => [] }));
vi.mock('@tubutree/app-core/server-clock', async (importOriginal) => ({ ...(await importOriginal<Record<string, unknown>>()), serverNow: () => mocks.now }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: mocks.push }) }));

import { SUGGEST_FIRST_RENDER, SUGGEST_FIRST_RENDER_WIDE } from '@tubutree/app-core/home-layout';
import { SuggestFeed } from './suggest-feed';

const TITLE = 'Gợi ý cho bạn';
const card = (n: number) => ({
  id: `p${n}`, slug: `sp-${n}`, brand: 'Tubu', name: `Sản phẩm ${n}`, thumbnail: null, basePrice: 100000, salePrice: null, isFeatured: false, inStock: true,
});
const cards = (from: number, n: number) => Array.from({ length: n }, (_, i) => card(from + i));
const page = (data: unknown[], extra: Record<string, number> = {}) => ({ data, meta: { page: 1, limit: 20, total: data.length, ...extra } });

let mounted: Rendered | null = null;
const mount = async (props: Partial<React.ComponentProps<typeof SuggestFeed>> = {}) => {
  mounted = render(
    <QueryClientProvider client={newTestClient()}>
      <SuggestFeed exclude={new Set()} {...props} />
    </QueryClientProvider>,
  );
  await flush(8);
  return mounted.container;
};
const productCalls = () => mocks.get.mock.calls.filter(([path]) => path === '/products');
const tiles = (c: HTMLElement) => Array.from(c.querySelectorAll('a.tubu-tile-link'));
const button = (c: HTMLElement, text: string) => Array.from(c.querySelectorAll('button')).find((b) => b.textContent === text) ?? null;
/** Lưới dựng dần: bấm "Xem thêm" tới khi đủ `n` thẻ đã tải (mỗi lần vẽ thêm phần đã có, không gọi mạng). */
const revealTo = async (c: HTMLElement, n: number) => {
  for (let i = 0; i < 10 && tiles(c).length < n; i += 1) {
    click(button(c, 'Xem thêm'));
    await flush(4);
  }
};

beforeEach(() => {
  mocks.phase = 'guest';
  mocks.desktop = false;
  mocks.wide = false;
  // 08:00 ngày 01/11/2026 giờ Việt Nam.
  mocks.now = Date.parse('2026-11-01T01:00:00.000Z');
  mocks.get.mockReset().mockImplementation(async (path: string) => (path === '/products' ? page(cards(1, 4)) : []));
  mocks.push.mockReset();
  window.matchMedia = ((query: string) => ({
    matches: query.includes('min-width: 1024px') ? mocks.desktop : query.includes('min-width: 768px') ? mocks.desktop || mocks.wide : false,
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

describe('SuggestFeed (web): "Gợi ý cho bạn", một lưới cuối Trang chủ (W47)', () => {
  it('tiêu đề "Gợi ý cho bạn" bằng SectionHeader, không hàng chip, không mục theo thương hiệu; mọi lời gọi gửi seed là ngày Việt Nam; hai lần mở cùng ngày gửi cùng seed', async () => {
    const c = await mount();
    expect(c.querySelector('h2')?.textContent).toBe(TITLE);
    expect(c.querySelector('[data-testid="section-header"]')).not.toBeNull();
    expect(c.querySelector('[data-testid="home-suggest"]')).not.toBeNull();
    expect(c.querySelector('[role="region"][aria-label*="Lọc gợi ý"]')).toBeNull();
    expect(c.querySelector('[data-testid="home-brand-section"]')).toBeNull();
    expect(productCalls()[0]).toEqual(['/products', { query: { page: 1, limit: 20, seed: '20261101' } }]);
    mounted!.unmount();
    mocks.get.mockClear();
    await mount();
    expect(productCalls()[0]![1]).toEqual({ query: { page: 1, limit: 20, seed: '20261101' } });
  });

  it('dữ liệu dựng sẵn của máy chủ khớp hạt giống: có lưới ngay ở lần vẽ đầu, không gọi lại trang 1', async () => {
    mounted = render(
      <QueryClientProvider client={newTestClient()}>
        <SuggestFeed exclude={new Set()} initial={page(cards(1, 4)) as never} seed="20261101" />
      </QueryClientProvider>,
    );
    expect(tiles(mounted.container)).toHaveLength(4);
    await flush(8);
    expect(productCalls()).toHaveLength(0);
  });

  it('hạt giống của máy chủ được giữ cho cả lần mở (HTML đầu và trang sau cùng một thứ tự), khác hạt giống ngày của máy khách', async () => {
    mounted = render(
      <QueryClientProvider client={newTestClient()}>
        <SuggestFeed exclude={new Set()} initial={page(cards(1, 20), { total: 60 }) as never} seed="20261031" />
      </QueryClientProvider>,
    );
    await flush(8);
    await revealTo(mounted.container, 20);
    click(button(mounted.container, 'Xem thêm'));
    await flush(8);
    expect(productCalls().at(-1)![1]).toEqual({ query: { page: 2, limit: 20, seed: '20261031' } });
  });

  it('món có slug trong exclude (đã nằm ở kệ trên) không vẽ ở lưới', async () => {
    const c = await mount({ exclude: new Set(['sp-2']) });
    const names = tiles(c).map((t) => t.textContent);
    expect(names).toEqual(['Sản phẩm 1', 'Sản phẩm 3', 'Sản phẩm 4'].map((n) => expect.stringContaining(n)));
  });

  it('điện thoại dừng ở 100 món: không còn "Xem thêm", có dòng hết gợi ý và nút "Vào Danh mục" tới trang sản phẩm', async () => {
    mocks.get.mockImplementation(async () => page(cards(1, 120), { limit: 120, total: 240 }));
    const c = await mount();
    expect(tiles(c)).toHaveLength(SUGGEST_FIRST_RENDER);
    await revealTo(c, 100);
    expect(tiles(c)).toHaveLength(100);
    expect(button(c, 'Xem thêm')).toBeNull();
    expect(c.textContent).toContain('Bạn đã xem hết gợi ý hôm nay');
    click(button(c, 'Vào Danh mục'));
    expect(mocks.push).toHaveBeenCalledWith('/san-pham');
  });

  it('máy tính dừng ở 48 món rồi "Xem thêm" dẫn tới trang sản phẩm (không tải tiếp), không có dòng hết gợi ý', async () => {
    mocks.desktop = true;
    mocks.get.mockImplementation(async () => page(cards(1, 60), { limit: 60, total: 240 }));
    const c = await mount();
    await revealTo(c, 48);
    expect(tiles(c)).toHaveLength(48);
    expect(c.textContent).not.toContain('Bạn đã xem hết gợi ý hôm nay');
    click(button(c, 'Xem thêm'));
    expect(mocks.push).toHaveBeenCalledWith('/san-pham');
    expect(productCalls()).toHaveLength(1);
  });

  it('còn trang sau và chưa tới trần: "Xem thêm" tải trang kế; chưa hết thì không báo hết', async () => {
    mocks.get.mockImplementation(async (_path: string, opts?: { query?: { page?: number } }) =>
      opts?.query?.page === 2 ? { data: cards(21, 20), meta: { page: 2, limit: 20, total: 60 } } : page(cards(1, 20), { total: 60 }),
    );
    const c = await mount();
    expect(c.textContent).not.toContain('Bạn đã xem hết gợi ý hôm nay');
    await revealTo(c, 20);
    expect(tiles(c)).toHaveLength(20);
    expect(productCalls()).toHaveLength(1);
    click(button(c, 'Xem thêm'));
    await flush(8);
    expect(tiles(c)).toHaveLength(40);
  });

  it('dựng dần: lần mở đầu chỉ vẽ SUGGEST_FIRST_RENDER thẻ, "Xem thêm" vẽ tiếp phần đã tải mà không gọi mạng', async () => {
    mocks.get.mockImplementation(async () => page(cards(1, 20), { total: 20 }));
    const c = await mount();
    expect(tiles(c)).toHaveLength(SUGGEST_FIRST_RENDER);
    expect(c.textContent).not.toContain('Bạn đã xem hết gợi ý hôm nay');
    click(button(c, 'Xem thêm'));
    await flush(4);
    expect(tiles(c)).toHaveLength(20);
    expect(productCalls()).toHaveLength(1);
    expect(c.textContent).toContain('Bạn đã xem hết gợi ý hôm nay');
  });

  it('từ md lần mở đầu vẽ SUGGEST_FIRST_RENDER_WIDE thẻ, điện thoại vẽ SUGGEST_FIRST_RENDER', async () => {
    mocks.get.mockImplementation(async () => page(cards(1, 20), { total: 20 }));
    mocks.wide = true;
    const wide = await mount();
    expect(tiles(wide)).toHaveLength(SUGGEST_FIRST_RENDER_WIDE);
    mounted?.unmount();
    mocks.wide = false;
    const phone = await mount();
    expect(tiles(phone)).toHaveLength(SUGGEST_FIRST_RENDER);
    expect(SUGGEST_FIRST_RENDER).toBeLessThan(SUGGEST_FIRST_RENDER_WIDE);
  });

  it('đã tải hết mà chưa tới trần: báo hết và mời vào Danh mục', async () => {
    const c = await mount();
    expect(c.textContent).toContain('Bạn đã xem hết gợi ý hôm nay');
    expect(button(c, 'Vào Danh mục')).not.toBeNull();
  });

  it('khách đã đăng nhập: gợi ý cá nhân kèm seed đứng đầu lưới', async () => {
    mocks.phase = 'authenticated';
    mocks.get.mockImplementation(async (path: string) => (path === '/products/for-you' ? [card(99)] : path === '/products' ? page(cards(1, 4)) : []));
    const c = await mount();
    expect(mocks.get).toHaveBeenCalledWith('/products/for-you', { query: { seed: '20261101' } });
    expect(tiles(c)[0]!.textContent).toContain('Sản phẩm 99');
  });

  it('khách vãng lai: không gọi gợi ý cá nhân', async () => {
    await mount();
    expect(mocks.get).not.toHaveBeenCalledWith('/products/for-you', expect.anything());
  });

  it('trang 1 toàn món đã nằm ở kệ trên nhưng còn trang sau: tải tiếp và hiện món của trang 2, không ẩn khối', async () => {
    mocks.get.mockImplementation(async (_path: string, opts?: { query?: { page?: number } }) =>
      opts?.query?.page === 2 ? { data: cards(21, 3), meta: { page: 2, limit: 20, total: 23 } } : page(cards(1, 20), { total: 23 }),
    );
    const c = await mount({ exclude: new Set(cards(1, 20).map((x) => x.slug)) });
    await flush(8);
    expect(tiles(c).map((t) => t.textContent)).toEqual(['Sản phẩm 21', 'Sản phẩm 22', 'Sản phẩm 23'].map((n) => expect.stringContaining(n)));
    expect(c.querySelector('h2')?.textContent).toBe(TITLE);
    expect(productCalls()).toHaveLength(2);
  });

  it('mọi trang đều là món đã nằm ở kệ trên và hết trang: ẩn khối sau khi tải hết', async () => {
    const c = await mount({ exclude: new Set(cards(1, 4).map((x) => x.slug)) });
    expect(c.textContent).toBe('');
  });

  it('đã tải xong, rỗng, không lỗi: ẩn cả khối, không để tiêu đề trên khoảng trống', async () => {
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

  it('đang tải: giữ tiêu đề và khung chờ (trang không nhảy)', async () => {
    mocks.get.mockReturnValue(new Promise(() => undefined));
    const c = await mount();
    expect(c.querySelector('h2')?.textContent).toBe(TITLE);
    expect(c.querySelector('[data-testid="catalog-grid-skeleton"]')).not.toBeNull();
  });

  it('lỗi tải (không phải rỗng): hiện khối lỗi kèm "Thử lại", không mất khối im lặng', async () => {
    mocks.get.mockRejectedValue(new Error('x'));
    const c = await mount();
    expect(c.querySelector('[data-testid="home-block-error"]')).not.toBeNull();
    expect(c.querySelector('button[aria-label^="Thử lại"]')).not.toBeNull();
  });
});
