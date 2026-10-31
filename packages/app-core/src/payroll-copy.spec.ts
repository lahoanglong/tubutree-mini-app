import { describe, expect, it } from 'vitest';
import { payrollReopenMessage } from './payroll-copy';

describe('payrollReopenMessage', () => {
  it('tháng mới chốt: hỏi mở lại và nhắc chốt lại, không nhắc chứng từ', () => {
    const text = payrollReopenMessage(3, 2026, 'Mai', 'FINALIZED');
    expect(text).toBe('Mở lại bảng lương T3/2026 của Mai? Cần chốt lại sau khi sửa.');
    expect(text).not.toContain('chứng từ');
  });

  it('tháng đã trả: nói rõ mở lại xoá dấu đã trả và ảnh chứng từ chuyển khoản', () => {
    const text = payrollReopenMessage(3, 2026, 'Hoa', 'PAID');
    expect(text).toContain('Mở lại bảng lương T3/2026 của Hoa? Cần chốt lại sau khi sửa.');
    expect(text).toContain('xoá dấu đã trả và ảnh chứng từ chuyển khoản');
  });

  it('tháng đang tính: giống tháng mới chốt', () => {
    expect(payrollReopenMessage(12, 2025, 'NV', 'OPEN')).toBe('Mở lại bảng lương T12/2025 của NV? Cần chốt lại sau khi sửa.');
  });
});
