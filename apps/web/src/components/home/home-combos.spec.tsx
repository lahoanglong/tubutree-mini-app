// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { BundleDTO, BundleItemDTO } from '@tubutree/app-core/api/bundle';
import type { ProductCard } from '@tubutree/app-core/api/catalog';
import { comboView } from '@tubutree/app-core/commerce/bundle-view';
import { click, flush, render, type Rendered } from '@/test-utils/dom';
import { smallTouchTargets, unnamedControls } from '@/test-utils/a11y';
import { ApiError } from '@/lib/client-api';

const mocks = vi.hoisted(() => ({ addAll: vi.fn(), push: vi.fn(), phase: 'authenticated' as string }));
vi.mock('@/lib/shop-combo', () => ({ addAllToCart: mocks.addAll }));
vi.mock('@/lib/auth-phase', () => ({ useAuthPhase: () => mocks.phase }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: mocks.push }), usePathname: () => '/' }));

import { HomeCombos } from './home-combos';

const card = (id: string): ProductCard => ({
  id, slug: `sp-${id}`, brand: 'Tubu', name: `Sản phẩm ${id}`, thumbnail: null, basePrice: 100_000, salePrice: null, isFeatured: false, inStock: true, repVariationId: `v-${id}`,
});
const item = (id: string, over: { inStock?: boolean; slug?: string } = {}): BundleItemDTO => ({
  productId: id, variationId: `v-${id}`, maxQty: 1, addonPrice: null, inStock: over.inStock ?? true, product: { ...card(id), slug: over.slug ?? `sp-${id}` },
});
const dto = (id: string, a: string | BundleItemDTO, b: string | BundleItemDTO): BundleDTO => ({
  id, kind: 'BUNDLE_PCT', title: `Combo ${id}`, pct: 10, endAt: new Date(Date.now() + 86_400_000).toISOString(), anchorProductId: null,
  items: [typeof a === 'string' ? item(a) : a, typeof b === 'string' ? item(b) : b],
});
const views = (...specs: [string, string | BundleItemDTO, string | BundleItemDTO][]) => specs.map(([id, a, b]) => comboView(dto(id, a, b), Date.now())!);

let mounted: Rendered[] = [];
const mount = async (ui: React.ReactElement) => {
  const r = render(ui);
  mounted.push(r);
  await flush();
  return r.container;
};
const addAllButtons = (c: HTMLElement) => Array.from(c.querySelectorAll<HTMLButtonElement>('button')).filter((b) => /Thêm cả combo/.test(b.textContent ?? ''));
const seeItemsButtons = (c: HTMLElement) => Array.from(c.querySelectorAll<HTMLButtonElement>('button')).filter((b) => b.textContent === 'Xem từng món');

beforeEach(() => {
  mocks.addAll.mockReset().mockResolvedValue({});
  mocks.push.mockReset();
  mocks.phase = 'authenticated';
});
afterEach(() => {
  mounted.forEach((m) => m.unmount());
  mounted = [];
});

describe('HomeCombos (web)', () => {
  it('không có combo: không render gì, không giữ chỗ', async () => {
    const c = await mount(<HomeCombos views={[]} />);
    expect(c.innerHTML).toBe('');
  });

  it('một khối "Combo tiết kiệm" với mỗi combo một thẻ, vùng cuộn ngang có tên đọc được', async () => {
    const c = await mount(<HomeCombos views={views(['c1', 'a', 'b'], ['c2', 'c', 'd'])} />);
    const section = c.querySelector('[data-testid="home-combos"]')!;
    expect(section.getAttribute('aria-label')).toBe('Combo tiết kiệm');
    expect(section.querySelector('h2')!.textContent).toBe('Combo tiết kiệm');
    expect(Array.from(section.querySelectorAll('h3')).map((h) => h.textContent)).toEqual(['Combo c1', 'Combo c2']);
    expect(section.querySelector('[aria-label="Combo tiết kiệm, vuốt ngang để xem thêm"]')).not.toBeNull();
  });

  it('"Thêm cả combo" thêm đúng các món của combo đó và báo kết quả ở vùng role=status', async () => {
    const c = await mount(<HomeCombos views={views(['c1', 'a', 'b'], ['c2', 'c', 'd'])} />);
    click(addAllButtons(c)[1]!);
    await flush();
    expect(mocks.addAll).toHaveBeenCalledWith([{ variationId: 'v-c', quantity: 1 }, { variationId: 'v-d', quantity: 1 }]);
    expect(c.querySelector('[role="status"]')!.textContent).toBe('Đã thêm cả combo vào giỏ');
  });

  it('khách chưa đăng nhập: chuyển sang đăng nhập, không gọi giỏ', async () => {
    mocks.phase = 'guest';
    const c = await mount(<HomeCombos views={views(['c1', 'a', 'b'], ['c2', 'c', 'd'])} />);
    click(addAllButtons(c)[0]!);
    expect(mocks.addAll).not.toHaveBeenCalled();
    expect(mocks.push).toHaveBeenCalledWith(expect.stringContaining('/dang-nhap'));
  });

  it('lỗi hết hàng của máy chủ đọc thẳng cho khách', async () => {
    mocks.addAll.mockRejectedValueOnce(new ApiError('Sản phẩm Sản phẩm a đã hết hàng', 409));
    const c = await mount(<HomeCombos views={views(['c1', 'a', 'b'], ['c2', 'c', 'd'])} />);
    click(addAllButtons(c)[0]!);
    await flush();
    expect(c.querySelector('[role="status"]')!.textContent).toBe('Sản phẩm Sản phẩm a đã hết hàng');
  });

  it('"Xem từng món" của từng thẻ mở món đầu của đúng combo đó', async () => {
    const c = await mount(<HomeCombos views={views(['c1', 'a', 'b'], ['c2', 'c', 'd'])} />);
    const buttons = seeItemsButtons(c);
    expect(buttons).toHaveLength(2);
    click(buttons[1]!);
    expect(mocks.push).toHaveBeenCalledTimes(1);
    expect(mocks.push).toHaveBeenCalledWith('/san-pham/sp-c');
  });

  it('món đầu hết hàng: thẻ "Combo tạm hết" vẫn có "Xem từng món", mở món còn hàng kế tiếp', async () => {
    const c = await mount(<HomeCombos views={views(['c1', item('a', { inStock: false }), 'b'], ['c2', 'c', 'd'])} />);
    expect(c.querySelector('[aria-label="Combo tạm hết: Combo c1"]')!.getAttribute('aria-disabled')).toBe('true');
    const buttons = seeItemsButtons(c);
    expect(buttons).toHaveLength(2);
    click(buttons[0]!);
    expect(mocks.push).toHaveBeenLastCalledWith('/san-pham/sp-b');
    click(buttons[1]!);
    expect(mocks.push).toHaveBeenLastCalledWith('/san-pham/sp-c');
    expect(mocks.push).toHaveBeenCalledTimes(2);
  });

  it('mọi món hết hàng: vẫn mở món đầu của bộ thay vì mất nút', async () => {
    const c = await mount(<HomeCombos views={views(['c1', item('a', { inStock: false }), item('b', { inStock: false })], ['c2', 'c', 'd'])} />);
    click(seeItemsButtons(c)[0]!);
    expect(mocks.push).toHaveBeenCalledWith('/san-pham/sp-a');
  });

  it('slug có ký tự đặc biệt được mã hoá trong đường dẫn', async () => {
    const c = await mount(<HomeCombos views={views(['c1', item('a', { slug: 'qua tang/1 &' }), 'b'], ['c2', 'c', 'd'])} />);
    click(seeItemsButtons(c)[0]!);
    expect(mocks.push).toHaveBeenCalledWith('/san-pham/qua%20tang%2F1%20%26');
  });

  it('vùng chạm và tên nút đạt chuẩn', async () => {
    const c = await mount(<HomeCombos views={views(['c1', 'a', 'b'], ['c2', 'c', 'd'])} />);
    expect(smallTouchTargets(c)).toEqual([]);
    expect(unnamedControls(c)).toEqual([]);
  });
});
