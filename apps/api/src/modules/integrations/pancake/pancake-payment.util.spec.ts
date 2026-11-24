import {
  codSwitchedTransferAfterHandover,
  isPancakeOrderPaid,
  pancakePaidAmount,
  pancakePaidAmountAfterPaid,
  pancakeShowsDelivered,
  unreadablePaidFields,
} from './pancake-payment.util';

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

describe('số tiền đã trả: chuỗi có phần lẻ dài và mẫu ngăn nghìn (W11)', () => {
  it('"269000.000" đọc như 269000 (trước đây thành 0 và bỏ qua so tổng)', () => {
    expect(pancakePaidAmount({ prepaid: '269000.000' })).toBe(269000);
    expect(pancakePaidAmountAfterPaid({ bank_payment: ' 269000.0000 ' })).toBe(269000);
    expect(isPancakeOrderPaid({ prepaid: '269000.000' }, 269000)).toBe(true);
  });

  it('đúng mẫu ngăn nghìn "269.000" / "1.234.567" → 0 (không thành 269 hay 1)', () => {
    expect(pancakePaidAmount({ prepaid: '269.000', bank_payment: '1.234.567' })).toBe(0);
  });

  it('số lẻ làm tròn như trước', () => {
    expect(pancakePaidAmount({ prepaid: '100000.4' })).toBe(100000);
    expect(pancakePaidAmount({ prepaid: '100000.6' })).toBe(100001);
  });
});

describe('unreadablePaidFields: ô tiền có mặt mà không đọc được', () => {
  it('liệt kê đúng ô có giá trị nhưng không đọc được', () => {
    expect(unreadablePaidFields({ prepaid: '269.000', bank_payment: 5000 })).toEqual(['prepaid']);
    expect(unreadablePaidFields({ prepaid: {}, bank_payment: [] })).toEqual(['prepaid', 'bank_payment']);
    expect(unreadablePaidFields({ prepaid: true })).toEqual(['prepaid']);
  });
  it.each([[undefined], [null], [''], [0], ['0'], [250000], ['250000.000'], ['250000.00']])('prepaid=%j hợp lệ hoặc vắng mặt → không báo', (raw) => {
    expect(unreadablePaidFields({ prepaid: raw })).toEqual([]);
  });
});

describe('codSwitchedTransferAfterHandover: đơn đã đổi sang COD, hàng đã rời kho (w29-01)', () => {
  const TOTAL = 200000;

  it('hàng còn trên đường: cờ "đã trả" trơn cũng là chuyển khoản (hãng chưa thu COD), báo amount 0', () => {
    expect(codSwitchedTransferAfterHandover({ is_paid: true }, TOTAL, 'SHIPPING')).toEqual({ amount: 0 });
    expect(codSwitchedTransferAfterHandover({ payment_status: 'paid', status: 2 }, TOTAL, 'SHIPPING')).toEqual({ amount: 0 });
  });

  it('hàng còn trên đường: prepaid + bank_payment là số chuyển khoản', () => {
    expect(codSwitchedTransferAfterHandover({ prepaid: 50000, bank_payment: 150000, is_paid: true }, TOTAL, 'SHIPPING')).toEqual({ amount: 200000 });
  });

  it('không có dấu "đã trả" nào → null', () => {
    expect(codSwitchedTransferAfterHandover({ status: 2 }, TOTAL, 'SHIPPING')).toBeNull();
    expect(codSwitchedTransferAfterHandover({ prepaid: 0, bank_payment: '0' }, TOTAL, 'DELIVERED')).toBeNull();
  });

  it.each([
    ['đơn Tubu đã giao', {}, 'DELIVERED'],
    ['webhook "Đã nhận" (3)', { status: 3 }, 'SHIPPING'],
    ['webhook "Hoàn một phần" (15): hãng thu COD phần khách giữ', { status: 15 }, 'SHIPPING'],
    ['webhook "Đã thu tiền" (16, chuỗi)', { status: '16' }, 'SHIPPING'],
    ['webhook status_name delivered', { status_name: 'Delivered' }, 'SHIPPING'],
  ] as [string, Record<string, unknown>, string][])('%s: cờ "đã trả" và prepaid tới bằng tổng đơn là tiền thu hộ COD → không báo', (_n, extra, status) => {
    expect(codSwitchedTransferAfterHandover({ ...extra, is_paid: true }, TOTAL, status)).toBeNull();
    expect(codSwitchedTransferAfterHandover({ ...extra, is_paid: true, prepaid: TOTAL }, TOTAL, status)).toBeNull();
    expect(codSwitchedTransferAfterHandover({ ...extra, prepaid: 120000 }, TOTAL, status)).toBeNull();
  });

  it('hãng đã giao: bank_payment và phần prepaid vượt tổng đơn vẫn là chuyển khoản', () => {
    expect(codSwitchedTransferAfterHandover({ status: 16, bank_payment: 80000 }, TOTAL, 'SHIPPING')).toEqual({ amount: 80000 });
    expect(codSwitchedTransferAfterHandover({ status: 16, prepaid: 400000 }, TOTAL, 'SHIPPING')).toEqual({ amount: 200000 });
    expect(codSwitchedTransferAfterHandover({ prepaid: TOTAL, bank_payment: TOTAL }, TOTAL, 'DELIVERED')).toEqual({ amount: 200000 });
  });

  it.each(['RETURNED', 'CANCELLED'])('đơn Tubu đã đóng (%s): cờ trơn không báo; có số chuyển khoản thì vẫn báo', (status) => {
    expect(codSwitchedTransferAfterHandover({ is_paid: true, status: 5 }, TOTAL, status)).toBeNull();
    expect(codSwitchedTransferAfterHandover({ is_paid: true, prepaid: 150000 }, TOTAL, status)).toEqual({ amount: 150000 });
  });
});

describe('pancakeShowsDelivered', () => {
  it.each([[3], ['3'], [15], [16], [' 16 '], ['delivered'], ['COMPLETED']])('%j → đã giao', (status) => {
    expect(pancakeShowsDelivered({ status })).toBe(true);
  });
  it.each([[2], ['2'], [4], [5], [null], [[3]], [{}]])('%j → chưa', (status) => {
    expect(pancakeShowsDelivered({ status })).toBe(false);
  });
});
