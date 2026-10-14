import { isPancakeOrderPaid, pancakePaidAmount, pancakePaidAmountAfterPaid } from './pancake-payment.util';

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

describe('pancakePaidAmount / pancakePaidAmountAfterPaid', () => {
  it('trước khi Tubu ghi số đã trả lên Pancake: cộng prepaid + bank_payment', () => {
    expect(pancakePaidAmount({ prepaid: 114000, bank_payment: 36000 })).toBe(150000);
  });

  it('đơn đã nhận đủ: prepaid (Tubu tự ghi transfer_money) + bank_payment (nhân viên ghi) cùng một lần chuyển → không cộng đôi', () => {
    expect(pancakePaidAmountAfterPaid({ prepaid: 114000, bank_payment: 114000 })).toBe(114000);
  });

  it('đơn đã nhận đủ: một ô vượt tổng đơn thì vẫn thấy', () => {
    expect(pancakePaidAmountAfterPaid({ prepaid: 114000, bank_payment: 228000 })).toBe(228000);
    expect(pancakePaidAmountAfterPaid({ prepaid: '228000' })).toBe(228000);
  });

  it('payload rác / âm → 0', () => {
    expect(pancakePaidAmountAfterPaid({ prepaid: 'x', bank_payment: -5 })).toBe(0);
  });
});
