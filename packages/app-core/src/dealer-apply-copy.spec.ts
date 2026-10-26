import { describe, expect, it } from 'vitest';
import { dealerApplyPitch, dealerReviewLine, DEALER_BENEFITS, DEALER_REQUIREMENTS } from './dealer-apply-copy';

describe('dealerApplyPitch', () => {
  it('nêu con số khi cấu hình đã về, không thì dùng câu chung không có số', () => {
    expect(dealerApplyPitch('45%')).toBe('Giá sỉ đến 45% · công nợ · đặt hàng nhanh số lượng lớn.');
    expect(dealerApplyPitch(null)).toBe('Giá sỉ ưu đãi · công nợ · đặt hàng nhanh số lượng lớn.');
    expect(dealerApplyPitch(undefined)).not.toMatch(/\d/);
  });
});

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
