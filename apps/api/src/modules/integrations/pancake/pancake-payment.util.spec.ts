import { isPancakeOrderPaid } from './pancake-payment.util';

describe('isPancakeOrderPaid', () => {
  it('prepaid >= tổng đơn → đã trả', () => {
    expect(isPancakeOrderPaid({ prepaid: 250000 }, 250000)).toBe(true);
  });

  it('bank_payment phủ tổng đơn → đã trả', () => {
    expect(isPancakeOrderPaid({ bank_payment: 300000 }, 250000)).toBe(true);
  });

  it('số tiền đã trả < tổng + không cờ → chưa trả', () => {
    expect(isPancakeOrderPaid({ prepaid: 100000 }, 250000)).toBe(false);
  });

  it('cờ is_paid=true → đã trả (kể cả thiếu số tiền)', () => {
    expect(isPancakeOrderPaid({ is_paid: true }, 250000)).toBe(true);
  });

  it('payment_status=paid → đã trả', () => {
    expect(isPancakeOrderPaid({ payment_status: 'paid' }, 250000)).toBe(true);
  });

  it('tổng đơn 0 (không hợp lệ) → false', () => {
    expect(isPancakeOrderPaid({ prepaid: 0 }, 0)).toBe(false);
  });
});
