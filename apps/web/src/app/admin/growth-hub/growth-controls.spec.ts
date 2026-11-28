import { describe, expect, it } from 'vitest';
import { MINI_GAME_IDS } from '@tubutree/shared-types';
import type { ConfigRow } from '@/lib/admin-client';
import { FEATURE_FLAGS } from '@/lib/admin-feature-flags';
import {
  GIFT_TRIAL_MIN_ORDER_KEY,
  GROWTH_GROUPS,
  checkinWeekTotal,
  choiceValue,
  formatStored,
  numberValue,
  parseInput,
  switchOn,
  toInput,
  type GrowthChoice,
  type GrowthNumber,
  type GrowthSwitch,
} from './growth-controls';
import { SEASONAL_THEMES } from '@tubutree/app-core/seasonal/seasonal-theme';

const all = GROWTH_GROUPS.flatMap((g) => g.items);
const num = (key: string) => all.find((i) => i.key === key) as GrowthNumber;
const sw = (key: string) => all.find((i) => i.key === key) as GrowthSwitch;
const rows = (o: Record<string, unknown>): ConfigRow[] => Object.entries(o).map(([key, value]) => ({ key, value, description: null, category: 'x' }));

describe('giao diện theo mùa (theme.seasonal)', () => {
  const season = () => all.find((i) => i.key === 'theme.seasonal') as GrowthChoice;
  it('ba lựa chọn đúng giá trị máy chủ nhận, nhãn PO chốt, mặc định "none" như máy chủ khi chưa có dòng', () => {
    expect(season().kind).toBe('choice');
    expect(season().options.map((o) => o.value)).toEqual([...SEASONAL_THEMES]);
    expect(season().options.map((o) => o.label)).toEqual(['Mặc định', 'Giáng Sinh (Noel Xanh)', 'Tết']);
    expect(choiceValue(undefined, season())).toBe('none');
    expect(choiceValue(rows({}), season())).toBe('none');
    expect(choiceValue(rows({ 'theme.seasonal': 'christmas' }), season())).toBe('christmas');
    expect(choiceValue(rows({ 'theme.seasonal': 'halloween' }), season())).toBe('none');
    expect(choiceValue(rows({ 'theme.seasonal': true }), season())).toBe('none');
  });
});

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
    expect(sw('commerce.gift_trial_enabled').needsRow).toBe(true);
    expect(sw('flashsale.green_hour_enabled').needsRow).toBe(true);
    expect(num('shipping.free_threshold').needsRow).toBeUndefined();
  });

  it('thưởng đơn đầu mời bạn: công tắc tắt sẵn, biên trùng máy chủ (referral/viral-config.ts), mức chuẩn 100 điểm và 199.000đ', () => {
    const viral = sw('growth.referral_viral_enabled');
    expect([viral.fallback, viral.needsRow]).toEqual([false, true]);
    expect([num('growth.referral_first_order_points').max, num('growth.referral_first_order_points').standard]).toEqual([10_000, 100]);
    expect([num('growth.referral_first_order_min').max, num('growth.referral_first_order_min').standard]).toEqual([100_000_000, 199_000]);
    expect([num('growth.referral_monthly_cap').min, num('growth.referral_monthly_cap').max, num('growth.referral_monthly_cap').fallback]).toEqual([0, 1_000, 10]);
  });

  it('mốc đơn đầu ghi đúng cơ sở máy chủ tính (orders.subtotal, w8-02 MINOR 7): tiền hàng như mốc freeship, không phải tổng khách trả', () => {
    const min = num('growth.referral_first_order_min');
    expect(min.label).toBe('Thưởng đơn đầu: tiền hàng tối thiểu');
    expect(min.hint).toContain('Tiền hàng');
    expect(min.hint).toContain('không gồm phí giao');
    expect(min.hint).not.toContain('Tổng tiền khách trả');
  });

  it('biên trần game trùng biên máy chủ kẹp (game-mini.settings.ts)', () => {
    expect([num('game.mini.points_daily_cap').min, num('game.mini.points_daily_cap').max]).toEqual([0, 500]);
    expect([num('game.mini.global_points_daily_budget').min, num('game.mini.global_points_daily_budget').max]).toEqual([0, 1_000_000]);
    expect([num('game.mini.water_daily_cap').min, num('game.mini.water_daily_cap').max]).toEqual([0, 200]);
    expect([num('game.mini.rounds_per_game_per_day').min, num('game.mini.rounds_per_game_per_day').max]).toEqual([0, 10]);
  });
});

describe('đồng bộ với thẻ "Bật/tắt tính năng" (lib/admin-feature-flags.ts)', () => {
  const flag = (key: string) => FEATURE_FLAGS.find((f) => f.key === key);
  const SHARED = ['eco.product_badges_enabled', 'retention.refill_21d_reminder_enabled', 'retention.refill_21d_zns_enabled'];

  it('nhãn xanh có nguồn và hai cờ nhắc Refill 21 ngày có ở CẢ Trung tâm tăng trưởng lẫn thẻ Bật/tắt tính năng, cùng nhãn, mô tả, mặc định và cảnh báo', () => {
    for (const key of SHARED) {
      const f = flag(key);
      const g = sw(key);
      expect(f, key).toBeDefined();
      expect(g?.kind, key).toBe('switch');
      expect({ label: g.label, description: g.description, fallback: g.fallback, onWarning: g.onWarning, offWarning: g.offWarning }, key).toEqual({
        label: f!.label,
        description: f!.description,
        fallback: f!.fallback,
        onWarning: f!.onWarning,
        offWarning: f!.offWarning,
      });
    }
  });

  it('mọi khoá có ở cả hai nơi dùng cùng giá trị mặc định (cùng mặc định máy chủ)', () => {
    const shared = all.filter((i): i is GrowthSwitch => i.kind === 'switch' && flag(i.key) !== undefined);
    expect(shared.map((i) => i.key)).toEqual(expect.arrayContaining(SHARED));
    for (const i of shared) expect(i.fallback, i.key).toBe(flag(i.key)!.fallback);
  });

  it('eco.product_badges_enabled mặc định TẮT; cảnh báo bật nói rõ chỉ bật khi khối lượng bao bì đã được cân trên hàng thật', () => {
    const f = flag('eco.product_badges_enabled')!;
    expect(f.fallback).toBe(false);
    expect(f.description).toContain('Mặc định TẮT');
    expect(f.onWarning).toContain('cân');
    expect(sw('eco.product_badges_enabled').needsRow).toBe(true);
  });

  it('ZNS Refill chỉ có tác dụng khi công tắc nhắc Refill bật; cả hai chờ dòng cấu hình của migration', () => {
    expect(sw('retention.refill_21d_zns_enabled').requires).toBe('retention.refill_21d_reminder_enabled');
    expect(sw('retention.refill_21d_reminder_enabled').needsRow).toBe(true);
    expect(sw('retention.refill_21d_zns_enabled').needsRow).toBe(true);
    expect([sw('retention.refill_21d_reminder_enabled').fallback, sw('retention.refill_21d_zns_enabled').fallback]).toEqual([false, false]);
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
