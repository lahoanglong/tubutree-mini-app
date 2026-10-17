import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * PC-9: ngày giờ hiển thị phải đi qua lib/format-date.ts. toLocaleDateString/toLocaleString('vi-VN') trả "1/9/2026"
 * (không đệm số 0), kèm giây, và dáng đổi theo phiên bản ICU. Quét mã nguồn để cách viết cũ không quay lại.
 * export-csv.ts nằm ngoài vì là giá trị ghi vào file Excel của kế toán, không phải chữ hiển thị trên màn hình.
 *
 * Số thì web gọi thẳng `n.toLocaleString('vi-VN')` (không có helper formatNumber như Mini App), mà regex không phân biệt
 * được số với ngày, nên:
 *  - cách viết CHỈ dành cho ngày (toLocaleDateString, toLocaleTimeString, dateStyle, timeStyle, Intl.DateTimeFormat)
 *    bị cấm hẳn, ngoại lệ phải có tên file và lý do (DATE_API_EXCEPTIONS);
 *  - `.toLocaleString(` bị cấm khi đứng trên `new Date(...)` hay kèm tuỳ chọn ngày giờ; mọi lần gọi còn lại phải nằm
 *    trong NUMBER_TO_LOCALE_STRING (file, số lần, lý do là số) — thêm một lần gọi mới là phải mở spec này và xác nhận
 *    đó là số, không phải ngày.
 * Giới hạn: một `.toLocaleString(` trên biến ngày trong file đã có tên trong danh sách chỉ bị bắt nhờ số lần gọi tăng.
 */
function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
}
const SRC = join(process.cwd(), 'src');
const stripComments = (t: string) =>
  t.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' ')).replace(/(^|[^:])\/\/.*$/gm, '$1');
const sources = walk(SRC)
  .filter((f) => /\.(ts|tsx)$/.test(f) && !/\.spec\./.test(f))
  .map((f) => ({ file: relative(SRC, f).split(sep).join('/'), text: stripComments(readFileSync(f, 'utf8')) }))
  .filter((s) => s.file !== 'lib/export-csv.ts' && s.file !== 'lib/format-date.ts');

const DATE_ONLY_API = /\.toLocale(?:Date|Time)String\(|\bdateStyle\b|\btimeStyle\b|\bIntl\.DateTimeFormat\b/g;
const DATE_OPTIONS = /\b(?:year|month|day|hour|minute|second|weekday|era|timeZone|hour12|hourCycle|timeZoneName)\s*:/;

const DATE_API_EXCEPTIONS: Record<string, string> = {
  'lib/loyalty-pos.ts': 'vnDayKey: khoá máy "YYYY-MM-DD" (en-CA, Asia/Ho_Chi_Minh) khớp dayKey của BE, không phải chữ hiển thị',
};

/** Mỗi file: số lần `.toLocaleString(` được phép và lý do. Tất cả đều là SỐ (điểm, tiền, phần trăm, ngưỡng). */
const NUMBER_TO_LOCALE_STRING: Record<string, { count: number; why: string }> = {
  'app/tai-khoan/page.tsx': { count: 1, why: 'points.total (tổng Điểm Xanh)' },
  'app/tai-khoan/orders-section.tsx': { count: 2, why: 'số đơn đang hiển thị / tổng số đơn' },
  'app/thanh-toan/page.tsx': { count: 2, why: 'quote.pointsUsed, usablePoints (Điểm Xanh)' },
  'components/admin/pos-credits-tab.tsx': { count: 1, why: 'sum.points (điểm đã tích)' },
  'components/admin/ns1-card.tsx': { count: 1, why: 'formatPct: phần trăm làm tròn 1 chữ số' },
  'components/settlement-table.tsx': { count: 1, why: 'formatPct: phần trăm phí sàn / phí Tubu giao hộ' },
  'components/admin/account-deletion-panel.tsx': { count: 1, why: 'pointsConvertedBalance (điểm không hết hạn)' },
  'components/admin/pos-screen.tsx': { count: 2, why: 'tổng Điểm Xanh của hội viên' },
  'lib/admin-config-forms.ts': { count: 2, why: 'cận min và max của ô cấu hình số nguyên' },
  'lib/checkout-points.ts': { count: 1, why: 'group(n): nhóm nghìn của số điểm' },
  'lib/format-vnd.ts': { count: 1, why: 'formatVnd: số tiền' },
};

interface LocaleCall {
  receiver: string;
  args: string;
}

/** Phần biểu thức đứng trước `.` (bỏ qua cặp ngoặc cân bằng), vd "new Date(a.b(c))" hay "points.total". */
function receiverBefore(text: string, dot: number): string {
  let i = dot;
  while (i > 0) {
    const c = text[i - 1]!;
    if (c === ')' || c === ']') {
      const open = c === ')' ? '(' : '[';
      let depth = 0;
      let j = i - 1;
      for (; j >= 0; j--) {
        if (text[j] === c) depth++;
        else if (text[j] === open && --depth === 0) break;
      }
      if (j < 0) break;
      i = j;
    } else if (/[\w$.?!]/.test(c)) i--;
    else break;
  }
  if (text.slice(Math.max(0, i - 4), i) === 'new ') i -= 4;
  return text.slice(i, dot);
}

function argsAfter(text: string, open: number): string {
  let depth = 0;
  for (let j = open; j < text.length; j++) {
    if (text[j] === '(') depth++;
    else if (text[j] === ')' && --depth === 0) return text.slice(open + 1, j);
  }
  return text.slice(open + 1);
}

function toLocaleStringCalls(text: string): LocaleCall[] {
  const out: LocaleCall[] = [];
  const re = /\.toLocaleString\(/g;
  for (let m = re.exec(text); m; m = re.exec(text)) {
    out.push({ receiver: receiverBefore(text, m.index), args: argsAfter(text, m.index + m[0].length - 1) });
  }
  return out;
}

const looksLikeDate = (c: LocaleCall) => /^(?:new\s+)?Date\(/.test(c.receiver) || DATE_OPTIONS.test(c.args);

describe('ngày giờ hiển thị đi qua formatDate/formatDateTime (PC-9)', () => {
  it('không còn toLocaleDateString, toLocaleTimeString, dateStyle, timeStyle hay Intl.DateTimeFormat ngoài ngoại lệ có lý do', () => {
    const bad = sources
      .filter((s) => !(s.file in DATE_API_EXCEPTIONS))
      .filter((s) => new RegExp(DATE_ONLY_API.source).test(s.text))
      .map((s) => s.file);
    expect(bad).toEqual([]);
  });

  it('không có .toLocaleString( trên new Date(...) hay kèm tuỳ chọn ngày giờ ở bất kỳ file nào', () => {
    const bad = sources.flatMap((s) => toLocaleStringCalls(s.text).filter(looksLikeDate).map((c) => `${s.file}: ${c.receiver}.toLocaleString(${c.args})`));
    expect(bad).toEqual([]);
  });

  it('mọi .toLocaleString( còn lại nằm trong danh sách số đã xác nhận, đúng số lần (thêm mới thì phải mở spec này)', () => {
    const counts = Object.fromEntries(
      sources.map((s) => [s.file, toLocaleStringCalls(s.text).length] as const).filter(([, n]) => n > 0),
    );
    const expected = Object.fromEntries(Object.entries(NUMBER_TO_LOCALE_STRING).map(([f, v]) => [f, v.count]));
    expect(counts).toEqual(expected);
  });

  it('các ngoại lệ không cũ: file còn dùng đúng cách viết đó', () => {
    for (const file of Object.keys(DATE_API_EXCEPTIONS)) {
      const src = sources.find((s) => s.file === file);
      expect(src && new RegExp(DATE_ONLY_API.source).test(src.text), `${file} không còn cần ngoại lệ`).toBe(true);
    }
  });
});

describe('bộ quét nhận ra các cách viết ngày cũ và chừa số', () => {
  const flagged = (code: string) => toLocaleStringCalls(code).some(looksLikeDate);

  it.each([
    "new Date(x).toLocaleString('vi-VN')",
    "new Date(order.created_at ?? Date.now()).toLocaleString('vi-VN')",
    "new Date(fmt(a, (b))).toLocaleString()",
    "const s = x.toLocaleString('vi-VN', { hour: '2-digit', minute: '2-digit' })",
    "when.toLocaleString('vi-VN', { year: 'numeric', month: '2-digit' })",
  ])('bắt: %s', (code) => {
    expect(flagged(code), code).toBe(true);
  });

  it.each([
    "n.toLocaleString('vi-VN')",
    "(memberPoints?.total ?? 0).toLocaleString('vi-VN')",
    "pointsSummary(result.member).total.toLocaleString('vi-VN')",
    "Number(p.toFixed(1)).toLocaleString('vi-VN')",
  ])('chừa: %s', (code) => {
    expect(flagged(code), code).toBe(false);
    expect(toLocaleStringCalls(code)).toHaveLength(1);
  });

  it('nhận ra cả các hàm chỉ dành cho ngày', () => {
    for (const bad of [
      "new Date(x).toLocaleDateString('vi-VN')",
      "d.toLocaleTimeString('vi-VN')",
      "f({ dateStyle: 'short' })",
      "new Intl.DateTimeFormat('vi-VN').format(d)",
    ]) {
      expect(new RegExp(DATE_ONLY_API.source).test(bad), bad).toBe(true);
    }
  });
});
