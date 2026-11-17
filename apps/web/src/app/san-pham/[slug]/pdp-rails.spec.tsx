// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PdpSelectionProvider, usePdpSelection } from '@/components/pdp-selection';
import { click, flush, render, type Rendered } from '@/test-utils/dom';

const mocks = vi.hoisted(() => ({ phase: 'guest' as string, get: vi.fn() }));
vi.mock('@/lib/auth-phase', () => ({ useAuthPhase: () => mocks.phase }));
vi.mock('@/lib/core-http', () => ({ coreHttp: { get: mocks.get } }));
vi.mock('@/components/mini/product-rail', () => ({
  ProductRail: ({ items, label }: { items: { id: string; name: string }[]; label: string }) => (
    <ul data-testid="rail" aria-label={label}>
      {items.map((i) => (
        <li key={i.id}>{i.name}</li>
      ))}
    </ul>
  ),
}));
// Khối "Gợi ý mua kèm hợp vị" có spec riêng (pdp-fbt.spec.tsx); ở đây chỉ cần biết khối nào được chọn.
vi.mock('./pdp-fbt', () => ({ PdpFbt: () => <div data-testid="fbt-stub" /> }));
vi.mock('@/components/mini/product-grid', () => ({
  ProductGrid: ({ items }: { items: { id: string; name: string }[] }) => (
    <ul data-testid="feed-grid">
      {items.map((i) => (
        <li key={i.id}>{i.name}</li>
      ))}
    </ul>
  ),
}));

import { PdpAddOns, PdpAddOnScope } from './pdp-addons';
import { PdpRails } from './pdp-rails';

const card = (id: string) => ({ id, name: `Món ${id}`, slug: id });
const many = (prefix: string, n: number) => Array.from({ length: n }, (_, i) => card(`${prefix}${i}`));

let mounted: Rendered[] = [];
const mount = async () => {
  const r = render(<PdpRails productId="cur" slug="cur" brand="Tubu" initialRelated={[]} />);
  mounted.push(r);
  await flush();
  return r.container;
};
const paths = () => mocks.get.mock.calls.map((c) => String(c[0]));

beforeEach(() => {
  mocks.get.mockReset();
  mocks.get.mockImplementation(async (path: string) => {
    if (path === '/products/for-you') return many('fy', 6);
    if (path === '/products') return { data: [card('cur'), ...many('bs', 6)], meta: { page: 1, limit: 24, total: 7 } };
    throw new Error(`đường không mong đợi: ${path}`);
  });
});
afterEach(() => {
  mounted.forEach((m) => m.unmount());
  mounted = [];
});

describe('PdpRails: "Có thể bạn cũng thích"', () => {
  it('khách vãng lai: không gọi /products/for-you (cần JWT, sẽ 401), lấy bán chạy và bỏ món đang xem', async () => {
    mocks.phase = 'guest';
    const c = await mount();
    expect(paths()).not.toContain('/products/for-you');
    expect(paths()).toContain('/products');
    expect(mocks.get.mock.calls.find((x) => x[0] === '/products')?.[1]).toMatchObject({ query: { sort: 'best_seller', limit: 10 } });
    const items = Array.from(c.querySelectorAll('[data-testid="feed-grid"] li')).map((li) => li.textContent);
    expect(items).toHaveLength(6);
    expect(items).not.toContain('Món cur');
    expect(c.querySelector('#pdp-feed-title')?.textContent).toBe('Có thể bạn cũng thích');
  });

  it('đang khôi phục phiên thì chưa gọi nguồn gợi ý nào', async () => {
    mocks.phase = 'loading';
    await mount();
    expect(paths()).not.toContain('/products/for-you');
    expect(paths()).not.toContain('/products');
  });

  it('khách đã đăng nhập: dùng gợi ý cá nhân, không gọi danh sách công khai', async () => {
    mocks.phase = 'authenticated';
    const c = await mount();
    expect(paths()).toContain('/products/for-you');
    expect(paths()).not.toContain('/products');
    expect(Array.from(c.querySelectorAll('[data-testid="feed-grid"] li')).map((li) => li.textContent)).toContain('Món fy0');
  });

  it('API trả sai dạng (không phải mảng): khối ẩn, trang không vỡ', async () => {
    mocks.phase = 'authenticated';
    mocks.get.mockImplementation(async (path: string) => (path === '/products/for-you' ? { error: 'x' } : []));
    const c = await mount();
    expect(c.querySelector('#pdp-feed-title')).toBeNull();
  });
});

describe('Khối mua kèm duy nhất (PdpAddOnScope + PdpAddOns) và các dải cuối trang', () => {
  const VARIATIONS = [
    { id: 'v-cur', retailPrice: 100_000, salePrice: null, stock: 10 },
    { id: 'v-out', retailPrice: 120_000, salePrice: null, stock: 0 },
  ];
  const together = [card('b1'), card('b2'), card('b3'), card('b4'), card('b5'), card('b6')].map((c) => ({ ...c, inStock: true, repVariationId: `v-${c.id}`, basePrice: 50_000, salePrice: null, brand: 'Tubu', thumbnail: null, isFeatured: false }));
  const asCard = (id: string) => ({ ...card(id), inStock: true, basePrice: 50_000, salePrice: null, brand: 'Tubu', thumbnail: null, isFeatured: false });

  function PickOut() {
    const sel = usePdpSelection();
    return <button type="button" data-testid="pick-out" onClick={() => sel?.setSelectedId('v-out')} />;
  }

  const mountPage = async ({
    hasBundles = false,
    initialBoughtTogether = together,
    variations = VARIATIONS,
    related = [] as ReturnType<typeof asCard>[],
    blockedReason,
    selected = 'v-cur',
  }: {
    hasBundles?: boolean;
    initialBoughtTogether?: typeof together;
    variations?: typeof VARIATIONS;
    related?: ReturnType<typeof asCard>[];
    blockedReason?: string;
    selected?: string;
  } = {}) => {
    const host = { productId: 'cur', slug: 'cur', name: 'Món đang xem', thumbnail: null, variations, blockedReason, initialBoughtTogether };
    const r = render(
      <PdpSelectionProvider initialId={selected}>
        <PdpAddOnScope hasBundles={hasBundles} {...host}>
          <PickOut />
          <PdpAddOns bundles={<div data-testid="bundles-stub" />} fbt={host} />
          <PdpRails productId="cur" slug="cur" brand="Tubu" initialRelated={related} />
        </PdpAddOnScope>
      </PdpSelectionProvider>,
    );
    mounted.push(r);
    await flush();
    return r.container;
  };
  const addons = (c: HTMLElement) => c.querySelectorAll('[data-pdp-block="addons"]');
  const railNames = (root: Element | null) => Array.from(root?.querySelectorAll('[data-testid="rail"] li') ?? []).map((li) => li.textContent);
  const suggestions = (c: HTMLElement) => c.querySelector('[data-pdp-block="suggestions"]');

  beforeEach(() => {
    mocks.phase = 'guest';
  });

  it('có combo/mua kèm giá tốt thật: khối là bộ do trang dựng, không có bộ gợi ý hay dải "Khách thường mua cùng" ở đâu cả', async () => {
    const c = await mountPage({ hasBundles: true, related: [asCard('b1'), asCard('r1')] });
    expect(addons(c)).toHaveLength(1);
    expect(addons(c)[0]!.querySelector('[data-testid="bundles-stub"]')).not.toBeNull();
    expect(c.querySelector('[data-testid="fbt-stub"]')).toBeNull();
    expect(c.querySelector('[aria-label="Khách thường mua cùng"]')).toBeNull();
    // Không có bộ gợi ý nên dải Cùng thương hiệu giữ cả món b1.
    expect(railNames(suggestions(c))).toEqual(['Món b1', 'Món r1']);
  });

  it('không có combo, có bộ "Gợi ý mua kèm hợp vị": khối là bộ đó; dải cuối không lặp 2 món của bộ và không có dải "Khách thường mua cùng"', async () => {
    const c = await mountPage({ related: [asCard('b1'), asCard('b3'), asCard('r1')] });
    expect(addons(c)).toHaveLength(1);
    expect(addons(c)[0]!.querySelector('[data-testid="fbt-stub"]')).not.toBeNull();
    expect(c.querySelector('[aria-label="Khách thường mua cùng"]')).toBeNull();
    expect(railNames(suggestions(c))).toEqual(['Món b3', 'Món r1']);
  });

  it('không dựng được bộ gợi ý (món đang xem hết hàng): khối là dải "Khách thường mua cùng" đủ món; dải Cùng thương hiệu không lặp các món đó', async () => {
    const c = await mountPage({ selected: 'v-out', related: [asCard('b1'), asCard('r1')] });
    expect(addons(c)).toHaveLength(1);
    expect(railNames(addons(c)[0]!)).toEqual(['Món b1', 'Món b2', 'Món b3', 'Món b4', 'Món b5', 'Món b6']);
    expect(addons(c)[0]!.querySelector('h2')!.textContent).toBe('Khách thường mua cùng');
    expect(railNames(suggestions(c))).toEqual(['Món r1']);
  });

  it('gian hàng tạm nghỉ: không có bộ gợi ý, khối là dải "Khách thường mua cùng"', async () => {
    const c = await mountPage({ blockedReason: 'Gian hàng tạm nghỉ' });
    expect(c.querySelector('[data-testid="fbt-stub"]')).toBeNull();
    expect(railNames(addons(c)[0]!)).toHaveLength(6);
  });

  it('không combo, không bộ gợi ý, dải mua cùng dưới sàn 3 món: không có khối mua kèm (không dải rỗng)', async () => {
    const c = await mountPage({ selected: 'v-out', initialBoughtTogether: together.slice(0, 2) });
    expect(addons(c)).toHaveLength(0);
    expect(c.querySelector('[data-testid="bundles-stub"]')).toBeNull();
  });

  it('nguồn chốt một lần: bộ gợi ý mất đi sau đó (đổi sang phân loại hết hàng) thì khối ẩn, không nhảy sang dải "Khách thường mua cùng"', async () => {
    const c = await mountPage();
    expect(c.querySelector('[data-testid="fbt-stub"]')).not.toBeNull();
    click(c.querySelector('[data-testid="pick-out"]'));
    await flush();
    expect(addons(c)).toHaveLength(0);
    expect(c.querySelector('[aria-label="Khách thường mua cùng"]')).toBeNull();
  });
});
