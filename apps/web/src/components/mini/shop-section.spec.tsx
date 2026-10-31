// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { click, flush, render, type Rendered } from '@/test-utils/dom';
import { resetFlashSales } from '@/lib/use-flash-sales';
import { ApiError } from '@/lib/client-api';

const mocks = vi.hoisted(() => ({ addAll: vi.fn(), push: vi.fn(), phase: 'authenticated' as string }));

vi.mock('@/lib/shop-combo', () => ({ addAllToCart: mocks.addAll }));
vi.mock('@/lib/shop-client', () => ({ getActiveFlashSales: async () => [] }));
vi.mock('@/lib/auth-phase', () => ({ useAuthPhase: () => mocks.phase }));
vi.mock('@/lib/core-http', () => ({ coreHttp: { get: async () => [], post: async () => ({}), delete: async () => ({}) } }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: mocks.push }), usePathname: () => '/s/uatctv' }));

import { ShopSection, type ShopSectionItem, type ShopSectionProps } from './shop-section';

const item = (n: number, over: Partial<ShopSectionItem['product']> = {}, extra: Partial<ShopSectionItem> = {}): ShopSectionItem => ({
  id: `i${n}`,
  note: null,
  variationId: null,
  ...extra,
  product: {
    id: `p${n}`, slug: `sp-${n}`, name: `Sản phẩm ${n}`, brand: 'Tubu', thumbnail: null,
    basePrice: 100_000, salePrice: null, inStock: true, repVariationId: `v${n}`, ...over,
  },
});
const many = (n: number) => Array.from({ length: n }, (_, i) => item(i + 1));
const col = (over: Partial<ShopSectionProps['collection']>): ShopSectionProps['collection'] => ({
  id: 'c1', title: 'Bếp xanh', kind: 'NORMAL', layout: 'GRID', comboDiscountPct: null, items: many(3), ...over,
});

let mounted: Rendered[] = [];
let qc: QueryClient;
beforeEach(() => {
  resetFlashSales();
  mocks.addAll.mockReset();
  mocks.push.mockReset();
  mocks.phase = 'authenticated';
});
afterEach(() => {
  mounted.forEach((m) => m.unmount());
  mounted = [];
});
const mount = async (ui: React.ReactElement) => {
  qc = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  const r = render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>);
  mounted.push(r);
  await flush();
  return r.container;
};
const tiles = (c: HTMLElement, testId: string) => c.querySelector(`[data-testid="${testId}"]`)!.querySelectorAll('[data-ds="product-tile"]').length;
const buttonByName = (c: HTMLElement, name: RegExp | string) =>
  Array.from(c.querySelectorAll<HTMLButtonElement>('button')).find((b) => (typeof name === 'string' ? (b.getAttribute('aria-label') ?? b.textContent) === name : name.test(b.getAttribute('aria-label') ?? b.textContent ?? '')));

describe('ShopSection (web) vẽ theo layout', () => {
  it('CAROUSEL: kệ ngang tối đa 10 thẻ, quá thì có "Tất cả (14)" gọi onSeeAll đúng một lần', async () => {
    const onSeeAll = vi.fn();
    const c = await mount(<ShopSection collection={col({ layout: 'CAROUSEL', items: many(14) })} onSeeAll={onSeeAll} />);
    expect(c.querySelector('h2')!.textContent).toBe('Bếp xanh');
    expect(tiles(c, 'shop-rail')).toBe(10);
    const all = buttonByName(c, 'Xem tất cả 14 sản phẩm trong Bếp xanh')!;
    expect(all.textContent).toBe('Tất cả (14)');
    click(all);
    expect(onSeeAll).toHaveBeenCalledTimes(1);
  });

  it('GRID: tối đa 6 thẻ; STACK: tối đa 5 dòng một cột', async () => {
    const g = await mount(<ShopSection collection={col({ layout: 'GRID', items: many(9) })} onSeeAll={() => undefined} />);
    expect(tiles(g, 'shop-grid')).toBe(6);
    expect(buttonByName(g, 'Xem tất cả 9 sản phẩm trong Bếp xanh')).toBeTruthy();
    const s = await mount(<ShopSection collection={col({ id: 'c2', layout: 'STACK', items: many(8) })} onSeeAll={() => undefined} />);
    expect(tiles(s, 'shop-line')).toBe(5);
    expect(s.querySelector('[data-testid="shop-line"] ul')!.className).toContain('grid-cols-1');
  });

  it('không có onSeeAll, hoặc khối không bị cắt, thì không nút "Tất cả"; bộ rỗng không vẽ gì', async () => {
    const a = await mount(<ShopSection collection={col({ layout: 'GRID', items: many(9) })} />);
    expect(buttonByName(a, /Xem tất cả/)).toBeUndefined();
    const b = await mount(<ShopSection collection={col({ layout: 'GRID', items: many(5) })} onSeeAll={() => undefined} />);
    expect(buttonByName(b, /Xem tất cả/)).toBeUndefined();
    const e = await mount(<ShopSection collection={col({ items: [] })} />);
    expect(e.querySelector('section')).toBeNull();
  });

  it('showBrand=false bỏ dòng thương hiệu; ghi chú của chủ shop nằm trong thẻ, thẻ khác giữ chỗ dòng đó', async () => {
    const c = await mount(<ShopSection collection={col({ layout: 'GRID', items: [item(1, {}, { note: 'Mình dùng mỗi ngày' }), item(2), item(3)] })} showBrand={false} />);
    expect(c.querySelector('[data-ds-part="brand"]')).toBeNull();
    expect(Array.from(c.querySelectorAll('[data-ds-part="note"]')).map((n) => n.textContent)).toEqual(['Mình dùng mỗi ngày', '', '']);
  });
});

describe('ShopSection (web) combo', () => {
  const comboItems = [item(1), item(2, { basePrice: 50_000 }), item(3, { basePrice: 50_000 })];
  const combo = (over: Partial<ShopSectionProps['collection']> = {}) => col({ id: 'cb', title: 'Combo giặt', kind: 'COMBO', comboDiscountPct: 10, items: comboItems, ...over });
  const add = (c: HTMLElement) => buttonByName(c, /^Thêm cả combo Combo giặt/)!;
  const status = (c: HTMLElement) => c.querySelector('[role="status"]')?.textContent ?? '';

  it('vẽ ComboCard (không lưới thẻ), tổng và Tiết kiệm từ giá thẻ, giảm sàn từng dòng', async () => {
    const c = await mount(<ShopSection collection={combo()} />);
    expect(c.querySelector('[data-testid="shop-combo"]')).not.toBeNull();
    expect(c.querySelector('[data-testid="catalog-grid"]')).toBeNull();
    expect(c.textContent).toContain('Combo -10%');
    expect(c.textContent).toContain('Tiết kiệm 20.000đ');
    expect(add(c).getAttribute('aria-label')).toBe('Thêm cả combo Combo giặt, 3 món, 180.000đ');
  });

  it('"Thêm cả combo": một lệnh với mọi món, làm mới giỏ, báo thành công; bấm đúp chỉ gửi một lần', async () => {
    let resolve!: (v: unknown) => void;
    mocks.addAll.mockReturnValue(new Promise((r) => { resolve = r; }));
    const c = await mount(<ShopSection collection={combo()} />);
    const invalidate = vi.spyOn(qc, 'invalidateQueries');
    click(add(c));
    click(add(c));
    await flush();
    expect(mocks.addAll).toHaveBeenCalledTimes(1);
    expect(mocks.addAll).toHaveBeenCalledWith([
      { variationId: 'v1', quantity: 1 },
      { variationId: 'v2', quantity: 1 },
      { variationId: 'v3', quantity: 1 },
    ]);
    resolve({});
    await flush();
    expect(status(c)).toContain('Đã thêm cả combo vào giỏ');
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['cart'] });
  });

  it('phân loại: món của bộ sưu tập > phân loại CTV ghim > phân loại đại diện', async () => {
    mocks.addAll.mockResolvedValue({});
    const items = [item(1, { pinnedVariationId: 'pin1' }, { variationId: 'own1' }), item(2, { pinnedVariationId: 'pin2' }), item(3)];
    const c = await mount(<ShopSection collection={combo({ items })} />);
    click(add(c));
    await flush();
    expect(mocks.addAll.mock.calls[0]![0].map((l: { variationId: string }) => l.variationId)).toEqual(['own1', 'pin2', 'v3']);
  });

  it('lỗi mạng: báo lỗi cố định, giỏ không bị ghi, bấm lại được; lỗi nghiệp vụ 4xx thì đọc lời máy chủ', async () => {
    mocks.addAll.mockRejectedValueOnce(new Error('boom')).mockRejectedValueOnce(new ApiError('Sản phẩm Sản phẩm 2 đã hết hàng.', 409, 'CART_BATCH_REJECTED'));
    const c = await mount(<ShopSection collection={combo()} />);
    const invalidate = vi.spyOn(qc, 'invalidateQueries');
    const setData = vi.spyOn(qc, 'setQueryData');
    click(add(c));
    await flush();
    expect(status(c)).toBe('Chưa thêm được combo, giỏ của bạn không thay đổi. Bạn thử lại nhé.');
    click(add(c));
    await flush();
    expect(mocks.addAll).toHaveBeenCalledTimes(2);
    expect(status(c)).toBe('Sản phẩm Sản phẩm 2 đã hết hàng.');
    expect(invalidate).not.toHaveBeenCalled();
    expect(setData).not.toHaveBeenCalled();
  });

  it('thiếu phân loại ở một món: không gọi API, báo lỗi', async () => {
    const c = await mount(<ShopSection collection={combo({ items: [item(1), item(2, { repVariationId: undefined }), item(3)] })} />);
    click(add(c));
    await flush();
    expect(mocks.addAll).not.toHaveBeenCalled();
    expect(status(c)).toContain('Chưa thêm được combo');
  });

  it('khách chưa đăng nhập: chuyển tới đăng nhập kèm đường quay lại, không gọi API', async () => {
    mocks.phase = 'guest';
    const c = await mount(<ShopSection collection={combo()} />);
    click(add(c));
    await flush();
    expect(mocks.addAll).not.toHaveBeenCalled();
    expect(mocks.push).toHaveBeenCalledWith('/dang-nhap?returnTo=%2Fs%2Fuatctv');
  });

  it('xem trước (preview): bấm nút không ghi giỏ, không báo gì, không chuyển trang', async () => {
    mocks.phase = 'guest';
    const c = await mount(<ShopSection collection={combo()} preview />);
    click(add(c));
    await flush();
    expect(mocks.addAll).not.toHaveBeenCalled();
    expect(mocks.push).not.toHaveBeenCalled();
    expect(status(c)).toBe('');
  });

  it('một món hết hàng: nút thành "Combo tạm hết", không gọi API', async () => {
    const c = await mount(<ShopSection collection={combo({ items: [item(1), item(2, { inStock: false }), item(3)] })} />);
    click(buttonByName(c, 'Combo tạm hết: Combo giặt')!);
    await flush();
    expect(mocks.addAll).not.toHaveBeenCalled();
    expect(c.textContent).not.toContain('Combo -');
  });

  it('combo không đủ hai sản phẩm khác nhau, hoặc không có % giảm, thì rơi về dòng', async () => {
    const a = await mount(<ShopSection collection={combo({ items: [item(1), item(1)] })} />);
    expect(a.querySelector('[data-testid="shop-combo"]')).toBeNull();
    expect(a.querySelector('[data-testid="shop-line"]')).not.toBeNull();
    const b = await mount(<ShopSection collection={combo({ comboDiscountPct: null })} />);
    expect(b.querySelector('[data-testid="shop-combo"]')).toBeNull();
    expect(b.querySelector('[data-testid="shop-line"]')).not.toBeNull();
  });
});
