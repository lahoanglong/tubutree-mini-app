import { describe, expect, it } from 'vitest';
import { dealerReviewLine, DEALER_BENEFITS, DEALER_REQUIREMENTS } from './dealer-apply-copy';

describe('dealer-apply-copy', () => {
  it('nêu số giờ khi có cấu hình', () => {
    expect(dealerReviewLine(24)).toContain('24 giờ');
  });
  it('không hứa số giờ khi chưa có cấu hình', () => {
    expect(dealerReviewLine(null)).not.toMatch(/\d/);
  });
  it('có điều kiện và quyền lợi', () => {
    expect(DEALER_REQUIREMENTS.length).toBeGreaterThan(0);
    expect(DEALER_BENEFITS.length).toBeGreaterThan(0);
  });
});
