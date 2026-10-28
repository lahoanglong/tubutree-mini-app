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
  it('tính từ giờ xác nhận theo ngày Việt Nam', () => {
    expect(orderDeliveryEtaLabel(eta, order('SHIPPING', { statusTimes: { CONFIRMED: '2026-10-28T18:00:00.000Z' } }))).toBe('31/10 – 02/11');
  });
  it('không có giờ xác nhận thì lấy giờ đặt', () => {
    expect(orderDeliveryEtaLabel(eta, order('CONFIRMED'))).toBe('30/10 – 01/11');
  });
  it('cấu hình trống thì ẩn, không bịa ngày', () => {
    expect(orderDeliveryEtaLabel(null, order('CONFIRMED'))).toBeNull();
    expect(orderDeliveryEtaLabel(undefined, order('CONFIRMED'))).toBeNull();
  });
  it('chưa xác nhận hoặc đã xong thì ẩn', () => {
    for (const s of ['PENDING_PAYMENT', 'DELIVERED', 'CANCELLED', 'RETURNED']) {
      expect(orderDeliveryEtaLabel(eta, order(s))).toBeNull();
    }
  });
  it('mốc thời gian hỏng thì ẩn', () => {
    expect(orderDeliveryEtaLabel(eta, { status: 'CONFIRMED', createdAt: 'x' })).toBeNull();
  });
});
