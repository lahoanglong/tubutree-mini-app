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
const CART = { items: [], couponCode: null, subtotal: 65000, discount: 0, freeship: false, freeshipThreshold: 199000, itemCount: 1 };

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
  it('1 món: thẻ ngang thấp (không phải kệ cuộn) với tên, phân loại, giá và hai nút; hỏi đúng /me/purchased-items?limit=10', async () => {
    const c = await mount();
    const region = c.querySelector('section[aria-label="Mua lại"]')!;
    expect(region.textContent).toContain('Nước rửa chén');
    expect(region.textContent).toContain('Chanh');
    expect(region.textContent).toContain('65.000đ');
    expect(byText(region as HTMLElement, 'button', 'Mua lại')).not.toBeNull();
    expect(Array.from(region.querySelectorAll('button')).some((b) => /Định kỳ/.test(b.textContent ?? ''))).toBe(true);
    expect(region.querySelector('ul')).toBeNull();
    expect(mocks.get).toHaveBeenCalledWith('/me/purchased-items', { query: { limit: 10 } });
  });

  it('tiêu đề có "Xem tất cả" sang danh sách Đã giao', async () => {
    const c = await mount();
    click(byText(c, 'button', 'Xem tất cả'));
    expect(mocks.push).toHaveBeenCalledWith('/tai-khoan/don-hang?tab=delivered');
  });

  // D7-29/D7-30: tên SP cao đúng hai dòng; kệ nhiều món không giãn thẻ theo bề ngang từ md (thẻ giãn làm lệch hàng ở 1280px).
  it('từ 3 món: kệ cuộn ngang, tên cao đúng hai dòng, thẻ không giãn từ md', async () => {
    rail = async () => ({ items: [ITEM, { ...ITEM, variationId: 'v2' }, { ...ITEM, variationId: 'v3' }], nextCursor: null });
    const c = await mount();
    const name = c.querySelector('section[aria-label="Mua lại"] p.line-clamp-2')!;
    expect(name.className).toContain('h-8');
    expect(name.className).not.toContain('min-h-');
    const tile = c.querySelector('section[aria-label="Mua lại"] li')!;
    expect(tile.className).not.toContain('md:flex-1');
    expect(tile.className).not.toContain('md:min-w-44');
    expect(tile.textContent).toContain('Đã mua 2 lần');
  });

  it('có giá sale thì hiện giá sale kèm giá gạch', async () => {
    rail = async () => ({ items: [{ ...ITEM, timesBought: 1, salePrice: 59000 }], nextCursor: null });
    const c = await mount();
    expect(c.textContent).toContain('59.000đ');
    expect(c.querySelector('[style*="line-through"]')?.textContent).toBe('65.000đ');
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
    click(c.querySelector('button[aria-label="Nước rửa chén"]'));
    expect(mocks.push).toHaveBeenCalledWith('/san-pham/nuoc-rua-chen');
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
