// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flush, render, type Rendered } from '@/test-utils/dom';

// Cùng ý nghĩa product-detail-trust.spec (Mini App): dải cam kết dưới khối mua, theo ai giao và số ngày đổi trả.

const mocks = vi.hoisted(() => ({
  config: { isLoaded: true, freeshipThreshold: 199000, subscribeDiscountPct: 0.12, returnWindowDays: 7 as unknown, groupBuy: { discountPct: 15, targetSize: 3 } } as Record<string, unknown>,
}));
vi.mock('@/lib/use-public-config', () => ({ usePublicConfig: () => mocks.config }));

import { PdpTrustStrip } from './pdp-extras';

let mounted: Rendered[] = [];
const mount = (ui: React.ReactElement) => {
  const r = render(ui);
  mounted.push(r);
  return r;
};
const qa = (c: ParentNode, id: string) => c.querySelectorAll(`[data-testid="${id}"]`);

beforeEach(() => {
  mocks.config = { ...mocks.config, returnWindowDays: 7 };
});
afterEach(() => {
  mounted.forEach((m) => m.unmount());
  mounted = [];
});

describe('PdpTrustStrip (web)', () => {
  it('hàng Tubu giao: ba trụ cột và liên kết tới chính sách đổi trả', async () => {
    const { container } = mount(<PdpTrustStrip fulfillerKind="TUBU" />);
    await flush();
    expect(container.querySelectorAll('li')).toHaveLength(3);
    expect(container.querySelector('a[data-testid="product-trust-cta"]')!.getAttribute('href')).toBe('/chinh-sach/doi-tra');
  });

  it('chưa biết ai giao (API cũ) vẫn có dải như khối Cam kết Tubu', async () => {
    const { container } = mount(<PdpTrustStrip fulfillerKind={undefined} />);
    await flush();
    expect(qa(container, 'product-trust-strip')).toHaveLength(1);
  });

  it.each(['MERCHANT', 'UNAVAILABLE'])('hàng %s: không có dải, thẻ bọc rỗng nên ẩn được bằng :empty', async (kind) => {
    const { container } = mount(
      <div data-section="pdp-trust" className="empty:hidden">
        <PdpTrustStrip fulfillerKind={kind} />
      </div>,
    );
    await flush();
    expect(qa(container, 'product-trust-strip')).toHaveLength(0);
    expect(container.querySelector('[data-section="pdp-trust"]')!.childNodes).toHaveLength(0);
  });

  it('đổi trả tắt ở cấu hình (0 ngày): bỏ trụ đổi trả, liên kết sang chính sách vận chuyển', async () => {
    mocks.config = { ...mocks.config, returnWindowDays: 0 };
    const { container } = mount(<PdpTrustStrip fulfillerKind="TUBU" />);
    await flush();
    expect(container.querySelectorAll('li')).toHaveLength(2);
    expect(qa(container, 'trust-pillar-returns')).toHaveLength(0);
    expect(container.querySelector('a[data-testid="product-trust-cta"]')!.getAttribute('href')).toBe('/chinh-sach/van-chuyen');
  });
});
