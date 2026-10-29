import { describe, expect, it } from 'vitest';
import { checkInCopy, checkInDayAria, checkInDayIcon, checkInRule, checkInSuccessText, checkInTodayLine } from './daily-check-in-copy';
import type { CheckInResult } from './api/loyalty';

const pts = { success: true, cycleDay: 1, streakDays: 1, pointsEarned: 1000, totalPoints: 1000, message: '' };
const water = { seedsEarned: 10, streakDays: 1, totalSeeds: 10, streakFrozeUsed: false, bonusNote: '' };
const res = (over: Partial<CheckInResult>): CheckInResult => ({ points: pts, water, alreadyDone: false, pending: [], ...over });

describe('checkInSuccessText', () => {
  it('bình đầy (seedsEarned 0): không hiện ghi chú thưởng nước dù server lỡ trả', () => {
    const t = checkInSuccessText(res({ water: { ...water, seedsEarned: 0, bonusNote: '+5 💧 chuỗi 3 ngày!' } }));
    expect(t).toBe('+1.000 Điểm Xanh');
    expect(t).not.toContain('chuỗi 3 ngày');
  });

  it('cả hai phần: "+N Điểm Xanh · +M giọt nước"', () => {
    expect(checkInSuccessText(res({}))).toBe('+1.000 Điểm Xanh · +10 giọt nước');
  });
  it('bên đã xong từ trước không nhắc lại', () => {
    expect(checkInSuccessText(res({ points: null }))).toBe('+10 giọt nước');
    expect(checkInSuccessText(res({ water: null }))).toBe('+1.000 Điểm Xanh');
  });
  it('kèm vé giữ lửa và ghi chú mốc chuỗi', () => {
    const t = checkInSuccessText(res({ water: { ...water, streakFrozeUsed: true, bonusNote: '+5 💧 chuỗi 3 ngày!' } }));
    expect(t).toBe('+1.000 Điểm Xanh · +10 giọt nước (+5 💧 chuỗi 3 ngày) · đã dùng vé giữ lửa');
  });
  it('quà lần đầu nằm trong tổng: ghi tổng trước, khoản thưởng trong ngoặc (không hiểu thành 110)', () => {
    const t = checkInSuccessText(res({ points: null, water: { ...water, seedsEarned: 60, bonuses: [{ seeds: 50, label: 'quà điểm danh đầu tiên' }], bonusNote: '+50 💧 quà điểm danh đầu tiên!' } }));
    expect(t).toBe('+60 giọt nước (gồm 50 quà điểm danh đầu tiên)');
    expect(t).not.toContain('110');
  });
  it('đã xong cả hai: báo đã điểm danh, không lỗi', () => {
    expect(checkInSuccessText(res({ points: null, water: null, alreadyDone: true }))).toBe('Hôm nay bạn đã điểm danh rồi');
  });
  it('0 điểm vẫn báo thành công', () => {
    expect(checkInSuccessText(res({ points: { ...pts, pointsEarned: 0 }, water: null }))).toBe('Điểm danh thành công!');
  });
  it('còn phần thiếu thì nhắc bấm lại', () => {
    expect(checkInSuccessText(res({ water: null, pending: ['water'] }))).toBe('+1.000 Điểm Xanh. Còn thiếu một phần, bấm điểm danh lại để nhận nốt');
  });
});

describe('checkInTodayLine', () => {
  it('ghi điểm và nước hôm nay; đã điểm danh hoặc thiếu số thì bỏ', () => {
    expect(checkInTodayLine({ checkedInToday: false, todayPoints: 1000, todayWater: 10 })).toBe('Hôm nay nhận +1.000 Điểm Xanh · +10 giọt nước');
    expect(checkInTodayLine({ checkedInToday: false, todayPoints: 1000, todayWater: 0 })).toBe('Hôm nay nhận +1.000 Điểm Xanh');
    // Nửa vời: chỉ liệt kê phần còn thiếu, dù server còn trả số của phần đã xong.
    expect(checkInTodayLine({ checkedInToday: false, pointsDone: true, waterDone: false, todayPoints: 1000, todayWater: 10 })).toBe('Hôm nay nhận +10 giọt nước');
    expect(checkInTodayLine({ checkedInToday: false, pointsDone: false, waterDone: true, todayPoints: 1000, todayWater: 10 })).toBe('Hôm nay nhận +1.000 Điểm Xanh');
    // Bình đầy: không hứa giọt nước.
    expect(checkInTodayLine({ checkedInToday: false, pointsDone: false, waterDone: false, tankFull: true, todayPoints: 1000, todayWater: 0 })).toBe('Hôm nay nhận +1.000 Điểm Xanh. Bình nước đang đầy nên không cộng thêm giọt nước.');
    expect(checkInTodayLine({ checkedInToday: false, pointsDone: true, waterDone: false, tankFull: true, todayPoints: 0, todayWater: 0 })).toBe('Bình nước đang đầy nên không cộng thêm giọt nước.');
    expect(checkInTodayLine({ checkedInToday: false, pointsDone: false, waterDone: true, todayPoints: 1000, todayWater: 0 })).toBe('Hôm nay nhận +1.000 Điểm Xanh');
    // todayWater = 0 do cấu hình thưởng ngày = 0 (bình chưa đầy), hoặc API cũ không trả tankFull: không nói bình đầy.
    expect(checkInTodayLine({ checkedInToday: false, pointsDone: false, waterDone: false, tankFull: false, todayPoints: 1000, todayWater: 0 })).toBe('Hôm nay nhận +1.000 Điểm Xanh');
    expect(checkInTodayLine({ checkedInToday: false, pointsDone: true, waterDone: false, todayPoints: 0, todayWater: 0 })).toBeNull();
    expect(checkInTodayLine({ checkedInToday: true, todayPoints: 1000, todayWater: 10 })).toBeNull();
    expect(checkInTodayLine({ checkedInToday: false })).toBeNull();
  });
});

describe('checkInDayIcon', () => {
  it('đã nhận → dấu tích; ngày 7 → quà; còn lại → mầm', () => {
    expect(checkInDayIcon(3, true)).toBe('check');
    expect(checkInDayIcon(7, false)).toBe('gift');
    expect(checkInDayIcon(2, false)).toBe('sprout');
  });
});

describe('khách vãng lai (pointsBlocked = GUEST): không hứa Điểm Xanh', () => {
  const guestPts = { ...pts, pointsEarned: 0, totalPoints: 0, pointsBlocked: 'GUEST' as const };

  it('báo sau khi bấm: chỉ giọt nước, kèm câu đăng nhập Zalo để nhận Điểm Xanh', () => {
    expect(checkInSuccessText(res({ points: guestPts }))).toBe('+10 giọt nước. Đăng nhập Zalo để nhận Điểm Xanh');
  });
  it('phần nước đã xong từ trước: vẫn báo thành công và câu đăng nhập, không chữ "+0 Điểm Xanh"', () => {
    const t = checkInSuccessText(res({ points: guestPts, water: null }));
    expect(t).toBe('Điểm danh thành công. Đăng nhập Zalo để nhận Điểm Xanh');
    expect(t).not.toContain('+0');
  });
  it('còn phần thiếu thì vẫn nhắc bấm lại sau câu đăng nhập', () => {
    expect(checkInSuccessText(res({ points: guestPts, water: null, pending: ['water'] }))).toBe(
      'Điểm danh thành công. Đăng nhập Zalo để nhận Điểm Xanh. Còn thiếu một phần, bấm điểm danh lại để nhận nốt',
    );
  });
  it('user thật không có cờ: câu báo không đổi', () => {
    expect(checkInSuccessText(res({}))).toBe('+1.000 Điểm Xanh · +10 giọt nước');
  });

  it('dòng "Hôm nay nhận": chỉ giọt nước dù API còn trả todayPoints', () => {
    expect(checkInTodayLine({ checkedInToday: false, pointsBlocked: 'GUEST', todayPoints: 1000, todayWater: 10 })).toBe('Hôm nay nhận +10 giọt nước');
    expect(checkInTodayLine({ checkedInToday: false, pointsBlocked: 'GUEST', todayPoints: 0, todayWater: 0 })).toBeNull();
  });

  it('nhãn đọc màn hình của ô ngày không có điểm; thể lệ không nhắc Điểm Xanh', () => {
    expect(checkInDayAria({ pointsBlocked: 'GUEST' }, { day: 3, points: 1000, claimed: true })).toBe('Ngày 3, đã nhận');
    expect(checkInDayAria({ pointsBlocked: 'GUEST' }, { day: 4, points: 1000, claimed: false })).toBe('Ngày 4');
    expect(checkInDayAria({}, { day: 3, points: 1000, claimed: true })).toBe('Ngày 3: +1.000 Điểm Xanh, đã nhận');
    expect(checkInRule({ pointsBlocked: 'GUEST' })).not.toContain('Điểm Xanh');
    expect(checkInRule({})).toBe(checkInCopy.rule);
  });

  it('câu mời đăng nhập ngắn, đúng chữ chủ chốt', () => {
    expect(checkInCopy.guestPoints).toBe('Đăng nhập Zalo để nhận Điểm Xanh');
    expect(checkInCopy.guestCta).toBe('Đăng nhập Zalo');
  });
});
