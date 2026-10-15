import { describe, it, expect } from 'vitest';
import {
  checkoutPoints,
  isInvoiceValid,
  pointsCapState,
  walletUnavailableReason,
  paymentMissingNote,
  paymentUnavailableReason,
  pickPaymentMethod,
  pointsEarnLabel,
  pointsUseLabel,
  zeroTotalNote,
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

describe('chọn phương thức thanh toán theo báo giá (R4-CHECKOUT-2)', () => {
  const COD_OVER = 'Thanh toán khi nhận hàng (COD) chỉ nhận đơn tối đa 5.000.000đ, đơn này là 5.400.000đ. Vui lòng chuyển khoản hoặc trả bằng Ví Tubu.';
  const SPLIT = 'Đơn gồm hàng do nhiều nơi giao nên chỉ thanh toán được khi nhận hàng (COD) hoặc bằng Ví Tubu.';

  it('lý do lấy đúng câu máy chủ khoá trong báo giá; Ví so số dư mới nhất với tổng đơn', () => {
    const quote = { total: 5_400_000, blockedPaymentMethods: { COD: COD_OVER } };
    expect(paymentUnavailableReason('COD', quote, 0)).toBe(COD_OVER);
    expect(paymentUnavailableReason('BANK_TRANSFER', quote, 0)).toBeNull();
    expect(paymentUnavailableReason('WALLET', quote, 5_000_000)).toBe('Số dư chưa đủ — cần thêm 400.000đ');
    expect(paymentUnavailableReason('WALLET', quote, 5_400_000)).toBeNull();
    expect(paymentUnavailableReason('WALLET', { total: 70_000 }, 70_000)).toBeNull();
  });

  it('lựa chọn của khách còn dùng được thì giữ nguyên', () => {
    expect(pickPaymentMethod('BANK_TRANSFER', { total: 70_000 }, 0)).toBe('BANK_TRANSFER');
    expect(pickPaymentMethod('WALLET', { total: 70_000, blockedPaymentMethods: { BANK_TRANSFER: SPLIT } }, 70_000)).toBe('WALLET');
  });

  it('COD bị khoá (một đơn vượt 5 triệu) → chọn chuyển khoản thay vì ép về COD', () => {
    expect(pickPaymentMethod('COD', { total: 5_400_000, blockedPaymentMethods: { COD: COD_OVER } }, 0)).toBe('BANK_TRANSFER');
  });

  it('chuyển khoản bị khoá (giỏ tách đơn) hoặc Ví thiếu số dư → về COD khi COD dùng được', () => {
    expect(pickPaymentMethod('BANK_TRANSFER', { total: 295_000, blockedPaymentMethods: { BANK_TRANSFER: SPLIT } }, 0)).toBe('COD');
    expect(pickPaymentMethod('WALLET', { total: 100_000 }, 50_000)).toBe('COD');
  });

  it('COD và chuyển khoản đều bị khoá → không tự chọn (kể cả Ví đủ tiền: Ví trừ tiền nên khách phải tự chọn)', () => {
    const quote = { total: 5_600_000, blockedPaymentMethods: { COD: COD_OVER, BANK_TRANSFER: SPLIT } };
    expect(pickPaymentMethod('COD', quote, 0)).toBe('');
    expect(pickPaymentMethod('COD', quote, 9_000_000)).toBe('');
    expect(pickPaymentMethod('WALLET', quote, 9_000_000)).toBe('WALLET');
  });

  it('chưa có phương thức nào được chọn: nhắc chọn khi còn cách dùng được, nói rõ khi không còn cách nào', () => {
    const quote = { total: 5_600_000, blockedPaymentMethods: { COD: COD_OVER, BANK_TRANSFER: SPLIT } };
    expect(paymentMissingNote(quote, 9_000_000)).toBe('Chọn một cách thanh toán cho đơn này để đặt hàng.');
    expect(paymentMissingNote(quote, 0)).toBe(
      'Đơn này chưa có cách thanh toán dùng được. Xem hướng dẫn dưới từng cách thanh toán ở trên.',
    );
  });

  it('XU không còn là phương thức thanh toán (PD-3): không được giữ, chọn lại COD', () => {
    expect(pickPaymentMethod('XU', { total: 100_000 }, 0)).toBe('COD');
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
      convertedNote: null,
      converted: 0,
    });
  });

  it('không có điểm khoá → như cũ: "Bạn đang có N điểm", không ghi chú', () => {
    expect(checkoutPoints({ pointsBalance: 120, lockedPoints: 0, redeemablePoints: 120 }, 0)).toEqual({
      balance: 120,
      usable: 120,
      label: 'Bạn đang có 120 điểm',
      lockNote: null,
      convertedNote: null,
      converted: 0,
    });
  });

  it('toàn bộ số dư đang khoá → usable 0 (tắt công tắc), nhãn giải thích thay vì "Tích điểm từ đơn đầu tiên"', () => {
    expect(checkoutPoints({ pointsBalance: 80, lockedPoints: 80, redeemablePoints: 0 }, 0)).toEqual({
      balance: 80,
      usable: 0,
      label: '80 điểm từ đơn còn trong hạn hoặc đang chờ xử lý đổi/trả chưa dùng được',
      lockNote: null,
      convertedNote: null,
      converted: 0,
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
    expect(checkoutPoints({ pointsBalance: 0, redeemablePoints: 0 }, 0)).toEqual({
      balance: 0,
      usable: 0,
      label: null,
      lockNote: null,
      convertedNote: null,
      converted: 0,
    });
  });
});

// PD-3: Điểm Xanh có hai lô. Lô quy đổi từ xu cũ không hết hạn, không bị khoá theo đơn còn đổi/trả và được
// trả tới 100% giá trị hàng ở thanh toán, nên khách thấy MỘT con số nhưng phải được nói rõ phần không hết hạn.
describe('checkoutPoints — điểm quy đổi không hết hạn (PD-3)', () => {
  it('chỉ có lô quy đổi → dùng được hết, kèm ghi chú không hết hạn và trả tới 100% giá trị hàng', () => {
    const r = checkoutPoints({ pointsBalance: 0, pointsConvertedBalance: 1_000, lockedPoints: 0, redeemablePoints: 0 }, 0);
    expect(r).toEqual({
      balance: 1_000,
      converted: 1_000,
      usable: 1_000,
      label: 'Bạn đang có 1.000 điểm',
      lockNote: null,
      convertedNote: 'trong đó 1.000 điểm không hết hạn, trả tới 100% giá trị hàng',
    });
  });

  it('lô thường bị khoá một phần: lô quy đổi vẫn dùng được (không bị khoá), tổng và phần khoá tách đúng', () => {
    const r = checkoutPoints({ pointsBalance: 500, pointsConvertedBalance: 100, lockedPoints: 300, redeemablePoints: 200 }, 0);
    expect(r.balance).toBe(600);
    expect(r.usable).toBe(300);
    expect(r.label).toBe('Dùng được 300/600 điểm');
    expect(r.lockNote).toBe('300 điểm từ đơn còn trong hạn hoặc đang chờ xử lý đổi/trả chưa dùng được');
    expect(r.convertedNote).toBe('trong đó 100 điểm không hết hạn, trả tới 100% giá trị hàng');
  });

  it('toàn bộ lô thường đang khoá nhưng còn lô quy đổi → usable = lô quy đổi, công tắc dùng điểm bật được', () => {
    const r = checkoutPoints({ pointsBalance: 80, pointsConvertedBalance: 20, lockedPoints: 80, redeemablePoints: 0 }, 0);
    expect(r.usable).toBe(20);
    expect(r.label).toBe('Dùng được 20/100 điểm');
  });

  it('chưa tải overview → lấy lô thường và lô quy đổi từ hồ sơ đăng nhập', () => {
    expect(checkoutPoints(undefined, 70, 30)).toMatchObject({ balance: 100, converted: 30, usable: 100 });
  });

  it('API cũ chưa trả lô quy đổi → như trước, không ghi chú', () => {
    expect(checkoutPoints({ pointsBalance: 120, redeemablePoints: 120 }, 0).convertedNote).toBeNull();
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

describe('walletUnavailableReason (C-080)', () => {
  it('Ví Tubu thiếu → nói rõ vì sao mờ và cần thêm bao nhiêu', () => {
    expect(walletUnavailableReason(130_000, 798_000)).toBe('Số dư chưa đủ — cần thêm 668.000đ');
  });

  it('đủ số dư (kể cả bằng đúng tổng đơn) → null, không có lý do', () => {
    expect(walletUnavailableReason(798_000, 798_000)).toBeNull();
    expect(walletUnavailableReason(900_000, 798_000)).toBeNull();
  });

  it('khớp tuyệt đối với lựa chọn: có lý do ⇔ Ví đang chọn bị đổi sang cách khác', () => {
    for (const [bal, total] of [[0, 1], [99, 100], [100, 100], [101, 100]] as const) {
      expect(walletUnavailableReason(bal, total) !== null).toBe(pickPaymentMethod('WALLET', { total }, bal) !== 'WALLET');
    }
  });
});

describe('zeroTotalNote — đơn 0đ (PD-3)', () => {
  it('tổng còn lại > 0 → không có ghi chú (khách vẫn chọn cách thanh toán)', () => {
    expect(zeroTotalNote({ total: 20_000, pointsDiscount: 0 })).toBeNull();
  });

  it('điểm phủ hết giá trị hàng và phí ship = 0 → "Đơn đã được trả đủ bằng Điểm Xanh"', () => {
    expect(zeroTotalNote({ total: 0, pointsDiscount: 50_000 })).toBe('Đơn đã được trả đủ bằng Điểm Xanh. Bạn không cần thanh toán thêm.');
  });

  it('0đ nhờ mã giảm giá (không dùng điểm) → không nói sai là trả bằng Điểm Xanh', () => {
    expect(zeroTotalNote({ total: 0, pointsDiscount: 0 })).toBe('Đơn không còn số tiền cần thanh toán.');
  });
});

describe('pointsUseLabel / pointsEarnLabel (C-080)', () => {
  it('điểm dùng có dấu nghìn: "Dùng 1.250 điểm — giảm 12.500đ"', () => {
    expect(pointsUseLabel(1250, '12.500đ')).toBe('Dùng 1.250 điểm — giảm 12.500đ');
    expect(pointsUseLabel(48, '480đ')).toBe('Dùng 48 điểm — giảm 480đ');
  });

  it('điểm sẽ tích có dấu nghìn: "Nhận +1.250 Điểm Xanh khi giao thành công"', () => {
    expect(pointsEarnLabel(1250)).toBe('Nhận +1.250 Điểm Xanh khi giao thành công');
    expect(pointsEarnLabel(35)).toBe('Nhận +35 Điểm Xanh khi giao thành công');
  });
});

const PARTNER_NOTE = 'Điểm Xanh chỉ dùng cho hàng của Tubu, không dùng cho hàng của gian hàng đối tác';

describe('pointsCapState (Q8 S7, R4-BUYER-2)', () => {
  it('báo giá chưa có trần (đang tải, API cũ): không đổi gì', () => {
    expect(pointsCapState(undefined)).toEqual({ disabled: false, capNote: null, partnerNote: null });
    expect(pointsCapState({}, 8000)).toEqual({ disabled: false, capNote: null, partnerNote: null });
    expect(pointsCapState({ pointsPartnerNote: null }, 8000)).toEqual({ disabled: false, capNote: null, partnerNote: null });
  });

  it('giỏ có hàng đối tác: nêu trần điểm của đơn và câu giải thích', () => {
    expect(pointsCapState({ pointsMax: 1250, pointsPartnerNote: PARTNER_NOTE }, 8000)).toEqual({
      disabled: false,
      capNote: 'Đơn này dùng tối đa 1.250 Điểm Xanh',
      partnerNote: PARTNER_NOTE,
    });
  });

  it('giỏ chỉ hàng đối tác: tắt ô Điểm Xanh, giữ câu giải thích', () => {
    expect(pointsCapState({ pointsMax: 0, pointsPartnerNote: PARTNER_NOTE }, 8000)).toEqual({ disabled: true, capNote: null, partnerNote: PARTNER_NOTE });
  });

  it('giỏ chỉ hàng Tubu, trần của đơn thấp hơn số điểm dùng được: nêu trần trước khi tick (khách 8.013 điểm, trần 42)', () => {
    expect(pointsCapState({ pointsMax: 42, pointsPartnerNote: null }, 7972)).toEqual({
      disabled: false,
      capNote: 'Đơn này dùng tối đa 42 Điểm Xanh, tính theo giá trị hàng của đơn',
      partnerNote: null,
    });
  });

  it('giỏ chỉ hàng Tubu, trần không thấp hơn số điểm dùng được: nhãn đã đúng, không thêm dòng', () => {
    expect(pointsCapState({ pointsMax: 300, pointsPartnerNote: null }, 300)).toEqual({ disabled: false, capNote: null, partnerNote: null });
    expect(pointsCapState({ pointsMax: 20, pointsPartnerNote: null })).toEqual({ disabled: false, capNote: null, partnerNote: null });
  });

  it('giỏ chỉ hàng Tubu, trần 0 mà khách có điểm: tắt ô kèm lời giải thích; không có điểm thì để nguyên', () => {
    expect(pointsCapState({ pointsMax: 0, pointsPartnerNote: null }, 500)).toEqual({
      disabled: true,
      capNote: 'Đơn này chưa dùng được Điểm Xanh',
      partnerNote: null,
    });
    expect(pointsCapState({ pointsMax: 0, pointsPartnerNote: null }, 0)).toEqual({ disabled: false, capNote: null, partnerNote: null });
  });
});
