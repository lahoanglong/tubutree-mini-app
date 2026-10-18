import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { BadRequestException } from '@nestjs/common';
import { WASTE_CONFIG_KEYS, assertWasteConfigSeedRows } from './waste-config.keys';
import { SystemConfigService } from '../system-config/system-config.service';
import { validateAdminConfigValue } from '../admin/admin-config-rules';
import type { PrismaService } from '../../prisma/prisma.service';

const SEED = readFileSync(join(__dirname, '../../../prisma/seed.ts'), 'utf-8');
const SQL = readFileSync(join(__dirname, '../../../prisma/migrations/20261020000000_waste_exchange/migration.sql'), 'utf-8');

type Row = { key: string; value: unknown; category?: string; description?: string; createOnly?: boolean };
function seededRows(): Row[] {
  const start = SEED.indexOf('const SYSTEM_CONFIGS: ConfigSeed[] = [');
  const open = SEED.indexOf('[', SEED.indexOf('=', start));
  const end = SEED.indexOf('\n];', open);
  return (new Function('Prisma', `return ${SEED.slice(open, end + 2)};`) as (p: unknown) => Row[])({ Decimal: Number, JsonNull: null });
}

const FEE = { zones: [], defaultZone: { name: 'Toàn quốc', low: 30000, high: 85000 } };
const THRESHOLDS = {
  quotaPacePct: 60, quotaPaceDays: 10, fullMatchPct: 95, fullMatchMinSample: 10, repeatCustomerCount: 3, repeatCustomerDays: 7,
  avgUnitsFactor: 2, lookupMissCount: 10, lookupMissDays: 1, staffDirectCount: 5, staffDirectDays: 7,
};
const EXPECTED: [key: string, type: string, def: unknown, min?: number, max?: number][] = [
  ['waste.enabled', 'boolean', false],
  ['waste.lane_dropoff_enabled', 'boolean', true],
  ['waste.lane_mailin_enabled', 'boolean', true],
  ['waste.lane_pickup_enabled', 'boolean', false],
  ['waste.mailin_min_points', 'int', 15_000, 1, 1_000_000],
  ['waste.pickup_min_points', 'int', 10_000, 1, 1_000_000],
  ['waste.customer_monthly_cap_points', 'int', 60_000, 1, 2_000_000],
  ['waste.max_open_requests', 'int', 3, 1, 20],
  ['waste.request_hold_days', 'int', 7, 1, 60],
  ['waste.pickup_wait_days', 'int', 14, 1, 90],
  ['waste.in_transit_review_days', 'int', 30, 7, 180],
  ['waste.mailin_max_weight_kg', 'int', 20, 1, 50],
  ['waste.mailin_max_edge_cm', 'int', 50, 10, 200],
  ['waste.shortfall_lock_pct', 'int', 50, 1, 100],
  ['waste.shortfall_lock_streak', 'int', 3, 2, 10],
  ['waste.staff_daily_cap_points', 'int', 1_000_000, 1, 20_000_000],
  ['waste.gift_claim_days', 'int', 60, 7, 365],
  ['waste.point_inactive_days', 'int', 60, 7, 365],
  ['waste.mailin_fee_table', 'json', FEE],
  ['waste.alert_thresholds', 'json', THRESHOLDS],
  ['waste.rules_text', 'string', ''],
];
const DESC: Record<string, string> = {
  'waste.enabled': 'Cờ tổng của chương trình Đổi rác lấy quà, tắt thì khách không tạo được yêu cầu mới và bàn đại lý bị chặn, kho vẫn xử lý yêu cầu đã có.',
  'waste.lane_dropoff_enabled': 'Bật cách giao Mang tới điểm nhận cho yêu cầu mới.',
  'waste.lane_mailin_enabled': 'Bật cách giao Gửi về kho cho yêu cầu mới.',
  'waste.lane_pickup_enabled': 'Bật cách giao Thu kèm đơn cho yêu cầu mới, còn cần cờ Gomdon hiện có.',
  'waste.mailin_min_points': 'Số Điểm Xanh tối thiểu của một gói gửi kho, không được lớn hơn trần điểm tháng của khách.',
  'waste.pickup_min_points': 'Số Điểm Xanh tối thiểu của một gói thu kèm đơn, không được lớn hơn trần điểm tháng của khách.',
  'waste.customer_monthly_cap_points': 'Trần Điểm Xanh mỗi khách được cộng từ đổi rác trong một tháng.',
  'waste.max_open_requests': 'Số yêu cầu đổi rác một khách được mở cùng lúc.',
  'waste.request_hold_days': 'Số ngày giữ chỗ một yêu cầu và chờ khách nhập mã vận đơn.',
  'waste.pickup_wait_days': 'Số ngày chờ hàng thu kèm về kho sau khi đơn mua đã giao.',
  'waste.in_transit_review_days': 'Yêu cầu gửi kho đang vận chuyển quá ngần này ngày thì vào danh sách admin xem lại.',
  'waste.mailin_max_weight_kg': 'Khối lượng tối đa của mỗi kiện gửi kho, tính bằng kg, theo giới hạn của hãng chuyển phát.',
  'waste.mailin_max_edge_cm': 'Cạnh dài tối đa của mỗi kiện gửi kho, tính bằng cm.',
  'waste.shortfall_lock_pct': 'Yêu cầu hoàn tất mà điểm cộng chưa tới (100 trừ ngần này) phần trăm điểm ước tính thì tính là một lần nhận thiếu.',
  'waste.shortfall_lock_streak': 'Số lần nhận thiếu liền nhau thì khoá đường gửi kho và thu kèm đơn của khách.',
  'waste.staff_daily_cap_points': 'Trần Điểm Xanh mỗi nhân viên kho hoặc điểm nhận được xác nhận trong một ngày.',
  'waste.gift_claim_days': 'Số ngày khách được nhận quà bằng mã, quá hạn thì lượt đổi vào danh sách admin xem lại.',
  'waste.point_inactive_days': 'Điểm nhận đối tác không có lượt xác nhận nào quá ngần này ngày kể từ lần xác nhận cuối hoặc lần kích hoạt thì bị ẩn khỏi danh sách khách.',
  'waste.mailin_fee_table': 'Bảng ước tính phí ship gửi kho theo vùng tỉnh, mỗi vùng có phí thấp và phí cao, cộng một vùng mặc định cho tỉnh chưa xếp.',
  'waste.alert_thresholds': 'Ngưỡng cảnh báo bất thường về điểm nhận và người xác nhận, chỉ để admin xem, không tự khoá ai.',
  'waste.rules_text': 'Thể lệ công khai của chương trình, tối đa 8000 ký tự, để trống thì mục Thể lệ hiện ghi chú sắp có.',
};
const INTS = EXPECTED.filter((e) => e[1] === 'int') as [string, string, number, number, number][];
const BOOLS = EXPECTED.filter((e) => e[1] === 'boolean').map((e) => e[0]);

function makeService() {
  const tx = { systemConfig: { findUnique: jest.fn().mockResolvedValue(null), upsert: jest.fn() }, systemConfigHistory: { create: jest.fn() } };
  const prisma = { $transaction: jest.fn((fn: (t: typeof tx) => unknown) => fn(tx)) } as unknown as PrismaService;
  return new SystemConfigService(prisma);
}
const accepts = async (key: string, value: object | string | number | boolean): Promise<boolean> => {
  try {
    validateAdminConfigValue(key, value);
    await makeService().set(key, value, 'admin-it');
    return true;
  } catch (e) {
    // Anything but a BadRequestException (a TypeError from a rule reading a field of null) is an HTTP 500 in production.
    if (e instanceof BadRequestException) return false;
    throw e;
  }
};

describe('WASTE_CONFIG_KEYS', () => {
  it('has exactly the 21 keys of spec 11.5 in table order, with type, default and category', () => {
    expect(Object.keys(WASTE_CONFIG_KEYS)).toEqual(EXPECTED.map((e) => e[0]));
    for (const [key, type, def, min, max] of EXPECTED) {
      expect(WASTE_CONFIG_KEYS[key as keyof typeof WASTE_CONFIG_KEYS]).toMatchObject({ type, default: def, category: 'waste', ...(min === undefined ? {} : { min, max }) });
    }
  });
  it('descriptions are short Vietnamese sentences with no apostrophe and no standalone xu', () => {
    expect(Object.keys(DESC)).toEqual(EXPECTED.map((e) => e[0]));
    for (const [k, d] of Object.entries(WASTE_CONFIG_KEYS)) expect(d.description).toBe(DESC[k]);
    for (const def of Object.values(WASTE_CONFIG_KEYS)) {
      expect(def.description.length).toBeGreaterThan(10);
      expect(def.description.length).toBeLessThanOrEqual(140);
      expect(def.description).not.toContain("'");
      expect(def.description).not.toMatch(/(?<![\p{L}_])xu(?![\p{L}_])/iu);
    }
  });
  it('no key name contains a word the config redaction masks', () => {
    expect(Object.keys(WASTE_CONFIG_KEYS).filter((k) => /pass|key|token|secret/i.test(k))).toEqual([]);
  });
});

describe('assertWasteConfigSeedRows', () => {
  const good = (): Row[] => Object.entries(WASTE_CONFIG_KEYS).map(([key, d]) => ({ key, value: d.default, category: 'waste', description: d.description, createOnly: true }));
  it('accepts the rows derived from the record', () => {
    expect(() => assertWasteConfigSeedRows(good())).not.toThrow();
  });
  it('throws naming the key when a row is missing, differs, is not createOnly, has another category, or is unknown', () => {
    expect(() => assertWasteConfigSeedRows(good().filter((r) => r.key !== 'waste.enabled'))).toThrow(/waste\.enabled/);
    expect(() => assertWasteConfigSeedRows(good().map((r) => (r.key === 'waste.max_open_requests' ? { ...r, value: 4 } : r)))).toThrow(/waste\.max_open_requests/);
    expect(() => assertWasteConfigSeedRows(good().map((r) => (r.key === 'waste.gift_claim_days' ? { ...r, createOnly: false } : r)))).toThrow(/waste\.gift_claim_days/);
    expect(() => assertWasteConfigSeedRows(good().map((r) => (r.key === 'waste.rules_text' ? { ...r, category: 'misc' } : r)))).toThrow(/waste\.rules_text/);
    expect(() => assertWasteConfigSeedRows([...good(), { key: 'waste.unknown', value: 1, category: 'waste', createOnly: true }])).toThrow(/waste\.unknown/);
  });
  it('ignores rows of other categories', () => {
    expect(() => assertWasteConfigSeedRows([...good(), { key: 'loyalty.vnd_per_point', value: 10000 }])).not.toThrow();
  });
});

describe('seed.ts and the migration carry the same 21 rows', () => {
  it('seed rows are literal, createOnly and equal to the record', () => {
    const rows = seededRows().filter((r) => r.key.startsWith('waste.'));
    expect(rows.map((r) => r.key)).toEqual(EXPECTED.map((e) => e[0]));
    expect(() => assertWasteConfigSeedRows(seededRows())).not.toThrow();
    expect(SEED).toContain('assertWasteConfigSeedRows(SYSTEM_CONFIGS);');
    expect(SEED.indexOf('assertWasteConfigSeedRows(SYSTEM_CONFIGS);')).toBeGreaterThan(SEED.indexOf('const SYSTEM_CONFIGS: ConfigSeed[] = ['));
  });
  it('migration section inserts every key once with the default value and the same description, ON CONFLICT DO NOTHING', () => {
    const a = SQL.indexOf('-- BEGIN WASTE CONFIG ROWS');
    const b = SQL.indexOf('-- END WASTE CONFIG ROWS');
    expect(a).toBeGreaterThanOrEqual(0);
    const section = SQL.slice(a, b);
    expect(section).toContain('INSERT INTO "system_configs" ("key", "value", "description", "category", "updatedAt") VALUES');
    expect(section).toContain('ON CONFLICT ("key") DO NOTHING;');
    const tuples = [...section.matchAll(/^\s*\('(waste\.[a-z_]+)', '([^']*)'::jsonb, '([^']*)', 'waste', NOW\(\)\)[,;]?\s*$/gm)];
    expect(tuples.map((m) => m[1])).toEqual(EXPECTED.map((e) => e[0]));
    for (const m of tuples) {
      const def = WASTE_CONFIG_KEYS[m[1] as keyof typeof WASTE_CONFIG_KEYS];
      expect(JSON.parse(m[2]!)).toEqual(def.default);
      expect(m[3]).toBe(def.description);
    }
  });
});

describe('write rules (SystemConfigService.set and the admin form rules)', () => {
  it.each(INTS)('%s (%s): accepts min and max, rejects min-1, max+1 and a fraction', async (key, _t, _d, min, max) => {
    expect(await accepts(key, min)).toBe(true);
    expect(await accepts(key, max)).toBe(true);
    expect(await accepts(key, min - 1)).toBe(false);
    expect(await accepts(key, max + 1)).toBe(false);
    expect(await accepts(key, min + 0.5)).toBe(false);
    expect(SystemConfigService.hasWriteRule(key)).toBe(true);
  });
  it.each(BOOLS)('%s accepts true and false only', async (key) => {
    expect(() => validateAdminConfigValue(key, true)).not.toThrow();
    expect(() => validateAdminConfigValue(key, false)).not.toThrow();
    for (const bad of ['true', 1, 0, null, {}]) expect(() => validateAdminConfigValue(key, bad)).toThrow(BadRequestException);
  });
  it('waste.mailin_fee_table', async () => {
    const zone = { name: 'Miền Nam', provinceCodes: ['79', '74'], low: 25000, high: 60000 };
    expect(await accepts('waste.mailin_fee_table', FEE)).toBe(true);
    expect(await accepts('waste.mailin_fee_table', { ...FEE, zones: [zone] })).toBe(true);
    expect(await accepts('waste.mailin_fee_table', { defaultZone: FEE.defaultZone })).toBe(false);
    expect(await accepts('waste.mailin_fee_table', { zones: [], defaultZone: { name: 'x' } })).toBe(false);
    expect(await accepts('waste.mailin_fee_table', { ...FEE, zones: [{ ...zone, name: '' }] })).toBe(false);
    expect(await accepts('waste.mailin_fee_table', { ...FEE, zones: [{ ...zone, low: 50000, high: 40000 }] })).toBe(false);
    expect(await accepts('waste.mailin_fee_table', { ...FEE, zones: [{ ...zone, low: -1 }] })).toBe(false);
    expect(await accepts('waste.mailin_fee_table', { ...FEE, zones: [{ ...zone, high: 500001 }] })).toBe(false);
    expect(await accepts('waste.mailin_fee_table', { ...FEE, zones: [zone, { ...zone, name: 'Khác', provinceCodes: ['79'] }] })).toBe(false);
    expect(await accepts('waste.mailin_fee_table', { ...FEE, zones: Array.from({ length: 21 }, (_, i) => ({ name: `Z${i}`, provinceCodes: [`P${i}`], low: 1, high: 2 })) })).toBe(false);
    expect(await accepts('waste.mailin_fee_table', [])).toBe(false);
    expect(await accepts('waste.mailin_fee_table', { ...FEE, zones: [{ ...zone, name: 'a'.repeat(60) }] })).toBe(true);
    expect(await accepts('waste.mailin_fee_table', { ...FEE, zones: [{ ...zone, name: 'a'.repeat(61) }] })).toBe(false);
    expect(await accepts('waste.mailin_fee_table', { ...FEE, zones: [{ ...zone, provinceCodes: [''] }] })).toBe(false);
    expect(await accepts('waste.mailin_fee_table', { ...FEE, zones: [{ ...zone, low: 0, high: 500000 }] })).toBe(true);
    expect(await accepts('waste.mailin_fee_table', { ...FEE, defaultZone: { name: 'x', low: 9, high: 3 } })).toBe(false);
    expect(await accepts('waste.mailin_fee_table', { ...FEE, zones: 'x' })).toBe(false);
    expect(await accepts('waste.mailin_fee_table', { ...FEE, zones: Array.from({ length: 20 }, (_, i) => ({ name: `Z${i}`, provinceCodes: [`P${i}`], low: 1, high: 2 })) })).toBe(true);
    // Malformed items must be rejected, never crash the rule.
    expect(await accepts('waste.mailin_fee_table', { zones: [null], defaultZone: 'A' })).toBe(false);
    expect(await accepts('waste.mailin_fee_table', { ...FEE, zones: [null] })).toBe(false);
    expect(await accepts('waste.mailin_fee_table', { ...FEE, zones: ['x'] })).toBe(false);
    expect(await accepts('waste.mailin_fee_table', { zones: [], defaultZone: null })).toBe(false);
    expect(await accepts('waste.mailin_fee_table', { ...FEE, zones: [{ ...zone, provinceCodes: null }] })).toBe(false);
  });
  it('waste.alert_thresholds', async () => {
    expect(await accepts('waste.alert_thresholds', THRESHOLDS)).toBe(true);
    expect(await accepts('waste.alert_thresholds', { ...THRESHOLDS, avgUnitsFactor: 20 })).toBe(true);
    expect(await accepts('waste.alert_thresholds', { ...THRESHOLDS, quotaPacePct: 1, avgUnitsFactor: 1 })).toBe(true);
    expect(await accepts('waste.alert_thresholds', { ...THRESHOLDS, quotaPacePct: '60' })).toBe(false);
    const { staffDirectDays: _omit, ...missing } = THRESHOLDS;
    expect(await accepts('waste.alert_thresholds', missing)).toBe(false);
    expect(await accepts('waste.alert_thresholds', { ...THRESHOLDS, extra: 1 })).toBe(false);
    for (const [k, v] of [['quotaPacePct', 101], ['fullMatchPct', 0], ['quotaPaceDays', 0], ['lookupMissDays', 32], ['fullMatchMinSample', 0], ['repeatCustomerCount', 1001], ['avgUnitsFactor', 0.5], ['avgUnitsFactor', 20.5], ['staffDirectCount', 1.5]] as const) {
      expect(await accepts('waste.alert_thresholds', { ...THRESHOLDS, [k]: v })).toBe(false);
    }
  });
  it('a change to a waste.* key is recorded in system_config_history like every config key (spec 9)', async () => {
    const tx = {
      systemConfig: { findUnique: jest.fn().mockResolvedValue({ key: 'waste.max_open_requests', value: 3 }), upsert: jest.fn() },
      systemConfigHistory: { create: jest.fn() },
    };
    const prisma = { $transaction: jest.fn((fn: (t: typeof tx) => unknown) => fn(tx)) } as unknown as PrismaService;
    await new SystemConfigService(prisma).set('waste.max_open_requests', 5, 'admin-it');
    expect(tx.systemConfigHistory.create).toHaveBeenCalledWith({ data: { key: 'waste.max_open_requests', oldValue: 3, newValue: 5, changedBy: 'admin-it' } });
  });
  it('waste.rules_text', async () => {
    expect(await accepts('waste.rules_text', '')).toBe(true);
    expect(await accepts('waste.rules_text', 'a'.repeat(8000))).toBe(true);
    expect(await accepts('waste.rules_text', 'a'.repeat(8001))).toBe(false);
    expect(await accepts('waste.rules_text', 123)).toBe(false);
  });
});
