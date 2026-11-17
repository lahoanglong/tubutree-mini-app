// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import type { CompareItem, ProductCompare } from '@tubutree/app-core/api/product-compare';
import { render, type Rendered } from '@/test-utils/dom';
import { PdpCompare } from './pdp-compare';

const item = (slug: string, over: Record<string, unknown> = {}): CompareItem =>
  ({ productId: slug, slug, name: slug, brand: 'Tubu', thumbnail: null, price: 100_000, variationName: '1L', size: null, unitPrice: null, keyIngredients: [], ...over }) as CompareItem;

let mounted: Rendered[] = [];
const mount = (data: ProductCompare) => {
  const r = render(<PdpCompare data={data} />);
  mounted.push(r);
  return r.container;
};
afterEach(() => {
  mounted.forEach((m) => m.unmount());
  mounted = [];
});

describe('PdpCompare — hàng "Điểm cộng xanh"', () => {
  it('máy chủ gửi số đếm (cờ nhãn xanh bật): hàng có số, món 0 điểm cộng ghi "—", đứng trước hàng "Xem"', () => {
    const c = mount({ current: item('a', { ecoFactCount: 2 }), others: [item('b', { ecoFactCount: 0 })] });
    const row = c.querySelector('[data-testid="pdp-compare-eco"]');
    expect(row?.querySelector('th')?.textContent).toBe('Điểm cộng xanh');
    expect([...row!.querySelectorAll('td')].map((td) => td.textContent)).toEqual(['2 điểm cộng', '—']);
    expect(row?.nextElementSibling?.textContent).toContain('Xem');
  });

  it('cờ tắt (không có ecoFactCount): không có hàng, bảng như cũ', () => {
    const c = mount({ current: item('a'), others: [item('b')] });
    expect(c.querySelector('[data-testid="pdp-compare-eco"]')).toBeNull();
  });
});
