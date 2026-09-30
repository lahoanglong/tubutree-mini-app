import { describe, it, expect } from 'vitest';
import { shippingEtaLabel } from './shipping-eta';

describe('shippingEtaLabel', () => {
  const now = new Date(2026, 8, 30, 12, 0, 0); // 30/09/2026 (giờ địa phương)
  it('khoảng ngày → "02/10 – 04/10"', () => {
    expect(shippingEtaLabel({ minDays: 2, maxDays: 4 }, now)).toBe('02/10 – 04/10');
  });
  it('min = max → một ngày', () => {
    expect(shippingEtaLabel({ minDays: 1, maxDays: 1 }, now)).toBe('01/10');
  });
  it('cuối năm → sang tháng 1 (31/12 + 3 ngày = 03/01)', () => {
    const dec = new Date(2026, 11, 30, 12, 0, 0);
    expect(shippingEtaLabel({ minDays: 1, maxDays: 4 }, dec)).toBe('31/12 – 03/01');
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
