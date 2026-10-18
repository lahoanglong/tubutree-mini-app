import { describe, it, expect } from 'vitest';
import type { CartSummary } from '@tubutree/app-core/api/cart';
import type { OrderItemView, PurchasedItem } from '@tubutree/app-core/api/orders';
import {
  MAX_REORDER_QTY, initialSelection, itemReorderTarget, lineFromOrderItem, lineFromPurchasedItem,
  orderReorderTarget, selectedLines, selectionTotals, summarizeReorder, type ReorderLine,
} from './reorder';

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

  it('trần số lượng 99: tồn kho lớn hơn 99 vẫn kẹp 99 (đơn cũ và SP đã mua)', () => {
    expect(lineFromOrderItem(orderItem({ stock: 500, available: true, quantity: 300 }))).toMatchObject({ maxQuantity: 99, defaultQuantity: 99 });
    const p = itemReorderTarget(purchased({ stock: 500 }));
    expect(p.kind === 'item' && p.line.maxQuantity).toBe(99);
    expect(selectedLines(p, { v1: { checked: true, quantity: 250 } })).toEqual([{ key: 'v1', variationId: 'v1', quantity: 99 }]);
  });

  it('selectionTotals bỏ qua dòng không khả dụng dù bị tick', () => {
    const t = orderReorderTarget({
      code: 'TUBU2',
      items: [
        orderItem({ id: 'a', stock: 10, available: true, currentPrice: 10000, quantity: 1 }),
        orderItem({ id: 'b', stock: 0, available: false, currentPrice: 99000, quantity: 3 }),
      ],
    });
    const sel = { a: { checked: true, quantity: 1 }, b: { checked: true, quantity: 3 } };
    expect(selectionTotals(t, sel)).toEqual({ units: 1, subtotal: 10000 });
  });
});

const CART: CartSummary = { items: [], couponCode: null, subtotal: 0, discount: 0, freeship: false, freeshipThreshold: 200000, itemCount: 0 };
const line = (key: string, productName: string): ReorderLine => ({
  key, variationId: `v-${key}`, productName, variationName: '', thumbnail: null, unitPrice: 1, defaultQuantity: 1, maxQuantity: 9, available: true,
});
const lines = [line('a', 'Nước rửa chén'), line('b', 'Xà phòng'), line('c', 'Nước lau sàn')];

describe('summarizeReorder', () => {
  it('thêm đủ → "Đã thêm N món vào giỏ"', () => {
    const s = summarizeReorder({ cart: CART, legacy: false, results: [{ orderItemId: 'a', status: 'added', addedQuantity: 2 }] }, lines, []);
    expect(s).toEqual({ addedLines: 1, skippedLines: 0, addedUnits: 2, hasProblems: false, message: 'Đã thêm 2 món vào giỏ' });
  });

  it('có dòng bị bỏ qua / thiếu → nêu tên + lý do tiếng Việt', () => {
    const s = summarizeReorder(
      {
        cart: CART,
        legacy: false,
        results: [
          { orderItemId: 'a', status: 'added', addedQuantity: 1 },
          { orderItemId: 'b', status: 'skipped', reason: 'OUT_OF_STOCK', addedQuantity: 0 },
          { orderItemId: 'c', status: 'partial', reason: 'EXCEEDS_STOCK', addedQuantity: 1 },
        ],
      },
      lines,
      [],
    );
    expect(s.addedLines).toBe(2);
    expect(s.skippedLines).toBe(1);
    expect(s.addedUnits).toBe(2);
    expect(s.hasProblems).toBe(true);
    expect(s.message).toBe('Đã thêm 2 món vào giỏ. Chưa thêm đủ: Xà phòng (hết hàng), Nước lau sàn (chỉ thêm được 1)');
  });

  it('không thêm được gì → câu báo lỗi, addedUnits 0; NOT_APPROVED hiển thị như "ngừng bán"', () => {
    const s = summarizeReorder(
      { cart: CART, legacy: false, results: [{ orderItemId: 'a', status: 'skipped', reason: 'NOT_APPROVED', addedQuantity: 0 }] },
      lines,
      [],
    );
    expect(s.addedUnits).toBe(0);
    expect(s.message).toBe('Chưa thêm được món nào vào giỏ: Nước rửa chén (ngừng bán)');
  });

  it('API cũ (legacy) → coi như thêm đủ các dòng đã chọn', () => {
    const s = summarizeReorder({ cart: CART, legacy: true, results: [] }, lines, [
      { key: 'a', variationId: 'v-a', quantity: 2 },
      { key: 'b', variationId: 'v-b', quantity: 1 },
    ]);
    expect(s).toEqual({ addedLines: 2, skippedLines: 0, addedUnits: 3, hasProblems: false, message: 'Đã thêm vào giỏ' });
  });

  it('results rỗng (không phải legacy) → không có dấu ":" thừa và vẫn tính là có vấn đề', () => {
    const s = summarizeReorder({ cart: CART, legacy: false, results: [] }, lines, []);
    expect(s).toEqual({ addedLines: 0, skippedLines: 0, addedUnits: 0, hasProblems: true, message: 'Chưa thêm được món nào vào giỏ' });
  });

  it('dòng "added" nhưng addedQuantity 0 → không thêm được gì, không có ":" thừa', () => {
    const s = summarizeReorder({ cart: CART, legacy: false, results: [{ orderItemId: 'a', status: 'added', addedQuantity: 0 }] }, lines, []);
    expect(s.addedUnits).toBe(0);
    expect(s.hasProblems).toBe(true);
    expect(s.message).toBe('Chưa thêm được món nào vào giỏ');
  });

  it('lý do INACTIVE / EXCEEDS_STOCK / thiếu reason → nhãn tiếng Việt (thiếu reason coi như hết hàng)', () => {
    const s = summarizeReorder(
      {
        cart: CART,
        legacy: false,
        results: [
          { orderItemId: 'a', status: 'skipped', reason: 'INACTIVE', addedQuantity: 0 },
          { orderItemId: 'b', status: 'skipped', reason: 'EXCEEDS_STOCK', addedQuantity: 0 },
          { orderItemId: 'c', status: 'skipped', addedQuantity: 0 },
        ],
      },
      lines,
      [],
    );
    expect(s.message).toBe('Chưa thêm được món nào vào giỏ: Nước rửa chén (ngừng bán), Xà phòng (không đủ hàng), Nước lau sàn (hết hàng)');
  });

  it('orderItemId lạ → dùng tên dự phòng "Sản phẩm"', () => {
    const s = summarizeReorder({ cart: CART, legacy: false, results: [{ orderItemId: 'zzz', status: 'skipped', reason: 'INACTIVE', addedQuantity: 0 }] }, lines, []);
    expect(s.message).toBe('Chưa thêm được món nào vào giỏ: Sản phẩm (ngừng bán)');
  });

  it('cùng tên sản phẩm lặp lại trong đơn → thêm tên phân loại để phân biệt', () => {
    const twins = [
      { ...line('a', 'Nước rửa chén'), variationName: 'Chanh' },
      { ...line('b', 'Nước rửa chén'), variationName: 'Trà xanh' },
      { ...line('c', 'Xà phòng'), variationName: '500ml' },
    ];
    const s = summarizeReorder(
      {
        cart: CART,
        legacy: false,
        results: [
          { orderItemId: 'a', status: 'added', addedQuantity: 1 },
          { orderItemId: 'b', status: 'skipped', reason: 'OUT_OF_STOCK', addedQuantity: 0 },
          { orderItemId: 'c', status: 'skipped', reason: 'INACTIVE', addedQuantity: 0 },
        ],
      },
      twins,
      [],
    );
    expect(s.message).toBe('Đã thêm 1 món vào giỏ. Chưa thêm đủ: Nước rửa chén - Trà xanh (hết hàng), Xà phòng (ngừng bán)');
  });
});
