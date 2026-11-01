import { describe, expect, it } from 'vitest';
import {
  ORDER_NOTE_MAX,
  effectiveReferralCode,
  isCartFixableError,
  cartFixableNotice,
  isInvoiceValid,
  outOfStockLine,
  overStockMessage,
  paymentMissingNote,
  paymentUnavailableReason,
  pickPaymentMethod,
  walletUnavailableReason,
} from './checkout-rules';

const FULL = { taxCode: '0312345678', companyName: 'Công ty A', address: '1 Phố Huế, Hà Nội', email: 'ketoan@a.vn' };

describe('ORDER_NOTE_MAX', () => {
  it('khớp trần 500 ký tự của API và Mini App', () => {
    expect(ORDER_NOTE_MAX).toBe(500);
  });
});

describe('isInvoiceValid', () => {
  it('không yêu cầu hoá đơn thì luôn hợp lệ', () => {
    expect(isInvoiceValid(false, { taxCode: '', companyName: '', address: '', email: '' })).toBe(true);
  });
  it('cần đủ MST, tên công ty, địa chỉ và email đúng định dạng', () => {
    expect(isInvoiceValid(true, FULL)).toBe(true);
    expect(isInvoiceValid(true, { ...FULL, taxCode: '  ' })).toBe(false);
    expect(isInvoiceValid(true, { ...FULL, companyName: '' })).toBe(false);
    expect(isInvoiceValid(true, { ...FULL, address: '' })).toBe(false);
    expect(isInvoiceValid(true, { ...FULL, email: 'ketoan@' })).toBe(false);
  });
});

describe('Ví Tubu ở thanh toán', () => {
  it('số dư đủ → dùng được, không có lý do khoá', () => {
    expect(walletUnavailableReason(50000, 50000)).toBeNull();
    expect(pickPaymentMethod('WALLET', { total: 50000 }, 50000)).toBe('WALLET');
  });
  it('Ví âm → lời riêng nêu số âm, khoá Ví và chọn lại COD', () => {
    expect(walletUnavailableReason(-50000, 120000)).toBe(
      'Ví đang âm 50.000đ do thu hồi hoa hồng đơn trả hàng, nên chưa trả đơn bằng Ví được. Hãy chọn cách thanh toán khác.',
    );
    expect(pickPaymentMethod('WALLET', { total: 120000 }, -50000)).toBe('COD');
  });
  it('số dư thiếu → nói thiếu bao nhiêu và chọn lại COD', () => {
    expect(walletUnavailableReason(50000, 120000)).toBe('Số dư chưa đủ — cần thêm 70.000đ');
    expect(pickPaymentMethod('WALLET', { total: 120000 }, 50000)).toBe('COD');
    expect(pickPaymentMethod('COD', { total: 120000 }, 0)).toBe('COD');
  });
});

describe('chọn phương thức thanh toán theo báo giá (R4-CHECKOUT-2)', () => {
  const COD_OVER = 'Thanh toán khi nhận hàng (COD) chỉ nhận đơn tối đa 5.000.000đ, đơn này là 5.400.000đ. Vui lòng chuyển khoản hoặc trả bằng Ví Tubu.';
  const SPLIT = 'Đơn gồm hàng do nhiều nơi giao nên chỉ thanh toán được khi nhận hàng (COD) hoặc bằng Ví Tubu.';

  it('lý do lấy đúng câu máy chủ khoá trong báo giá; Ví so số dư với tổng đơn', () => {
    const quote = { total: 5400000, blockedPaymentMethods: { COD: COD_OVER } };
    expect(paymentUnavailableReason('COD', quote, 0)).toBe(COD_OVER);
    expect(paymentUnavailableReason('BANK_TRANSFER', quote, 0)).toBeNull();
    expect(paymentUnavailableReason('WALLET', quote, 5000000)).toBe('Số dư chưa đủ — cần thêm 400.000đ');
  });

  it('COD bị khoá → chọn chuyển khoản; chuyển khoản bị khoá → COD', () => {
    expect(pickPaymentMethod('COD', { total: 5400000, blockedPaymentMethods: { COD: COD_OVER } }, 0)).toBe('BANK_TRANSFER');
    expect(pickPaymentMethod('BANK_TRANSFER', { total: 295000, blockedPaymentMethods: { BANK_TRANSFER: SPLIT } }, 0)).toBe('COD');
  });

  it('COD và chuyển khoản đều bị khoá → không tự chọn Ví; khách tự chọn Ví thì giữ', () => {
    const quote = { total: 5600000, blockedPaymentMethods: { COD: COD_OVER, BANK_TRANSFER: SPLIT } };
    expect(pickPaymentMethod('COD', quote, 9000000)).toBe('');
    expect(pickPaymentMethod('WALLET', quote, 9000000)).toBe('WALLET');
    expect(paymentMissingNote(quote, 9000000)).toBe('Chọn một cách thanh toán cho đơn này để đặt hàng.');
    expect(paymentMissingNote(quote, 0)).toBe('Đơn này chưa có cách thanh toán dùng được. Xem hướng dẫn dưới từng cách thanh toán ở trên.');
  });
});

describe('effectiveReferralCode', () => {
  it('mã khách vừa nhập thắng mã còn trong phiên từ link', () => {
    expect(effectiveReferralCode('ABC', 'LINK')).toBe('ABC');
    expect(effectiveReferralCode(null, 'LINK')).toBe('LINK');
    expect(effectiveReferralCode(null, null)).toBeUndefined();
  });
});

describe('lỗi chỉ sửa được ở giỏ', () => {
  it('nhận ra lỗi hết tồn kho và suất ưu đãi', () => {
    expect(isCartFixableError('Sản phẩm "Dầu gội" không đủ tồn kho.')).toBe(true);
    expect(isCartFixableError('Hết suất ưu đãi.')).toBe(true);
    expect(isCartFixableError('Vượt giới hạn mua ưu đãi.')).toBe(true);
    expect(isCartFixableError('Địa chỉ không hợp lệ.')).toBe(false);
  });
  it('cartFixableNotice: FLASH_LIMIT nói giới hạn bằng câu của kế hoạch (limit thắng message), câu cũ giữ nguyên, lỗi khác là null', () => {
    const flash = Object.assign(new Error('Vượt giới hạn.'), { code: 'FLASH_LIMIT', limit: 2 });
    expect(cartFixableNotice(flash, 'Vượt giới hạn.')).toBe('Giá Giờ vàng chỉ áp cho 2 sản phẩm mỗi khách. Bạn giảm số lượng rồi đặt lại nhé.');
    const noLimit = Object.assign(new Error('x'), { code: 'FLASH_LIMIT' });
    expect(cartFixableNotice(noLimit, 'Giá Giờ vàng chỉ áp cho 3 sản phẩm mỗi khách. Bạn giảm số lượng rồi đặt lại nhé.')).toBe(
      'x',
    );
    expect(cartFixableNotice(new Error('Vượt giới hạn mua ưu đãi.'), 'Vượt giới hạn mua ưu đãi.')).toBe('Vượt giới hạn mua ưu đãi.');
    expect(cartFixableNotice(new Error('Địa chỉ không hợp lệ.'), 'Địa chỉ không hợp lệ.')).toBeNull();
    expect(cartFixableNotice(null, null)).toBeNull();
  });
  it('outOfStockLine chọn dòng đầu tiên vượt tồn hoặc hết hàng', () => {
    const items = [
      { id: 'a', productName: 'A', quantity: 1, stock: 5 },
      { id: 'b', productName: 'B', quantity: 3, stock: 2 },
      { id: 'c', productName: 'C', quantity: 1, stock: 0 },
    ];
    expect(outOfStockLine(items)?.id).toBe('b');
    expect(outOfStockLine(items.slice(0, 1))).toBeUndefined();
  });
});

describe('overStockMessage', () => {
  it('còn ít hơn số đặt → nói còn bao nhiêu; hết hàng → bảo bỏ khỏi giỏ', () => {
    expect(overStockMessage('Dầu gội', 2)).toBe('Sản phẩm "Dầu gội" chỉ còn 2 sản phẩm. Vui lòng sửa số lượng trong giỏ.');
    expect(overStockMessage('Dầu gội', 0)).toBe('Sản phẩm "Dầu gội" đã hết hàng. Vui lòng bỏ khỏi giỏ để đặt các món còn lại.');
  });
});
