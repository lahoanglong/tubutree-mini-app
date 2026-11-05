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

describe('số tiền Pancake báo đã trả — ô kiểu lạ (W11)', () => {
  it.each([[true], [false], [[]], [[5]], [{}], [Number.NaN], [Infinity], [1e21], ['12.000'], ['1e5'], ['0x10'], ['abc'], ['  '], [null], [undefined]])(
    'prepaid=%j: không phải số tiền → 0 (không thành 1, 12 hay số khổng lồ)',
    (raw) => {
      expect(pancakePaidAmount({ prepaid: raw, bank_payment: raw })).toBe(0);
      expect(pancakePaidAmountAfterPaid({ prepaid: raw, bank_payment: raw })).toBe(0);
      expect(isPancakeOrderPaid({ prepaid: raw }, 100000)).toBe(false);
    },
  );

  it('chuỗi số kiểu máy đọc như số; cộng prepaid và bank_payment như trước', () => {
    expect(pancakePaidAmount({ prepaid: '100000', bank_payment: '50000.00' })).toBe(150000);
    expect(pancakePaidAmountAfterPaid({ prepaid: '100000', bank_payment: 50000 })).toBe(100000);
  });

  it('cờ is_paid kiểu chuỗi không tự coi là đã trả (chỉ boolean true hoặc payment_status đúng)', () => {
    expect(isPancakeOrderPaid({ is_paid: 'true' }, 100000)).toBe(false);
    expect(isPancakeOrderPaid({ is_paid: 1 }, 100000)).toBe(false);
    expect(isPancakeOrderPaid({ is_paid: true }, 100000)).toBe(true);
  });
});
