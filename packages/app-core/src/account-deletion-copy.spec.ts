import { describe, expect, it } from 'vitest';
import { WALLET_FORFEIT_AGREE, canSubmitDeletion, walletForfeitConsent, walletForfeitNotice } from './account-deletion-copy';

describe('account-deletion-copy', () => {
  it('câu báo số dư mất, đúng chữ chủ chốt', () => {
    expect(walletForfeitNotice('20.000đ')).toBe('Ví Tubu còn 20.000đ. Xoá tài khoản thì số dư này mất và không hoàn lại.');
    expect(WALLET_FORFEIT_AGREE).toContain('đồng ý bỏ số dư Ví Tubu');
  });

  it('gói đồng ý chỉ có khi Ví còn tiền và khách đã tick; mang đúng số dư đã thấy', () => {
    expect(walletForfeitConsent(20000, true)).toEqual({ acknowledgedWalletBalance: 20000, acceptWalletForfeit: true });
    expect(walletForfeitConsent(20000, false)).toBeUndefined();
    expect(walletForfeitConsent(0, true)).toBeUndefined();
    expect(walletForfeitConsent(undefined, true)).toBeUndefined();
  });

  it('nút gửi: cần biết số dư; Ví còn tiền thì phải tick; Ví 0 (hoặc âm) gửi được', () => {
    expect(canSubmitDeletion(undefined, true)).toBe(false);
    expect(canSubmitDeletion(20000, false)).toBe(false);
    expect(canSubmitDeletion(20000, true)).toBe(true);
    expect(canSubmitDeletion(0, false)).toBe(true);
    expect(canSubmitDeletion(-500, false)).toBe(true);
  });
});
