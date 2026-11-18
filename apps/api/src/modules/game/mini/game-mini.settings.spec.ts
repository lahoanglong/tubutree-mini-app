import { MINI_GAME_IDS, type MiniGameId } from '@tubutree/shared-types';
import type { SystemConfigService } from '../../system-config/system-config.service';
import {
  MINI_ENABLED_KEY,
  MINI_NUMERIC_SETTINGS,
  clampSetting,
  isGameOn,
  miniGameFlagKey,
  readFlag,
  readMiniSettings,
  rewardedRoundsFor,
  type MiniSettings,
} from './game-mini.settings';

type Name = keyof typeof MINI_NUMERIC_SETTINGS;
const NAMES = Object.keys(MINI_NUMERIC_SETTINGS) as Name[];

const settings = (over: Partial<MiniSettings> = {}): MiniSettings => ({
  enabled: true,
  games: { sort: true, daily_quiz: true, match: true, origin: true, basket: true, kitchen_swap: true },
  roundsPerGame: 2,
  waterCap: 40,
  pointsCap: 100,
  accountsPerDevice: 2,
  globalBudget: 200_000,
  minAccountAgeHours: 0,
  tankCapacity: 1000,
  ...over,
});

/** SystemConfigService.get giả: khoá có trong map thì trả giá trị đó, không thì trả đúng mặc định nơi gọi truyền vào. */
const configOf = (map: Record<string, unknown>) =>
  ({
    get: jest.fn(async (key: string, fallback?: unknown) => (key in map ? map[key] : fallback)),
  }) as unknown as Pick<SystemConfigService, 'get'> & { get: jest.Mock };

describe('clampSetting: kẹp biên', () => {
  it.each(NAMES)('%s: dưới min kẹp lên min, trên max kẹp xuống max, trong biên giữ nguyên', (name) => {
    const { min, max } = MINI_NUMERIC_SETTINGS[name];
    expect(clampSetting(name, min - 1000)).toBe(min);
    expect(clampSetting(name, max + 1000)).toBe(max);
    expect(clampSetting(name, min)).toBe(min);
    expect(clampSetting(name, max)).toBe(max);
    expect(clampSetting(name, Math.floor((min + max) / 2))).toBe(Math.floor((min + max) / 2));
  });

  it('giá trị gõ nhầm quá lớn không mở kho điểm: points_daily_cap 50000 → 500, global budget 99999999 → 1.000.000', () => {
    expect(clampSetting('pointsCap', 50_000)).toBe(500);
    expect(clampSetting('globalBudget', 99_999_999)).toBe(1_000_000);
  });

  it('accountsPerDevice có min 1: 0 hoặc số âm kẹp lên 1 (không cho chặn mọi thiết bị)', () => {
    expect(clampSetting('accountsPerDevice', 0)).toBe(1);
    expect(clampSetting('accountsPerDevice', -5)).toBe(1);
  });

  it('số thập phân được làm tròn xuống trước khi kẹp', () => {
    expect(clampSetting('roundsPerGame', 3.9)).toBe(3);
    expect(clampSetting('waterCap', 40.99)).toBe(40);
    expect(clampSetting('roundsPerGame', -0.5)).toBe(0);
  });

  it('chuỗi số (admin cũ lưu dạng chữ) được đọc như số, vẫn kẹp biên', () => {
    expect(clampSetting('waterCap', '60')).toBe(60);
    expect(clampSetting('waterCap', ' 60 ')).toBe(60);
    expect(clampSetting('waterCap', '9999')).toBe(200);
    expect(clampSetting('pointsCap', '75.8')).toBe(75);
  });

  describe.each([
    ['chuỗi rỗng', ''],
    ['chuỗi toàn khoảng trắng', '   '],
    ['chuỗi không phải số', 'abc'],
    ['NaN', Number.NaN],
    ['Infinity', Number.POSITIVE_INFINITY],
    ['-Infinity', Number.NEGATIVE_INFINITY],
    ['chuỗi "Infinity"', 'Infinity'],
    ['null', null],
    ['undefined', undefined],
    ['boolean true', true],
    ['đối tượng', { value: 5 }],
    ['mảng', [5]],
  ])('giá trị không phải số hữu hạn: %s', (_label, raw) => {
    it.each(NAMES.filter((n) => MINI_NUMERIC_SETTINGS[n].invalid === 'default'))('%s → mặc định của khoá', (name) => {
      expect(clampSetting(name, raw)).toBe(MINI_NUMERIC_SETTINGS[name].fallback);
    });

    it.each(['pointsCap', 'globalBudget'] as const)('%s (tính bằng Điểm Xanh) → 0, không rơi về mức có phát điểm', (name) => {
      expect(clampSetting(name, raw)).toBe(0);
    });
  });

  it('chỉ pointsCap và globalBudget xử lý giá trị hỏng bằng 0', () => {
    expect(NAMES.filter((n) => MINI_NUMERIC_SETTINGS[n].invalid === 'zero').sort()).toEqual(['globalBudget', 'pointsCap']);
  });
});

describe('readFlag', () => {
  it.each([[true], ['true']])('%j → bật', (raw) => {
    expect(readFlag(raw)).toBe(true);
  });

  it.each([[false], ['false'], ['TRUE'], ['True'], [' true'], [1], ['1'], ['yes'], [0], [null], [undefined], [{}], [[]], ['']])(
    '%j → tắt',
    (raw) => {
      expect(readFlag(raw)).toBe(false);
    },
  );
});

describe('rewardedRoundsFor', () => {
  it.each([
    [0, 0],
    [1, 1],
    [2, 1],
    [10, 1],
  ])('daily_quiz: roundsPerGame %i → tối đa 1 ván có thưởng (được %i)', (rounds, expected) => {
    expect(rewardedRoundsFor(settings({ roundsPerGame: rounds }), 'daily_quiz')).toBe(expected);
  });

  it.each(MINI_GAME_IDS.filter((g) => g !== 'daily_quiz'))('%s: giữ nguyên roundsPerGame', (game) => {
    for (const rounds of [0, 1, 2, 10]) expect(rewardedRoundsFor(settings({ roundsPerGame: rounds }), game)).toBe(rounds);
  });
});

describe('miniGameFlagKey', () => {
  const EXPECTED: Record<MiniGameId, string> = {
    sort: 'game.mini.sort.enabled',
    daily_quiz: 'game.mini.daily_quiz.enabled',
    match: 'game.mini.match.enabled',
    origin: 'game.mini.origin.enabled',
    basket: 'game.mini.basket.enabled',
    kitchen_swap: 'game.mini.kitchen_swap.enabled',
  };

  it('trả đúng 6 khoá, mỗi game một khoá', () => {
    const keys = MINI_GAME_IDS.map((g) => miniGameFlagKey(g));
    expect(keys).toHaveLength(6);
    expect(new Set(keys).size).toBe(6);
    expect(Object.fromEntries(MINI_GAME_IDS.map((g) => [g, miniGameFlagKey(g)]))).toEqual(EXPECTED);
  });

  it('cờ chung là game.mini.enabled và khác mọi cờ game', () => {
    expect(MINI_ENABLED_KEY).toBe('game.mini.enabled');
    expect(MINI_GAME_IDS.map((g) => miniGameFlagKey(g))).not.toContain(MINI_ENABLED_KEY);
  });
});

describe('isGameOn', () => {
  it('cần cả cờ chung và cờ của game', () => {
    expect(isGameOn(settings(), 'sort')).toBe(true);
    expect(isGameOn(settings({ enabled: false }), 'sort')).toBe(false);
    expect(isGameOn(settings({ games: { sort: false, daily_quiz: true, match: true, origin: true, basket: true, kitchen_swap: true } }), 'sort')).toBe(false);
    expect(isGameOn(settings({ games: { sort: false, daily_quiz: true, match: true, origin: true, basket: true, kitchen_swap: true } }), 'match')).toBe(true);
  });
});

describe('readMiniSettings', () => {
  it('không có khoá nào trong DB thì mọi cờ tắt và mọi số về mặc định', async () => {
    const s = await readMiniSettings(configOf({}));
    expect(s.enabled).toBe(false);
    expect(s.games).toEqual({ sort: false, daily_quiz: false, match: false, origin: false, basket: false, kitchen_swap: false });
    expect(s).toMatchObject({
      roundsPerGame: 2,
      waterCap: 40,
      pointsCap: 100,
      accountsPerDevice: 2,
      globalBudget: 200_000,
      minAccountAgeHours: 0,
      tankCapacity: 1000,
    });
  });

  it('đọc đúng từng khoá, kẹp biên và hiểu cờ dạng chuỗi', async () => {
    const s = await readMiniSettings(
      configOf({
        'game.mini.enabled': true,
        'game.mini.sort.enabled': 'true',
        'game.mini.daily_quiz.enabled': true,
        'game.mini.match.enabled': 'false',
        'game.mini.origin.enabled': 1,
        'game.mini.rounds_per_game_per_day': 3,
        'game.mini.water_daily_cap': 9999,
        'game.mini.points_daily_cap': 50_000,
        'game.mini.accounts_per_device_per_day': 0,
        'game.mini.global_points_daily_budget': 'abc',
        'game.mini.min_account_age_hours': '24',
        'game.tank_capacity': 800,
      }),
    );
    expect(s.enabled).toBe(true);
    expect(s.games).toEqual({ sort: true, daily_quiz: true, match: false, origin: false, basket: false, kitchen_swap: false });
    expect(s.roundsPerGame).toBe(3);
    expect(s.waterCap).toBe(200);
    expect(s.pointsCap).toBe(500);
    expect(s.accountsPerDevice).toBe(1);
    expect(s.globalBudget).toBe(0);
    expect(s.minAccountAgeHours).toBe(24);
    expect(s.tankCapacity).toBe(800);
  });

  it.each([[0], [-10], ['800'], [Number.NaN], [null], [Number.POSITIVE_INFINITY]])('sức chứa bình %j không hợp lệ → 1000 (cùng seed)', async (raw) => {
    expect((await readMiniSettings(configOf({ 'game.tank_capacity': raw }))).tankCapacity).toBe(1000);
  });

  it('sức chứa bình thập phân được làm tròn xuống', async () => {
    expect((await readMiniSettings(configOf({ 'game.tank_capacity': 300.9 }))).tankCapacity).toBe(300);
  });

  it('đọc đủ 14 khoá (cờ chung, 6 cờ game, 6 khoá số, sức chứa bình) và truyền mặc định theo từng khoá', async () => {
    const cfg = configOf({});
    await readMiniSettings(cfg);
    const keys = cfg.get.mock.calls.map((c) => c[0]);
    expect(keys).toHaveLength(14);
    expect(new Set(keys).size).toBe(14);
    expect(keys).toEqual(expect.arrayContaining([MINI_ENABLED_KEY, ...MINI_GAME_IDS.map((g) => miniGameFlagKey(g)), 'game.tank_capacity']));
    for (const n of NAMES) {
      expect(cfg.get).toHaveBeenCalledWith(MINI_NUMERIC_SETTINGS[n].key, MINI_NUMERIC_SETTINGS[n].fallback);
    }
    expect(cfg.get).toHaveBeenCalledWith(MINI_ENABLED_KEY, false);
  });
});
