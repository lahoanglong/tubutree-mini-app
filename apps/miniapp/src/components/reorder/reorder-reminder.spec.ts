import { describe, it, expect } from 'vitest';
import type { PurchasedItem } from '../../services/shop-api';
import { reminderFallbackPath, reorderReminderAction } from './reorder-reminder';

const ITEM: PurchasedItem = {
  variationId: 'v1', productId: 'p1', slug: 'dau-goi', productName: 'Dầu gội', variationName: '500ml', brand: 'Visante',
  thumbnail: null, price: 120000, salePrice: null, stock: 5, inStock: true, timesBought: 1, lastPurchasedAt: '2026-08-01T00:00:00.000Z',
};

describe('reorderReminderAction (spec 4a.4 + Ruling 8)', () => {
  it('variation còn trong danh sách đã mua và còn hàng → mở sheet đúng variation', () => {
    expect(reorderReminderAction({ variation_id: 'v1', product_slug: 'dau-goi' }, ITEM)).toEqual({ kind: 'sheet', item: ITEM });
  });
  it('đã mua nhưng hết hàng → trang sản phẩm (4c thêm "Báo khi có hàng"), không mở sheet cụt', () => {
    expect(reorderReminderAction({ product_slug: 'dau-goi' }, { ...ITEM, stock: 0, inStock: false })).toEqual({ kind: 'navigate', to: '/product/dau-goi' });
  });
  it('không tìm thấy + thiếu slug → /orders (fallback của spec)', () => {
    expect(reorderReminderAction({ product: 'Dầu gội', variation_id: 'gone' }, null)).toEqual({ kind: 'navigate', to: '/orders' });
    expect(reorderReminderAction(undefined, null)).toEqual({ kind: 'navigate', to: '/orders' });
  });
  it('slug được encode', () => {
    expect(reminderFallbackPath({ product_slug: 'sữa tắm/đặc biệt' })).toBe(`/product/${encodeURIComponent('sữa tắm/đặc biệt')}`);
  });
});
