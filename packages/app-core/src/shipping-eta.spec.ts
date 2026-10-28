import { describe, expect, it } from 'vitest';
import { orderDeliveryEtaLabel, shippingEtaLabel } from './shipping-eta';

describe('shippingEtaLabel', () => {
  const now = new Date(2026, 8, 30, 12, 0, 0);
  it('khoảng ngày → "02/10 – 04/10"', () => {
    expect(shippingEtaLabel({ minDays: 2, maxDays: 4 }, now)).toBe('02/10 – 04/10');
  });
  it('min = max → một ngày', () => {
    expect(shippingEtaLabel({ minDays: 1, maxDays: 1 }, now)).toBe('01/10');
  });
  it('cuối năm → sang tháng 1 (31/12 + 3 ngày = 03/01)', () => {
    expect(shippingEtaLabel({ minDays: 1, maxDays: 4 }, new Date(2026, 11, 30, 12, 0, 0))).toBe('31/12 – 03/01');
  });
  it('minDays 0 → hôm nay', () => {
    expect(shippingEtaLabel({ minDays: 0, maxDays: 2 }, now)).toBe('30/09 – 02/10');
    expect(shippingEtaLabel({ minDays: 0, maxDays: 0 }, now)).toBe('30/09');
  });
  it('cuối tháng: 31/01 + 1 ngày = 01/02 (không tràn sang tháng sai)', () => {
    const jan31 = new Date(2026, 0, 31, 12, 0, 0);
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
    expect(orderDeliveryEtaLabel(eta, order('SHIPPING', { createdAt: '2026-10-24T03:00:00.000Z' }), now)).toBe('26/10 – 28/10');
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
