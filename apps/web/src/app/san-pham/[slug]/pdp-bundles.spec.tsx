// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, type ReactElement } from 'react';
import { hydrateRoot } from 'react-dom/client';
import { renderToString } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { BundleDTO, BundleItemDTO, ProductBundles } from '@tubutree/app-core/api/bundle';
import type { ProductCard } from '@tubutree/app-core/api/catalog';
import { click, flush, render, type Rendered } from '@/test-utils/dom';
import { smallTouchTargets, unnamedControls } from '@/test-utils/a11y';
import { ApiError } from '@/lib/client-api';

const mocks = vi.hoisted(() => ({ addAll: vi.fn(), push: vi.fn(), phase: 'authenticated' as string, get: vi.fn() }));

vi.mock('@/lib/shop-combo', () => ({ addAllToCart: mocks.addAll }));
vi.mock('@/lib/auth-phase', () => ({ useAuthPhase: () => mocks.phase }));
vi.mock('@/lib/core-http', () => ({ coreHttp: { get: mocks.get, post: vi.fn() } }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: mocks.push }), usePathname: () => '/san-pham/sp-anchor' }));

import { PdpBundles } from './pdp-bundles';

const FUTURE = new Date(Date.now() + 86_400_000).toISOString();
const PAST = new Date(Date.now() - 1_000).toISOString();

const card = (id: string, o: Partial<ProductCard> = {}): ProductCard => ({
  id, slug: `sp-${id}`, brand: 'Tubu', name: `Sản phẩm ${id}`, thumbnail: null, basePrice: 100_000, salePrice: null, isFeatured: false, inStock: true, repVariationId: `v-${id}`, ...o,
});
const item = (id: string, o: Partial<BundleItemDTO> = {}): BundleItemDTO => ({
  productId: id, variationId: `v-${id}`, maxQty: 1, addonPrice: null, inStock: true, product: card(id), ...o,
});
const combo = (id: string, items: BundleItemDTO[], o: Partial<BundleDTO> = {}): BundleDTO => ({
  id, kind: 'BUNDLE_PCT', title: `Combo ${id}`, pct: 10, endAt: FUTURE, anchorProductId: null, items, ...o,
});
const addon = (id: string, items: BundleItemDTO[], o: Partial<BundleDTO> = {}): BundleDTO => ({
  id, kind: 'ADDON', title: `Kèm ${id}`, pct: null, endAt: FUTURE, anchorProductId: 'anchor', items, ...o,
});

let mounted: Rendered[] = [];
const mount = async (initial: ProductBundles | undefined, name: string | null = 'Xà phòng sả') => {
  const r = render(<PdpBundles slug="sp-anchor" productName={name ?? undefined} initialBundles={initial} />);
  mounted.push(r);
  await flush();
  return r.container;
};
const buttonText = (c: HTMLElement, text: RegExp | string) =>
  Array.from(c.querySelectorAll<HTMLButtonElement>('button')).find((b) => (typeof text === 'string' ? b.textContent === text : text.test(b.textContent ?? '')));
const rows = (c: HTMLElement) => Array.from(c.querySelectorAll<HTMLInputElement>('[data-testid="addon-row"] input[type="checkbox"]'));

const ONE_COMBO = [combo('c1', [item('a'), item('b')])];
const TWO_ADDONS = [addon('a1', [item('x', { addonPrice: 60_000 }), item('y', { addonPrice: 70_000 })])];

beforeEach(() => {
  mocks.addAll.mockReset().mockResolvedValue({});
  mocks.push.mockReset();
  mocks.get.mockReset().mockRejectedValue(new Error('offline'));
  mocks.phase = 'authenticated';
});
afterEach(() => {
  mounted.forEach((m) => m.unmount());
  mounted = [];
});

describe('PdpBundles (web): ẩn hẳn khi không có gì để mời', () => {
  it('server trả rỗng: không render gì, không gọi lại API', async () => {
    const c = await mount({ combos: [], addons: [] });
    expect(c.innerHTML).toBe('');
    expect(mocks.get).not.toHaveBeenCalled();
  });

  it('server lỗi (không có dữ liệu đầu) và trình duyệt cũng lỗi: ẩn, không báo lỗi', async () => {
    const c = await mount(undefined);
    expect(mocks.get).toHaveBeenCalledWith('/products/sp-anchor/bundles', { anonymous: true });
    expect(c.innerHTML).toBe('');
  });

  it('server lỗi nhưng trình duyệt tải được: hiện khối', async () => {
    mocks.get.mockResolvedValue({ combos: ONE_COMBO, addons: [] });
    const c = await mount(undefined);
    expect(c.querySelector('[data-testid="pdp-combos"]')).not.toBeNull();
  });

  it('bộ đã quá hạn theo giờ máy chủ: ẩn cả combo lẫn mua kèm', async () => {
    const c = await mount({ combos: [combo('c1', [item('a'), item('b')], { endAt: PAST })], addons: [addon('a1', [item('x', { addonPrice: 10_000 })], { endAt: PAST })] });
    expect(c.innerHTML).toBe('');
  });
});

describe('PdpBundles (web): dữ liệu server của trang ISR có thể cũ tới 5 phút', () => {
  const mountAt = async (fetchedAt: number | undefined) => {
    const r = render(<PdpBundles slug="sp-anchor" initialBundles={{ combos: ONE_COMBO, addons: [] }} initialFetchedAt={fetchedAt} />);
    mounted.push(r);
    const first = r.container.querySelector('[data-testid="pdp-combos"]') !== null;
    await flush();
    return { first, c: r.container };
  };

  it('dữ liệu server đã quá 30 giây: hiện ngay, rồi tải lại; bộ vừa tắt biến mất khỏi trang', async () => {
    mocks.get.mockResolvedValue({ combos: [], addons: [] });
    const { first, c } = await mountAt(Date.now() - 5 * 60_000);
    expect(first).toBe(true);
    expect(mocks.get).toHaveBeenCalledWith('/products/sp-anchor/bundles', { anonymous: true });
    expect(c.querySelector('[data-testid="pdp-combos"]')).toBeNull();
  });

  it('dữ liệu server còn mới: không tải lại', async () => {
    const { c } = await mountAt(Date.now() - 1_000);
    expect(mocks.get).not.toHaveBeenCalled();
    expect(c.querySelector('[data-testid="pdp-combos"]')).not.toBeNull();
  });
});

describe('PdpBundles (web): HTML dựng sẵn (ISR) và lần hydrate đầu phải khớp, dù trang đã cũ hay đồng hồ máy lệch', () => {
  const NOW = new Date('2026-11-01T20:00:00Z').getTime();
  const END = new Date(NOW + 2 * 3_600_000).toISOString();
  const bundles = (): ProductBundles => ({ combos: [combo('c1', [item('a'), item('b')], { endAt: END })], addons: [addon('a1', [item('x', { addonPrice: 60_000 })], { endAt: END })] });
  const ui = (client: QueryClient) => (
    <QueryClientProvider client={client}>
      <PdpBundles slug="sp-anchor" productName="Xà phòng sả" initialBundles={bundles()} initialFetchedAt={NOW} />
    </QueryClientProvider>
  );

  afterEach(() => vi.useRealTimers());

  async function hydrateAt(visitTime: number) {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(NOW);
    const html = renderToString(ui(new QueryClient()));
    expect(html).toContain('Combo ưu đãi');
    expect(html).toContain('Mua kèm deal sốc');
    vi.setSystemTime(visitTime);
    const container = document.createElement('div');
    container.innerHTML = html;
    document.body.appendChild(container);
    const errors: unknown[] = [];
    const consoleError = vi.spyOn(console, 'error').mockImplementation((...a) => void errors.push(a));
    // Dữ liệu cũ hơn 30 giây nên trình duyệt tải lại ngay; nhánh này không có API thật nên hỏng và giữ dữ liệu cũ.
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    let root!: ReturnType<typeof hydrateRoot>;
    await act(async () => {
      root = hydrateRoot(container, ui(client), { onRecoverableError: (e) => void errors.push(e) });
    });
    consoleError.mockRestore();
    return {
      errors,
      final: container,
      cleanup: () => {
        act(() => root.unmount());
        container.remove();
      },
    };
  }

  /** Lần vẽ đầu của trình duyệt dùng cùng nhánh với máy chủ (chưa hydrate): chạy nó ở giờ khách mở trang phải ra đúng HTML đã dựng. */
  const firstPassAt = (visitTime: number) => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(NOW);
    const built = renderToString(ui(new QueryClient()));
    vi.setSystemTime(visitTime);
    const firstClientPass = renderToString(ui(new QueryClient()));
    return { built, firstClientPass };
  };

  it('bộ hết hạn sau lúc dựng HTML nhưng trước lúc khách mở trang (HTML cũ hàng giờ): lần vẽ đầu của trình duyệt giống HTML đã dựng, hydrate không lỗi', async () => {
    const { built, firstClientPass } = firstPassAt(NOW + 3 * 3_600_000);
    expect(built).toContain('Combo ưu đãi');
    expect(firstClientPass).toBe(built);
    const r = await hydrateAt(NOW + 3 * 3_600_000);
    expect(r.errors).toEqual([]);
    r.cleanup();
  });

  it('đồng hồ điện thoại lệch vài phút quanh giờ kết thúc: lần vẽ đầu vẫn giống HTML đã dựng', async () => {
    for (const skew of [-4 * 60_000, 4 * 60_000]) {
      const { built, firstClientPass } = firstPassAt(NOW + 2 * 3_600_000 + skew);
      expect(firstClientPass).toBe(built);
    }
    const r = await hydrateAt(NOW + 2 * 3_600_000 + 4 * 60_000);
    expect(r.errors).toEqual([]);
    r.cleanup();
  });

  it('sau khi hydrate xong mới lọc theo giờ: bộ đã hết hạn rời trang (không đứng mãi)', async () => {
    const r = await hydrateAt(NOW + 3 * 3_600_000);
    await act(async () => {
      await new Promise((res) => setTimeout(res, 0));
    });
    expect(r.final.querySelector('[data-testid="pdp-combos"]')).toBeNull();
    expect(r.final.querySelector('[data-testid="pdp-addons"]')).toBeNull();
    r.cleanup();
  });
});

describe('PdpBundles (web): Combo ưu đãi', () => {
  it('vẽ thẻ combo nằm trong khối bọc của PDP, tiêu đề mục là h2', async () => {
    const c = await mount({ combos: ONE_COMBO, addons: [] });
    expect(c.querySelector('[data-testid="pdp-bundle-slots"]')).not.toBeNull();
    expect(c.querySelector('[data-testid="pdp-combos"] h2')!.textContent).toBe('Combo ưu đãi');
    expect(c.querySelector('[data-testid="pdp-combos"]')!.textContent).toContain('Combo c1');
    expect(c.querySelector('[data-testid="pdp-addons"]')).toBeNull();
  });

  it('"Thêm cả combo": một lệnh với mỗi món một đơn vị, báo thành công trong vùng role=status', async () => {
    const c = await mount({ combos: ONE_COMBO, addons: [] });
    click(buttonText(c, /Thêm cả combo/)!);
    await flush();
    expect(mocks.addAll).toHaveBeenCalledTimes(1);
    expect(mocks.addAll).toHaveBeenCalledWith([{ variationId: 'v-a', quantity: 1 }, { variationId: 'v-b', quantity: 1 }]);
    expect(c.querySelector('[data-testid="pdp-combos"] [role="status"]')!.textContent).toBe('Đã thêm cả combo vào giỏ');
  });

  it('khách chưa đăng nhập: chuyển sang đăng nhập kèm đường quay lại, không gọi giỏ', async () => {
    mocks.phase = 'guest';
    const c = await mount({ combos: ONE_COMBO, addons: [] });
    click(buttonText(c, /Thêm cả combo/)!);
    expect(mocks.addAll).not.toHaveBeenCalled();
    expect(mocks.push).toHaveBeenCalledWith(expect.stringContaining('/dang-nhap'));
    expect(String(mocks.push.mock.calls[0]![0])).toContain(encodeURIComponent('/san-pham/sp-anchor'));
  });

  it('lỗi nghiệp vụ 4xx đọc thẳng lời máy chủ; lỗi khác dùng câu cố định (giỏ không đổi)', async () => {
    mocks.addAll.mockRejectedValueOnce(new ApiError('Sản phẩm Sản phẩm b đã hết hàng', 409));
    const c = await mount({ combos: ONE_COMBO, addons: [] });
    click(buttonText(c, /Thêm cả combo/)!);
    await flush();
    expect(c.querySelector('[role="status"]')!.textContent).toBe('Sản phẩm Sản phẩm b đã hết hàng');
    mocks.addAll.mockRejectedValueOnce(new Error('mạng'));
    click(buttonText(c, /Thêm cả combo/)!);
    await flush();
    expect(c.querySelector('[role="status"]')!.textContent).toContain('giỏ của bạn không thay đổi');
  });

  it('chỉ hai combo đầu được hiện', async () => {
    const three = ['c1', 'c2', 'c3'].map((id) => combo(id, [item(`${id}a`), item(`${id}b`)]));
    const c = await mount({ combos: three, addons: [] });
    expect(c.querySelectorAll('[data-testid="pdp-combos"] h3').length).toBe(2);
  });
});

describe('PdpBundles (web): Mua kèm deal sốc', () => {
  it('vẽ dòng mua kèm với điều kiện, giá kèm và nhãn % giảm; nút khoá tới khi chọn', async () => {
    const c = await mount({ combos: [], addons: TWO_ADDONS });
    const section = c.querySelector('[data-testid="pdp-addons"]')!;
    expect(section.querySelector('h2')!.textContent).toBe('Mua kèm deal sốc');
    expect(section.textContent).toContain('Chỉ khi mua cùng Xà phòng sả');
    expect(rows(c).length).toBe(2);
    expect(section.textContent).toContain('-40%');
    expect(section.textContent).toContain('-30%');
    const button = buttonText(c, 'Chọn món muốn mua kèm')!;
    expect(button.disabled || button.getAttribute('aria-disabled') === 'true').toBe(true);
  });

  it('không có tên sản phẩm chính: bỏ dòng điều kiện', async () => {
    const c = await mount({ combos: [], addons: TWO_ADDONS }, null);
    expect(c.querySelector('[data-testid="pdp-addons"]')!.textContent).not.toContain('Chỉ khi mua cùng');
  });

  it('chọn món: nhãn nút theo số món, dòng "Tiết kiệm" theo tổng; bỏ chọn thì khoá lại', async () => {
    const c = await mount({ combos: [], addons: TWO_ADDONS });
    click(rows(c)[0]!);
    expect(buttonText(c, 'Thêm 1 món vào giỏ')).toBeDefined();
    expect(c.querySelector('[data-testid="addon-save"]')!.textContent).toBe('Tiết kiệm 40.000đ');
    click(rows(c)[1]!);
    expect(buttonText(c, 'Thêm 2 món vào giỏ')).toBeDefined();
    expect(c.querySelector('[data-testid="addon-save"]')!.textContent).toBe('Tiết kiệm 70.000đ');
    click(rows(c)[0]!);
    click(rows(c)[1]!);
    expect(buttonText(c, 'Chọn món muốn mua kèm')).toBeDefined();
    expect(c.querySelector('[data-testid="addon-save"]')).toBeNull();
  });

  it('thêm: chỉ các món đã chọn (không kèm món chính), rồi bỏ chọn và nhãn nút báo đã thêm', async () => {
    const c = await mount({ combos: [], addons: TWO_ADDONS });
    click(rows(c)[1]!);
    click(buttonText(c, 'Thêm 1 món vào giỏ')!);
    await flush();
    expect(mocks.addAll).toHaveBeenCalledWith([{ variationId: 'v-y', quantity: 1 }]);
    expect(buttonText(c, 'Đã thêm vào giỏ')).toBeDefined();
    expect(rows(c).every((r) => !r.checked)).toBe(true);
    expect(c.querySelector('[data-testid="pdp-addons"] [role="status"]')!.textContent).toBe('Đã thêm vào giỏ');
  });

  it('thêm lỗi: giữ lựa chọn để thử lại và báo lỗi, nút không đổi nhãn "đã thêm"', async () => {
    mocks.addAll.mockRejectedValueOnce(new Error('mạng'));
    const c = await mount({ combos: [], addons: TWO_ADDONS });
    click(rows(c)[0]!);
    click(buttonText(c, 'Thêm 1 món vào giỏ')!);
    await flush();
    expect(rows(c)[0]!.checked).toBe(true);
    expect(buttonText(c, 'Đã thêm vào giỏ')).toBeUndefined();
    expect(c.querySelector('[data-testid="pdp-addons"] [role="status"]')!.textContent).toContain('Chưa thêm được món mua kèm');
  });

  it('khách chưa đăng nhập: chuyển sang đăng nhập, không gọi giỏ', async () => {
    mocks.phase = 'guest';
    const c = await mount({ combos: [], addons: TWO_ADDONS });
    click(rows(c)[0]!);
    click(buttonText(c, 'Thêm 1 món vào giỏ')!);
    expect(mocks.addAll).not.toHaveBeenCalled();
    expect(mocks.push).toHaveBeenCalledTimes(1);
  });

  it('một sản phẩm nằm ở hai bộ: một dòng, lấy giá kèm thấp nhất', async () => {
    const c = await mount({
      combos: [],
      addons: [addon('a1', [item('x', { addonPrice: 70_000 })]), addon('a2', [item('x', { addonPrice: 50_000 })])],
    });
    expect(rows(c).length).toBe(1);
    expect(c.querySelector('[data-testid="pdp-addons"]')!.textContent).toContain('-50%');
  });

  it('dòng mua kèm có tên đọc được và vùng chạm 44px; không nút/ô thiếu tên', async () => {
    const c = await mount({ combos: ONE_COMBO, addons: TWO_ADDONS });
    expect(rows(c)[0]!.getAttribute('aria-label')).toBe('Chọn mua kèm Sản phẩm x, 60.000đ, giảm 40%');
    expect(smallTouchTargets(c)).toEqual([]);
    expect(unnamedControls(c)).toEqual([]);
  });
});
