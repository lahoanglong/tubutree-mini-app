import { ARCADE_NOMINAL_MS } from './arcade-config';

export type RushStation = 'return' | 'refill' | 'compost';
export const RUSH_STATIONS: readonly RushStation[] = ['return', 'refill', 'compost'];
export const RUSH_ITEMS: Record<RushStation, readonly (readonly [string, string])[]> = {
  return: [['🧴', 'Vỏ chai nước giặt TubuTree'], ['🧴', 'Vỏ chai nước rửa chén TubuTree'], ['🍶', 'Chai TubuTree rỗng đã súc sạch'], ['🧴', 'Chai TubuTree rỗng đã tráng sạch']],
  refill: [['🍾', 'Chai thuỷ tinh dùng lại'], ['🏺', 'Bình vòi dùng lại'], ['🫙', 'Hũ thuỷ tinh dùng lại'], ['🫖', 'Bình thuỷ tinh có vòi']],
  compost: [['🌰', 'Bã quả bồ hòn'], ['🍊', 'Vỏ cam'], ['🍋', 'Vỏ chanh'], ['🍂', 'Lá khô'], ['🍃', 'Cành lá tỉa']],
};
export const RUSH_DURATION_MS = ARCADE_NOMINAL_MS.refill_rush;
export const RUSH_WRONG_PENALTY_MS = 2_000;
export const RUSH_LATE_PENALTY_MS = 1_000;
export const RUSH_FEVER_STEPS = 5;
export const RUSH_FEVER_MS = 4_000;
/** Nghỉ giữa hai vật: giữ điểm tối đa dưới trần điểm mỗi giây của máy chủ. */
export const RUSH_GAP_MS = 400;
export const RUSH_POINTS = 10;

export const rushLimitMs = (progress: number): number => Math.round(3200 - 1700 * Math.min(1, Math.max(0, progress)));

export interface RushItemView { id: number; station: RushStation; emoji: string; label: string; limitMs: number; leftMs: number }
export interface RushEvent { type: 'correct' | 'wrong' | 'late' | 'fever'; station: RushStation; points: number }
export interface RefillRushStats {
  score: number;
  correct: number;
  wrong: number;
  timedOut: number;
  maxStreak: number;
  feverCount: number;
  durationMs: number;
}
export interface RefillRushState {
  timeLeftMs: number;
  score: number;
  streak: number;
  maxStreak: number;
  bar: number;
  barMax: number;
  feverMs: number;
  feverCount: number;
  correct: number;
  wrong: number;
  item: RushItemView | null;
  events: RushEvent[];
  over: boolean;
}

/** Engine thuần; sai hoặc quá hạn xả Fever Xanh (5 đúng liên tiếp, x2 điểm). */
export function createRefillRush({ rng = Math.random, durationMs = RUSH_DURATION_MS }: { rng?: () => number; durationMs?: number } = {}) {
  let id = 0, elapsed = 0, timeLeft = durationMs, gap = 600;
  let cur: RushItemView | null = null;
  let lastKey = '';
  let score = 0, correct = 0, wrong = 0, timedOut = 0, streak = 0, maxStreak = 0, bar = 0, fever = 0, feverCount = 0, over = false;
  let events: RushEvent[] = [];

  const rand = (n: number) => Math.min(n - 1, Math.floor(rng() * n));
  const present = () => {
    const station = RUSH_STATIONS[rand(RUSH_STATIONS.length)]!;
    const list = RUSH_ITEMS[station];
    let i = rand(list.length);
    if (`${station}${i}` === lastKey) i = (i + 1) % list.length;
    lastKey = `${station}${i}`;
    const limitMs = rushLimitMs(1 - timeLeft / durationMs);
    cur = { id: id++, station, emoji: list[i]![0], label: list[i]![1], limitMs, leftMs: limitMs };
  };
  const close = (type: RushEvent['type'], penalty: number) => {
    events.push({ type, station: cur!.station, points: 0 });
    wrong++;
    streak = bar = fever = 0;
    timeLeft = Math.max(0, timeLeft - penalty);
    cur = null;
    gap = RUSH_GAP_MS;
  };
  const tick = (dt: number) => {
    const d = Math.min(dt, timeLeft);
    elapsed += d;
    timeLeft -= d;
    fever = Math.max(0, fever - d);
    if (cur) {
      if ((cur.leftMs -= d) <= 0) {
        timedOut++;
        close('late', RUSH_LATE_PENALTY_MS);
      }
    } else if ((gap -= d) <= 0) present();
    over = timeLeft <= 0;
  };

  return {
    step(dtMs: number) {
      events = [];
      for (let left = dtMs > 0 ? dtMs : 0; left > 0 && !over; left -= 25) tick(Math.min(25, left));
    },
    pick(station: RushStation): boolean {
      if (over || !cur) return false;
      const ok = station === cur.station;
      if (!ok) close('wrong', RUSH_WRONG_PENALTY_MS);
      else {
        const points = RUSH_POINTS * (fever > 0 ? 2 : 1);
        score += points;
        correct++;
        maxStreak = Math.max(maxStreak, ++streak);
        events.push({ type: 'correct', station, points });
        if (fever <= 0 && ++bar >= RUSH_FEVER_STEPS) {
          bar = 0;
          fever = RUSH_FEVER_MS;
          feverCount++;
          events.push({ type: 'fever', station, points: 0 });
        }
        cur = null;
        gap = RUSH_GAP_MS;
      }
      over = timeLeft <= 0;
      return ok;
    },
    state(): RefillRushState {
      return { timeLeftMs: timeLeft, score, streak, maxStreak, bar, barMax: RUSH_FEVER_STEPS, feverMs: fever, feverCount, correct, wrong, item: cur && { ...cur }, events: events.slice(), over };
    },
    stats(): RefillRushStats | null {
      return over ? { score, correct, wrong, timedOut, maxStreak, feverCount, durationMs: Math.round(elapsed) } : null;
    },
  };
}
