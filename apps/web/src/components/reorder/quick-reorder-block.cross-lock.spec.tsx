// @vitest-environment jsdom
import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { QuickReorderItem } from '@tubutree/app-core/commerce/quick-reorder';
import { flush, render, type Rendered } from '@/test-utils/dom';

// Khoá chéo của khối là của chính nó, không dựa vào việc dải đã vẽ lại nút khoá hay chưa: dải được thay bằng bản giả để gọi thẳng `onAdd`/`onAddAll`
// với props của lần vẽ cũ (cú bấm tới trước khi React kịp vẽ lại), đúng khung hình mà khoá `disabled` của dải chưa phủ tới.
const mocks = vi.hoisted(() => ({
  post: vi.fn(),
  addAll: vi.fn(),
  strip: null as null | { onAdd: (item: unknown) => void; onAddAll: () => void },
}));
vi.mock('@/components/mini/quick-reorder-strip', () => ({
  QuickReorderStrip: (p: { onAdd: (item: unknown) => void; onAddAll: () => void }) => {
    mocks.strip = { onAdd: p.onAdd, onAddAll: p.onAddAll };
    return null;
  },
}));
vi.mock('@/lib/use-flash-sales', () => ({ useActiveFlashSales: () => [], useRunningFlash: () => ({ flash: [], now: Date.now() }) }));
vi.mock('@/lib/core-http', () => ({ coreHttp: { get: vi.fn(), post: mocks.post } }));
vi.mock('@/lib/shop-combo', () => ({ addAllToCart: mocks.addAll }));
vi.mock('@/lib/auth-phase', () => ({ useAuthPhase: () => 'authenticated' }));
vi.mock('@/lib/cart-key', () => ({ cartStorefrontSlug: () => null, useCartKey: () => ['cart', null], cartKey: () => ['cart', null] }));
vi.mock('@/lib/shop-client', async (importOriginal) => ({ ...(await importOriginal<typeof import('@/lib/shop-client')>()), getCart: async () => ({ items: [] }) }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }), usePathname: () => '/' }));

import { QuickReorderBlock } from './quick-reorder-block';

const item = (n: number): QuickReorderItem => ({
  key: `v${n}`, productId: `p${n}`, slug: `sp-${n}`, variationId: `v${n}`, name: `Món ${n}`, thumbnail: null,
  price: 50_000, compareAt: null, savePct: 0, isFlash: false, timesBought: 1, source: 'purchased',
});
const ITEMS = [item(1), item(2), item(3)];
const CART = { items: [], itemCount: 3, subtotal: 150_000, discount: 0, freeship: false, freeshipThreshold: 199_000, couponCode: null };

let mounted: Rendered | null = null;
beforeEach(() => {
  mocks.post.mockReset().mockResolvedValue(CART);
  mocks.addAll.mockReset().mockResolvedValue(CART);
  mocks.strip = null;
  mounted = render(<QuickReorderBlock items={ITEMS} />);
});
afterEach(() => {
  mounted?.unmount();
  mounted = null;
  document.body.innerHTML = '';
});

describe('QuickReorderBlock — cú "+ Thêm" bị bỏ không được nhả khoá của lệnh đang bay', () => {
  it('"+ Thêm" P, "+ Thêm" Q (bị bỏ vì P còn bay), rồi "Thêm lại tất cả" cùng props cũ: chỉ một lệnh bay, lệnh lô không đi', async () => {
    mocks.post.mockImplementation(() => new Promise(() => undefined));
    await flush(4);
    const strip = mocks.strip!;
    strip.onAdd(ITEMS[0]);
    strip.onAdd(ITEMS[1]);
    // Cho lời hứa đã xong của cú Q (bị bỏ) chạy hết phần `.finally` trước khi bấm tiếp.
    await Promise.resolve();
    await Promise.resolve();
    strip.onAddAll();
    await flush(2);
    expect(mocks.post).toHaveBeenCalledTimes(1);
    expect(mocks.addAll).not.toHaveBeenCalled();
  });

  it('P xong thì khoá nhả đúng một lần: "Thêm lại tất cả" đi được, và "+ Thêm" lại đi được sau lệnh lô', async () => {
    let finish!: (v: unknown) => void;
    mocks.post.mockImplementationOnce(() => new Promise((r) => (finish = r)));
    await flush(4);
    const strip = mocks.strip!;
    act(() => {
      strip.onAdd(ITEMS[0]);
      strip.onAdd(ITEMS[1]);
    });
    await act(async () => finish(CART));
    await flush(6);
    act(() => mocks.strip!.onAddAll());
    await flush(6);
    expect(mocks.addAll).toHaveBeenCalledTimes(1);
    act(() => mocks.strip!.onAdd(ITEMS[2]));
    await flush(4);
    expect(mocks.post).toHaveBeenCalledTimes(2);
  });
});
