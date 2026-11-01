import { describe, expect, it } from 'vitest';
import { BANK_DEADLINE_LEAD, BANK_DEADLINE_TAIL } from './bank-payment-copy';

describe('câu hạn chuyển khoản (R-32)', () => {
  it('ghép đúng câu ngắn của web, không hứa hoàn tiền trước khi quá hạn', () => {
    expect(`${BANK_DEADLINE_LEAD} 10:00 14/10/2026 ${BANK_DEADLINE_TAIL}`).toBe('Chuyển khoản trước 10:00 14/10/2026 — quá hạn đơn sẽ tự huỷ.');
    expect(`${BANK_DEADLINE_LEAD}${BANK_DEADLINE_TAIL}`).not.toMatch(/hoàn/);
  });
});
