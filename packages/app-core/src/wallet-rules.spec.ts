import { describe, it, expect } from 'vitest';
import * as walletRules from './wallet-rules';
import { walletTxLabel, formatWalletTxTime } from './wallet-rules';

describe('rút Ví về ngân hàng đã bỏ', () => {
  it('không còn quy tắc rút', () => {
    expect(walletRules).not.toHaveProperty('canWithdraw');
  });
});

describe('đổi Ví sang xu đã ngừng (PD-3)', () => {
  it('không còn quy tắc đổi Ví → xu', () => {
    expect(walletRules).not.toHaveProperty('canConvertToXu');
  });
});

describe('walletTxLabel (sao kê Ví)', () => {
  it('mỗi loại biến động có nhãn tiếng Việt riêng', () => {
    expect(walletTxLabel('OPENING')).toBe('Số dư đầu kỳ');
    expect(walletTxLabel('ORDER_PAY')).toBe('Thanh toán đơn');
    expect(walletTxLabel('ORDER_REFUND')).toBe('Hoàn tiền đơn hàng');
    expect(walletTxLabel('WITHDRAW')).toBe('Rút về ngân hàng');
    expect(walletTxLabel('WITHDRAW_REFUND')).toBe('Hoàn lệnh rút bị từ chối');
    expect(walletTxLabel('PIT_REFUND')).toBe('Hoàn thuế TNCN giữ dư');
    // Dòng sao kê cũ của lần đổi Ví → xu trước khi xu gộp vào Điểm Xanh.
    expect(walletTxLabel('XU_CONVERT')).toBe('Đổi sang xu cũ (nay là Điểm Xanh)');
  });

  it('ORDER_REFUND tách theo nguồn từ lời reason API ghi', () => {
    expect(walletTxLabel('ORDER_REFUND', 'Hoàn tiền trả hàng đơn TT001')).toBe('Hoàn tiền trả hàng');
    expect(walletTxLabel('ORDER_REFUND', 'Hoàn tiền đơn TT002')).toBe('Hoàn tiền đơn hàng');
    expect(walletTxLabel('ORDER_REFUND', 'lý do lạ')).toBe('Hoàn tiền đơn hàng');
    expect(walletTxLabel('ORDER_REFUND', null)).toBe('Hoàn tiền đơn hàng');
    expect(walletTxLabel('ORDER_PAY', 'Thanh toán đơn TT003')).toBe('Thanh toán đơn');
  });

  it('loại mới BE thêm sau mà FE chưa biết → nhãn chung, không vỡ màn', () => {
    expect(walletTxLabel('SOMETHING_NEW')).toBe('Biến động ví');
  });
});

describe('formatWalletTxTime', () => {
  it('dd/MM HH:mm theo giờ máy', () => {
    const d = new Date(2026, 9, 5, 8, 7);
    expect(formatWalletTxTime(d.toISOString())).toBe('05/10 08:07');
  });
});
