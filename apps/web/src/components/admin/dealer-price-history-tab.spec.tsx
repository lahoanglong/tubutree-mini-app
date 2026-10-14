// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { act } from 'react';
import { DealerPriceHistoryTab } from './dealer-price-history-tab';
import { flush, mockFetch, render, typeInto, type Rendered } from '@/test-utils/dom';

let mounted: Rendered[] = [];
const mount = (ui: Parameters<typeof render>[0]) => {
  const r = render(ui);
  mounted.push(r);
  return r;
};
afterEach(() => {
  mounted.forEach((m) => m.unmount());
  mounted = [];
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

const ROW = {
  id: 'h1',
  variationId: 'v1',
  sku: 'NRC-500',
  tierId: 'tier_gold',
  oldPrice: 200000,
  newPrice: 190000,
  changedBy: 'a1',
  createdAt: '2026-10-10T03:00:00.000Z',
  productName: 'Nước rửa chén',
  variationName: 'Chai 500ml',
  tierName: 'Vàng',
  changedByName: 'Chủ shop',
};

function stub(total = 1) {
  const m = mockFetch({ '/admin/dealer-prices/history': { body: { data: [ROW, { ...ROW, id: 'h2', oldPrice: null, tierName: null }], meta: { page: 1, limit: 30, total } } } });
  vi.stubGlobal('fetch', vi.fn(m.fn));
  return m;
}

describe('DealerPriceHistoryTab (Lịch sử giá đại lý, ADMINOPS-17)', () => {
  it('mỗi dòng: SKU, sản phẩm/biến thể, bậc, giá cũ → mới, ai đổi', async () => {
    stub(2);
    const { container } = mount(<DealerPriceHistoryTab />);
    await flush();
    const rows = container.querySelectorAll<HTMLElement>('[data-price-history]');
    expect(rows).toHaveLength(2);
    const t = rows[0]!.textContent ?? '';
    expect(t).toContain('NRC-500');
    expect(t).toContain('Nước rửa chén · Chai 500ml');
    expect(t).toContain('Bậc Vàng');
    expect(t).toContain('200.000');
    expect(t).toContain('190.000');
    expect(t).toContain('Chủ shop');
    expect(rows[1]!.textContent).toContain('Chưa có giá riêng');
    expect(rows[1]!.textContent).toContain('Bậc tier_gold');
    expect(container.textContent).toContain('2 lần đổi giá');
  });

  it('tìm theo SKU gọi API với sku', async () => {
    const m = stub();
    const { container } = mount(<DealerPriceHistoryTab />);
    await flush();
    typeInto(container.querySelector('input[type="search"]'), 'NRC');
    await act(async () => {
      await new Promise((r) => setTimeout(r, 400));
    });
    await flush();
    expect(m.calls.some((c) => c.url.includes('sku=NRC'))).toBe(true);
  });
});
