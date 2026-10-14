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
  const FRACTION_KEYS = new Set(['flashsale.min_discount_pct']);

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
