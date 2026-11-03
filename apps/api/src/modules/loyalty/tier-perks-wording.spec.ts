import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * XANH-03: quyền lợi hạng nằm trong dữ liệu (membership_tiers.perks) nên máy quét chữ ở màn khách không thấy. DESIGN.md cấm
 * "Freeship" ở chữ khách đọc, dùng "Miễn phí giao hàng". Đọc thẳng seed.ts (import sẽ chạy main() cần DB) và migration đổi chữ.
 */
const SEED = readFileSync(join(__dirname, '../../../prisma/seed.ts'), 'utf8');
const MIGRATION = readFileSync(join(__dirname, '../../../prisma/migrations/20261103140000_tier_perks_free_shipping_wording/migration.sql'), 'utf8');

const tiersBlock = SEED.slice(SEED.indexOf('export const TIERS = ['), SEED.indexOf('export const DEALER_TIERS'));
const seedPerks = [...tiersBlock.matchAll(/perks: \[(.*)\],/g)].map((m) => [...m[1]!.matchAll(/'([^']*)'/g)].map((x) => x[1]!));

describe('quyền lợi hạng (membership_tiers.perks)', () => {
  it('seed có đủ 3 hạng có quyền lợi và không phần tử nào còn "Freeship"', () => {
    expect(seedPerks.length).toBeGreaterThanOrEqual(3);
    expect(seedPerks.flat().filter((p) => /freeship/i.test(p))).toEqual([]);
  });

  it('migration đổi đúng ba chuỗi cũ sang đúng chữ seed, chỉ khớp khi phần tử còn nguyên chuỗi cũ', () => {
    const flat = seedPerks.flat();
    for (const next of ['Miễn phí giao hàng đơn từ 99k', 'Miễn phí giao hàng mọi đơn', 'Miễn phí giao hàng và giảm 5% mọi đơn']) {
      expect(flat).toContain(next);
      expect(MIGRATION).toContain(`to_jsonb('${next}'::text)`);
    }
    for (const old of ['Freeship đơn ≥ 99k', 'Freeship toàn shop', 'Freeship + giảm 5% mọi đơn']) {
      expect(MIGRATION).toContain(`to_jsonb(ARRAY['${old}'])`);
    }
  });
});
