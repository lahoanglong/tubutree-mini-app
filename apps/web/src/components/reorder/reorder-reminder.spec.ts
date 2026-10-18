import { describe, expect, it } from 'vitest';
import type { PurchasedItem } from '@tubutree/app-core/api/orders';
import { pickReminderItem, reorderReminderAction } from './reorder-reminder';

const ITEM: PurchasedItem = {
  variationId: 'v1', productId: 'p1', slug: 'dau-goi', productName: 'Dầu gội', variationName: '500ml', brand: 'Visante',
  thumbnail: null, price: 120000, salePrice: null, stock: 5, inStock: true, timesBought: 1, lastPurchasedAt: '2026-08-01T00:00:00.000Z',
};
const FALLBACK = '/san-pham/dau-goi';

describe('reorderReminderAction', () => {
  it('variation còn trong danh sách đã mua và còn hàng → mở sheet đúng variation', () => {
    expect(reorderReminderAction(FALLBACK, ITEM)).toEqual({ kind: 'sheet', item: ITEM });
  });
  it('đã mua nhưng hết hàng → điều hướng dự phòng, không mở sheet cụt', () => {
    expect(reorderReminderAction(FALLBACK, { ...ITEM, stock: 0, inStock: false })).toEqual({ kind: 'navigate', to: FALLBACK });
  });
  it('không tìm thấy → điều hướng dự phòng', () => {
    expect(reorderReminderAction('/tai-khoan/don-hang', null)).toEqual({ kind: 'navigate', to: '/tai-khoan/don-hang' });
  });
});

describe('pickReminderItem (deploy-skew: API bỏ qua bộ lọc variationId)', () => {
  const OTHER: PurchasedItem = { ...ITEM, variationId: 'v-other', productName: 'Sản phẩm khác' };
  it('chọn đúng dòng có variationId khớp, không lấy dòng đầu', () => {
    expect(pickReminderItem([OTHER, ITEM], 'v1')).toBe(ITEM);
  });
  it('kết quả chỉ chứa variation khác → null (không mở sheet sai SP)', () => {
    expect(pickReminderItem([OTHER], 'v1')).toBeNull();
  });
  it('rỗng / thiếu variationId → null', () => {
    expect(pickReminderItem([], 'v1')).toBeNull();
    expect(pickReminderItem([ITEM], undefined)).toBeNull();
  });
});
