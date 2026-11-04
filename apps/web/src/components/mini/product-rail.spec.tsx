// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flush, render, type Rendered } from '@/test-utils/dom';
import { resetFlashSales } from '@/lib/use-flash-sales';

vi.mock('@/lib/shop-client', () => ({ getActiveFlashSales: async () => [] }));
vi.mock('@/lib/auth-phase', () => ({ useAuthPhase: () => 'guest' }));
vi.mock('@/lib/core-http', () => ({ coreHttp: { get: async () => ({}), post: async () => ({}), delete: async () => ({}) } }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: () => undefined }) }));

import { ProductRail } from './product-rail';

const item = (n: number) => ({
  id: `p${n}`, slug: `sp-${n}`, brand: 'Tubu', name: `Sản phẩm ${n}`, thumbnail: `https://cdn.example/${n}.jpg`,
  basePrice: 50_000, salePrice: null, isFeatured: false, inStock: true,
});
const ITEMS = [1, 2, 3, 4, 5].map(item);

let mounted: Rendered | null = null;
const mount = async (ui: React.ReactElement) => {
  mounted = render(ui);
  await flush();
  return Array.from(mounted.container.querySelectorAll('img'));
};
beforeEach(() => resetFlashSales());
afterEach(() => {
  mounted?.unmount();
  mounted = null;
});

describe('ProductRail: ảnh ưu tiên (LCP)', () => {
  it('priorityCount thẻ đầu eager + fetchpriority=high, thẻ còn lại lazy', async () => {
    const imgs = await mount(<ProductRail items={ITEMS} variant="rank" rankFrom={1} label="Bán chạy" priorityCount={2} />);
    expect(imgs.map((i) => i.getAttribute('loading'))).toEqual(['eager', 'eager', 'lazy', 'lazy', 'lazy']);
    expect(imgs.map((i) => i.getAttribute('fetchpriority'))).toEqual(['high', 'high', null, null, null]);
  });

  it('mặc định (kệ nằm dưới màn hình đầu): lazy hết, không fetchpriority', async () => {
    const imgs = await mount(<ProductRail items={ITEMS} variant="rail-md" label="Mua lại" />);
    expect(imgs).toHaveLength(5);
    expect(imgs.every((i) => i.getAttribute('loading') === 'lazy' && i.getAttribute('fetchpriority') === null)).toBe(true);
  });
});
