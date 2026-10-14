import { describe, expect, it } from 'vitest';
import { payoutStatus, payoutToTubu } from './merchant-payout';

describe('trạng thái phiếu đối soát theo chiều tiền (R2-MERCHANT-4)', () => {
  it('phiếu âm: đối tác nộp — "Chờ nộp"/"Đã thu"; phiếu dương: Tubu chuyển — "Chờ chuyển"/"Đã chuyển"', () => {
    expect(payoutStatus({ amount: -103500, status: 'PENDING' })).toEqual({ label: 'Chờ nộp', tone: 'warning' });
    expect(payoutStatus({ amount: -103500, status: 'PAID' })).toEqual({ label: 'Đã thu', tone: 'success' });
    expect(payoutStatus({ amount: 500000, status: 'PENDING' })).toEqual({ label: 'Chờ chuyển', tone: 'warning' });
    expect(payoutStatus({ amount: 500000, status: 'PAID' })).toEqual({ label: 'Đã chuyển', tone: 'success' });
    expect(payoutStatus({ amount: -1, status: 'CANCELLED' })).toEqual({ label: 'Đã huỷ', tone: 'neutral' });
  });

  it('góc nhìn admin: phiếu âm chờ là "Chờ thu"', () => {
    expect(payoutStatus({ amount: -103500, status: 'PENDING' }, 'admin')).toEqual({ label: 'Chờ thu', tone: 'warning' });
  });

  it('chiều tiền ưu tiên `direction` của API, API cũ thì suy từ dấu', () => {
    expect(payoutToTubu({ amount: 0, direction: 'TO_TUBU' })).toBe(true);
    expect(payoutToTubu({ amount: -5 })).toBe(true);
    expect(payoutToTubu({ amount: 5 })).toBe(false);
  });
});
