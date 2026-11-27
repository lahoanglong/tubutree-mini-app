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
    expect(offenders(/định nghĩa với KPI/)).toEqual([]);
  });

  it('QT-12: chữ kỹ thuật ở các tab quản trị đã đổi sang lời thường (cron, SLA, GMV, webhook, slug, khoá cấu hình)', () => {
    expect(offenders(/Hạn SLA|tên miền con|slug hoặc|nhóm merchant|auto-reply|Giá trị đặt \(GMV\)|đối tác CTV \/ Affiliate/)).toEqual([]);
    expect(offenders(/cron tính|Tác vụ nền \(cron\)|Báo động qua webhook|Nhận webhook|Xử lý webhook|Webhook (?:lỗi|kẹt)|Đặt OPS_ALERT_WEBHOOK_URL/)).toEqual([]);
    expect(offenders(/khoá <code>affiliate\.|\(cấu hình affiliate\./)).toEqual([]);
  });

  it('nút đăng khoá học ở Học viện là "Đăng", không kèm chữ tiếng Anh (publish)', () => {
    expect(offenders(/Đăng \(publish\)/)).toEqual([]);
  });

  it('QT-20: nút trả lương ở bảng lương không đặt tên "Đã chuyển" (dễ nhầm với trạng thái)', () => {
    expect(offenders(/aria-label=\{`Đã chuyển · /)).toEqual([]);
  });

  it('W43: chữ hiển thị không dùng "funnel" hay "O2O" (viết "Phễu", "tích điểm đơn sàn")', () => {
    // Chữ người đọc = chuỗi có khoảng trắng hoặc chữ giữa thẻ JSX. Từ dính "-", "." hay chữ khác là khoá truy vấn,
    // thuộc tính data-*, tên biến (w.funnel.x) nên không tính; đoạn giữa ">" và "<" có ( ) ; = là mã TS (kiểu generic), không phải chữ JSX.
    const WORD = /(?<![\w.$/-])(?:funnel|O2O)(?![\w$/-]|\.\w)/i;
    const visibleText = (text: string) => [
      ...[...text.matchAll(/'([^'\n]*)'|"([^"\n]*)"|`([^`]*)`/g)].map((m) => m[1] ?? m[2] ?? m[3] ?? '').filter((t) => /\s/.test(t)),
      ...[...text.matchAll(/>([^<>{}();=]+)</g)].map((m) => m[1]!),
    ];
    const hasWord = (text: string) => visibleText(text).some((t) => WORD.test(t));
    expect(hasWord(`<h3>Cài đặt O2O</h3>`)).toBe(true);
    expect(hasWord(`const t = 'Phễu funnel 30 ngày';`)).toBe(true);
    expect(hasWord(`<section aria-labelledby="external-funnel-title" data-external-funnel className="p-4 rounded">`)).toBe(false);
    expect(hasWord(`const ok = rows.every((r) => r.total === 0) && w.funnel.confirmedRequests === 0;`)).toBe(false);
    expect(hasWord(`useQuery({ queryKey: ['admin-external-claims-funnel', period] })`)).toBe(false);
    expect(sources.filter((s) => hasWord(s.text)).map((s) => s.file)).toEqual([]);
  });

  it('tên nhóm menu cũ và chữ chỉ đường cũ không còn trong app', () => {
    expect(offenders(/Người bán|Đơn hàng & giao vận|Hoàn tiền & đổi trả|Cấu hình & tích hợp|Khách hàng › Đổi rác/)).toEqual([]);
    // tab Nhân sự & quyền thuộc gói khác, chữ "cờ đối tác" ở đó đổi cùng gói đó.
    expect(offenders(/cờ đối tác/).filter((f) => !f.endsWith('staff-roster-tab.tsx'))).toEqual([]);
  });
});
