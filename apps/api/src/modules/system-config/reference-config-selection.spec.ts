import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { SYSTEM_CONFIGS } from '../../../prisma/seed';
import {
  EXCLUDED_CONFIG_KEYS,
  EXCLUDED_CONFIG_PREFIXES,
  EXTRA_CONFIGS,
  REFERENCE_CONFIG_PREFIXES,
  classifyConfigKey,
  selectReferenceConfigs,
} from '../../../prisma/reference-data/config-selection';

const API_ROOT = join(__dirname, '../../..');
const keysOf = (rows: readonly { key: string }[]) => rows.map((r) => r.key);

describe('khoá SystemConfig nạp lên DB thật (seed-reference)', () => {
  it('mọi khoá của seed.ts đã được phân loại: nạp hoặc loại có lý do (khoá/tiền tố mới phải được chọn, không tự lọt lên prod)', () => {
    const unclassified = SYSTEM_CONFIGS.filter((c) => classifyConfigKey(c.key) === 'unclassified').map((c) => c.key);
    expect(unclassified).toEqual([]);
  });

  it('danh sách loại không có dòng thừa: mọi khoá/tiền tố loại đều còn khoá tương ứng trong seed.ts', () => {
    const seeded = keysOf(SYSTEM_CONFIGS);
    for (const key of Object.keys(EXCLUDED_CONFIG_KEYS)) expect(seeded).toContain(key);
    for (const prefix of Object.keys(EXCLUDED_CONFIG_PREFIXES)) expect(seeded.some((k) => k.startsWith(`${prefix}.`))).toBe(true);
  });

  it('tiền tố vừa được nạp vừa bị loại thì không có', () => {
    const overlap = REFERENCE_CONFIG_PREFIXES.filter((p) => p in EXCLUDED_CONFIG_PREFIXES);
    expect(overlap).toEqual([]);
  });

  it('không nạp tài khoản ngân hàng, kho Gomdon và khoá đổi vỏ (không đụng cấu hình thanh toán hay phần đổi rác)', () => {
    const loaded = keysOf(selectReferenceConfigs(SYSTEM_CONFIGS));
    expect(loaded.filter((k) => /^(payment|refill)\./.test(k))).toEqual([]);
    expect(loaded).not.toContain('shipping.gomdon.config');
    expect(loaded).not.toContain('shipping.gomdon.recycling_enabled');
  });

  it('hạng thành viên đi cùng freeship theo hạng: khoá freeship phải nằm trong phần nạp (quyền lợi hứa trên hạng thực hiện nhờ khoá này)', () => {
    expect(keysOf(selectReferenceConfigs(SYSTEM_CONFIGS))).toContain('shipping.tier_freeship_overrides');
  });

  it('khoá bổ sung không trùng khoá của seed.ts và không có hai dòng cùng khoá', () => {
    const seeded = new Set(keysOf(SYSTEM_CONFIGS));
    const extras = keysOf(EXTRA_CONFIGS);
    expect(extras.filter((k) => seeded.has(k))).toEqual([]);
    expect(new Set(extras).size).toBe(extras.length);
    for (const key of extras) expect(classifyConfigKey(key)).toBe('reference');
  });

  it.each(EXTRA_CONFIGS.map((c) => [c.key, c] as const))('%s: giá trị nạp bằng mặc định đang nằm trong mã', (_key, extra) => {
    const source = readFileSync(join(API_ROOT, extra.fallbackSource.file), 'utf-8');
    expect(source).toContain(extra.fallbackSource.text);
  });

  it('dòng nạp không còn cờ createOnly lẫn chú thích nguồn (cột SystemConfig không có hai trường này)', () => {
    for (const row of selectReferenceConfigs(SYSTEM_CONFIGS).filter((r) => EXTRA_CONFIGS.some((e) => e.key === r.key))) {
      expect(row).not.toHaveProperty('fallbackSource');
    }
  });
});
