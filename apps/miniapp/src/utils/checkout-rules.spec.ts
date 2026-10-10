import { describe, it, expect } from 'vitest';
import {
  checkoutPoints,
  isInvoiceValid,
  paymentUnavailableReason,
  pointsEarnLabel,
  pointsUseLabel,
  shouldFallbackToCod,
  type InvoiceInfo,
} from './checkout-rules';

const emptyInvoice: InvoiceInfo = { taxCode: '', companyName: '', address: '', email: '' };
const validInvoice: InvoiceInfo = {
  taxCode: '0312345678',
  companyName: 'Cty ABC',
  address: '123 Lê Lợi',
  email: 'ke-toan@abc.vn',
};

describe('isInvoiceValid', () => {
  it('không yêu cầu xuất hoá đơn → luôn hợp lệ dù các trường rỗng', () => {
    expect(isInvoiceValid(false, emptyInvoice)).toBe(true);
  });

  it('yêu cầu xuất + thiếu bất kỳ trường nào → không hợp lệ', () => {
    expect(isInvoiceValid(true, emptyInvoice)).toBe(false);
    expect(isInvoiceValid(true, { ...validInvoice, taxCode: '' })).toBe(false);
    expect(isInvoiceValid(true, { ...validInvoice, companyName: '   ' })).toBe(false);
  });

  it('yêu cầu xuất + email sai định dạng → không hợp lệ', () => {
    expect(isInvoiceValid(true, { ...validInvoice, email: 'not-an-email' })).toBe(false);
  });

  it('yêu cầu xuất + đủ 4 trường hợp lệ → hợp lệ', () => {
    expect(isInvoiceValid(true, validInvoice)).toBe(true);
  });
});

describe('shouldFallbackToCod', () => {
  it('WALLET không đủ số dư trả tổng đơn → true', () => {
    expect(shouldFallbackToCod('WALLET', 50_000, 0, 100_000)).toBe(true);
  });

  it('WALLET đủ số dư → false', () => {
    expect(shouldFallbackToCod('WALLET', 200_000, 0, 100_000)).toBe(false);
  });

  it('XU không đủ số dư trả tổng đơn → true', () => {
    expect(shouldFallbackToCod('XU', 0, 50_000, 100_000)).toBe(true);
  });

  it('COD hoặc BANK_TRANSFER không bao giờ tự fallback (không dùng số dư)', () => {
    expect(shouldFallbackToCod('COD', 0, 0, 100_000)).toBe(false);
    expect(shouldFallbackToCod('BANK_TRANSFER', 0, 0, 100_000)).toBe(false);
  });
});

// Điểm của đơn vừa giao còn trong hạn đổi/trả (hoặc đang chờ xử lý đổi/trả) chưa tiêu được — BE kẹp
// checkout theo redeemablePoints của loyalty overview, nên màn thanh toán phải đề nghị ĐÚNG số đó.
describe('checkoutPoints', () => {
  it('dùng redeemablePoints của loyalty overview làm trần, kèm ghi chú phần chưa dùng được', () => {
    const r = checkoutPoints({ pointsBalance: 500, lockedPoints: 300, redeemablePoints: 200 }, 999);
    expect(r).toEqual({
      balance: 500,
      usable: 200,
      label: 'Dùng được 200/500 điểm',
      lockNote: '300 điểm từ đơn còn trong hạn hoặc đang chờ xử lý đổi/trả chưa dùng được',
    });
  });

  it('không có điểm khoá → như cũ: "Bạn đang có N điểm", không ghi chú', () => {
    expect(checkoutPoints({ pointsBalance: 120, lockedPoints: 0, redeemablePoints: 120 }, 0)).toEqual({
      balance: 120,
      usable: 120,
      label: 'Bạn đang có 120 điểm',
      lockNote: null,
    });
  });

  it('toàn bộ số dư đang khoá → usable 0 (tắt công tắc), nhãn giải thích thay vì "Tích điểm từ đơn đầu tiên"', () => {
    expect(checkoutPoints({ pointsBalance: 80, lockedPoints: 80, redeemablePoints: 0 }, 0)).toEqual({
      balance: 80,
      usable: 0,
      label: '80 điểm từ đơn còn trong hạn hoặc đang chờ xử lý đổi/trả chưa dùng được',
      lockNote: null,
    });
  });

  it('API cũ chưa trả redeemablePoints → số dư − lockedPoints (không âm)', () => {
    expect(checkoutPoints({ pointsBalance: 100, lockedPoints: 40 }, 0).usable).toBe(60);
    expect(checkoutPoints({ pointsBalance: 100, lockedPoints: 400 }, 0).usable).toBe(0);
  });

  it('chưa tải loyalty overview → số dư dự phòng (BE vẫn tự kẹp khi báo giá)', () => {
    expect(checkoutPoints(undefined, 70)).toMatchObject({ balance: 70, usable: 70, lockNote: null });
  });

  it('không có điểm nào → usable 0, label null (màn hình hiện lời mời tích điểm)', () => {
    expect(checkoutPoints({ pointsBalance: 0, redeemablePoints: 0 }, 0)).toEqual({ balance: 0, usable: 0, label: null, lockNote: null });
  });
});

describe('checkoutPoints — số ≥ 1.000 có dấu phân cách nghìn (C-080)', () => {
  it('"Dùng được 48/65.000 điểm" thay vì "48/65000"', () => {
    const r = checkoutPoints({ pointsBalance: 65_000, lockedPoints: 64_952, redeemablePoints: 48 }, 0);
    expect(r.label).toBe('Dùng được 48/65.000 điểm');
    expect(r.lockNote).toBe('64.952 điểm từ đơn còn trong hạn hoặc đang chờ xử lý đổi/trả chưa dùng được');
  });

  it('"Bạn đang có 1.250 điểm"', () => {
    expect(checkoutPoints({ pointsBalance: 1250, lockedPoints: 0, redeemablePoints: 1250 }, 0).label).toBe('Bạn đang có 1.250 điểm');
  });

  it('toàn bộ đang khoá: "12.000 điểm từ đơn còn trong hạn..."', () => {
    expect(checkoutPoints({ pointsBalance: 12_000, lockedPoints: 12_000, redeemablePoints: 0 }, 0).label).toBe(
      '12.000 điểm từ đơn còn trong hạn hoặc đang chờ xử lý đổi/trả chưa dùng được',
    );
  });
});

describe('paymentUnavailableReason (C-080)', () => {
  it('Ví Tubu thiếu → nói rõ vì sao mờ và cần thêm bao nhiêu', () => {
    expect(paymentUnavailableReason('WALLET', 130_000, 798_000)).toBe('Số dư chưa đủ — cần thêm 668.000đ');
  });

  it('TubuXu thiếu → cần thêm bao nhiêu xu (1 xu = 1đ như BE kiểm)', () => {
    expect(paymentUnavailableReason('XU', 149_000, 798_000)).toBe('Số dư chưa đủ — cần thêm 649.000 xu');
  });

  it('đủ số dư (kể cả bằng đúng tổng đơn) → null, không có lý do', () => {
    expect(paymentUnavailableReason('WALLET', 798_000, 798_000)).toBeNull();
    expect(paymentUnavailableReason('XU', 900_000, 798_000)).toBeNull();
  });

  it('khớp tuyệt đối với shouldFallbackToCod: có lý do ⇔ sẽ bị rơi về COD', () => {
    for (const [bal, total] of [[0, 1], [99, 100], [100, 100], [101, 100]] as const) {
      expect(paymentUnavailableReason('WALLET', bal, total) !== null).toBe(shouldFallbackToCod('WALLET', bal, 0, total));
      expect(paymentUnavailableReason('XU', bal, total) !== null).toBe(shouldFallbackToCod('XU', 0, bal, total));
    }
  });
});

describe('pointsUseLabel / pointsEarnLabel (C-080)', () => {
  it('điểm dùng có dấu nghìn: "Dùng 1.250 điểm — giảm 12.500đ"', () => {
    expect(pointsUseLabel(1250, '12.500đ')).toBe('Dùng 1.250 điểm — giảm 12.500đ');
    expect(pointsUseLabel(48, '480đ')).toBe('Dùng 48 điểm — giảm 480đ');
  });

  it('điểm sẽ tích có dấu nghìn: "+1.250 điểm Xanh khi giao thành công"', () => {
    expect(pointsEarnLabel(1250)).toBe('+1.250 điểm Xanh khi giao thành công');
    expect(pointsEarnLabel(35)).toBe('+35 điểm Xanh khi giao thành công');
  });
});
