import {
  isConsumableName,
  pickRepurchaseDue,
  repurchaseDueWindow,
  REPURCHASE_DUE_MAX_DAYS,
  REPURCHASE_DUE_MIN_DAYS,
  vnDaysSince,
  type RepurchaseCandidateLine,
} from './repurchase-due.rules';

// 10:00 sáng 25/11/2026 giờ VN.
const NOW = new Date('2026-11-25T03:00:00Z');
const DAY = 864e5;

/** Mốc nhận cách hôm nay đúng `days` ngày lịch VN (lúc 15:00 giờ VN). */
const deliveredDaysAgo = (days: number) => new Date(Date.parse('2026-11-25T08:00:00Z') - days * DAY);

const line = (over: Partial<RepurchaseCandidateLine> = {}): RepurchaseCandidateLine => ({
  orderId: 'o1',
  orderCreatedAt: new Date(deliveredDaysAgo(30).getTime() - 2 * DAY),
  deliveredAt: deliveredDaysAgo(30),
  variationId: 'v1',
  productId: 'p-bottle',
  productName: 'Nước rửa chén Fuwa3e 500ml',
  quantity: 1,
  returnedQty: 0,
  partnerOwned: false,
  ...over,
});

const pick = (lines: RepurchaseCandidateLine[], over: Partial<Parameters<typeof pickRepurchaseDue>[0]> = {}) =>
  pickRepurchaseDue({ lines, now: NOW, pairs: new Map([['p-bottle', 'p-refill']]), reorderedAt: new Map(), subscribedProductIds: new Set(), ...over });

describe('vnDaysSince: ngày lịch Việt Nam', () => {
  it('nhận 23:59 hôm qua giờ VN là 1 ngày; 00:01 hôm nay là 0', () => {
    expect(vnDaysSince(new Date('2026-11-24T16:59:00Z'), NOW)).toBe(1);
    expect(vnDaysSince(new Date('2026-11-24T17:01:00Z'), NOW)).toBe(0);
  });
});

describe('pickRepurchaseDue', () => {
  it.each([
    [24, false],
    [25, true],
    [40, true],
    [41, false],
  ])('nhận %i ngày trước → %s', (days, shown) => {
    const picks = pick([line({ deliveredAt: deliveredDaysAgo(days), orderCreatedAt: new Date(deliveredDaysAgo(days).getTime() - DAY) })]);
    expect(picks.length > 0).toBe(shown);
    if (shown) expect(picks[0]!.days).toBe(days);
  });

  it('cửa sổ truy vấn rộng hơn cửa sổ lọc một ngày mỗi đầu', () => {
    const w = repurchaseDueWindow(NOW);
    expect(w.deliveredFrom.getTime()).toBe(NOW.getTime() - (REPURCHASE_DUE_MAX_DAYS + 1) * DAY);
    expect(w.deliveredTo.getTime()).toBe(NOW.getTime() - (REPURCHASE_DUE_MIN_DAYS - 1) * DAY);
  });

  it('chỉ hàng tiêu hao (theo tên bỏ dấu): nước rửa chén, rửa bát, ngâm rửa, rửa rau', () => {
    expect(isConsumableName('Nước Rửa Chén Fuwa3e')).toBe(true);
    expect(isConsumableName('nuoc rua bat sinh hoc')).toBe(true);
    expect(isConsumableName('Nước ngâm rửa rau quả')).toBe(true);
    expect(isConsumableName('Dung dịch rửa thực phẩm')).toBe(true);
    expect(isConsumableName('Dầu gội Visante')).toBe(false);
    expect(pick([line({ productName: 'Dầu gội Visante 500ml' })])).toEqual([]);
  });

  it('hàng đối tác, đã trả hết: bỏ; trả một phần vẫn hiện', () => {
    expect(pick([line({ partnerOwned: true })])).toEqual([]);
    expect(pick([line({ quantity: 2, returnedQty: 2 })])).toEqual([]);
    expect(pick([line({ quantity: 2, returnedQty: 1 })])).toHaveLength(1);
  });

  it('đã đặt lại chính chai hoặc gói Refill của nó ở đơn sau: bỏ; đơn trước đó không tính', () => {
    const l = line();
    const after = new Date(l.orderCreatedAt.getTime() + DAY);
    const before = new Date(l.orderCreatedAt.getTime() - DAY);
    expect(pick([l], { reorderedAt: new Map([['p-bottle', after]]) })).toEqual([]);
    expect(pick([l], { reorderedAt: new Map([['p-refill', after]]) })).toEqual([]);
    expect(pick([l], { reorderedAt: new Map([['p-refill', before]]) })).toHaveLength(1);
    expect(pick([l], { reorderedAt: new Map([['p-bottle', l.orderCreatedAt]]) })).toHaveLength(1);
  });

  it('có gói định kỳ cho chai hoặc gói Refill: bỏ', () => {
    expect(pick([line()], { subscribedProductIds: new Set(['p-refill']) })).toEqual([]);
    expect(pick([line()], { subscribedProductIds: new Set(['p-bottle']) })).toEqual([]);
  });

  it('mỗi sản phẩm một dòng, xếp lâu nhất trước', () => {
    const picks = pick([
      line({ orderId: 'old', deliveredAt: deliveredDaysAgo(38) }),
      line({ orderId: 'new', deliveredAt: deliveredDaysAgo(27) }),
      line({ orderId: 'rau', productId: 'p-rau', productName: 'Nước rửa rau củ', deliveredAt: deliveredDaysAgo(33) }),
    ]);
    expect(picks.map((p) => [p.line.orderId, p.days])).toEqual([
      ['old', 38],
      ['rau', 33],
    ]);
  });

  it('đơn cũ của sản phẩm đã được mua lại thì xét đơn mới hơn trong cửa sổ', () => {
    const old = line({ orderId: 'old', deliveredAt: deliveredDaysAgo(39), orderCreatedAt: new Date(deliveredDaysAgo(39).getTime() - DAY) });
    const newer = line({ orderId: 'newer', deliveredAt: deliveredDaysAgo(26), orderCreatedAt: new Date(deliveredDaysAgo(26).getTime() - DAY) });
    const picks = pick([old, newer], { reorderedAt: new Map([['p-bottle', newer.orderCreatedAt]]) });
    expect(picks.map((p) => p.line.orderId)).toEqual(['newer']);
  });
});
