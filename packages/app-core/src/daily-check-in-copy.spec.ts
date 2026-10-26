import { describe, expect, it } from 'vitest';
import { checkInDayIcon, checkInSuccessText, checkInTodayLine } from './daily-check-in-copy';
import type { CheckInResult } from './api/loyalty';

const pts = { success: true, cycleDay: 1, streakDays: 1, pointsEarned: 1000, totalPoints: 1000, message: '' };
const water = { seedsEarned: 10, streakDays: 1, totalSeeds: 10, streakFrozeUsed: false, bonusNote: '' };
const res = (over: Partial<CheckInResult>): CheckInResult => ({ points: pts, water, alreadyDone: false, pending: [], ...over });

describe('checkInSuccessText', () => {
  it('cả hai phần: "+N Điểm Xanh · +M giọt nước"', () => {
    expect(checkInSuccessText(res({}))).toBe('+1.000 Điểm Xanh · +10 giọt nước');
  });
  it('bên đã xong từ trước không nhắc lại', () => {
    expect(checkInSuccessText(res({ points: null }))).toBe('+10 giọt nước');
    expect(checkInSuccessText(res({ water: null }))).toBe('+1.000 Điểm Xanh');
  });
  it('kèm vé giữ lửa và ghi chú mốc chuỗi', () => {
    const t = checkInSuccessText(res({ water: { ...water, streakFrozeUsed: true, bonusNote: '+5 💧 chuỗi 3 ngày!' } }));
    expect(t).toBe('+1.000 Điểm Xanh · +10 giọt nước · đã dùng vé giữ lửa · +5 💧 chuỗi 3 ngày!');
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
