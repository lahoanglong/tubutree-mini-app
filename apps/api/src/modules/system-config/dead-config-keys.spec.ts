import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { DEAD_CONFIG_KEYS, deadConfigKeyReason, isDeadConfigKey } from './dead-config-keys';

const SRC_ROOT = join(__dirname, '../..');
const SEED_PATH = join(__dirname, '../../../prisma/seed.ts');

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (name.endsWith('.ts') && !name.endsWith('.spec.ts') && !name.endsWith('.d.ts')) out.push(p);
  }
  return out;
}

/** Mã nguồn chạy thật (bỏ spec, bỏ chính danh sách khoá chết, bỏ comment) để dò "có code nào đọc khoá này không". */
function runtimeSource(): string {
  return walk(SRC_ROOT)
    .filter((p) => !p.endsWith('dead-config-keys.ts'))
    .map((p) => readFileSync(p, 'utf-8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, ''))
    .join('\n');
}

function isReferenced(source: string, key: string): boolean {
  return ['\'', '"', '`'].some((q) => source.includes(`${q}${key}${q}`));
}

/** Đọc mảng SYSTEM_CONFIGS trong prisma/seed.ts (import seed.ts sẽ chạy main() → cần DB). */
function seededConfigs(): { key: string; value: unknown; description: string }[] {
  const src = readFileSync(SEED_PATH, 'utf-8');
  const start = src.indexOf('const SYSTEM_CONFIGS: ConfigSeed[] = [');
  expect(start).toBeGreaterThanOrEqual(0);
  const open = src.indexOf('[', src.indexOf('=', start));
  const end = src.indexOf('\n];', open);
  const factory = new Function('Prisma', `return ${src.slice(open, end + 2)};`) as (p: unknown) => unknown;
  return factory({ Decimal: Number, JsonNull: null }) as { key: string; value: unknown; description: string }[];
}

describe('khoá config chết (C-054)', () => {
  const source = runtimeSource();

  it('mọi khoá trong danh sách chết thực sự không còn code nào đọc', () => {
    const readByCode = Object.keys(DEAD_CONFIG_KEYS).filter((k) => isReferenced(source, k));
    expect(readByCode).toEqual([]);
  });

  it('seed không còn gieo khoá chết, và mọi khoá được seed đều có code đọc', () => {
    const rows = seededConfigs();
    expect(rows.length).toBeGreaterThan(50);
    const seededDead = rows.map((r) => r.key).filter(isDeadConfigKey);
    expect(seededDead).toEqual([]);
    const unread = rows.map((r) => r.key).filter((k) => !isReferenced(source, k));
    expect(unread).toEqual([]);
  });

  it('khoá voucher chào mừng seed đúng tên mà code đọc (voucher.welcome_*), không phải loyalty.welcome_voucher_*', () => {
    const keys = seededConfigs().map((r) => r.key);
    expect(keys).toEqual(expect.arrayContaining(['voucher.welcome_amount', 'voucher.welcome_min_order']));
    expect(keys).not.toContain('loyalty.welcome_voucher_amount');
    expect(keys).not.toContain('loyalty.welcome_voucher_min_order');
  });

  it('khoá ETA giao hàng được seed (giá trị null = chưa đặt) để admin bật được từ tab Cấu hình', () => {
    const rows = seededConfigs();
    for (const key of ['shipping.eta_min_days', 'shipping.eta_max_days']) {
      const row = rows.find((r) => r.key === key);
      expect(row).toBeDefined();
      expect(row!.value).toBeNull();
    }
  });

  it('deadConfigKeyReason trả lý do cho khoá chết, null cho khoá còn dùng', () => {
    expect(deadConfigKeyReason('payment.cod_max_amount')).toContain('COD');
    expect(deadConfigKeyReason('voucher.welcome_amount')).toBeNull();
    expect(deadConfigKeyReason('toString')).toBeNull();
  });
});
