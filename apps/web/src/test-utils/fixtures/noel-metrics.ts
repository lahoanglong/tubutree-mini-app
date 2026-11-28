import type { NoelEconomyPeriod, NoelMetricsDTO } from '@tubutree/shared-types';

const SLOTS = ['star', 'lights', 'baubles', 'gifts', 'reindeer', 'wreath'] as const;
const tap = (users = 0, taps = 0) => ({ users, taps });

const period = (over: Partial<NoelEconomyPeriod> = {}): NoelEconomyPeriod => ({
  fromDayKey: '2026-12-14',
  toDayKey: '2026-12-20',
  miniUsers: 0,
  miniRewardedRounds: 0,
  miniWater: 0,
  miniPoints: 0,
  maxUserWaterInDay: 0,
  maxUserPointsInDay: 0,
  maxGlobalPointsInDay: 0,
  arcadeRewardedRuns: 0,
  arcadeWater: 0,
  ...over,
});

const DAY_KEYS = ['2026-12-14', '2026-12-15', '2026-12-16', '2026-12-17', '2026-12-18', '2026-12-19', '2026-12-20'];

/** Số liệu Noel rỗng, 7 ngày 14–20/12/2026: mọi số 0 và tỉ lệ null (trạng thái rỗng của tab). */
export function emptyNoelMetrics(over: Partial<NoelMetricsDTO> = {}): NoelMetricsDTO {
  return {
    generatedAt: '2026-12-20T03:00:00.000Z',
    days: 7,
    seasonalTheme: 'christmas',
    fromDayKey: '2026-12-14',
    toDayKey: '2026-12-20',
    claims: { users: 0, claims: 0, perDay: DAY_KEYS.map((dayKey) => ({ dayKey, count: 0 })), reachedStreak3: 0, reachedStreak7: 0 },
    advent: {
      year: 2026,
      phase: 'during',
      daysElapsed: 7,
      requiredDays: 6,
      opensByDay: Array.from({ length: 12 }, (_, i) => ({ day: i + 1, dayKey: `2026-12-${14 + i}`, users: 0 })),
      openedAny: 0,
      completed: 0,
      completionPct: null,
    },
    ornaments: SLOTS.map((slot) => ({ slot, unlock: tap(), hang: tap(), remove: tap() })),
    share: tap(),
    snow: { on: tap(), off: tap(), offSharePct: null },
    games: [
      { game: 'dew_catcher', kind: 'arcade', plays: 0, users: 0, avgScore: null, avgOutOf: null, rewardedPlays: 0, water: 0, points: 0 },
      { game: 'refill_rush', kind: 'arcade', plays: 0, users: 0, avgScore: null, avgOutOf: null, rewardedPlays: 0, water: 0, points: 0 },
      { game: 'eco_merge', kind: 'mini', plays: 0, users: 0, avgScore: null, avgOutOf: null, rewardedPlays: 0, water: 0, points: 0 },
      { game: 'green_conveyor', kind: 'mini', plays: 0, users: 0, avgScore: null, avgOutOf: null, rewardedPlays: 0, water: 0, points: 0 },
    ],
    economy: {
      caps: { miniWaterPerUserDay: 40, miniPointsPerUserDay: 100, miniGlobalPointsPerDay: 200_000 },
      current: period(),
      previous: period({ fromDayKey: '2026-12-07', toDayKey: '2026-12-13' }),
    },
    retention: {
      cohortFromDayKey: '2026-12-12',
      cohortToDayKey: '2026-12-18',
      noel: { userDays: 0, returned: 0, ratePct: null },
      other: { userDays: 0, returned: 0, ratePct: null },
    },
    ...over,
  };
}

/** Số liệu Noel có dữ liệu, cùng khoảng 14–20/12/2026. */
export function busyNoelMetrics(): NoelMetricsDTO {
  const base = emptyNoelMetrics();
  return {
    ...base,
    claims: {
      users: 40,
      claims: 140,
      perDay: DAY_KEYS.map((dayKey, i) => ({ dayKey, count: 10 + i * 5 })),
      reachedStreak3: 18,
      reachedStreak7: 4,
    },
    advent: {
      ...base.advent,
      opensByDay: base.advent.opensByDay.map((d, i) => ({ ...d, users: i < 7 ? 30 - i : 0 })),
      openedAny: 40,
      completed: 8,
      completionPct: 20,
    },
    ornaments: SLOTS.map((slot, i) => ({ slot, unlock: tap(i + 1, i + 1), hang: tap(i, i * 2), remove: tap(i > 2 ? 1 : 0, i > 2 ? 2 : 0) })),
    share: tap(12, 20),
    snow: { on: tap(5, 6), off: tap(4, 18), offSharePct: 75 },
    games: [
      { game: 'dew_catcher', kind: 'arcade', plays: 120, users: 45, avgScore: 412.3, avgOutOf: null, rewardedPlays: 90, water: 450, points: 90 },
      { game: 'refill_rush', kind: 'arcade', plays: 0, users: 0, avgScore: null, avgOutOf: null, rewardedPlays: 0, water: 0, points: 0 },
      { game: 'eco_merge', kind: 'mini', plays: 30, users: 20, avgScore: 4.3, avgOutOf: 8, rewardedPlays: 25, water: 125, points: 25 },
      { game: 'green_conveyor', kind: 'mini', plays: 22, users: 15, avgScore: 6, avgOutOf: 8, rewardedPlays: 18, water: 90, points: 18 },
      { game: 'daily_quiz', kind: 'mini', plays: 60, users: 40, avgScore: 2.5, avgOutOf: 3, rewardedPlays: 40, water: 200, points: 40 },
    ],
    economy: {
      caps: base.economy.caps,
      current: period({ miniUsers: 30, miniRewardedRounds: 83, miniWater: 415, miniPoints: 83, maxUserWaterInDay: 40, maxUserPointsInDay: 60, maxGlobalPointsInDay: 900, arcadeRewardedRuns: 90, arcadeWater: 450 }),
      previous: period({ fromDayKey: '2026-12-07', toDayKey: '2026-12-13', miniUsers: 28, miniRewardedRounds: 76, miniWater: 380, miniPoints: 76, maxUserWaterInDay: 40, maxUserPointsInDay: 50, maxGlobalPointsInDay: 600, arcadeRewardedRuns: 60, arcadeWater: 300 }),
    },
    retention: {
      cohortFromDayKey: '2026-12-12',
      cohortToDayKey: '2026-12-18',
      noel: { userDays: 100, returned: 60, ratePct: 60 },
      other: { userDays: 400, returned: 120, ratePct: 30 },
    },
  };
}
