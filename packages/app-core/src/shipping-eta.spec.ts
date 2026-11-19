import { describe, expect, expectTypeOf, it } from 'vitest';
import type { PlacedOrder } from './api/checkout';
import type { DeliverySchedule } from './api/config';
import { checkoutEtaLabel, etaSchedule, orderDeliveryEtaLabel, placedOrderKinds, scheduleEtaLabel, shippingEtaLabel } from './shipping-eta';

describe('shippingEtaLabel', () => {
  const now = new Date('2026-09-30T05:00:00.000Z'); // 12:00 giờ VN
  it('khoảng ngày → "02/10 – 04/10"', () => {
    expect(shippingEtaLabel({ minDays: 2, maxDays: 4 }, now)).toBe('02/10 – 04/10');
  });
  it('min = max → một ngày', () => {
    expect(shippingEtaLabel({ minDays: 1, maxDays: 1 }, now)).toBe('01/10');
  });
  it('cuối năm → sang tháng 1 (31/12 + 3 ngày = 03/01)', () => {
    expect(shippingEtaLabel({ minDays: 1, maxDays: 4 }, new Date('2026-12-30T05:00:00.000Z'))).toBe('31/12 – 03/01');
  });
  it('minDays 0 → hôm nay', () => {
    expect(shippingEtaLabel({ minDays: 0, maxDays: 2 }, now)).toBe('30/09 – 02/10');
    expect(shippingEtaLabel({ minDays: 0, maxDays: 0 }, now)).toBe('30/09');
  });
  it('theo ngày Việt Nam: 23:30 giờ VN vẫn là ngày đó dù máy ở múi giờ khác, 00:30 giờ VN đã sang ngày sau', () => {
    expect(shippingEtaLabel({ minDays: 1, maxDays: 1 }, new Date('2026-09-30T16:30:00.000Z'))).toBe('01/10');
    expect(shippingEtaLabel({ minDays: 1, maxDays: 1 }, new Date('2026-09-30T17:30:00.000Z'))).toBe('02/10');
  });
  it('cuối tháng: 31/01 + 1 ngày = 01/02 (không tràn sang tháng sai)', () => {
    const jan31 = new Date('2026-01-31T05:00:00.000Z');
    expect(shippingEtaLabel({ minDays: 1, maxDays: 1 }, jan31)).toBe('01/02');
    expect(shippingEtaLabel({ minDays: 1, maxDays: 30 }, jan31)).toBe('01/02 – 02/03');
  });
});

describe('orderDeliveryEtaLabel', () => {
  const eta = { minDays: 2, maxDays: 4 };
  const order = (status: string, extra: Record<string, unknown> = {}) => ({
    status,
    createdAt: '2026-10-28T01:39:00.000Z',
    ...extra,
  });
  const now = new Date('2026-10-28T03:00:00.000Z');
  it('tính từ giờ đặt (cùng gốc màn thanh toán), không từ giờ xác nhận', () => {
    expect(
      orderDeliveryEtaLabel(eta, order('SHIPPING', { statusTimes: { CONFIRMED: '2026-10-28T18:00:00.000Z' } }), now),
    ).toBe('30/10 – 01/11');
  });
  it('đặt 23:00 giờ VN vẫn tính theo ngày VN', () => {
    expect(orderDeliveryEtaLabel(eta, order('CONFIRMED', { createdAt: '2026-10-27T16:30:00.000Z' }), now)).toBe('29/10 – 31/10');
    expect(orderDeliveryEtaLabel(eta, order('CONFIRMED', { createdAt: '2026-10-27T17:30:00.000Z' }), now)).toBe('30/10 – 01/11');
  });
  it('ngày muộn nhất đã qua theo ngày VN thì ẩn; đúng hôm nay vẫn hiện', () => {
    const old = order('SHIPPING', { createdAt: '2026-10-15T03:00:00.000Z' });
    expect(orderDeliveryEtaLabel(eta, old, now)).toBeNull();
    expect(orderDeliveryEtaLabel(eta, order('SHIPPING', { createdAt: '2026-10-24T03:00:00.000Z' }), now)).toBe('28/10');
    expect(orderDeliveryEtaLabel(eta, order('SHIPPING', { createdAt: '2026-10-24T03:00:00.000Z' }), new Date('2026-10-28T17:30:00.000Z'))).toBeNull();
  });
  it('đơn có món đặt trước thì ẩn', () => {
    expect(orderDeliveryEtaLabel(eta, order('CONFIRMED', { items: [{ backorderedQty: 0 }, { backorderedQty: 2 }] }), now)).toBeNull();
    expect(orderDeliveryEtaLabel(eta, order('CONFIRMED', { items: [{ backorderedQty: 0 }] }), now)).toBe('30/10 – 01/11');
  });
  it('đơn của gian hàng đối tác thì ẩn', () => {
    expect(orderDeliveryEtaLabel(eta, order('CONFIRMED', { fulfilment: { kind: 'MERCHANT' } }), now)).toBeNull();
    expect(orderDeliveryEtaLabel(eta, order('CONFIRMED', { fulfilment: { kind: 'TUBU' } }), now)).toBe('30/10 – 01/11');
  });
  it('đơn Tubu xử lý tay thì ẩn', () => {
    expect(orderDeliveryEtaLabel(eta, order('CONFIRMED', { manualHandling: true }), now)).toBeNull();
    expect(orderDeliveryEtaLabel(eta, order('CONFIRMED', { manualHandling: false }), now)).toBe('30/10 – 01/11');
  });
  it('ngày sớm nhất không lùi về quá khứ: kẹp về hôm nay (giờ VN)', () => {
    const late = order('CONFIRMED', { createdAt: '2026-10-25T03:00:00.000Z' });
    expect(orderDeliveryEtaLabel(eta, late, now)).toBe('28/10 – 29/10');
  });
  it('cấu hình trống thì ẩn, không bịa ngày', () => {
    expect(orderDeliveryEtaLabel(null, order('CONFIRMED'), now)).toBeNull();
    expect(orderDeliveryEtaLabel(undefined, order('CONFIRMED'), now)).toBeNull();
  });
  it('chưa xác nhận hoặc đã xong thì ẩn', () => {
    for (const s of ['PENDING_PAYMENT', 'DELIVERED', 'CANCELLED', 'RETURNED']) {
      expect(orderDeliveryEtaLabel(eta, order(s), now)).toBeNull();
    }
  });
  it('mốc thời gian hỏng thì ẩn', () => {
    expect(orderDeliveryEtaLabel(eta, { status: 'CONFIRMED', createdAt: 'x' }, now)).toBeNull();
  });
});

describe('checkoutEtaLabel', () => {
  const eta = { minDays: 2, maxDays: 4 };
  const now = new Date(2026, 8, 30, 12, 0, 0);
  it('chỉ hàng Tubu giao → khoảng ngày như cũ', () => {
    expect(checkoutEtaLabel(eta, ['TUBU'], now)).toBe('02/10 – 04/10');
    expect(checkoutEtaLabel(eta, ['TUBU', 'TUBU'], now)).toBe('02/10 – 04/10');
  });
  it('chỉ gian hàng tự giao → null (không hứa ngày thay họ)', () => {
    expect(checkoutEtaLabel(eta, ['MERCHANT'], now)).toBeNull();
    expect(checkoutEtaLabel(eta, ['MERCHANT', 'MERCHANT'], now)).toBeNull();
  });
  it('trộn → thêm hậu tố nói ngày chỉ cho hàng Tubu Tree', () => {
    expect(checkoutEtaLabel(eta, ['TUBU', 'MERCHANT'], now)).toBe('02/10 – 04/10 (hàng Tubu Tree)');
    expect(checkoutEtaLabel(eta, ['MERCHANT', 'TUBU'], now)).toBe('02/10 – 04/10 (hàng Tubu Tree)');
  });
  it('chưa cấu hình ngày, hoặc không biết nơi giao nào → null', () => {
    expect(checkoutEtaLabel(null, ['TUBU'], now)).toBeNull();
    expect(checkoutEtaLabel(undefined, ['TUBU'], now)).toBeNull();
    expect(checkoutEtaLabel(eta, [], now)).toBeNull();
    expect(checkoutEtaLabel(eta, [undefined, null], now)).toBeNull();
  });
});

describe('placedOrderKinds', () => {
  it('lần đặt bị tách → nơi giao của từng đơn con', () => {
    expect(placedOrderKinds({ fulfiller: 'TUBU', splitOrders: [{ fulfiller: 'TUBU' }, { fulfiller: 'MERCHANT' }] })).toEqual(['TUBU', 'MERCHANT']);
  });
  it('đơn đơn lẻ → nơi giao của chính đơn (cột fulfiller máy chủ trả)', () => {
    expect(placedOrderKinds({ fulfiller: 'MERCHANT' })).toEqual(['MERCHANT']);
    expect(placedOrderKinds({ fulfiller: 'TUBU', splitOrders: [] })).toEqual(['TUBU']);
  });
  it('không có thông tin nơi giao → rỗng (checkoutEtaLabel không hứa ngày)', () => {
    expect(placedOrderKinds({})).toEqual([]);
    expect(placedOrderKinds({ fulfiller: null })).toEqual([]);
  });
  it('phản hồi đặt đơn khai báo cột fulfiller: bỏ cột khỏi kiểu thì ngày giao ở màn đặt xong biến mất mà không báo lỗi', () => {
    expectTypeOf<PlacedOrder['fulfiller']>().toEqualTypeOf<'TUBU' | 'MERCHANT' | undefined>();
    const placed = { fulfiller: 'MERCHANT' } as PlacedOrder;
    expect(placedOrderKinds(placed)).toEqual(['MERCHANT']);
  });
});

describe('scheduleEtaLabel: lịch kho (Thứ 2 – Thứ 7, cắt đơn 15:00, nghỉ Chủ nhật), giờ Việt Nam', () => {
  const S: DeliverySchedule = { cutoff: '15:00', workDays: [1, 2, 3, 4, 5, 6], holidays: [], hcmDays: [1, 2], provinceDays: [2, 4] };
  // 19/11/2026 là Thứ 5. Giờ VN = UTC + 7.
  const vn = (iso: string) => new Date(`${iso}+07:00`);
  const HCM = 'Thành phố Hồ Chí Minh';

  it.each([
    ['Thứ 5 10:00, trước giờ cắt: xuất kho trong ngày (đúng ví dụ PO)', '2026-11-19T10:00:00', 'T6 20/11 – T7 21/11'],
    ['Thứ 5 14:59', '2026-11-19T14:59:59', 'T6 20/11 – T7 21/11'],
    ['Thứ 5 đúng 15:00: đã qua giờ cắt, xuất Thứ 6, bỏ Chủ nhật', '2026-11-19T15:00:00', 'T7 21/11 – T2 23/11'],
    ['Thứ 7 10:00: ngày giao bỏ Chủ nhật', '2026-11-21T10:00:00', 'T2 23/11 – T3 24/11'],
    ['Thứ 7 16:00: xuất kho Thứ 2', '2026-11-21T16:00:00', 'T3 24/11 – T4 25/11'],
    ['Chủ nhật: kho nghỉ, xuất kho Thứ 2', '2026-11-22T09:00:00', 'T3 24/11 – T4 25/11'],
    ['03:00 sáng Thứ 6 giờ VN (vẫn là Thứ 5 theo UTC)', '2026-11-20T03:00:00', 'T7 21/11 – T2 23/11'],
    ['qua năm mới', '2026-12-31T10:00:00', 'T6 01/01 – T7 02/01'],
  ])('TP.HCM, %s', (_name, at, want) => {
    expect(scheduleEtaLabel(S, HCM, vn(at))).toBe(want);
  });

  it('tỉnh khác 2–4 ngày làm việc; chưa biết tỉnh (trang chi tiết) thì từ sớm nhất TP.HCM tới muộn nhất tỉnh khác', () => {
    const at = vn('2026-11-19T10:00:00');
    expect(scheduleEtaLabel(S, 'Tỉnh Đồng Nai', at)).toBe('T7 21/11 – T3 24/11');
    expect(scheduleEtaLabel(S, null, at)).toBe('T6 20/11 – T3 24/11');
    expect(scheduleEtaLabel(S, '', at)).toBe('T6 20/11 – T3 24/11');
    expect(scheduleEtaLabel(S, 'TP.HCM', at)).toBe('T6 20/11 – T7 21/11');
  });

  it('ngày lễ: không xuất kho và không tính là ngày giao', () => {
    expect(scheduleEtaLabel({ ...S, holidays: ['2026-11-20'] }, HCM, vn('2026-11-19T10:00:00'))).toBe('T7 21/11 – T2 23/11');
    expect(scheduleEtaLabel({ ...S, holidays: ['2026-11-19'] }, HCM, vn('2026-11-19T10:00:00'))).toBe('T7 21/11 – T2 23/11');
  });

  it('giờ cắt và khoảng ngày theo cấu hình; ít nhất bằng nhiều nhất thì một ngày', () => {
    expect(scheduleEtaLabel({ ...S, cutoff: '09:30' }, HCM, vn('2026-11-19T10:00:00'))).toBe('T7 21/11 – T2 23/11');
    expect(scheduleEtaLabel({ ...S, hcmDays: [1, 1] }, HCM, vn('2026-11-19T10:00:00'))).toBe('T6 20/11');
  });

  it('lịch không còn ngày làm nào: vẫn trả về, không treo', () => {
    expect(typeof scheduleEtaLabel({ ...S, workDays: [] }, HCM, vn('2026-11-19T10:00:00'))).toBe('string');
  });
});

describe('checkoutEtaLabel + etaSchedule: lịch kho thay khoảng ngày lịch khi bật cờ', () => {
  const S: DeliverySchedule = { cutoff: '15:00', workDays: [1, 2, 3, 4, 5, 6], holidays: [], hcmDays: [1, 2], provinceDays: [2, 4] };
  const at = new Date('2026-11-19T10:00:00+07:00');

  it('etaSchedule chỉ trả lịch khi cờ pdpEtaEnabled bật và API có gửi lịch', () => {
    expect(etaSchedule({ pdpEtaEnabled: false, deliverySchedule: S })).toBeNull();
    expect(etaSchedule({ pdpEtaEnabled: true })).toBeNull();
    expect(etaSchedule(undefined)).toBeNull();
    expect(etaSchedule({ pdpEtaEnabled: true, deliverySchedule: S })).toBe(S);
  });

  it('có lịch: theo tỉnh của địa chỉ, không cần shippingEta; trộn gian hàng thì ghi rõ phần hàng Tubu', () => {
    expect(checkoutEtaLabel(null, ['TUBU'], at, S, 'Thành phố Hồ Chí Minh')).toBe('T6 20/11 – T7 21/11');
    expect(checkoutEtaLabel({ minDays: 9, maxDays: 9 }, ['TUBU', 'MERCHANT'], at, S, 'Tỉnh Cà Mau')).toBe('T7 21/11 – T3 24/11 (hàng Tubu Tree)');
    expect(checkoutEtaLabel(null, ['MERCHANT'], at, S, 'TP.HCM')).toBeNull();
  });

  it('không lịch: giữ khoảng ngày lịch cũ, thiếu cấu hình thì không hứa', () => {
    expect(checkoutEtaLabel({ minDays: 1, maxDays: 2 }, ['TUBU'], at, null, 'TP.HCM')).toBe('20/11 – 21/11');
    expect(checkoutEtaLabel(null, ['TUBU'], at, null)).toBeNull();
  });
});
