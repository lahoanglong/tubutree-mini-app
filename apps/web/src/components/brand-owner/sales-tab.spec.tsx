// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { flush, render, type Rendered } from '@/test-utils/dom';

import { SalesTab } from './sales-tab';

const sales = {
  orderCount: 20,
  revenue: 10282000,
  unitsSold: 39,
  delivered: { orderCount: 5, revenue: 100000 },
  topProducts: [{ productId: 'p1', name: 'Sản phẩm một', quantity: 3, revenue: 300000 }],
};

let mounted: Rendered[] = [];
afterEach(() => {
  mounted.forEach((m) => m.unmount());
  mounted = [];
  vi.unstubAllGlobals();
});

describe('tab Doanh thu chủ nhãn', () => {
  it('ô số theo StatTile của Mini: biểu tượng, rồi số, rồi nhãn; danh sách bán chạy không thẻ trắng ở điện thoại', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(sales), { status: 200, headers: { 'Content-Type': 'application/json' } })));
    const r = render(<SalesTab />);
    mounted.push(r);
    await flush(10);
    const c = r.container;
    const tile = Array.from(c.querySelectorAll('div')).find((d) => d.textContent === '10.282.000đDoanh thu');
    expect(tile).toBeTruthy();
    expect(tile!.firstElementChild!.querySelector('svg')).not.toBeNull();
    const list = c.querySelector('section[aria-label="Sản phẩm bán chạy"]')!;
    expect(list.className).toContain('p-0');
    expect(list.className).toContain('md:p-4');
  });
});
