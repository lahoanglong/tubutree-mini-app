import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { SystemConfigService } from './system-config.service';
import { isDeadConfigKey } from './dead-config-keys';
import { hasAdminConfigRule, validateAdminConfigValue } from '../admin/admin-config-rules';
import { RETENTION_POLICY } from '../data-retention/data-retention.service';
import type { PrismaService } from '../../prisma/prisma.service';

const SEED_PATH = join(__dirname, '../../../prisma/seed.ts');

function seededConfigs(): { key: string; value: unknown }[] {
  const src = readFileSync(SEED_PATH, 'utf-8');
  const start = src.indexOf('const SYSTEM_CONFIGS: ConfigSeed[] = [');
  const open = src.indexOf('[', src.indexOf('=', start));
  const end = src.indexOf('\n];', open);
  const factory = new Function('Prisma', `return ${src.slice(open, end + 2)};`) as (p: unknown) => unknown;
  return factory({ Decimal: Number, JsonNull: null }) as { key: string; value: unknown }[];
}

function makeService() {
  const tx = {
    systemConfig: { findUnique: jest.fn().mockResolvedValue(null), upsert: jest.fn() },
    systemConfigHistory: { create: jest.fn() },
  };
  const prisma = { $transaction: jest.fn((fn: (t: typeof tx) => unknown) => fn(tx)) } as unknown as PrismaService;
  return new SystemConfigService(prisma);
}

/** Đường ghi thật của admin: luật riêng của form (admin-config-rules) rồi SystemConfigService.set. */
async function accepts(service: SystemConfigService, key: string, value: number): Promise<boolean> {
  try {
    validateAdminConfigValue(key, value);
    await service.set(key, value, 'admin-it');
    return true;
  } catch {
    return false;
  }
}

// R3-UI-4 / ADMINOPS-3: 29 khoá số vẫn nhận số âm, số khổng lồ hay số thực nên "đã lưu" mà hệ thống chạy sai (bán kính chấm công
// âm, giới hạn quay vô hạn). Spec này khoá cả họ: mọi khoá số được seed phải có luật khoảng, nên khoá mới không thể bị bỏ sót.
describe('khoá cấu hình dạng số có luật khoảng (R3-UI-4)', () => {
  const numeric = seededConfigs().filter((r) => typeof r.value === 'number' && !isDeadConfigKey(r.key));

  it('đọc được danh sách khoá số từ seed', () => {
    expect(numeric.length).toBeGreaterThan(80);
  });

  it('mọi khoá số được seed đều có luật ghi', () => {
    const missing = numeric.map((r) => r.key).filter((k) => !SystemConfigService.hasWriteRule(k) && !hasAdminConfigRule(k));
    expect(missing).toEqual([]);
  });

  it('giá trị seed mặc định luôn hợp lệ với luật của chính nó', async () => {
    const service = makeService();
    const rejected: string[] = [];
    for (const { key, value } of numeric) if (!(await accepts(service, key, value as number))) rejected.push(`${key}=${value}`);
    expect(rejected).toEqual([]);
  });

  it('số âm và số khổng lồ bị từ chối ở mọi khoá số', async () => {
    const service = makeService();
    const accepted: string[] = [];
    for (const { key } of numeric) {
      if (await accepts(service, key, -1)) accepted.push(`${key}: -1`);
      if (await accepts(service, key, 99_999_999_999)) accepted.push(`${key}: 99999999999`);
    }
    expect(accepted).toEqual([]);
  });

  // Khoá phân số 0–1 mà seed là 0 (không yêu cầu mức giảm tối thiểu): số lẻ là giá trị hợp lệ.
  const FRACTION_KEYS = new Set(['flashsale.min_discount_pct', 'loyalty.earn_pct']);

  it('khoá mặc định là số nguyên không nhận số thực (1,5 ngày, 0,5 giờ…)', async () => {
    const service = makeService();
    const accepted: string[] = [];
    for (const { key, value } of numeric) {
      if (FRACTION_KEYS.has(key) || !Number.isInteger(value)) continue;
      if (await accepts(service, key, (value as number) + 0.5)) accepted.push(`${key}=${(value as number) + 0.5}`);
    }
    expect(accepted).toEqual([]);
  });

  it('thông báo lỗi nói rõ khoảng hợp lệ (ví dụ bán kính chấm công)', async () => {
    const service = makeService();
    await expect(service.set('attendance.radius_m', -5, 'a')).rejects.toThrow(/attendance\.radius_m.*khoảng/);
    await expect(service.set('game.plot_target', 1.5, 'a')).rejects.toThrow(/số nguyên/);
  });

  it('khoảng của khoá lưu giữ dữ liệu khớp sàn mà data-retention vẫn kẹp khi đọc', async () => {
    const service = makeService();
    for (const { configKey, minDays } of Object.values(RETENTION_POLICY)) {
      expect(await accepts(service, configKey, minDays)).toBe(true);
      expect(await accepts(service, configKey, minDays - 1)).toBe(false);
    }
  });
});

describe('khoá cấu hình tích điểm đơn chat (B9)', () => {
  const service = makeService();
  const setOk = async (key: string, value: unknown): Promise<boolean> => {
    try {
      await service.set(key, value as never, 'admin-it');
      return true;
    } catch {
      return false;
    }
  };

  it('hai cờ chỉ nhận đúng boolean', async () => {
    for (const key of ['loyalty.chat_order_points_enabled', 'loyalty.chat_order_require_carrier']) {
      expect(await setOk(key, true)).toBe(true);
      expect(await setOk(key, false)).toBe(true);
      expect(await setOk(key, 'false')).toBe(false);
      expect(await setOk(key, 0)).toBe(false);
    }
  });

  it('tỉ lệ chat nhận null hoặc 0.1 đến 20, từ chối ngoài khoảng', async () => {
    const key = 'loyalty.chat_order_earn_pct';
    expect(await setOk(key, null)).toBe(true);
    expect(await setOk(key, 2)).toBe(true);
    expect(await setOk(key, 0)).toBe(false);
    expect(await setOk(key, 21)).toBe(false);
    expect(await setOk(key, '2')).toBe(false);
  });

  it('trần tháng, ngưỡng duyệt, số ngày giữ có khoảng và là số nguyên', async () => {
    expect(await accepts(service, 'loyalty.chat_order_monthly_points_cap', 200_000)).toBe(true);
    expect(await accepts(service, 'loyalty.chat_order_monthly_points_cap', 0)).toBe(false);
    expect(await accepts(service, 'loyalty.chat_order_review_above_vnd', 5_000_000)).toBe(true);
    expect(await accepts(service, 'loyalty.chat_order_review_above_vnd', -1)).toBe(false);
    expect(await accepts(service, 'loyalty.chat_unclaimed_hold_days', 30)).toBe(true);
    expect(await accepts(service, 'loyalty.chat_unclaimed_hold_days', 0)).toBe(false);
    expect(await accepts(service, 'loyalty.chat_unclaimed_hold_days', 1.5)).toBe(false);
  });

  it('hai khoá thêm có khoảng; staff_map chỉ nhận object { id: userId }', async () => {
    expect(await accepts(service, 'loyalty.chat_phone_verified_max_days', 180)).toBe(true);
    expect(await accepts(service, 'loyalty.chat_phone_verified_max_days', 0)).toBe(false);
    expect(await accepts(service, 'loyalty.chat_order_creator_monthly_points', 1_000_000)).toBe(true);
    expect(await accepts(service, 'loyalty.chat_order_creator_monthly_points', -5)).toBe(false);
    expect(await setOk('pancake.staff_map', { 'pc-1': 'user-1' })).toBe(true);
    expect(await setOk('pancake.staff_map', [])).toBe(false);
    expect(await setOk('pancake.staff_map', { 'pc-1': 5 })).toBe(false);
  });
});
