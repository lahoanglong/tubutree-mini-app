import { beforeEach, describe, expect, it, vi } from 'vitest';

const http = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn(), put: vi.fn(), patch: vi.fn(), delete: vi.fn() }));
vi.mock('./api', () => ({ api: http }));

import { useStorefrontContext } from '../store/storefront-context';
import { addAllToCart } from './cart-batch';

beforeEach(() => {
  for (const f of Object.values(http)) f.mockReset().mockResolvedValue({ data: { itemCount: 3 } });
  useStorefrontContext.getState().clear();
});

describe('addAllToCart ("Thêm cả combo")', () => {
  it('một lệnh POST /cart/items/batch với nguồn ctv_sheet', async () => {
    await expect(addAllToCart([{ variationId: 'v1', quantity: 1 }, { variationId: 'v2', quantity: 1 }])).resolves.toEqual({ itemCount: 3 });
    expect(http.post).toHaveBeenCalledTimes(1);
    expect(http.post).toHaveBeenCalledWith('/cart/items/batch', { items: [{ variationId: 'v1', quantity: 1 }, { variationId: 'v2', quantity: 1 }], addSource: 'ctv_sheet' });
  });

  it('gửi gian hàng đang ghi công để giỏ trừ đúng combo', async () => {
    useStorefrontContext.getState().setContext({ slug: 'lan-shop', referralCode: 'ABC', kind: 'ctv', referralEligible: true });
    await addAllToCart([{ variationId: 'v1', quantity: 1 }]);
    expect(http.post).toHaveBeenCalledWith('/cart/items/batch', expect.any(Object), { params: { storefrontSlug: 'lan-shop' } });
  });

  it('lỗi từ API thì ném ra nguyên vẹn (giỏ không đổi do API làm tất cả hoặc không)', async () => {
    http.post.mockRejectedValueOnce(new Error('boom'));
    await expect(addAllToCart([{ variationId: 'v1', quantity: 1 }])).rejects.toThrow('boom');
  });
});
