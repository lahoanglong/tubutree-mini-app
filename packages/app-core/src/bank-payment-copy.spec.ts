import { describe, expect, it } from 'vitest';
import { BANK_DEADLINE_LEAD, BANK_DEADLINE_TAIL, COD_SWITCH_CTA, codSwitchConfirmBody } from './bank-payment-copy';

describe('câu hạn chuyển khoản (R-32)', () => {
  it('ghép đúng câu ngắn của web, không hứa hoàn tiền trước khi quá hạn', () => {
    expect(`${BANK_DEADLINE_LEAD} 10:00 14/10/2026 ${BANK_DEADLINE_TAIL}`).toBe('Chuyển khoản trước 10:00 14/10/2026 — quá hạn đơn sẽ tự huỷ.');
    expect(`${BANK_DEADLINE_LEAD}${BANK_DEADLINE_TAIL}`).not.toMatch(/hoàn/);
  });
});

describe('đổi chuyển khoản sang trả tiền khi nhận', () => {
  it('nút ghi đúng chữ PO duyệt, câu xác nhận nêu số tiền và nhắc đã chuyển thì đừng đổi', () => {
    expect(COD_SWITCH_CTA).toBe('Đổi sang trả tiền khi nhận (COD)');
    const body = codSwitchConfirmBody('250.000đ');
    expect(body).toContain('250.000đ');
    expect(body).toMatch(/đã chuyển khoản rồi thì đừng đổi/);
  });
});
