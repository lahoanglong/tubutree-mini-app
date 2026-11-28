import { describe, expect, it } from 'vitest';
import { MINI_GAME_IDS, type NoelEconomyPeriod, type NoelMetricsDTO } from '@tubutree/shared-types';
import {
  GAME_LABELS,
  barPercent,
  dayLabel,
  economyAlerts,
  formatAvgScore,
  formatDecimal,
  gameLabel,
  MIN_RETENTION_SAMPLE,
  ornamentLabel,
  rangeLabel,
  retentionGap,
  retentionSampleSmall,
} from './noel-metrics-format';

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
const caps = { miniWaterPerUserDay: 40, miniPointsPerUserDay: 100, miniGlobalPointsPerDay: 200_000 };
const economy = (cur: Partial<NoelEconomyPeriod>, prev: Partial<NoelEconomyPeriod> = {}): NoelMetricsDTO['economy'] => ({
  caps,
  current: period(cur),
  previous: period(prev),
});

describe('nhãn và định dạng', () => {
  it('dayLabel và rangeLabel', () => {
    expect(dayLabel('2026-12-04')).toBe('04/12');
    expect(rangeLabel('2026-12-14', '2026-12-20')).toBe('14/12 đến 20/12');
    expect(rangeLabel('2026-12-14', '2026-12-14')).toBe('14/12');
  });

  it('formatDecimal dùng dấu phẩy và bỏ ",0"', () => {
    expect(formatDecimal(412.34)).toBe('412,3');
    expect(formatDecimal(5)).toBe('5');
    expect(formatDecimal(4.26)).toBe('4,3');
  });

  it('điểm TB: arcade là điểm, mini là đúng/tổng, chưa có ván là gạch', () => {
    expect(formatAvgScore(412.3, null)).toBe('412,3');
    expect(formatAvgScore(4.3, 8)).toBe('4,3/8');
    expect(formatAvgScore(null, null)).toBe('—');
  });

  it('tên game và món; mã lạ hiện nguyên mã', () => {
    expect(gameLabel('eco_merge')).toBe('Ghép Mầm Xanh');
    expect(gameLabel('quiz_x')).toBe('quiz_x');
    expect(gameLabel('daily_quiz')).toBe('Đố Xanh Mỗi Ngày');
    expect(ornamentLabel('baubles')).toBe('Quả châu đỏ');
    expect(ornamentLabel('santa')).toBe('santa');
  });

  it('mọi game mini và hai game arcade đều có tên tiếng Việt (không hiện mã trần)', () => {
    for (const id of [...MINI_GAME_IDS, 'dew_catcher', 'refill_rush']) expect(GAME_LABELS[id], id).toBeTruthy();
  });

  it('barPercent: 0 khi không có gì, tối thiểu 4% khi có, 100% ở giá trị lớn nhất', () => {
    expect(barPercent(0, 10)).toBe(0);
    expect(barPercent(5, 0)).toBe(0);
    expect(barPercent(1, 1000)).toBe(4);
    expect(barPercent(10, 10)).toBe(100);
    expect(barPercent(5, 10)).toBe(50);
  });
});

describe('quay lại D+1', () => {
  const g = (userDays: number, returned: number, ratePct: number | null) => ({ userDays, returned, ratePct });

  it('chênh lệch có dấu; null khi một nhóm trống', () => {
    expect(retentionGap(g(40, 30, 75), g(200, 60, 30))).toBe('+45 điểm phần trăm');
    expect(retentionGap(g(40, 10, 25), g(200, 100, 50))).toBe('−25 điểm phần trăm');
    expect(retentionGap(g(40, 20, 50), g(200, 100, 50))).toBe('0 điểm phần trăm');
    expect(retentionGap(g(0, 0, null), g(200, 100, 50))).toBeNull();
  });

  it('mẫu nhỏ khi một nhóm dưới ngưỡng', () => {
    const r = (a: number, b: number) => ({ cohortFromDayKey: '', cohortToDayKey: '', noel: g(a, 0, null), other: g(b, 0, null) });
    expect(retentionSampleSmall(r(MIN_RETENTION_SAMPLE, 500))).toBe(false);
    expect(retentionSampleSmall(r(MIN_RETENTION_SAMPLE - 1, 500))).toBe(true);
    expect(retentionSampleSmall(r(0, 0))).toBe(true);
  });
});

describe('economyAlerts', () => {
  it('bình thường: không cảnh báo', () => {
    expect(economyAlerts(economy({ miniWater: 300, maxUserWaterInDay: 40, maxUserPointsInDay: 100, maxGlobalPointsInDay: 5000 }, { miniWater: 280 }))).toEqual([]);
  });

  it('đúng bằng trần chưa là vượt', () => {
    expect(economyAlerts(economy({ maxUserWaterInDay: 40, maxUserPointsInDay: 100, maxGlobalPointsInDay: 200_000 }))).toEqual([]);
  });

  it('vượt trần từng khách hoặc ngân sách ngày: đỏ', () => {
    const a = economyAlerts(economy({ maxUserWaterInDay: 41, maxUserPointsInDay: 101, maxGlobalPointsInDay: 200_001 }));
    expect(a.map((x) => x.level)).toEqual(['red', 'red', 'red']);
    expect(a[0]!.message).toContain('41 giọt nước');
    expect(a[0]!.message).toContain('trần 40');
  });

  it('trần đặt 0 (tắt) thì không cảnh báo vượt', () => {
    const e = economy({ maxUserWaterInDay: 10 });
    e.caps = { miniWaterPerUserDay: 0, miniPointsPerUserDay: 0, miniGlobalPointsPerDay: 0 };
    expect(economyAlerts(e)).toEqual([]);
  });

  it('tăng từ 50% so với khoảng trước và đủ lớn: vàng', () => {
    const a = economyAlerts(economy({ miniWater: 150, miniPoints: 20 }, { miniWater: 100, miniPoints: 10 }));
    expect(a).toHaveLength(1);
    expect(a[0]).toMatchObject({ level: 'amber' });
    expect(a[0]!.message).toContain('tăng 50%');
  });

  it('khoảng trước quá nhỏ hoặc trống: không nhắc', () => {
    expect(economyAlerts(economy({ miniWater: 500 }, { miniWater: 10 }))).toEqual([]);
    expect(economyAlerts(economy({ miniWater: 500 }, { miniWater: 0 }))).toEqual([]);
  });
});
