import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { describe, it, expect } from 'vitest';

/**
 * PD-3: Điểm Xanh khách thấy = pointsBalance (lô thường) + pointsConvertedBalance (lô quy đổi từ xu cũ). Đọc
 * thẳng `.pointsBalance` để hiện cho khách là lỗi đã gặp hai lần (web thanh toán/tài khoản, rồi lời chào Trang
 * chủ): khách vừa được quy đổi xu thấy "0 điểm". Chỗ cần số hiện ra dùng `pointsSummary(x).total`
 * (utils/points-lots). File dưới đây được đọc thẳng vì tự xử lý đủ hai lô; thêm file mới vào danh sách chỉ khi
 * xử lý lô quy đổi riêng và ghi lý do.
 */
const READS_STANDARD_LOT_ON_PURPOSE: Record<string, string> = {
  'utils/points-lots.ts': 'pointsSummary: nơi duy nhất cộng hai lô',
  'utils/checkout-rules.ts': 'checkoutPoints: lô thường dùng được (trừ phần khoá) cộng lô quy đổi',
  'services/account-api.ts': 'luật đổi mã giảm giá / hạng chỉ tính lô thường (lô quy đổi không đổi được mã, không xét hạng)',
  'pages/checkout.tsx': 'truyền hai lô vào checkoutPoints',
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

describe('Điểm Xanh hai lô: không đọc thẳng pointsBalance để hiện cho khách (PD-3)', () => {
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
