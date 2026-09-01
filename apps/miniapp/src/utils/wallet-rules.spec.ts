import { describe, it, expect } from 'vitest';
import { canWithdraw, canConvertToXu, type WithdrawBankInfo } from './wallet-rules';

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

describe('canConvertToXu', () => {
  it('số 0 hoặc âm → false', () => {
    expect(canConvertToXu(0, { walletBalance: 1_000_000 })).toBe(false);
    expect(canConvertToXu(-1, { walletBalance: 1_000_000 })).toBe(false);
  });

  it('vượt số dư ví → false', () => {
    expect(canConvertToXu(200_000, { walletBalance: 100_000 })).toBe(false);
  });

  it('hợp lệ → true', () => {
    expect(canConvertToXu(100_000, { walletBalance: 100_000 })).toBe(true);
  });
});
