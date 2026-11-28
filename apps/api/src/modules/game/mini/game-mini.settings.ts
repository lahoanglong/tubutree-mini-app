import { MINI_GAME_IDS, type MiniGameId } from '@tubutree/shared-types';
import type { SystemConfigService } from '../../system-config/system-config.service';
import { GAME_TANK_CAPACITY_DEFAULT } from '../game.constants';

export const MINI_ENABLED_KEY = 'game.mini.enabled';
/** Viết nguyên chữ (không ghép chuỗi): spec khoá chết tìm đúng tên khoá trong mã đọc. */
const MINI_GAME_FLAG_KEYS: Record<MiniGameId, string> = {
  sort: 'game.mini.sort.enabled',
  daily_quiz: 'game.mini.daily_quiz.enabled',
  match: 'game.mini.match.enabled',
  origin: 'game.mini.origin.enabled',
  basket: 'game.mini.basket.enabled',
  kitchen_swap: 'game.mini.kitchen_swap.enabled',
  eco_merge: 'game.mini.eco_merge.enabled',
  green_conveyor: 'game.mini.green_conveyor.enabled',
};
export const miniGameFlagKey = (game: MiniGameId): string => MINI_GAME_FLAG_KEYS[game];

/**
 * Khoá số của game mini và biên máy chủ kẹp khi đọc. Biên này độc lập với luật ghi của admin: một giá trị gõ nhầm (vd 50000 cho
 * `points_daily_cap`) đã lọt vào DB bằng đường nào đó vẫn không mở kho điểm. `invalid` là cách xử lý giá trị không phải số:
 * khoá tính bằng Điểm Xanh (tương đương tiền) coi là 0 để không rơi về mức có phát điểm ngoài ý admin.
 */
export const MINI_NUMERIC_SETTINGS = {
  roundsPerGame: { key: 'game.mini.rounds_per_game_per_day', fallback: 2, min: 0, max: 10, invalid: 'default' },
  waterCap: { key: 'game.mini.water_daily_cap', fallback: 40, min: 0, max: 200, invalid: 'default' },
  pointsCap: { key: 'game.mini.points_daily_cap', fallback: 100, min: 0, max: 500, invalid: 'zero' },
  accountsPerDevice: { key: 'game.mini.accounts_per_device_per_day', fallback: 2, min: 1, max: 10, invalid: 'default' },
  globalBudget: { key: 'game.mini.global_points_daily_budget', fallback: 200_000, min: 0, max: 1_000_000, invalid: 'zero' },
  minAccountAgeHours: { key: 'game.mini.min_account_age_hours', fallback: 0, min: 0, max: 720, invalid: 'default' },
} as const;

type NumericName = keyof typeof MINI_NUMERIC_SETTINGS;

export interface MiniSettings {
  enabled: boolean;
  games: Record<MiniGameId, boolean>;
  roundsPerGame: number;
  waterCap: number;
  pointsCap: number;
  accountsPerDevice: number;
  globalBudget: number;
  minAccountAgeHours: number;
  /** `game.tank_capacity`: 💧 game mini không đẩy bình vượt sức chứa. */
  tankCapacity: number;
}

/** Cờ chỉ bật với đúng `true` (hoặc chuỗi 'true' do admin cũ lưu): giá trị lạ coi như tắt. */
export function readFlag(raw: unknown): boolean {
  return raw === true || raw === 'true';
}

export function clampSetting(name: NumericName, raw: unknown): number {
  const spec = MINI_NUMERIC_SETTINGS[name];
  const n = typeof raw === 'number' ? raw : typeof raw === 'string' && raw.trim() !== '' ? Number(raw) : Number.NaN;
  if (!Number.isFinite(n)) return spec.invalid === 'zero' ? 0 : spec.fallback;
  return Math.min(spec.max, Math.max(spec.min, Math.floor(n)));
}

/** Đọc mọi khoá một lượt, NGOÀI transaction (cache nguội trong transaction xin kết nối thứ hai, cạn pool). */
export async function readMiniSettings(config: Pick<SystemConfigService, 'get'>): Promise<MiniSettings> {
  const names = Object.keys(MINI_NUMERIC_SETTINGS) as NumericName[];
  const [enabledRaw, gameRaws, numericRaws, tankRaw] = await Promise.all([
    config.get<unknown>(MINI_ENABLED_KEY, false),
    Promise.all(MINI_GAME_IDS.map((g) => config.get<unknown>(miniGameFlagKey(g), false))),
    Promise.all(names.map((n) => config.get<unknown>(MINI_NUMERIC_SETTINGS[n].key, MINI_NUMERIC_SETTINGS[n].fallback))),
    config.get<unknown>('game.tank_capacity', GAME_TANK_CAPACITY_DEFAULT),
  ]);
  const numeric = Object.fromEntries(names.map((n, i) => [n, clampSetting(n, numericRaws[i])])) as Record<NumericName, number>;
  const tank = typeof tankRaw === 'number' && Number.isFinite(tankRaw) && tankRaw > 0 ? Math.floor(tankRaw) : GAME_TANK_CAPACITY_DEFAULT;
  return {
    enabled: readFlag(enabledRaw),
    games: Object.fromEntries(MINI_GAME_IDS.map((g, i) => [g, readFlag(gameRaws[i])])) as Record<MiniGameId, boolean>,
    ...numeric,
    tankCapacity: tank,
  };
}

export function isGameOn(settings: MiniSettings, game: MiniGameId): boolean {
  return settings.enabled && settings.games[game];
}

/**
 * Số ván có thưởng mỗi ngày của một game. Đố Xanh phát cùng 3 câu cho mọi người suốt ngày, nên ván thứ hai là chép lại đáp án vừa
 * thấy: tối đa 1 ván có thưởng dù admin đặt cao hơn.
 */
export function rewardedRoundsFor(settings: MiniSettings, game: MiniGameId): number {
  return game === 'daily_quiz' ? Math.min(1, settings.roundsPerGame) : settings.roundsPerGame;
}
