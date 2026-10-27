// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flush, render, type Rendered } from '@/test-utils/dom';
import { OrderCard } from './order-card';
import { SubscriptionsPanel } from './subscriptions-panel';

// Thẻ đơn và thẻ lịch định kỳ ở điện thoại phải là Mini App (order-card.tsx, subscriptions-panel.tsx):
// nút phụ nền xanh nhạt không viền, ô ảnh nền sage, "Giao thành công". jsdom không có media query nên kiểm bằng lớp `max-md:`.

vi.mock('@/lib/auth-context', () => ({ useAuth: () => ({ status: 'authenticated', initialized: true, sessionUnavailable: false }) }));

const ORDER = {
  id: 'o1', code: 'TUBU1', status: 'DELIVERED', subtotal: 149000, discount: 0, shippingFee: 0, total: 149000, paymentMethod: 'COD',
  paymentStatus: 'PAID', createdAt: '2026-09-20T03:00:00Z',
  items: [{ id: 'i1', variationId: 'v1', productName: 'Nước rửa chén', variationName: 'Chanh', unitPrice: 50000, quantity: 2, total: 100000, thumbnail: null }],
} as never;
const SUB = {
  id: 's1', quantity: 2, intervalWeeks: 4, status: 'ACTIVE', nextRunAt: '2026-10-15T00:00:00.000Z',
  addressId: 'a1', paymentMethod: 'COD', lastOrderId: null,
  productName: 'Nước xả vải Tubu', variationName: 'Hương sả', thumbnail: null, slug: 'nxv', unitPrice: 80000, effectiveDiscountPct: 0.14,
};

let mounted: Rendered[] = [];
const mount = async (ui: Parameters<typeof render>[0]) => {
  const r = render(ui);
  mounted.push(r);
  await flush(8);
  return r.container;
};
const button = (c: HTMLElement, label: string) => Array.from(c.querySelectorAll('button')).find((b) => b.textContent === label)!;
beforeEach(() => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      const path = new URL(url).pathname.replace(/^\/api/, '');
      const json = (b: unknown) => new Response(JSON.stringify(b), { status: 200, headers: { 'Content-Type': 'application/json' } });
      if (path === '/me/subscriptions') return json([SUB]);
      if (path === '/me/addresses') return json([]);
      if (path === '/config/public') return json({ subscribeDiscountPct: 0.12 });
      return json({});
    }),
  );
});
afterEach(() => {
  mounted.forEach((m) => m.unmount());
  mounted = [];
  vi.unstubAllGlobals();
});

describe('OrderCard như Mini App', () => {
  it('đơn đã giao ghi "Giao thành công"', async () => {
    const c = await mount(<OrderCard order={ORDER} />);
    expect(c.textContent).toContain('Giao thành công');
  });

  it('thẻ nổi không viền, ô ảnh nền sage, "Mua lại" là nút phụ nền xanh nhạt không viền', async () => {
    const c = await mount(<OrderCard order={ORDER} onReorder={() => undefined} />);
    expect(c.querySelector('li')!.className).toMatch(/\bmax-md:border-0\b/);
    expect(c.querySelector('li svg')!.parentElement!.style.background).toContain('var(--color-bg-subtle)');
    const reorder = button(c, 'Mua lại');
    expect(reorder.className).toMatch(/max-md:bg-\[var\(--color-action-secondary-bg\)\]/);
    expect(reorder.className).toMatch(/\bmax-md:border-transparent\b/);
  });
});

describe('SubscriptionsPanel như Mini App', () => {
  it('"Sửa" và "Tạm dừng" là nút phụ nền xanh nhạt không viền; ô ảnh nền sage', async () => {
    const c = await mount(<SubscriptionsPanel />);
    for (const label of ['Sửa', 'Tạm dừng']) {
      const b = button(c, label);
      expect(b.className).toMatch(/max-md:bg-\[var\(--color-action-secondary-bg\)\]/);
    }
    expect(c.querySelector('li svg')!.parentElement!.style.background).toContain('var(--color-bg-subtle)');
  });

  it('"Huỷ" chữ đỏ thật: không mang lớp màu chữ stone của nút phụ để thắng thua không phụ thuộc thứ tự CSS', async () => {
    const c = await mount(<SubscriptionsPanel />);
    const cancel = button(c, 'Huỷ');
    expect(cancel.className).toMatch(/\btext-danger-fg\b/);
    expect(cancel.className).not.toMatch(/\btext-stone-800\b/);
    expect(cancel.className).not.toMatch(/\bborder-stone-450\b/);
    expect(cancel.className).not.toMatch(/\bbg-stone-0\b/);
  });
});
