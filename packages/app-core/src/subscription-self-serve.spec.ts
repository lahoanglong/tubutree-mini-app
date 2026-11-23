import { describe, expect, it } from 'vitest';
import {
  SUBSCRIPTION_SELF_SERVE_COPY,
  SUBSCRIPTION_SELF_SERVE_MAX,
  canActOnCycle,
  dayKeyText,
  isRescheduleDateAllowed,
  nextTierText,
  rescheduleOptions,
  rescheduleRange,
  runNowConfirmBody,
  runNowDoneText,
  runNowNextDay,
  selfServeCopy,
  skipDoneText,
  type SubscriptionSelfServeCopyKey,
} from './subscription-self-serve';

/** 23h40 ngày 20/10/2026 giờ VN (16:40 UTC): ngày VN khác ngày UTC chỉ khi qua 17h UTC, chọn giờ sát nửa đêm VN để bắt lệch múi giờ. */
const NOW = new Date('2026-10-20T16:40:00.000Z');

describe('chữ tự phục vụ gói định kỳ', () => {
  it('trần độ dài sau khi điền giá trị xấu nhất', () => {
    const vars = { date: '30/12/2026', code: 'TUBUSUB0123456789', n: 99, pct: 99, max: 90, name: 'x' };
    for (const key of Object.keys(SUBSCRIPTION_SELF_SERVE_COPY) as SubscriptionSelfServeCopyKey[]) {
      const max = SUBSCRIPTION_SELF_SERVE_MAX[key];
      if (max !== null) expect(selfServeCopy(key, vars).length, key).toBeLessThanOrEqual(max);
    }
  });
});

describe('dời ngày giao kỳ tới', () => {
  it('khoảng từ ngày mai tới 90 ngày theo ngày VN', () => {
    expect(rescheduleRange(NOW)).toEqual({ min: '2026-10-21', max: '2027-01-18' });
    expect(isRescheduleDateAllowed('2026-10-21', NOW)).toBe(true);
    expect(isRescheduleDateAllowed('2027-01-18', NOW)).toBe(true);
    expect(isRescheduleDateAllowed('2026-10-20', NOW)).toBe(false);
    expect(isRescheduleDateAllowed('2027-01-19', NOW)).toBe(false);
    expect(isRescheduleDateAllowed('2026-02-30', NOW)).toBe(false);
    expect(isRescheduleDateAllowed('', NOW)).toBe(false);
  });

  it('+7/+14 ngày tính từ ngày đang hẹn (0h VN lưu dưới dạng 17h UTC hôm trước)', () => {
    expect(rescheduleOptions('2026-11-02T17:00:00.000Z', NOW)).toEqual([
      { days: 7, date: '2026-11-10', allowed: true },
      { days: 14, date: '2026-11-17', allowed: true },
    ]);
  });

  it('kỳ đã đến hạn hay đang thử lại: tính từ hôm nay', () => {
    expect(rescheduleOptions('2026-10-01T17:00:00.000Z', NOW).map((o) => o.date)).toEqual(['2026-10-27', '2026-11-03']);
  });

  it('bước vượt 90 ngày thì khoá; ngày hẹn hỏng thì không có bước', () => {
    expect(rescheduleOptions('2027-01-10T17:00:00.000Z', NOW)).toEqual([
      { days: 7, date: '2027-01-18', allowed: true },
      { days: 14, date: '2027-01-25', allowed: false },
    ]);
    expect(rescheduleOptions('hỏng', NOW)).toEqual([]);
  });
});

describe('Đặt kỳ này ngay', () => {
  it('kỳ sau = hôm nay giờ VN + chu kỳ', () => {
    expect(runNowNextDay(4, NOW)).toBe('2026-11-17');
    expect(runNowConfirmBody({ productName: 'Nước giặt Fuwa3e 3,8L', intervalWeeks: 6 }, NOW)).toBe(
      'Tubu tạo đơn Nước giặt Fuwa3e 3,8L ngay, giá định kỳ như mọi kỳ. Kỳ kế giao ngày 01/12/2026.',
    );
  });

  it('lời báo: đơn chờ chuyển khoản nhắc chuyển khoản', () => {
    expect(runNowDoneText({ code: 'S1', status: 'CONFIRMED' })).toBe('Đã đặt đơn S1, Tubu giao sớm nhé');
    expect(runNowDoneText({ code: 'S2', status: 'PENDING_PAYMENT' })).toBe('Đã tạo đơn S2, bạn chuyển khoản để Tubu giao nhé');
  });

  it('chỉ gói đang chạy', () => {
    expect(canActOnCycle({ status: 'ACTIVE' })).toBe(true);
    expect(canActOnCycle({ status: 'PAUSED' })).toBe(false);
  });
});

describe('lời báo bỏ qua kỳ', () => {
  it('nêu ngày kỳ kế theo giờ VN; thiếu ngày thì chỉ câu đầu', () => {
    expect(skipDoneText('2026-11-30T17:00:00.000Z')).toBe('Đã bỏ qua kỳ này, lần kế 01/12/2026');
    expect(skipDoneText(undefined)).toBe('Đã bỏ qua kỳ này');
    expect(dayKeyText('2026-12-01')).toBe('01/12/2026');
  });
});

describe('viên bậc giảm kế tiếp', () => {
  it('đọc nextTier của gói đầu', () => {
    expect(nextTierText([{ nextTier: { countNeeded: 2, discountPct: 0.14 } }, { nextTier: null }])).toBe('Thêm 2 gói định kỳ để được giảm 14%');
  });

  it('không có, API cũ hay số hỏng: null', () => {
    expect(nextTierText([])).toBeNull();
    expect(nextTierText([{}])).toBeNull();
    expect(nextTierText([{ nextTier: null }])).toBeNull();
    expect(nextTierText([{ nextTier: { countNeeded: 0, discountPct: 0.14 } }])).toBeNull();
    expect(nextTierText([{ nextTier: { countNeeded: 1.5, discountPct: 0.14 } }])).toBeNull();
    expect(nextTierText([{ nextTier: { countNeeded: 2, discountPct: 14 } }])).toBeNull();
  });
});
