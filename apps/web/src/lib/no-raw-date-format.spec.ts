import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * PC-9: ngày giờ hiển thị phải đi qua lib/format-date.ts. toLocaleDateString/toLocaleString('vi-VN') trả "1/9/2026"
 * (không đệm số 0), kèm giây, và dáng đổi theo phiên bản ICU. Quét mã nguồn để cách viết cũ không quay lại.
 * export-csv.ts nằm ngoài vì là giá trị ghi vào file Excel của kế toán, không phải chữ hiển thị trên màn hình.
 */
function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
}
const SRC = join(process.cwd(), 'src');
const sources = walk(SRC)
  .filter((f) => /\.(ts|tsx)$/.test(f) && !/\.spec\./.test(f))
  .map((f) => ({ file: relative(SRC, f).split(sep).join('/'), text: readFileSync(f, 'utf8') }))
  .filter((s) => s.file !== 'lib/export-csv.ts');

const RAW_DATE = /toLocaleDateString|toLocaleTimeString|\bdateStyle\b|\btimeStyle\b|new Date\([^)]*\)\s*\.toLocaleString\(/;

describe('ngày giờ hiển thị đi qua formatDate/formatDateTime (PC-9)', () => {
  it('không còn toLocaleDateString, toLocaleTimeString, dateStyle hay new Date(...).toLocaleString trong mã web', () => {
    expect(sources.filter((s) => RAW_DATE.test(s.text)).map((s) => s.file)).toEqual([]);
  });

  it('bộ quét nhận ra cả bốn cách viết cũ', () => {
    for (const bad of [
      "new Date(x).toLocaleDateString('vi-VN')",
      "new Date(x).toLocaleString('vi-VN')",
      "d.toLocaleTimeString('vi-VN')",
      "d.toLocaleString('vi-VN', { dateStyle: 'short' })",
    ]) {
      expect(RAW_DATE.test(bad), bad).toBe(true);
    }
    expect(RAW_DATE.test("n.toLocaleString('vi-VN')")).toBe(false);
  });
});
