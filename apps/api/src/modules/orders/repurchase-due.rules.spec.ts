import { REFILL_REMINDER_ENABLED_KEY, REFILL_REMINDER_ZNS_KEY } from '../notifications/refill-reminder.rules';
import {
  cadenceFor,
  DEFAULT_REFILL_CADENCE,
  isConsumableName,
  newerScanResetsCycle,
  pickRepurchaseDue,
  repurchaseDueWindow,
  REPURCHASE_DUE_CARD_ENABLED_KEY,
  REPURCHASE_DUE_GATE_KEYS,
  REPURCHASE_DUE_MAX_DAYS,
  REPURCHASE_DUE_MIN_DAYS,
  scanAnchorDays,
  scanAnchorFrom,
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
    // Không có cặp Refill và tên không khớp nhóm nào: không phải hàng tiêu hao.
    expect(pick([line({ productName: 'Dầu gội Visante 500ml' })], { pairs: new Map() })).toEqual([]);
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

describe('chu kỳ theo nhóm hàng (w55-01)', () => {
  const shampoo = (days: number) =>
    line({ productId: 'p-shampoo', productName: 'Dầu gội Visante 500ml', deliveredAt: deliveredDaysAgo(days), orderCreatedAt: new Date(deliveredDaysAgo(days).getTime() - DAY) });
  const shampooPairs = new Map([['p-shampoo', 'p-shampoo-refill']]);

  it.each([
    [20, false],
    [21, true],
    [30, true],
    [31, false],
  ])('chai có cặp Refill, tên không khớp nhóm nào: nhận %i ngày trước → %s (mặc định 21–30)', (days, shown) => {
    const picks = pick([shampoo(days)], { pairs: shampooPairs });
    expect(picks.length > 0).toBe(shown);
    if (shown) expect(picks[0]!.days).toBe(days);
  });

  it('nhóm rửa chén/rau giữ chu kỳ riêng 25–40 dù chai có cặp Refill', () => {
    for (const days of [21, 24, 41]) {
      expect(pick([line({ deliveredAt: deliveredDaysAgo(days), orderCreatedAt: new Date(deliveredDaysAgo(days).getTime() - DAY) })])).toEqual([]);
    }
    expect(pick([line({ deliveredAt: deliveredDaysAgo(25), orderCreatedAt: new Date(deliveredDaysAgo(25).getTime() - DAY) })])).toHaveLength(1);
  });

  it('cadenceFor: nhóm thắng mặc định; không nhóm và không cặp thì không phải hàng tiêu hao', () => {
    expect(cadenceFor('Nước rửa chén Fuwa3e', true)).toEqual({ minDays: 25, maxDays: 40 });
    expect(cadenceFor('Nước rửa chén Fuwa3e', false)).toEqual({ minDays: 25, maxDays: 40 });
    expect(cadenceFor('Dầu gội Visante', true)).toEqual(DEFAULT_REFILL_CADENCE);
    expect(cadenceFor('Dầu gội Visante', false)).toBeNull();
    expect(DEFAULT_REFILL_CADENCE).toEqual({ minDays: 21, maxDays: 30 });
  });

  it('cửa sổ thô phủ hợp mọi chu kỳ: 21 tới 40 ngày', () => {
    expect([REPURCHASE_DUE_MIN_DAYS, REPURCHASE_DUE_MAX_DAYS]).toEqual([21, 40]);
  });
});

describe('cờ của thẻ (w55-01)', () => {
  it('hiện khi cờ thẻ HOẶC cờ nhắc Refill 21 ngày bật; cờ ZNS không bao giờ là điều kiện', () => {
    expect(REPURCHASE_DUE_GATE_KEYS).toEqual([REPURCHASE_DUE_CARD_ENABLED_KEY, REFILL_REMINDER_ENABLED_KEY]);
    expect(REPURCHASE_DUE_GATE_KEYS).not.toContain(REFILL_REMINDER_ZNS_KEY);
    expect(REFILL_REMINDER_ZNS_KEY).toBe('retention.refill_21d_zns_enabled');
  });
});

describe('scanAnchorDays: mốc theo đơn sàn đã quét (w55-01)', () => {
  it.each([
    [20, null],
    [21, 21],
    [27, 27],
    [30, 30],
    [31, null],
  ])('đơn sàn giao %i ngày trước → %s', (days, expected) => {
    expect(scanAnchorDays([deliveredDaysAgo(days)], NOW)).toBe(expected);
  });

  it('xét đơn GẦN NHẤT: đơn mới hơn chu kỳ (khách vừa mua) thì không nhắc dù có đơn cũ trong chu kỳ', () => {
    expect(scanAnchorDays([deliveredDaysAgo(27), deliveredDaysAgo(3)], NOW)).toBeNull();
    expect(scanAnchorDays([deliveredDaysAgo(40), deliveredDaysAgo(25), deliveredDaysAgo(33)], NOW)).toBe(25);
  });

  it('không có đơn, mốc giao null hay ở tương lai: null', () => {
    expect(scanAnchorDays([], NOW)).toBeNull();
    expect(scanAnchorDays([null, undefined], NOW)).toBeNull();
    expect(scanAnchorDays([new Date(NOW.getTime() + DAY)], NOW)).toBeNull();
  });

  it('cửa sổ truy vấn thừa một ngày ở đầu cũ so với chu kỳ', () => {
    expect(scanAnchorFrom(NOW).getTime()).toBe(NOW.getTime() - (DEFAULT_REFILL_CADENCE.maxDays + 1) * DAY);
  });
});

describe('newerScanResetsCycle: đơn sàn quét mới hơn đơn trực tiếp (w55-01)', () => {
  it.each([
    [2, 26, true],
    [20, 26, true],
    [21, 26, false],
    [22, 30, false],
    [29, 26, false],
    [26, 26, false],
  ])('đơn sàn giao %i ngày trước, đơn trực tiếp giao %i ngày trước → %s', (scanDays, itemDays, expected) => {
    expect(newerScanResetsCycle(deliveredDaysAgo(scanDays), deliveredDaysAgo(itemDays), NOW)).toBe(expected);
  });

  it('không có đơn sàn hay mốc giao ở tương lai: không đặt lại', () => {
    expect(newerScanResetsCycle(null, deliveredDaysAgo(26), NOW)).toBe(false);
    expect(newerScanResetsCycle(undefined, deliveredDaysAgo(26), NOW)).toBe(false);
    expect(newerScanResetsCycle(new Date(NOW.getTime() + DAY), deliveredDaysAgo(26), NOW)).toBe(false);
  });
});
