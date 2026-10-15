import { describe, it, expect } from 'vitest';
import { DEALER_APP_FILTERS, dealerAppStatusLabel } from './dealer-applications';

describe('dealerAppStatusLabel', () => {
  it.each([
    ['PENDING', 'Chờ duyệt'],
    ['APPROVED', 'Đã duyệt'],
    ['REJECTED', 'Đã từ chối'],
    ['SUSPENDED', 'Tạm ngưng'],
  ])('%s → %s', (status, label) => {
    expect(dealerAppStatusLabel(status)).toBe(label);
  });

  it('trạng thái API thêm sau mà web chưa biết không lộ mã thô', () => {
    expect(dealerAppStatusLabel('ARCHIVED')).toBe('Trạng thái khác');
    expect(dealerAppStatusLabel('')).toBe('Trạng thái khác');
  });
});

describe('DEALER_APP_FILTERS', () => {
  it('giữ nguyên giá trị gửi API, chỉ đổi chữ hiển thị; "Tất cả" = không lọc', () => {
    expect(DEALER_APP_FILTERS).toEqual([
      { value: 'PENDING', label: 'Chờ duyệt' },
      { value: 'APPROVED', label: 'Đã duyệt' },
      { value: 'REJECTED', label: 'Đã từ chối' },
      { value: '', label: 'Tất cả trạng thái' },
    ]);
  });
});
