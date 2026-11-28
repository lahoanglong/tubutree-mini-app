import { describe, expect, it } from 'vitest';
import { extraPlotsVisible, gameNewbieCopy, missingDrops, missionTarget } from './game-newbie';
import { gardenDayActions, gardenDayCopy, primaryWaterAction } from './game-primary-action';

const BASE = { totalSeeds: 0, checkedInToday: false, dewToday: false, dailyLoginSeeds: 15, dewSeeds: 15, firstCheckinBonus: 0 };

describe('primaryWaterAction', () => {
  it('lần điểm danh đầu: chỉ điểm danh, gồm quà người mới (65), chưa gộp sương', () => {
    expect(primaryWaterAction({ ...BASE, firstCheckinBonus: 50 })).toEqual({ kind: 'claim', first: true, withDew: false, gain: 65 });
  });
  it('ngày thường chưa nhận: điểm danh + sương = 30; sương đã hứng thì chỉ 15', () => {
    expect(primaryWaterAction(BASE)).toEqual({ kind: 'claim', first: false, withDew: true, gain: 30 });
    expect(primaryWaterAction({ ...BASE, dewToday: true })).toEqual({ kind: 'claim', first: false, withDew: false, gain: 15 });
  });
  it('xong nước nhưng Điểm Xanh còn thiếu: nút chính nhận nốt (không còn nút điểm danh thứ hai)', () => {
    expect(primaryWaterAction({ ...BASE, checkedInToday: true, pointsPending: true, totalSeeds: 65 })).toEqual({ kind: 'claim', first: false, withDew: false, gain: null, pointsOnly: true });
    expect(primaryWaterAction({ ...BASE, checkedInToday: true, pointsPending: false, totalSeeds: 65 })).toEqual({ kind: 'water', drops: 65 });
    expect(primaryWaterAction({ ...BASE, harvestReady: true, checkedInToday: true, pointsPending: true })).toEqual({ kind: 'harvest' });
  });
  it('bình đầy: gain null (không hứa +N💧); gần đầy: cắt theo chỗ trống; bình còn rộng: giữ nguyên', () => {
    expect(primaryWaterAction({ ...BASE, totalSeeds: 500, tankCapacity: 500 })).toMatchObject({ kind: 'claim', gain: null });
    expect(primaryWaterAction({ ...BASE, totalSeeds: 495, tankCapacity: 500 })).toMatchObject({ kind: 'claim', gain: 5 });
    expect(primaryWaterAction({ ...BASE, totalSeeds: 0, tankCapacity: 500 })).toMatchObject({ kind: 'claim', gain: 30 });
    expect(primaryWaterAction({ ...BASE, totalSeeds: 700, tankCapacity: 500 })).toMatchObject({ kind: 'claim', gain: null });
  });
  it('checkInSeeds (todayWater của trạng thái gộp) thay số suy từ hồ sơ: ngày 3 = 15 (+15 sương), ngày 7 = 30, quà đầu đã nằm sẵn trong số', () => {
    expect(primaryWaterAction({ ...BASE, checkInSeeds: 15 })).toMatchObject({ kind: 'claim', withDew: true, gain: 30 });
    expect(primaryWaterAction({ ...BASE, checkInSeeds: 30, dewToday: true })).toMatchObject({ kind: 'claim', withDew: false, gain: 30 });
    expect(primaryWaterAction({ ...BASE, checkInSeeds: 65, firstCheckinBonus: 50 })).toMatchObject({ kind: 'claim', first: true, gain: 65 });
  });
  it('checkInSeeds khi bình gần đầy: số API đã cắt theo chỗ trống, không vượt chỗ trống khi gộp sương; bình đầy thì không hứa', () => {
    expect(primaryWaterAction({ ...BASE, totalSeeds: 495, tankCapacity: 500, checkInSeeds: 5 })).toMatchObject({ kind: 'claim', gain: 5 });
    expect(primaryWaterAction({ ...BASE, totalSeeds: 500, tankCapacity: 500, checkInSeeds: 0 })).toMatchObject({ kind: 'claim', gain: null });
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

describe('cây đã đủ nước từ trước (B-107)', () => {
  it('harvestReady thắng mọi nút khác, kể cả khi bình dưới 20💧 hoặc chưa nhận nước hôm nay', () => {
    expect(primaryWaterAction({ ...BASE, harvestReady: true, totalSeeds: 0 })).toEqual({ kind: 'harvest' });
    expect(primaryWaterAction({ ...BASE, harvestReady: true, checkedInToday: true, totalSeeds: 5 })).toEqual({ kind: 'harvest' });
    expect(primaryWaterAction({ ...BASE, harvestReady: false, checkedInToday: true, totalSeeds: 5 })).toEqual({ kind: 'earn' });
  });
});

describe('hai nút Chăm vườn (gardenDayActions)', () => {
  it('chưa điểm danh: nút Điểm danh nhận nước, nút Tưới cây vẫn theo số giọt đang có (không bị điểm danh che)', () => {
    expect(gardenDayActions({ ...BASE, totalSeeds: 40 })).toEqual({
      water: { kind: 'water', drops: 40 },
      checkIn: { kind: 'claim', first: false, withDew: true, gain: 30 },
    });
    expect(gardenDayActions({ ...BASE, totalSeeds: 5 }).water).toEqual({ kind: 'earn' });
  });
  it('cây đã đủ nước: Tưới cây thành thu hoạch, Điểm danh vẫn còn nếu chưa nhận', () => {
    expect(gardenDayActions({ ...BASE, harvestReady: true })).toMatchObject({ water: { kind: 'harvest' }, checkIn: { kind: 'claim', gain: 30 } });
  });
  it('xong nước nhưng Điểm Xanh còn thiếu: Điểm danh nhận nốt phần điểm, Tưới cây không đổi', () => {
    expect(gardenDayActions({ ...BASE, checkedInToday: true, pointsPending: true, totalSeeds: 25 })).toEqual({
      water: { kind: 'water', drops: 25 },
      checkIn: { kind: 'claim', first: false, withDew: false, gain: null, pointsOnly: true },
    });
  });
  it('đã xong cả hai phần: không còn nút điểm danh để bấm', () => {
    expect(gardenDayActions({ ...BASE, checkedInToday: true, totalSeeds: 19 })).toEqual({ water: { kind: 'earn' }, checkIn: null });
  });
});

describe('lô phụ và số giọt thiếu', () => {
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
  it('nhãn hai nút và viên chuỗi ngày của Chăm vườn', () => {
    expect([gardenDayCopy.water, gardenDayCopy.checkIn]).toEqual(['Tưới cây', 'Điểm danh']);
    expect(gardenDayCopy.streak(12, 15)).toBe('🔥 Chuỗi 12 ngày · +15💧');
    expect(gardenDayCopy.streak(1250, null)).toBe('🔥 Chuỗi 1.250 ngày');
    expect(gardenDayCopy.streak(0, 65)).toBe('🔥 Bắt đầu chuỗi · +65💧');
  });
  it('báo trần mã tắt không hứa "mai/sang tháng có mã" (B-108)', () => {
    expect(gameNewbieCopy.harvest.capped.OFF).not.toMatch(/mai|sang tháng|tiếp/);
  });
  it('không còn chữ thuật ngữ điểm thường / điểm quy đổi (B-99)', () => {
    expect(JSON.stringify(gameNewbieCopy)).not.toMatch(/điểm thường|điểm quy đổi/i);
  });
});

describe('missionTarget', () => {
  it('map theo code, mã lạ không có đích', () => {
    expect(missionTarget('FIRST_ORDER')).toBe('catalog');
    expect(missionTarget('REVIEW_3')).toBe('delivered-orders');
    expect(missionTarget('INVITE_3')).toBe('invite');
    expect(missionTarget('CHECKIN_7')).toBe('checkin');
    expect(missionTarget('UNKNOWN')).toBeNull();
    expect(missionTarget('CUSTOM_AB12', 'ORDER_COUNT')).toBe('catalog');
    expect(missionTarget('CUSTOM_AB12', 'CHECKIN_STREAK')).toBe('checkin');
    expect(missionTarget('CUSTOM_AB12', 'WHATEVER')).toBeNull();
    expect(missionTarget('CUSTOM_AB12', 'toString')).toBeNull();
    expect(missionTarget('FIRST_ORDER', 'REVIEW_COUNT')).toBe('catalog');
    expect(missionTarget('toString')).toBeNull();
  });
});
