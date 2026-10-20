import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { describe, it, expect } from 'vitest';

/**
 * Chữ hiển thị ở màn quản trị web: một kiểu đặt dấu ("Huỷ, Xoá, Khoá, hoá đơn", Q13) và tên mục/tab bằng tiếng Việt (Q16).
 * `components/admin/portal-header.tsx` thuộc cổng người bán dùng chung với web khách nên không quét ở đây.
 */
function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
}
const SRC = join(process.cwd(), 'src');
const stripComments = (t: string) => t.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`])\/\/.*$/gm, '$1');
const sources = [...walk(join(SRC, 'app/admin')), ...walk(join(SRC, 'components/admin'))]
  .filter((f) => /\.(ts|tsx)$/.test(f) && !/\.spec\./.test(f) && !f.endsWith(`${sep}portal-header.tsx`))
  .map((f) => ({ file: relative(SRC, f).split(sep).join('/'), text: stripComments(readFileSync(f, 'utf8')) }));
const offenders = (re: RegExp) => sources.filter((s) => re.test(s.text)).map((s) => s.file);

const OLD_STYLE_TONE = /(?:[òóỏõọ][ae]|[ùúủũụ]y)(?![\p{L}])/u;
const PLACE_NAMES = /Thanh Hóa|Khánh Hòa/g;

describe('chữ màn quản trị web', () => {
  it('Q13: không còn "Hủy/Xóa/Khóa/hóa/hòa/tùy" kiểu cũ', () => {
    expect(sources.filter((s) => OLD_STYLE_TONE.test(s.text.replace(PLACE_NAMES, ''))).map((s) => s.file)).toEqual([]);
  });

  it('Q16: thanh điều hướng và tab dùng tiếng Việt (KPI, Retention, North-star, Voucher, Flash Sale, Content Kit, Academy)', () => {
    expect(
      offenders(/Tổng quan KPI|số liệu tổng quan KPI|Retention & North-star|số liệu retention|label: 'Voucher'|label: 'Flash Sale'|Content Kit CTV|label: 'Academy'/),
    ).toEqual([]);
    expect(offenders(/Tạo voucher|Mã voucher|Loại voucher|Voucher bắt đầu|Voucher hết hạn|Đã tạo voucher|farm voucher/)).toEqual([]);
    expect(offenders(/[Ff]lash [Ss]ale|Content Kit|Chưa có cohort|gộp cohort/)).toEqual([]);
  });
});
