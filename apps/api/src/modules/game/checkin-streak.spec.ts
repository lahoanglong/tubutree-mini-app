import { planCheckInSeeds, projectCheckIn, streakCycleDay } from './checkin-streak';

const T = '2026-10-28';
const at = (key: string) => new Date(`${key}T05:00:00Z`); // 12:00 giờ VN

describe('streakCycleDay', () => {
  it('chuỗi 1..7 là ngày 1..7, chuỗi 8 quay về ngày 1', () => {
    expect([1, 2, 3, 4, 5, 6, 7, 8, 14, 15].map(streakCycleDay)).toEqual([1, 2, 3, 4, 5, 6, 7, 1, 7, 1]);
  });
});

describe('projectCheckIn (một chuỗi chung của Điểm Xanh và giọt nước)', () => {
  it('chưa từng điểm danh: chuỗi 1, chưa sống', () => {
    expect(projectCheckIn(null, T)).toMatchObject({ doneToday: false, gapDays: null, streakDays: 1, aliveStreak: 0 });
  });
  it('đã điểm danh hôm nay: giữ nguyên chuỗi hôm nay', () => {
    expect(projectCheckIn({ lastCheckInAt: at(T), streakDays: 3, streakFreezes: 0 }, T)).toMatchObject({ doneToday: true, streakDays: 3, aliveStreak: 3 });
  });
  it('hôm qua điểm danh: chuỗi +1', () => {
    expect(projectCheckIn({ lastCheckInAt: at('2026-10-27'), streakDays: 3, streakFreezes: 0 }, T)).toMatchObject({ streakDays: 4, usesFreeze: false, aliveStreak: 3, gapDays: 1 });
  });
  it('lỡ đúng 1 ngày có vé giữ lửa: giữ chuỗi, tiêu vé', () => {
    expect(projectCheckIn({ lastCheckInAt: at('2026-10-26'), streakDays: 3, streakFreezes: 1 }, T)).toMatchObject({ streakDays: 4, usesFreeze: true, aliveStreak: 3 });
  });
  it('lỡ 1 ngày không có vé: về ngày 1', () => {
    expect(projectCheckIn({ lastCheckInAt: at('2026-10-26'), streakDays: 3, streakFreezes: 0 }, T)).toMatchObject({ streakDays: 1, usesFreeze: false, aliveStreak: 0 });
  });
  it('lỡ 2 ngày trở lên: về ngày 1 dù có vé', () => {
    expect(projectCheckIn({ lastCheckInAt: at('2026-10-25'), streakDays: 9, streakFreezes: 3 }, T)).toMatchObject({ streakDays: 1, usesFreeze: false, aliveStreak: 0 });
  });
  it('đếm ngày theo giờ VN: 23:30 VN hôm qua (16:30Z) vẫn là "hôm qua"', () => {
    expect(projectCheckIn({ lastCheckInAt: new Date('2026-10-27T16:30:00Z'), streakDays: 2, streakFreezes: 0 }, T)).toMatchObject({ doneToday: false, gapDays: 1, streakDays: 3 });
    expect(projectCheckIn({ lastCheckInAt: new Date('2026-10-27T17:30:00Z'), streakDays: 2, streakFreezes: 0 }, T)).toMatchObject({ doneToday: true });
  });
});

describe('planCheckInSeeds', () => {
  const config = { get: jest.fn(async (_k: string, def: unknown) => def) } as never;
  it('ngày thường chỉ có phần gốc; ngày 3 +5; ngày 7 +thưởng mốc; ngày 14 cũng là mốc 7', async () => {
    const base = { first: false, gapDays: 1 };
    expect((await planCheckInSeeds(config, { ...base, streakDays: 2 })).seeds).toBe(10);
    expect((await planCheckInSeeds(config, { ...base, streakDays: 3 })).seeds).toBe(15);
    expect((await planCheckInSeeds(config, { ...base, streakDays: 7 })).seeds).toBe(30);
    expect((await planCheckInSeeds(config, { ...base, streakDays: 14 })).seeds).toBe(30);
  });
  it('lần đầu cộng quà đầu tiên; quay lại sau ngưỡng cộng quà quay lại; không cộng dồn hai quà', async () => {
    expect(await planCheckInSeeds(config, { first: true, gapDays: null, streakDays: 1 })).toMatchObject({ seeds: 60 });
    expect(await planCheckInSeeds(config, { first: false, gapDays: 7, streakDays: 1 })).toMatchObject({ seeds: 70 });
    expect(await planCheckInSeeds(config, { first: false, gapDays: 6, streakDays: 1 })).toMatchObject({ seeds: 10 });
  });
});
