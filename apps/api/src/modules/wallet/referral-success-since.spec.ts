import { referralSuccessesSince } from './referral-reward';

const at = (d: number) => new Date(Date.UTC(2026, 9, d));
const row = (reason: string, d: number) => ({ reason, createdAt: at(d) });

describe('referralSuccessesSince', () => {
  const rows = [
    row('REFERRAL_ORDER2:old', 1),
    row('REFERRAL_ORDER2_REVOKE:old', 12),
    row('REFERRAL_ORDER2:new', 11),
    row('REFERRAL_CASHBACK:legacy', 2),
  ];

  it('không có mốc: thưởng trừ thu hồi như cũ', () => {
    expect(referralSuccessesSince(rows, null)).toBe(2);
  });

  it('có mốc: thu hồi lượt cấp trước mốc không trừ vào lượt cấp sau mốc', () => {
    expect(referralSuccessesSince(rows, at(10))).toBe(1);
  });

  it('thu hồi chính lượt cấp sau mốc thì trừ', () => {
    expect(referralSuccessesSince([row('REFERRAL_ORDER2:a', 11), row('REFERRAL_ORDER2_REVOKE:a', 12)], at(10))).toBe(0);
  });
});
