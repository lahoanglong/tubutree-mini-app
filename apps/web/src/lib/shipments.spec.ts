import { describe, expect, it } from 'vitest';
import { fulfillerLabel, shipmentsNote } from './shipments';

describe('fulfillerLabel', () => {
  it('nơi giao và lý do không giao được (R2-MERCHANT-3/13)', () => {
    expect(fulfillerLabel({ kind: 'TUBU', storefrontId: null, name: 'Tubu Tree' })).toBe('Tubu Tree giao');
    expect(fulfillerLabel({ kind: 'MERCHANT', storefrontId: 's', name: 'Gốm An' })).toBe('Gốm An giao');
    expect(fulfillerLabel({ kind: 'UNAVAILABLE', storefrontId: null, name: 'Gốm An', reason: 'STORE_PAUSED' })).toBe('Gốm An đang tạm nghỉ, chưa nhận đơn');
    expect(fulfillerLabel({ kind: 'UNAVAILABLE', storefrontId: null, name: 'Gốm An', reason: 'STORE_CLOSED' })).toBe('Gốm An đã ngừng bán');
    expect(fulfillerLabel({ kind: 'UNAVAILABLE', storefrontId: null, name: '' })).toBe('Không giao được');
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
