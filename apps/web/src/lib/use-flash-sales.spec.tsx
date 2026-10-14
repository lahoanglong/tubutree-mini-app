// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flush, render, type Rendered } from '@/test-utils/dom';
import type { FlashItem } from './flash-price';

const api = vi.hoisted(() => ({ calls: 0, impl: null as null | (() => Promise<unknown>) }));
vi.mock('@/lib/shop-client', () => ({
  getActiveFlashSales: () => {
    api.calls += 1;
    return api.impl!();
  },
}));

import { resetFlashSales, useActiveFlashSales } from './use-flash-sales';

const ITEM: FlashItem = {
  itemId: 'f1', variationId: 'v1', productSlug: 'nuoc-rua-chen', flashPrice: 79000, retailPrice: 120000,
  salePrice: null, soldCount: 3, quota: 20, endAt: '2026-10-14T16:00:00.000Z',
};

function Probe({ id }: { id: string }) {
  const items = useActiveFlashSales();
  return <span data-testid={id}>{items.map((i) => i.flashPrice).join(',') || 'none'}</span>;
}

let mounted: Rendered[] = [];
beforeEach(() => {
  resetFlashSales();
  api.calls = 0;
  api.impl = async () => [ITEM];
});
afterEach(() => {
  mounted.forEach((m) => m.unmount());
  mounted = [];
});

describe('useActiveFlashSales — các thẻ sản phẩm dùng chung một lần gọi', () => {
  it('chưa tải xong (và khi render phía máy chủ): rỗng, tức là giá thường', () => {
    api.impl = () => new Promise(() => {});
    const r = render(<Probe id="a" />);
    mounted.push(r);
    expect(r.container.textContent).toBe('none');
  });

  it('nhiều thẻ cùng trang chỉ gọi API một lần và cùng thấy đợt Giờ vàng', async () => {
    const r = render(
      <>
        <Probe id="a" />
        <Probe id="b" />
        <Probe id="c" />
      </>,
    );
    mounted.push(r);
    await flush();
    expect(api.calls).toBe(1);
    expect(r.container.textContent).toBe('79000' + '79000' + '79000');
  });

  it('API lỗi: coi như không có đợt nào (giá thường), không làm vỡ trang, lần mở sau thử lại', async () => {
    api.impl = async () => {
      throw new Error('boom');
    };
    const r = render(<Probe id="a" />);
    mounted.push(r);
    await flush();
    expect(r.container.textContent).toBe('none');

    api.impl = async () => [ITEM];
    const r2 = render(<Probe id="b" />);
    mounted.push(r2);
    await flush();
    expect(r2.container.textContent).toBe('79000');
    expect(api.calls).toBe(2);
  });

  it('trả về không phải mảng: bỏ qua', async () => {
    api.impl = async () => ({ message: 'x' });
    const r = render(<Probe id="a" />);
    mounted.push(r);
    await flush();
    expect(r.container.textContent).toBe('none');
  });
});
