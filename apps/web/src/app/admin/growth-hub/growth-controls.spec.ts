import { describe, expect, it } from 'vitest';
import { MINI_GAME_IDS } from '@tubutree/shared-types';
import type { ConfigRow } from '@/lib/admin-client';
import {
  GIFT_TRIAL_MIN_ORDER_KEY,
  GROWTH_GROUPS,
  checkinWeekTotal,
  formatStored,
  numberValue,
  parseInput,
  switchOn,
  toInput,
  type GrowthNumber,
  type GrowthSwitch,
} from './growth-controls';

const all = GROWTH_GROUPS.flatMap((g) => g.items);
const num = (key: string) => all.find((i) => i.key === key) as GrowthNumber;
const sw = (key: string) => all.find((i) => i.key === key) as GrowthSwitch;
const rows = (o: Record<string, unknown>): ConfigRow[] => Object.entries(o).map(([key, value]) => ({ key, value, description: null, category: 'x' }));

describe('danh sách điều khiển', () => {
  it('mỗi khoá xuất hiện một lần', () => {
    const keys = all.map((i) => i.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('đủ 6 game PO nêu và công tắc riêng cho mọi game mini đang có', () => {
    const labels = all.map((i) => ('label' in i ? i.label : ''));
    for (const name of ['Ghép Cặp', 'Đoán Xuất Xứ', 'Giỏ Đúng Việc', 'Chọn Chuẩn Xanh', 'Căn Bếp Xanh', 'Điểm danh ngày']) expect(labels).toContain(name);
    for (const id of MINI_GAME_IDS) expect(sw(`game.mini.${id}.enabled`)?.kind).toBe('switch');
    // Công tắc game mini chỉ có tác dụng khi công tắc chung bật.
    for (const id of MINI_GAME_IDS) expect(sw(`game.mini.${id}.enabled`).requires).toBe('game.mini.enabled');
  });

  it('mức chuẩn chốt 18/11: freeship 199.000đ, quà 0đ 299.000đ, +100 Điểm Xanh đánh giá ảnh, trần Điểm Xanh 20%', () => {
    expect(num('shipping.free_threshold').standard).toBe(199_000);
    expect(num(GIFT_TRIAL_MIN_ORDER_KEY).standard).toBe(299_000);
    expect(num('reviews.photo_reward_points').standard).toBe(100);
    const redeem = num('loyalty.max_redeem_pct');
    expect(redeem.standard).toBe(0.2);
    expect(redeem.max).toBe(20);
    expect(redeem.percent).toBe(true);
  });

  it('khoá do tính năng khác tạo phải chờ có dòng mới cho sửa', () => {
    expect(num(GIFT_TRIAL_MIN_ORDER_KEY).needsRow).toBe(true);
    expect(num('reviews.photo_reward_points').needsRow).toBe(true);
    expect(sw('game.mini.kitchen_swap.enabled').needsRow).toBe(true);
    expect(sw('reviews.green_corner_enabled').needsRow).toBe(true);
    expect(num('shipping.free_threshold').needsRow).toBeUndefined();
  });

  it('biên trần game trùng biên máy chủ kẹp (game-mini.settings.ts)', () => {
    expect([num('game.mini.points_daily_cap').min, num('game.mini.points_daily_cap').max]).toEqual([0, 500]);
    expect([num('game.mini.global_points_daily_budget').min, num('game.mini.global_points_daily_budget').max]).toEqual([0, 1_000_000]);
    expect([num('game.mini.water_daily_cap').min, num('game.mini.water_daily_cap').max]).toEqual([0, 200]);
    expect([num('game.mini.rounds_per_game_per_day').min, num('game.mini.rounds_per_game_per_day').max]).toEqual([0, 10]);
  });
});

describe('parseInput', () => {
  const free = () => num('shipping.free_threshold');
  const pct = () => num('loyalty.max_redeem_pct');

  it('số đồng nhận dấu chấm, khoảng trắng và chữ đ', () => {
    expect(parseInput(free(), '199.000')).toEqual({ value: 199_000 });
    expect(parseInput(free(), '199 000đ')).toEqual({ value: 199_000 });
    expect(parseInput(free(), '0')).toEqual({ value: 0 });
  });

  it('chặn số ngoài biên, số âm, số lẻ và chữ', () => {
    for (const raw of ['', '-5', '12a', '50.000.001', '1e5']) expect(parseInput(free(), raw).error).toMatch(/Nhập số nguyên 0–50\.000\.000 đ/);
    expect(parseInput(num('game.mini.points_daily_cap'), '501').error).toContain('0–500');
  });

  it('phần trăm lưu dạng phân số, nhận dấu phẩy và một chữ số thập phân, tối đa 20', () => {
    expect(parseInput(pct(), '20')).toEqual({ value: 0.2 });
    expect(parseInput(pct(), '12,5')).toEqual({ value: 0.125 });
    expect(parseInput(pct(), '1.1%')).toEqual({ value: 0.011 });
    expect(parseInput(pct(), '0')).toEqual({ value: 0 });
    for (const raw of ['20.1', '25', '12,55', 'abc', '']) expect(parseInput(pct(), raw).error).toContain('Nhập phần trăm 0–20');
  });

  it('toInput và formatStored đọc ngược đúng giá trị lưu', () => {
    expect(toInput(pct(), 0.2)).toBe('20');
    expect(toInput(pct(), 0.125)).toBe('12.5');
    expect(formatStored(pct(), 0.125)).toBe('12,5%');
    expect(formatStored(free(), 199_000)).toBe('199.000đ');
    expect(formatStored(num('game.mini.points_daily_cap'), 100)).toBe('100 Điểm Xanh');
    expect(toInput(free(), null)).toBe('');
  });
});

describe('đọc giá trị đang chạy', () => {
  it('công tắc: chưa có dòng dùng mặc định; chỉ true hoặc "true" là bật', () => {
    const s = sw('game.mini.enabled');
    expect(switchOn(undefined, s)).toBe(false);
    expect(switchOn(rows({ 'game.mini.enabled': true }), s)).toBe(true);
    expect(switchOn(rows({ 'game.mini.enabled': 'true' }), s)).toBe(true);
    expect(switchOn(rows({ 'game.mini.enabled': 1 }), s)).toBe(false);
  });

  it('ô số: chưa có dòng dùng mặc định; giá trị không phải số thì null', () => {
    const f = num('shipping.free_threshold');
    expect(numberValue([], f)).toBe(199_000);
    expect(numberValue(rows({ 'shipping.free_threshold': 150_000 }), f)).toBe(150_000);
    expect(numberValue(rows({ 'shipping.free_threshold': '150000' }), f)).toBeNull();
  });

  it('tổng điểm danh 7 ngày; bảng hỏng thì null', () => {
    expect(checkinWeekTotal(rows({ 'loyalty.checkin_points': [10, 10, 10, 20, 20, 20, 50] }))).toBe(140);
    expect(checkinWeekTotal(rows({ 'loyalty.checkin_points': [10, 10] }))).toBeNull();
    expect(checkinWeekTotal([])).toBeNull();
  });
});
