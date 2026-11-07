import { describe, it, expect } from 'vitest';
import type { OrderItemView, PurchasedItem } from '@tubutree/app-core/api/orders';
import {
  MAX_REORDER_QTY, initialSelection, itemReorderTarget, lineAt, lineFromOrderItem, lineFromPurchasedItem,
  orderReorderTarget, selectedLines, selectionTotals, unitsSharingCartLine,
} from './reorder-types';

const orderItem = (over: Partial<OrderItemView> = {}): OrderItemView => ({
  id: 'oi1', variationId: 'v1', productName: 'Nước rửa chén', productSlug: 'nrc', variationName: 'Chanh',
  unitPrice: 60000, quantity: 2, total: 120000, backorderedQty: 0, flashActive: false, ...over,
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
      notices: [
        { kind: 'reduced', tone: 'warning', text: 'Không đủ 2 như đơn trước, đã giảm số lượng' },
        { kind: 'priceUp', tone: 'warning', text: 'Giá tăng so với đơn trước (60.000đ)' },
      ],
      pricing: { standing: 65000, flashPrice: null, flashAllowance: null, paidPrice: 60000, comparable: true },
    });
  });

  it('dòng đơn: câu báo theo từng trường hợp (hết hàng, ngừng bán, giá giảm, đủ hàng giá như cũ)', () => {
    const texts = (over: Parameters<typeof orderItem>[0]) => lineFromOrderItem(orderItem(over)).notices.map((n) => n.text);
    expect(texts({ stock: 0, available: false, discontinued: false })).toEqual(['Tạm hết hàng']);
    expect(texts({ stock: 0, available: false, discontinued: true })).toEqual(['Ngừng bán']);
    // API cũ chưa có cờ: không bán được mà còn tồn là ngừng bán, trang sản phẩm gỡ cũng vậy.
    expect(texts({ stock: 5, available: false })).toEqual(['Ngừng bán']);
    expect(texts({ stock: 0, available: false, productPublic: false })).toEqual(['Ngừng bán']);
    expect(texts({ stock: 9, available: true, currentPrice: 50000 })).toEqual(['Giá giảm so với đơn trước (60.000đ)']);
    expect(texts({ stock: 9, available: true, currentPrice: 60000 })).toEqual([]);
  });

  it('dòng đơn: Giờ vàng xen vào thì không so giá; đơn trước quá trần 99 thì báo trần', () => {
    const texts = (over: Parameters<typeof orderItem>[0]) => lineFromOrderItem(orderItem(over)).notices.map((n) => n.text);
    expect(texts({ stock: 9, available: true, currentPrice: 70000, flashSaleItemId: 'fi1' })).toEqual([]);
    expect(texts({ stock: 9, available: true, currentPrice: 70000, flashActive: true })).toEqual([]);
    expect(texts({ stock: 9, available: true, currentPrice: 70000, flashActive: undefined })).toEqual([]);
    const capped = lineFromOrderItem(orderItem({ stock: 500, available: true, quantity: 120, currentPrice: 60000 }));
    expect(capped).toMatchObject({ defaultQuantity: 99 });
    expect(capped.notices.map((n) => n.text)).toEqual(['Mua lại tối đa 99 mỗi món, đã giảm số lượng']);
  });

  it('lineAt: dòng không bán được giữ đúng một câu, không thêm câu giá dù giá hiện tại đã đổi', () => {
    const out = lineFromOrderItem(orderItem({ stock: 0, available: false, currentPrice: 120000 }));
    expect(lineAt(out, 1).notices.map((n) => n.text)).toEqual(['Tạm hết hàng']);
    const off = lineFromOrderItem(orderItem({ stock: 5, available: false, discontinued: true, currentPrice: 50000 }));
    expect(lineAt(off, 1).notices.map((n) => n.text)).toEqual(['Ngừng bán']);
  });

  it('dòng đơn hết hàng / không khả dụng → available=false', () => {
    expect(lineFromOrderItem(orderItem({ stock: 0, available: false })).available).toBe(false);
    expect(lineFromOrderItem(orderItem({ stock: 5, available: false })).available).toBe(false);
  });

  it('API cũ không trả stock/available → coi như khả dụng, max 99, giá lúc mua', () => {
    const l = lineFromOrderItem(orderItem());
    expect(l).toMatchObject({ available: true, maxQuantity: MAX_REORDER_QTY, unitPrice: 60000, defaultQuantity: 2, notices: [] });
  });

  it('SP đã mua: key = variationId, giá sale, SL 1, max = tồn', () => {
    expect(lineFromPurchasedItem(purchased())).toMatchObject({ key: 'v1', unitPrice: 59000, defaultQuantity: 1, maxQuantity: 4, available: true });
    expect(lineFromPurchasedItem(purchased({ stock: 0, inStock: false })).available).toBe(false);
    expect(lineFromPurchasedItem(purchased({ stock: 0, inStock: false })).notices.map((n) => n.text)).toEqual(['Tạm hết hàng']);
    expect(lineFromPurchasedItem(purchased()).notices).toEqual([]);
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

  it('tồn trên 20: không kẹp SL mặc định và trần về tồn (lộ tồn thật), không báo "Không đủ"; máy chủ kẹp lúc thêm', () => {
    const l = lineFromOrderItem(orderItem({ quantity: 30, stock: 25, available: true, currentPrice: 60000 }));
    expect(l.defaultQuantity).toBe(30);
    expect(l.maxQuantity).toBe(MAX_REORDER_QTY);
    expect(l.notices).toEqual([]);
    const t = orderReorderTarget({ code: 'TUBU1', items: [orderItem({ quantity: 30, stock: 25, available: true })] });
    expect(selectedLines(t, initialSelection(t))[0]!.quantity).toBe(30);
    expect(lineFromPurchasedItem(purchased({ stock: 25 })).maxQuantity).toBe(MAX_REORDER_QTY);
    expect(lineFromPurchasedItem(purchased({ stock: 20 })).maxQuantity).toBe(20);
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

describe('giá Giờ vàng theo giỏ: số lượng đã có trong giỏ và dòng trùng biến thể', () => {
  const flashItem = (over: Partial<OrderItemView> = {}) =>
    orderItem({ stock: 50, available: true, currentPrice: 120000, unitPrice: 120000, flashActive: true, flashPrice: 90000, flashAllowance: 3, ...over });
  const cartOf = (entries: [string, number][]) => new Map(entries);

  it('giỏ chưa có món: số lượng vừa suất → giá Giờ vàng (như trước)', () => {
    const t = orderReorderTarget({ code: 'T1', items: [flashItem({ id: 'a', variationId: 'v1', quantity: 2 })] });
    const sel = initialSelection(t);
    expect(selectionTotals(t, sel)).toEqual({ units: 2, subtotal: 180000 });
    expect(selectionTotals(t, sel, cartOf([]))).toEqual({ units: 2, subtotal: 180000 });
  });

  it('giỏ đã có 2 món cùng biến thể, thêm 2: tổng 4 vượt suất 3 → giỏ tính giá đang bán, sheet phải hiện đúng số đó', () => {
    const t = orderReorderTarget({ code: 'T2', items: [flashItem({ id: 'a', variationId: 'v1', quantity: 2 })] });
    const sel = initialSelection(t);
    const cart = cartOf([['v1', 2]]);
    expect(selectionTotals(t, sel, cart)).toEqual({ units: 2, subtotal: 240000 });
    const l = t.kind === 'order' ? t.lines[0]! : (null as never);
    expect(lineAt(l, 2, unitsSharingCartLine(t, sel, cart, l)).unitPrice).toBe(120000);
  });

  it('giỏ có món khác biến thể không ảnh hưởng', () => {
    const t = orderReorderTarget({ code: 'T3', items: [flashItem({ id: 'a', variationId: 'v1', quantity: 2 })] });
    expect(selectionTotals(t, initialSelection(t), cartOf([['v9', 40]]))).toEqual({ units: 2, subtotal: 180000 });
  });

  it('đơn có hai dòng cùng biến thể: giỏ gộp 2 + 2 = 4 > 3 nên cả hai dòng tính giá đang bán', () => {
    const t = orderReorderTarget({
      code: 'T4',
      items: [flashItem({ id: 'a', variationId: 'v1', quantity: 2 }), flashItem({ id: 'b', variationId: 'v1', quantity: 2 })],
    });
    expect(selectionTotals(t, initialSelection(t))).toEqual({ units: 4, subtotal: 480000 });
  });

  it('dòng trùng biến thể bị bỏ chọn không tính vào tổng gộp', () => {
    const t = orderReorderTarget({
      code: 'T5',
      items: [flashItem({ id: 'a', variationId: 'v1', quantity: 2 }), flashItem({ id: 'b', variationId: 'v1', quantity: 2 })],
    });
    const sel = { a: { checked: true, quantity: 2 }, b: { checked: false, quantity: 2 } };
    expect(selectionTotals(t, sel)).toEqual({ units: 2, subtotal: 180000 });
    const lines = t.kind === 'order' ? t.lines : [];
    expect(unitsSharingCartLine(t, sel, cartOf([]), lines[0]!)).toBe(0);
    // Dòng b chưa chọn: nếu khách tick thêm thì giỏ sẽ gộp với dòng a đang chọn.
    expect(unitsSharingCartLine(t, sel, cartOf([]), lines[1]!)).toBe(2);
  });

  it('dòng trùng biến thể không khả dụng không tính vào tổng gộp', () => {
    const t = orderReorderTarget({
      code: 'T6',
      items: [flashItem({ id: 'a', variationId: 'v1', quantity: 2 }), flashItem({ id: 'b', variationId: 'v1', quantity: 2, stock: 0, available: false })],
    });
    const sel = { a: { checked: true, quantity: 2 }, b: { checked: true, quantity: 2 } };
    expect(selectionTotals(t, sel)).toEqual({ units: 2, subtotal: 180000 });
  });

  it('mua lại một sản phẩm đã mua (rail): cộng phần đã có trong giỏ', () => {
    const t = itemReorderTarget(purchased({ price: 120000, salePrice: null, stock: 50, flashPrice: 90000, flashAllowance: 3 }));
    const sel = { v1: { checked: true, quantity: 2 } };
    expect(selectionTotals(t, sel, cartOf([]))).toEqual({ units: 2, subtotal: 180000 });
    expect(selectionTotals(t, sel, cartOf([['v1', 2]]))).toEqual({ units: 2, subtotal: 240000 });
  });

  it('API cũ không có flashPrice: giá không đổi dù giỏ có bao nhiêu', () => {
    const t = orderReorderTarget({ code: 'T7', items: [orderItem({ id: 'a', variationId: 'v1', quantity: 2, stock: 50, available: true, currentPrice: 120000, unitPrice: 120000 })] });
    expect(selectionTotals(t, initialSelection(t), cartOf([['v1', 40]]))).toEqual({ units: 2, subtotal: 240000 });
  });
});
