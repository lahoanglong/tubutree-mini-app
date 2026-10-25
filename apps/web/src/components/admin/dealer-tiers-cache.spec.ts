import { readdirSync, readFileSync } from 'fs';
import path from 'path';
import { describe, expect, it } from 'vitest';

/**
 * Hai API khác dạng từng dùng chung khoá ['admin-dealer-tiers']: mảng (listDealerTiers) và object (listDealerTiersForEdit).
 * Mở "Đại lý & công nợ" rồi "Hoa hồng & giá sỉ" thì tab sau nhận object từ cache và `.map` ném TypeError.
 */
describe('khoá cache bậc đại lý', () => {
  it("khoá trần ['admin-dealer-tiers'] chỉ dành cho listDealerTiers; bản quản lý dùng khoá riêng", () => {
    const dir = __dirname;
    const offenders: string[] = [];
    for (const f of readdirSync(dir).filter((n) => n.endsWith('.tsx') && !n.endsWith('.spec.tsx'))) {
      for (const line of readFileSync(path.join(dir, f), 'utf8').split('\n')) {
        if (line.includes("queryKey: ['admin-dealer-tiers']") && line.includes('queryFn') && !line.includes('queryFn: listDealerTiers,')) offenders.push(`${f}: ${line.trim()}`);
      }
    }
    expect(offenders).toEqual([]);
  });
});
