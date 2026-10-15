import { describe, expect, it } from 'vitest';
import type { LineFulfiller } from '../services/shop-api';
import { fulfillerLabel, shipmentsNote, groupByFulfiller, showFulfillerHeaders, tubuSubtotal } from './shipments';

const TUBU: LineFulfiller = { kind: 'TUBU', storefrontId: null, name: 'Tubu Tree' };
const SHOP_A: LineFulfiller = { kind: 'MERCHANT', storefrontId: 'a', name: 'Shop A' };
const SHOP_B: LineFulfiller = { kind: 'MERCHANT', storefrontId: 'b', name: 'Shop B' };
const GONE: LineFulfiller = { kind: 'UNAVAILABLE', storefrontId: null, name: '' };

describe('groupByFulfiller', () => {
  it('Tubu trước, rồi từng gian hàng theo thứ tự xuất hiện, dòng không giao được cuối; dòng thiếu fulfiller coi là Tubu', () => {
    const groups = groupByFulfiller([
      { id: '1', fulfiller: SHOP_B, total: 1 },
      { id: '2', fulfiller: GONE, total: 1 },
      { id: '3', total: 1 },
      { id: '4', fulfiller: SHOP_A, total: 1 },
      { id: '5', fulfiller: SHOP_B, total: 1 },
    ]);
    expect(groups.map((g) => [g.key, g.items.map((i) => i.id)])).toEqual([
      ['TUBU', ['3']],
      ['MERCHANT:b', ['1', '5']],
      ['MERCHANT:a', ['4']],
      ['UNAVAILABLE', ['2']],
    ]);
  });

  it('chỉ hiện tiêu đề nơi giao khi giỏ không phải toàn hàng Tubu', () => {
    expect(showFulfillerHeaders(groupByFulfiller([{ fulfiller: TUBU, total: 1 }]))).toBe(false);
    expect(showFulfillerHeaders(groupByFulfiller([{ fulfiller: SHOP_A, total: 1 }]))).toBe(true);
  });
});

describe('tubuSubtotal', () => {
  it('chỉ cộng tiền hàng Tubu giao (kể cả dòng API cũ thiếu fulfiller)', () => {
    expect(
      tubuSubtotal([
        { fulfiller: TUBU, total: 100 },
        { total: 50 },
        { fulfiller: SHOP_A, total: 1000 },
      ]),
    ).toBe(150);
  });
});

describe('fulfillerLabel', () => {
  it('dòng không giao được nói lý do: gian hàng tạm nghỉ / đã ngừng bán (R2-MERCHANT-3/13)', () => {
    expect(fulfillerLabel(SHOP_A)).toBe('Shop A giao');
    expect(fulfillerLabel({ ...GONE, name: 'Shop A', reason: 'STORE_PAUSED' })).toBe('Shop A đang tạm nghỉ, chưa nhận đơn');
    expect(fulfillerLabel({ ...GONE, name: 'Shop A', reason: 'STORE_CLOSED' })).toBe('Shop A đã ngừng bán');
    expect(fulfillerLabel(GONE)).toBe('Không giao được');
  });
});

// R5-CHECKOUT-4: giỏ chỉ một kiện của gian hàng đối tác từng hiện "Hàng do 1 nơi giao nên sẽ thành 1 đơn riêng, mỗi đơn…".
describe('shipmentsNote', () => {
  const tubu = { fulfiller: { kind: 'TUBU' as const, storefrontId: null, name: 'Tubu Tree' } };
  const shop = { fulfiller: { kind: 'MERCHANT' as const, storefrontId: 'sf1', name: 'Shop Tự Giao Mộc' } };
  const shop2 = { fulfiller: { kind: 'MERCHANT' as const, storefrontId: 'sf2', name: 'Mật ong Linh' } };

  it('nhiều nơi giao → nói rõ thành mấy đơn riêng', () => {
    expect(shipmentsNote([tubu, shop])).toBe('Hàng do 2 nơi giao nên sẽ thành 2 đơn riêng, mỗi đơn có phí giao và mã đơn riêng.');
    expect(shipmentsNote([tubu, shop, shop2])).toBe('Hàng do 3 nơi giao nên sẽ thành 3 đơn riêng, mỗi đơn có phí giao và mã đơn riêng.');
  });

  it('một kiện của gian hàng đối tác → nói gian hàng nào giao, không nói tách đơn', () => {
    expect(shipmentsNote([shop])).toBe('Đơn này do Shop Tự Giao Mộc giao, phí giao theo gian hàng.');
  });

  it('một kiện Tubu hoặc chưa có báo giá → không có câu nào', () => {
    expect(shipmentsNote([tubu])).toBeNull();
    expect(shipmentsNote([])).toBeNull();
  });
});
