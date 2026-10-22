import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Q12: ngưỡng freeship thường khớp ngưỡng đơn đầu (199.000đ). Đọc thẳng prisma/seed.ts (import seed.ts chạy main() cần DB),
 * để seed và mặc định trong mã không lệch nhau.
 */
const seedSrc = readFileSync(join(__dirname, '../../../prisma/seed.ts'), 'utf-8');

function seededRow(key: string): string {
  const line = seedSrc.split('\n').find((l) => l.includes(`key: '${key}'`));
  expect(line).toBeDefined();
  return line as string;
}

describe('seed ngưỡng freeship (Q12)', () => {
  it('shipping.free_threshold = 199000 và mô tả không còn ghi 200k', () => {
    const row = seededRow('shipping.free_threshold');
    expect(row).toMatch(/value: 199000\b/);
    expect(row).not.toMatch(/200k|200\.000/);
  });
  it('mô tả phí cố định ghi đúng ngưỡng 199k', () => {
    expect(seededRow('shipping.flat_fee_below_threshold')).not.toMatch(/200k|200\.000/);
  });
});
