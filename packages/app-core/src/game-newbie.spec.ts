import { describe, expect, it } from 'vitest';
import { extraPlotsVisible, gameNewbieCopy, missingDrops, missionTarget, primaryWaterAction, tutorialState } from './game-newbie';

const BASE = { totalSeeds: 0, checkedInToday: false, dewToday: false, dailyLoginSeeds: 15, dewSeeds: 15, firstCheckinBonus: 0 };

describe('primaryWaterAction', () => {
  it('lần điểm danh đầu: chỉ điểm danh, gồm quà người mới (65), chưa gộp sương', () => {
    expect(primaryWaterAction({ ...BASE, firstCheckinBonus: 50 })).toEqual({ kind: 'claim', first: true, withDew: false, gain: 65 });
  });
  it('ngày thường chưa nhận: điểm danh + sương = 30; sương đã hứng thì chỉ 15', () => {
    expect(primaryWaterAction(BASE)).toEqual({ kind: 'claim', first: false, withDew: true, gain: 30 });
    expect(primaryWaterAction({ ...BASE, dewToday: true })).toEqual({ kind: 'claim', first: false, withDew: false, gain: 15 });
  });
  it('bình đầy: gain null (không hứa +N💧); gần đầy: cắt theo chỗ trống; bình còn rộng: giữ nguyên', () => {
    expect(primaryWaterAction({ ...BASE, totalSeeds: 500, tankCapacity: 500 })).toMatchObject({ kind: 'claim', gain: null });
    expect(primaryWaterAction({ ...BASE, totalSeeds: 495, tankCapacity: 500 })).toMatchObject({ kind: 'claim', gain: 5 });
    expect(primaryWaterAction({ ...BASE, totalSeeds: 0, tankCapacity: 500 })).toMatchObject({ kind: 'claim', gain: 30 });
    expect(primaryWaterAction({ ...BASE, totalSeeds: 700, tankCapacity: 500 })).toMatchObject({ kind: 'claim', gain: null });
  });
  it('API cũ không có số: gain null', () => {
    expect(primaryWaterAction({ ...BASE, dailyLoginSeeds: undefined })).toMatchObject({ kind: 'claim', gain: null });
  });
  it('đã nhận: từ 20💧 tưới hết, dưới 20 thì mở sheet kiếm nước', () => {
    expect(primaryWaterAction({ ...BASE, checkedInToday: true, totalSeeds: 65 })).toEqual({ kind: 'water', drops: 65 });
    expect(primaryWaterAction({ ...BASE, checkedInToday: true, totalSeeds: 20 })).toEqual({ kind: 'water', drops: 20 });
    expect(primaryWaterAction({ ...BASE, checkedInToday: true, totalSeeds: 19 })).toEqual({ kind: 'earn' });
    expect(primaryWaterAction({ ...BASE, checkedInToday: true, totalSeeds: Number.NaN })).toEqual({ kind: 'earn' });
  });
});

describe('thẻ 3 bước và lô phụ', () => {
  it('bước theo dữ liệu, tự ẩn khi bấm "Đã hiểu"', () => {
    expect(tutorialState({ lastCheckInAt: null, treesPlanted: 0, dismissed: false })).toMatchObject({ visible: true, current: 1 });
    expect(tutorialState({ lastCheckInAt: 'x', treesPlanted: 0, dismissed: false })).toMatchObject({ current: 2 });
    expect(tutorialState({ lastCheckInAt: 'x', treesPlanted: 1, dismissed: false })).toMatchObject({ current: 3, done: [true, true, false] });
    expect(tutorialState({ lastCheckInAt: 'x', treesPlanted: 1, dismissed: true }).visible).toBe(false);
  });
  it('lô phụ hiện từ cây thứ 2 hoặc khi đã có lô phụ', () => {
    expect(extraPlotsVisible(1, false)).toBe(false);
    expect(extraPlotsVisible(2, false)).toBe(true);
    expect(extraPlotsVisible(0, true)).toBe(true);
  });
  it('missingDrops', () => {
    expect(missingDrops(5, 40)).toBe(35);
    expect(missingDrops(50, 40)).toBe(0);
  });
});

describe('chữ dùng chung', () => {
  it('không còn lời hứa mất tiến độ', () => {
    expect(JSON.stringify(gameNewbieCopy)).not.toMatch(/chết|từ đầu|héo úa/);
  });
  it('nhãn nút chính', () => {
    expect(gameNewbieCopy.primary.claim(30)).toBe('Nhận nước hôm nay (+30💧)');
    expect(gameNewbieCopy.primary.claimFirst(65)).toBe('Điểm danh nhận 65💧');
    expect(gameNewbieCopy.primary.water(1250)).toBe('Tưới hết (1.250💧)');
  });
});

describe('missionTarget', () => {
  it('map theo code, mã lạ không có đích', () => {
    expect(missionTarget('FIRST_ORDER')).toBe('catalog');
    expect(missionTarget('REVIEW_3')).toBe('delivered-orders');
    expect(missionTarget('INVITE_3')).toBe('invite');
    expect(missionTarget('CHECKIN_7')).toBe('checkin');
    expect(missionTarget('UNKNOWN')).toBeNull();
    expect(missionTarget('toString')).toBeNull();
  });
});
