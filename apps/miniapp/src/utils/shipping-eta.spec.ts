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
});
