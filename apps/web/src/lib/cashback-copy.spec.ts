import { describe, expect, it } from 'vitest';
import { CASHBACK_TXN_META, formatRatePct } from './cashback-copy';

// DB lưu baseRate dạng phân số: Shopee 0.035, Lazada 0.042, TikTok 0.049.
describe('formatRatePct — tỉ lệ hoàn tiền (DB lưu phân số, hiển thị phần trăm)', () => {
  it('0.035 → "3,5%" (không phải "0.035%")', () => {
    expect(formatRatePct(0.035)).toBe('3,5%');
  });
  it('nhận cả chuỗi (Decimal serialize thành string qua API)', () => {
    expect(formatRatePct('0.042')).toBe('4,2%');
  });
  it('số tròn bỏ phần thập phân', () => {
    expect(formatRatePct(0.05)).toBe('5%');
  });
  it('0, null, undefined, rác → "0%", không hiện NaN%', () => {
    expect(formatRatePct(0)).toBe('0%');
    expect(formatRatePct(null)).toBe('0%');
    expect(formatRatePct(undefined)).toBe('0%');
    expect(formatRatePct('abc')).toBe('0%');
    expect(formatRatePct(-1)).toBe('0%');
  });
});

describe('CASHBACK_TXN_META', () => {
  it('nhãn và tông theo trạng thái giống Mini App', () => {
    expect(CASHBACK_TXN_META).toEqual({
      PENDING: { label: 'Chờ duyệt', tone: 'warning' },
      CONFIRMED: { label: 'Đã duyệt', tone: 'success' },
      PAID: { label: 'Đã hoàn vào Ví', tone: 'neutral' },
      REJECTED: { label: 'Từ chối', tone: 'danger' },
    });
  });
});
