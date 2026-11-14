import { afterEach, describe, expect, it } from 'vitest';
import * as api from '../../../../apps/api/src/modules/game/game-arcade.constants';
import {
  ARCADE_GAME_IDS,
  ARCADE_MAX_SCORE_PER_SEC,
  ARCADE_MIN_DURATION_MS,
  ARCADE_MIN_REWARD_SCORE,
  ARCADE_NOMINAL_MS,
  arcadeDailyCap,
  arcadeMaxScore,
  arcadeScoreTier,
  arcadeWaterFor,
  arcadeWindowAt,
  nextArcadeWindowStart,
  type ArcadeGameId,
} from './arcade-config';

// Mốc giờ VN viết kèm +07:00 nên không phụ thuộc TZ máy chạy spec.
const vn = (time: string, day = '2026-11-15') => new Date(`${day}T${time}+07:00`);
const TIMEZONES = ['UTC', 'Asia/Ho_Chi_Minh', 'America/Los_Angeles', 'Pacific/Kiritimati'];
const originalTz = process.env.TZ;
afterEach(() => {
  if (originalTz === undefined) delete process.env.TZ;
  else process.env.TZ = originalTz;
});

describe('hằng số khớp hợp đồng API', () => {
  it('giá trị theo contract W164', () => {
    expect([...ARCADE_GAME_IDS]).toEqual(['dew_catcher', 'refill_rush']);
    expect(ARCADE_NOMINAL_MS).toEqual({ dew_catcher: 40_000, refill_rush: 45_000 });
    expect(ARCADE_MAX_SCORE_PER_SEC).toEqual({ dew_catcher: 160, refill_rush: 60 });
    expect(ARCADE_MIN_REWARD_SCORE).toEqual({ dew_catcher: 100, refill_rush: 60 });
    expect(ARCADE_MIN_DURATION_MS).toBe(5_000);
  });

  it('bằng hằng của apps/api (game-arcade.constants)', () => {
    expect([...ARCADE_GAME_IDS]).toEqual([...api.ARCADE_GAME_IDS]);
    expect(ARCADE_NOMINAL_MS).toEqual(api.ARCADE_NOMINAL_MS);
    expect(ARCADE_MAX_SCORE_PER_SEC).toEqual(api.ARCADE_MAX_SCORE_PER_SEC);
    expect(ARCADE_MIN_REWARD_SCORE).toEqual(api.ARCADE_MIN_REWARD_SCORE);
    expect(ARCADE_MIN_DURATION_MS).toBe(api.ARCADE_MIN_DURATION_MS);
  });
});

// `arcadeDailyCap` là trần khi chưa dùng lượt thưởng khung: 3, hoặc 4 trong khung. Mỗi khung còn một lượt thưởng riêng (tối đa 5 mỗi ngày mỗi game) do máy chủ đếm.
describe('arcadeWindowAt và arcadeDailyCap: ranh khung giờ VN', () => {
  it.each([
    ['06:29:59', null, 3],
    ['06:30:00', 'SUONG_SOM', 4],
    ['08:59:59', 'SUONG_SOM', 4],
    ['09:00:00', null, 3],
    ['19:59:59', null, 3],
    ['20:00:00', 'MUA_RAO', 4],
    ['21:59:59', 'MUA_RAO', 4],
    ['22:00:00', null, 3],
    ['00:00:00', null, 3],
    ['12:00:00', null, 3],
    ['23:59:59', null, 3],
  ])('%s -> khung %s, trần %i', (time, win, cap) => {
    const t = vn(time);
    expect(arcadeWindowAt(t)).toBe(win);
    expect(arcadeDailyCap(t)).toBe(cap);
  });

  it('tới từng mili giây ở ranh', () => {
    expect(arcadeWindowAt(new Date(vn('06:30:00').getTime() - 1))).toBeNull();
    expect(arcadeWindowAt(new Date(vn('09:00:00').getTime() - 1))).toBe('SUONG_SOM');
    expect(arcadeWindowAt(new Date(vn('20:00:00').getTime() - 1))).toBeNull();
    expect(arcadeWindowAt(new Date(vn('22:00:00').getTime() - 1))).toBe('MUA_RAO');
  });

  it.each(TIMEZONES)('cùng kết quả khi TZ của process là %s', (tz) => {
    process.env.TZ = tz;
    expect(arcadeWindowAt(vn('06:29:59'))).toBeNull();
    expect(arcadeWindowAt(vn('06:30:00'))).toBe('SUONG_SOM');
    expect(arcadeWindowAt(vn('08:59:59'))).toBe('SUONG_SOM');
    expect(arcadeWindowAt(vn('09:00:00'))).toBeNull();
    expect(arcadeWindowAt(vn('19:59:59'))).toBeNull();
    expect(arcadeWindowAt(vn('20:00:00'))).toBe('MUA_RAO');
    expect(arcadeWindowAt(vn('21:59:59'))).toBe('MUA_RAO');
    expect(arcadeWindowAt(vn('22:00:00'))).toBeNull();
    // 06:30 VN là 23:30 UTC ngày hôm trước: ngày UTC và ngày VN lệch nhau.
    expect(arcadeWindowAt(new Date('2026-11-14T23:30:00Z'))).toBe('SUONG_SOM');
    expect(arcadeDailyCap(new Date('2026-11-14T13:00:00Z'))).toBe(4);
    expect(arcadeDailyCap(new Date('2026-11-14T16:30:00Z'))).toBe(3);
  });

  it('Date không hợp lệ không có khung và trần là 3', () => {
    expect(arcadeWindowAt(new Date(NaN))).toBeNull();
    expect(arcadeDailyCap(new Date(NaN))).toBe(3);
  });
});

describe('nextArcadeWindowStart', () => {
  it.each([
    ['05:00:00', '2026-11-14T23:30:00.000Z'],
    ['06:29:59', '2026-11-14T23:30:00.000Z'],
    ['06:30:00', '2026-11-15T13:00:00.000Z'],
    ['08:59:59', '2026-11-15T13:00:00.000Z'],
    ['09:00:00', '2026-11-15T13:00:00.000Z'],
    ['19:59:59', '2026-11-15T13:00:00.000Z'],
    ['20:00:00', '2026-11-15T23:30:00.000Z'],
    ['21:59:59', '2026-11-15T23:30:00.000Z'],
    ['22:00:00', '2026-11-15T23:30:00.000Z'],
    ['23:59:59', '2026-11-15T23:30:00.000Z'],
  ])('từ %s -> %s', (time, iso) => {
    expect(nextArcadeWindowStart(vn(time)).toISOString()).toBe(iso);
  });

  it.each(TIMEZONES)('không đổi theo TZ %s và luôn rơi vào đầu một khung', (tz) => {
    process.env.TZ = tz;
    expect(nextArcadeWindowStart(vn('10:00:00')).toISOString()).toBe('2026-11-15T13:00:00.000Z');
    const next = nextArcadeWindowStart(vn('23:00:00'));
    expect(arcadeWindowAt(next)).toBe('SUONG_SOM');
    expect(arcadeWindowAt(new Date(next.getTime() - 1))).toBeNull();
  });
});

describe('arcadeScoreTier và arcadeWaterFor', () => {
  it.each<[ArcadeGameId, number, 'base' | 'good' | 'great', number]>([
    ['dew_catcher', 0, 'base', 5],
    ['dew_catcher', 399, 'base', 5],
    ['dew_catcher', 400, 'good', 8],
    ['dew_catcher', 899, 'good', 8],
    ['dew_catcher', 900, 'great', 10],
    ['dew_catcher', 4800, 'great', 10],
    ['refill_rush', 249, 'base', 5],
    ['refill_rush', 250, 'good', 8],
    ['refill_rush', 549, 'good', 8],
    ['refill_rush', 550, 'great', 10],
  ])('%s %i điểm -> %s, %i giọt', (game, score, tier, water) => {
    expect(arcadeScoreTier(game, score)).toBe(tier);
    expect(arcadeWaterFor(game, score)).toBe(water);
  });

  it('base tuỳ chỉnh (game.arcade_water_base) cộng đủ phần thưởng mốc', () => {
    expect(arcadeWaterFor('dew_catcher', 0, 7)).toBe(7);
    expect(arcadeWaterFor('dew_catcher', 400, 7)).toBe(10);
    expect(arcadeWaterFor('dew_catcher', 900, 7)).toBe(12);
  });

  it('điểm sai (NaN, âm) rơi về mốc cơ bản', () => {
    expect(arcadeScoreTier('refill_rush', NaN)).toBe('base');
    expect(arcadeWaterFor('refill_rush', -10)).toBe(5);
  });
});

describe('arcadeMaxScore và ngưỡng thưởng tối thiểu', () => {
  it.each<[ArcadeGameId, number, number]>([
    ['dew_catcher', 40_000, 6_400],
    ['dew_catcher', 60_000, 9_600],
    ['dew_catcher', 20_000, 1_600],
    ['dew_catcher', 5_000, 100],
    ['dew_catcher', 0, 0],
    ['refill_rush', 45_000, 2_700],
    ['refill_rush', 22_500, 675],
    ['refill_rush', 5_000, 34],
    ['refill_rush', 90_000, 5_400],
  ])('%s %i ms -> tối đa %i điểm', (game, ms, max) => {
    expect(arcadeMaxScore(game, ms)).toBe(max);
  });

  it('ván ngắn hơn danh nghĩa bị siết theo bình phương, từ danh nghĩa trở đi tuyến tính, và không giảm theo thời gian', () => {
    for (const game of ARCADE_GAME_IDS) {
      const nominal = ARCADE_NOMINAL_MS[game];
      expect(arcadeMaxScore(game, nominal / 2)).toBeLessThanOrEqual(Math.ceil(arcadeMaxScore(game, nominal) / 4));
      expect(arcadeMaxScore(game, nominal * 2)).toBe(2 * arcadeMaxScore(game, nominal));
      let prev = 0;
      for (let ms = 0; ms <= nominal * 1.5; ms += 250) {
        const max = arcadeMaxScore(game, ms);
        expect(max).toBeGreaterThanOrEqual(prev);
        prev = max;
      }
    }
  });

  it('ngưỡng thưởng tối thiểu thấp hơn mốc khá của từng game', () => {
    for (const game of ARCADE_GAME_IDS) {
      expect(ARCADE_MIN_REWARD_SCORE[game]).toBeGreaterThan(0);
      expect(arcadeScoreTier(game, ARCADE_MIN_REWARD_SCORE[game])).toBe('base');
    }
  });
});

describe('chéo giá trị với apps/api', () => {
  const NO_USAGE = { baseUsed: 0, bonusUsed: new Set<never>(), total: 0 };

  it('arcadeMaxScore trùng maxScoreFor của API ở từng 250 ms và từng mili giây quanh ranh danh nghĩa', () => {
    for (const game of ARCADE_GAME_IDS) {
      const nominal = ARCADE_NOMINAL_MS[game];
      for (let ms = 0; ms <= nominal * 2; ms += 250) expect(arcadeMaxScore(game, ms), `${game} ${ms}`).toBe(api.maxScoreFor(game, ms));
      for (let ms = nominal - 3; ms <= nominal + 3; ms++) expect(arcadeMaxScore(game, ms), `${game} ${ms}`).toBe(api.maxScoreFor(game, ms));
      for (const ms of [1, 999, 1_001, 4_999, 5_000, 7_500, 12_345]) expect(arcadeMaxScore(game, ms), `${game} ${ms}`).toBe(api.maxScoreFor(game, ms));
    }
  });

  it('giọt nước theo điểm trùng arcadeWater của API', () => {
    for (const game of ARCADE_GAME_IDS) {
      for (let score = 0; score <= 1200; score += 7) {
        for (const base of [5, 8]) expect(arcadeWaterFor(game, score, base), `${game} ${score} ${base}`).toBe(api.arcadeWater(game, score, base));
      }
      for (const score of [249, 250, 399, 400, 549, 550, 899, 900]) expect(arcadeWaterFor(game, score)).toBe(api.arcadeWater(game, score, 5));
    }
  });

  it('khung giờ, trần và khung kế trùng API ở từng phút của ba ngày, kể cả ranh', () => {
    const start = Date.parse('2026-11-14T00:00:00Z');
    for (let minute = 0; minute < 3 * 24 * 60; minute++) {
      for (const offset of [-1, 0]) {
        const t = new Date(start + minute * 60_000 + offset);
        expect(arcadeWindowAt(t)).toBe(api.arcadeWindowAt(t));
        expect(arcadeDailyCap(t)).toBe(api.arcadeCap(api.arcadeWindowAt(t), NO_USAGE));
        expect(nextArcadeWindowStart(t).getTime()).toBe(api.nextArcadeWindowStart(t).getTime());
      }
    }
  });
});
