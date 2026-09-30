import { describe, it, expect } from 'vitest';
import type { OrderItemView, PurchasedItem } from '../../services/shop-api';
import {
  MAX_REORDER_QTY, initialSelection, itemReorderTarget, lineFromOrderItem, lineFromPurchasedItem,
  orderReorderTarget, selectedLines, selectionTotals,
} from './reorder-types';

const orderItem = (over: Partial<OrderItemView> = {}): OrderItemView => ({
  id: 'oi1', variationId: 'v1', productName: 'Nước rửa chén', productSlug: 'nrc', variationName: 'Chanh',
  unitPrice: 60000, quantity: 2, total: 120000, backorderedQty: 0, ...over,
});
const purchased = (over: Partial<PurchasedItem> = {}): PurchasedItem => ({
  variationId: 'v1', productId: 'p1', slug: 'nrc', productName: 'Nước rửa chén', variationName: 'Chanh', brand: 'Tubu',
  thumbnail: null, price: 65000, salePrice: 59000, stock: 4, inStock: true, timesBought: 2, lastPurchasedAt: '2026-09-10T00:00:00.000Z', ...over,
});

describe('reorder-types', () => {
  it('dòng đơn: giá hiện tại (currentPrice) thay giá lúc mua; SL mặc định = SL cũ, kẹp theo tồn', () => {
    const l = lineFromOrderItem(orderItem({ currentPrice: 65000, stock: 1, available: true, thumbnail: 'x.jpg' }));
    expect(l).toEqual({
      key: 'oi1', variationId: 'v1', productName: 'Nước rửa chén', variationName: 'Chanh', thumbnail: 'x.jpg',
      unitPrice: 65000, defaultQuantity: 1, maxQuantity: 1, available: true,
    });
  });

  it('dòng đơn hết hàng / không khả dụng → available=false', () => {
    expect(lineFromOrderItem(orderItem({ stock: 0, available: false })).available).toBe(false);
    expect(lineFromOrderItem(orderItem({ stock: 5, available: false })).available).toBe(false);
  });

  it('API cũ không trả stock/available → coi như khả dụng, max 99, giá lúc mua', () => {
    const l = lineFromOrderItem(orderItem());
    expect(l).toMatchObject({ available: true, maxQuantity: MAX_REORDER_QTY, unitPrice: 60000, defaultQuantity: 2 });
  });

  it('SP đã mua: key = variationId, giá sale, SL 1, max = tồn', () => {
    expect(lineFromPurchasedItem(purchased())).toMatchObject({ key: 'v1', unitPrice: 59000, defaultQuantity: 1, maxQuantity: 4, available: true });
    expect(lineFromPurchasedItem(purchased({ stock: 0, inStock: false })).available).toBe(false);
  });

  it('lựa chọn ban đầu chỉ tick dòng khả dụng; tổng tính theo dòng được chọn', () => {
    const t = orderReorderTarget({
      code: 'TUBU1',
      items: [orderItem({ id: 'a', stock: 10, available: true, currentPrice: 10000, quantity: 2 }), orderItem({ id: 'b', stock: 0, available: false })],
    });
    const sel = initialSelection(t);
    expect(sel).toEqual({ a: { checked: true, quantity: 2 }, b: { checked: false, quantity: 2 } });
    expect(selectedLines(t, sel)).toEqual([{ key: 'a', variationId: 'v1', quantity: 2 }]);
    expect(selectionTotals(t, sel)).toEqual({ units: 2, subtotal: 20000 });
  });

  it('dòng không khả dụng không bao giờ được gửi dù state bị tick; SL bị kẹp 1..max', () => {
    const t = itemReorderTarget(purchased({ stock: 3 }));
    expect(selectedLines(t, { v1: { checked: true, quantity: 50 } })).toEqual([{ key: 'v1', variationId: 'v1', quantity: 3 }]);
    const out = itemReorderTarget(purchased({ stock: 0, inStock: false }));
    expect(selectedLines(out, { v1: { checked: true, quantity: 1 } })).toEqual([]);
  });
});
