import { describe, it, expect } from 'vitest';
import * as walletRules from './wallet-rules';
import { canWithdraw, walletTxLabel, formatWalletTxTime, type WithdrawBankInfo } from './wallet-rules';

const validBank: WithdrawBankInfo = {
  bankName: 'Vietcombank',
  accountNumber: '0123456789',
  accountName: 'NGUYEN VAN A',
};

describe('canWithdraw', () => {
  it('dưới mức rút tối thiểu → false', () => {
    expect(canWithdraw(50_000, { walletBalance: 1_000_000 }, 100_000, validBank)).toBe(false);
  });

  it('vượt số dư ví → false', () => {
    expect(canWithdraw(200_000, { walletBalance: 100_000 }, 100_000, validBank)).toBe(false);
  });

  it('chưa có dữ liệu ví (undefined) → false', () => {
    expect(canWithdraw(200_000, undefined, 100_000, validBank)).toBe(false);
  });

  it('thiếu/ngắn thông tin ngân hàng → false', () => {
    expect(canWithdraw(200_000, { walletBalance: 1_000_000 }, 100_000, { ...validBank, accountNumber: '123' })).toBe(
      false,
    );
    expect(canWithdraw(200_000, { walletBalance: 1_000_000 }, 100_000, { ...validBank, bankName: '' })).toBe(false);
  });

  it('đủ điều kiện (≥min, ≤số dư, đủ thông tin NH) → true', () => {
    expect(canWithdraw(200_000, { walletBalance: 1_000_000 }, 100_000, validBank)).toBe(true);
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
    expect(walletTxLabel('ORDER_PAY')).toBe('Thanh toán đơn hàng');
    expect(walletTxLabel('ORDER_REFUND')).toBe('Hoàn tiền đơn hàng');
    expect(walletTxLabel('WITHDRAW')).toBe('Rút về ngân hàng');
    expect(walletTxLabel('WITHDRAW_REFUND')).toBe('Hoàn lệnh rút bị từ chối');
    // Dòng sao kê cũ của lần đổi Ví → xu trước khi xu gộp vào Điểm Xanh.
    expect(walletTxLabel('XU_CONVERT')).toBe('Đổi sang xu cũ (nay là Điểm Xanh)');
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
