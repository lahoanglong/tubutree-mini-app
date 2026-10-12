import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { describe, it, expect } from 'vitest';

/**
 * PD-3: Điểm Xanh khách/nhân viên thấy = pointsBalance (lô thường) + pointsConvertedBalance (lô quy đổi từ xu
 * cũ). Đọc thẳng `.pointsBalance` để hiện là lỗi đã gặp hai lần (web thanh toán/tài khoản, rồi quầy POS và
 * danh sách người dùng admin): khách vừa được quy đổi xu thấy thiếu điểm. Chỗ cần số hiện ra dùng
 * `pointsSummary(x).total` (lib/checkout-points). File dưới đây được đọc thẳng vì tự xử lý đủ hai lô.
 */
const READS_STANDARD_LOT_ON_PURPOSE: Record<string, string> = {
  'lib/checkout-points.ts': 'pointsSummary và checkoutPointsOffer: nơi cộng hai lô',
  'lib/export-csv.ts': 'CSV người dùng: truyền cả hai lô vào pointsSummary',
};

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
}
const SRC = join(process.cwd(), 'src');
const sources = walk(SRC)
  .filter((f) => /\.(ts|tsx)$/.test(f) && !/\.spec\./.test(f))
  .map((f) => ({ file: relative(SRC, f).split(sep).join('/'), text: readFileSync(f, 'utf8') }));

describe('Điểm Xanh hai lô: không đọc thẳng pointsBalance để hiện (PD-3)', () => {
  it('chỉ các file đã duyệt mới đọc .pointsBalance; chỗ khác dùng pointsSummary(...).total', () => {
    const offenders = sources
      .filter((s) => /\.pointsBalance\b/.test(s.text) && !(s.file in READS_STANDARD_LOT_ON_PURPOSE))
      .map((s) => s.file);
    expect(offenders).toEqual([]);
  });

  it('danh sách duyệt không chứa file không còn đọc .pointsBalance (dọn khi mã đổi)', () => {
    const stale = Object.keys(READS_STANDARD_LOT_ON_PURPOSE).filter(
      (f) => !sources.some((s) => s.file === f && /\.pointsBalance\b/.test(s.text)),
    );
    expect(stale).toEqual([]);
  });
});
