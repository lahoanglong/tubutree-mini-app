import { describe, expect, it } from 'vitest';
import { fakeHttp } from './fake-http';
import { EXTERNAL_CLAIM_REJECT_CODES, externalClaimRejectCode, getMyExternalClaims, phoneConfirmPrompt, retryExternalClaimPhone, submitExternalClaim } from './external-points';

describe('external-points — hợp đồng gọi API', () => {
  it('gửi mã và xem lịch sử (mặc định trang 1, 10 dòng)', async () => {
    const { http, calls } = fakeHttp();
    await submitExternalClaim(http, 'SPXVN123');
    await submitExternalClaim(http, 'SPXVN124', 'scan');
    await submitExternalClaim(http, 'SPXVN125', 'typed', '8326');
    await getMyExternalClaims(http);
    await getMyExternalClaims(http, 3, 5);
    expect(calls).toEqual([
      { method: 'post', path: '/me/external-points/claims', body: { code: 'SPXVN123' } },
      { method: 'post', path: '/me/external-points/claims', body: { code: 'SPXVN124', via: 'scan' } },
      { method: 'post', path: '/me/external-points/claims', body: { code: 'SPXVN125', via: 'typed', recipientPhoneLast4: '8326' } },
      { method: 'get', path: '/me/external-points/claims', opts: { query: { page: 1, limit: 10 } } },
      { method: 'get', path: '/me/external-points/claims', opts: { query: { page: 3, limit: 5 } } },
    ]);
  });
  it('W59: nhập lại 4 số cuối từ dòng lịch sử gửi đúng một khoá (claimId hoặc attemptId)', async () => {
    const { http, calls } = fakeHttp();
    await retryExternalClaimPhone(http, { claimId: 'c1' }, '8326');
    await retryExternalClaimPhone(http, { attemptId: 'a1' }, '0011');
    expect(calls).toEqual([
      { method: 'post', path: '/me/external-points/claims/phone-retry', body: { claimId: 'c1', recipientPhoneLast4: '8326' } },
      { method: 'post', path: '/me/external-points/claims/phone-retry', body: { attemptId: 'a1', recipientPhoneLast4: '0011' } },
    ]);
  });
});

describe('externalClaimRejectCode', () => {
  it('nhận mọi mã từ chối đã biết', () => {
    for (const c of EXTERNAL_CLAIM_REJECT_CODES) expect(externalClaimRejectCode(c)).toBe(c);
    expect(EXTERNAL_CLAIM_REJECT_CODES).toHaveLength(18);
  });
  it('mã lạ, rỗng, null đều trả undefined', () => {
    expect(externalClaimRejectCode('WHATEVER')).toBeUndefined();
    expect(externalClaimRejectCode('')).toBeUndefined();
    expect(externalClaimRejectCode(null)).toBeUndefined();
    expect(externalClaimRejectCode(undefined)).toBeUndefined();
  });
});

describe('phoneConfirmPrompt (W46)', () => {
  it('đọc mã, sàn và lượt còn lại của PHONE_CONFIRM_*', () => {
    expect(phoneConfirmPrompt({ code: 'PHONE_CONFIRM_REQUIRED', channel: 'shopee', requiredDigits: 4 })).toEqual({ code: 'PHONE_CONFIRM_REQUIRED', channel: 'shopee', remainingAttempts: null });
    expect(phoneConfirmPrompt({ code: 'PHONE_CONFIRM_WRONG', channel: 'lazada', remainingAttempts: 2 })).toEqual({ code: 'PHONE_CONFIRM_WRONG', channel: 'lazada', remainingAttempts: 2 });
    expect(phoneConfirmPrompt({ code: 'PHONE_CONFIRM_LOCKED', channel: null, remainingAttempts: 0 })).toEqual({ code: 'PHONE_CONFIRM_LOCKED', channel: null, remainingAttempts: 0 });
  });
  it('mã khác, thân rỗng hay giá trị lạ: null hoặc bỏ phần lạ', () => {
    expect(phoneConfirmPrompt({ code: 'PHONE_MISMATCH' })).toBeNull();
    expect(phoneConfirmPrompt(null)).toBeNull();
    expect(phoneConfirmPrompt('PHONE_CONFIRM_REQUIRED')).toBeNull();
    expect(phoneConfirmPrompt({ code: 'PHONE_CONFIRM_WRONG', channel: '<b>Shopee</b>', remainingAttempts: -1 })).toEqual({ code: 'PHONE_CONFIRM_WRONG', channel: null, remainingAttempts: null });
  });
});
