import { DAILY_MISSION_IDS, type DailyMissionId } from '@tubutree/shared-types';
import { vnDateKey } from '../../../common/vn-time';
import { dailyMissionPool, pickDailyMissions, readEngagementFlag } from './daily-missions';

const FULL = dailyMissionPool(true);
const NO_QUIZ = dailyMissionPool(false);

describe('pickDailyMissions: 3 nhiệm vụ mỗi ngày, ổn định theo khách và ngày VN', () => {
  it('cùng khách cùng ngày luôn ra cùng 3 nhiệm vụ, nằm trong rổ, theo thứ tự cố định của DAILY_MISSION_IDS', () => {
    const a = pickDailyMissions('user-1', '2026-11-17', FULL);
    expect(pickDailyMissions('user-1', '2026-11-17', FULL)).toEqual(a);
    expect(a).toHaveLength(3);
    expect(new Set(a).size).toBe(3);
    for (const id of a) expect(FULL).toContain(id);
    const order = a.map((id) => DAILY_MISSION_IDS.indexOf(id));
    expect([...order].sort((x, y) => x - y)).toEqual(order);
  });

  it('sang ngày khác thì đổi bộ: 30 ngày liên tiếp của một khách ra hơn một bộ', () => {
    const sets = new Set<string>();
    for (let d = 1; d <= 30; d++) sets.add(pickDailyMissions('user-1', `2026-11-${String(d).padStart(2, '0')}`, FULL).join(','));
    expect(sets.size).toBeGreaterThan(1);
  });

  it('khách khác cùng ngày có thể ra bộ khác (không phát cùng một bộ cho mọi người)', () => {
    const sets = new Set<string>();
    for (let i = 0; i < 50; i++) sets.add(pickDailyMissions(`user-${i}`, '2026-11-17', FULL).join(','));
    expect(sets.size).toBeGreaterThan(1);
  });

  it('chia đều: trên 2.000 khách, mỗi nhiệm vụ rơi vào khoảng 3/5 số khách', () => {
    const count = new Map<DailyMissionId, number>();
    for (let i = 0; i < 2000; i++) for (const id of pickDailyMissions(`u${i}`, '2026-11-17', FULL)) count.set(id, (count.get(id) ?? 0) + 1);
    for (const id of FULL) {
      const share = (count.get(id) ?? 0) / 2000;
      expect(share).toBeGreaterThan(0.5);
      expect(share).toBeLessThan(0.7);
    }
  });

  it('Đố Xanh tắt: không bao giờ có DAILY_QUIZ, và các nhiệm vụ khác của ngày giữ nguyên (chỉ thay đúng món bị bỏ)', () => {
    for (let i = 0; i < 200; i++) {
      const full = pickDailyMissions(`u${i}`, '2026-11-17', FULL);
      const noQuiz = pickDailyMissions(`u${i}`, '2026-11-17', NO_QUIZ);
      expect(noQuiz).not.toContain('DAILY_QUIZ');
      expect(noQuiz).toHaveLength(3);
      for (const id of full.filter((x) => x !== 'DAILY_QUIZ')) expect(noQuiz).toContain(id);
    }
  });

  it('rổ nhỏ hơn 3 thì trả cả rổ; count 0 trả rỗng', () => {
    expect(pickDailyMissions('u', '2026-11-17', ['DAILY_WATER', 'DAILY_PLAY'])).toEqual(['DAILY_PLAY', 'DAILY_WATER']);
    expect(pickDailyMissions('u', '2026-11-17', FULL, 0)).toEqual([]);
  });

  it('mốc 00:00 giờ VN (+07): 16:59:59Z còn ngày cũ, 17:00:00Z đã sang ngày mới', () => {
    const before = new Date('2026-11-17T16:59:59.999Z');
    const after = new Date('2026-11-17T17:00:00.000Z');
    expect(vnDateKey(before)).toBe('2026-11-17');
    expect(vnDateKey(after)).toBe('2026-11-18');
    expect(pickDailyMissions('user-1', vnDateKey(before), FULL)).toEqual(pickDailyMissions('user-1', '2026-11-17', FULL));
    expect(pickDailyMissions('user-1', vnDateKey(after), FULL)).toEqual(pickDailyMissions('user-1', '2026-11-18', FULL));
  });
});

describe('dailyMissionPool', () => {
  it('Đố Xanh chỉ có trong rổ khi game Đố Xanh đang bật', () => {
    expect(FULL).toEqual([...DAILY_MISSION_IDS]);
    expect(NO_QUIZ).toEqual(DAILY_MISSION_IDS.filter((x) => x !== 'DAILY_QUIZ'));
  });
});

describe('readEngagementFlag', () => {
  it.each([
    [true, true],
    ['true', true],
    [false, false],
    ['false', false],
    [1, false],
    [null, false],
    [undefined, false],
  ])('%j → %j (mặc định tắt)', async (raw, want) => {
    const config = { get: jest.fn(async () => raw) };
    expect(await readEngagementFlag(config as never, 'engagement.daily_missions_enabled')).toBe(want);
    expect(config.get).toHaveBeenCalledWith('engagement.daily_missions_enabled', false);
  });
});
