// @vitest-environment jsdom
import { act } from 'react';
import { QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { newTestClient } from '@/test-utils/render-hook';
import { byText, click, flush, render, type Rendered } from '@/test-utils/dom';
import { ApiError } from '@/lib/client-api';

// Chép ý nghĩa purchased-rail.spec của Mini App: kệ "Mua lại" cho khách cũ, ẩn khi rỗng/404/khách, sheet → thêm giỏ → sang giỏ, lỗi làm mới.
const mocks = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn(), push: vi.fn(), phase: 'authenticated' }));
vi.mock('@/lib/core-http', () => ({ coreHttp: { get: mocks.get, post: mocks.post } }));
vi.mock('@/lib/auth-phase', () => ({ useAuthPhase: () => mocks.phase }));
vi.mock('@/lib/cart-key', () => ({ cartStorefrontSlug: () => null }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: mocks.push }) }));

import { PurchasedRail } from './purchased-rail';

const ITEM = {
  variationId: 'v1', productId: 'p1', slug: 'nuoc-rua-chen', productName: 'Nước rửa chén', variationName: 'Chanh', brand: 'Tubu',
  thumbnail: null, price: 65000, salePrice: null, stock: 8, inStock: true, timesBought: 2, lastPurchasedAt: '2026-09-10T00:00:00.000Z',
};
const CART = { items: [], couponCode: null, subtotal: 65000, discount: 0, freeship: false, freeshipThreshold: 200000, itemCount: 1 };

let rail: () => Promise<unknown>;
let mounted: Rendered | null = null;
const mount = async () => {
  mounted = render(<PurchasedRail />);
  await flush(8);
  return mounted.container;
};

beforeEach(() => {
  mocks.phase = 'authenticated';
  rail = async () => ({ items: [ITEM], nextCursor: null });
  mocks.get.mockReset().mockImplementation(() => rail());
  mocks.post.mockReset().mockResolvedValue(CART);
  mocks.push.mockReset();
});
afterEach(() => {
  mounted?.unmount();
  mounted = null;
  document.body.innerHTML = '';
});

describe('PurchasedRail', () => {
  it('khách cũ: vùng "Mua lại" với thẻ SP, giá, nhãn số lần đã mua; hỏi đúng /me/purchased-items?limit=10', async () => {
    const c = await mount();
    const region = c.querySelector('section[aria-label="Mua lại"]')!;
    expect(region.textContent).toContain('Nước rửa chén · Chanh');
    expect(region.textContent).toContain('65.000đ');
    expect(region.textContent).toContain('Đã mua 2 lần');
    expect(mocks.get).toHaveBeenCalledWith('/me/purchased-items', { query: { limit: 10 } });
  });

  it('mua một lần thì không có nhãn; có giá sale thì hiện giá sale kèm giá gạch', async () => {
    rail = async () => ({ items: [{ ...ITEM, timesBought: 1, salePrice: 59000 }], nextCursor: null });
    const c = await mount();
    expect(c.textContent).not.toContain('Đã mua');
    expect(c.textContent).toContain('59.000đ');
    expect(c.querySelector('.line-through')?.textContent).toBe('65.000đ');
  });

  it('khách mới (rỗng) → không render gì', async () => {
    rail = async () => ({ items: [], nextCursor: null });
    expect((await mount()).textContent).toBe('');
  });

  it('API cũ trả 404 hoặc lỗi ở lần tải đầu → ẩn im lặng, không "Thử lại" (Trang chủ tự dựng khối lỗi cho lỗi thật)', async () => {
    rail = async () => {
      throw new ApiError('Không tìm thấy', 404);
    };
    expect((await mount()).textContent).toBe('');
  });

  it('chưa đăng nhập → không gọi API, không render', async () => {
    mocks.phase = 'guest';
    expect((await mount()).textContent).toBe('');
    expect(mocks.get).not.toHaveBeenCalled();
  });

  it('đang tải → khung chờ ẩn với trình đọc màn hình, không phải region', async () => {
    rail = () => new Promise(() => undefined);
    const c = await mount();
    expect(c.querySelector('[data-testid="purchased-rail-loading"]')?.getAttribute('aria-hidden')).toBe('true');
    expect(c.querySelector('section')).toBeNull();
  });

  it('"Mua lại" → sheet → "Thêm vào giỏ (1)" → POST /cart/items addSource repurchase rồi tự sang giỏ', async () => {
    const c = await mount();
    click(byText(c, 'button', 'Mua lại'));
    expect(document.querySelector('[role="dialog"]')).not.toBeNull();
    const cta = Array.from(document.querySelectorAll<HTMLButtonElement>('button')).find((b) => b.textContent === 'Thêm vào giỏ (1)')!;
    click(cta);
    await flush(8);
    expect(mocks.post).toHaveBeenCalledWith('/cart/items', { variationId: 'v1', quantity: 1, addSource: 'repurchase' }, undefined);
    expect(mocks.push).toHaveBeenCalledWith('/gio-hang');
  });

  it('SP hết hàng: thẻ không có nút mua lại, ghi "Tạm hết hàng"', async () => {
    rail = async () => ({ items: [{ ...ITEM, inStock: false, stock: 0 }], nextCursor: null });
    const c = await mount();
    expect(byText(c, 'button', 'Mua lại')).toBeNull();
    expect(c.textContent).toContain('Tạm hết hàng');
  });

  it('chạm tên/ảnh thẻ → trang sản phẩm', async () => {
    const c = await mount();
    expect(c.querySelector('a[href="/san-pham/nuoc-rua-chen"]')).not.toBeNull();
  });

  describe('làm mới lỗi (React Query v5 giữ dữ liệu cũ, status=error)', () => {
    it('còn dữ liệu cũ → kệ KHÔNG biến mất: vẫn hiện thẻ cũ + dòng báo nhẹ + "Thử lại"; thử lại xong thì dòng báo mất', async () => {
      const client = newTestClient();
      mounted = render(
        <QueryClientProvider client={client}>
          <PurchasedRail />
        </QueryClientProvider>,
      );
      await flush(8);
      expect(mounted.container.textContent).toContain('Nước rửa chén');

      rail = async () => {
        throw new ApiError('Máy chủ đang bận', 503);
      };
      await act(async () => {
        await client.refetchQueries({ queryKey: ['purchased-items', 10] });
      });
      await flush(4);
      expect(mounted.container.textContent).toContain('Nước rửa chén');
      expect(mounted.container.textContent).toContain('Máy chủ đang bận');

      rail = async () => ({ items: [ITEM], nextCursor: null });
      click(mounted.container.querySelector('button[aria-label="Thử lại Mua lại"]'));
      await flush(8);
      expect(mounted.container.textContent).not.toContain('Máy chủ đang bận');
      expect(mounted.container.textContent).toContain('Nước rửa chén');
    });

    it('lỗi ở lần tải đầu (chưa có gì để giữ) → ẩn như cũ', async () => {
      rail = async () => {
        throw new ApiError('Máy chủ đang bận', 503);
      };
      expect((await mount()).textContent).toBe('');
    });
  });
});
