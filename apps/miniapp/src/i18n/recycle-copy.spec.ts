import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { describe, it, expect } from 'vitest';

/** Câu chữ luồng Đổi rác / Kho quà (spec 16.1, 14.6, 14.7, 5.7): chỉ quét chuỗi và chữ JSX, không quét tên biến (field `voucher`, kind 'VOUCHER'). */
const SRC = join(process.cwd(), 'src');
const NEW_FLOW = /^(pages\/(recycle|rewards)[\w-]*|services\/waste-api|utils\/waste-labels|components\/waste-[\w-]+|components\/ui\/timeline)\.tsx?$/;
const walk = (d: string): string[] => readdirSync(d).flatMap((n) => { const p = join(d, n); return statSync(p).isDirectory() ? walk(p) : [p]; });
const files = walk(SRC).map((f) => relative(SRC, f).split(sep).join('/')).filter((f) => NEW_FLOW.test(f) && !/\.spec\./.test(f));
const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
const textsOf = (s: string) => [
  ...[...s.matchAll(/(['"`])((?:\\.|(?!\1)[^\\])*)\1/g)].map((m) => m[2]!),
  ...[...s.matchAll(/>([^<>{}]+)</g)].map((m) => m[1]!),
];
const FORBIDDEN: [string, RegExp][] = [
  ['voucher', /[Vv]oucher/], ['xu', /(?<![\p{L}\p{N}_])[Xx]u(?![\p{L}\p{N}_])/u], ['TubuXu', /Tubu[\s -]?Xu/iu],
  ['Mã ưu đãi', /mã ưu đãi/iu], ['điểm Xanh', /điểm Xanh/u], ['cây thật', /cây\s+thật/iu], ['mua cây', /\bmua (1 )?cây\b/iu],
  ['CO2', /CO2|CO₂/u], ['hấp thụ', /hấp thụ/iu], ['Mã chứng nhận', /Mã chứng nhận/u], ['PanNature', /PanNature|Rừng Xanh Lên/iu],
  ['/merchant', /\/merchant/u], ['Cổng đối tác', /Cổng đối tác|Kênh Đối Tác/iu], ['tái chế', /tái chế/iu], ['tái sinh', /tái sinh/iu],
  ['giảm khí thải', /giảm khí thải/iu], ['EPR', /\bEPR\b/u], ['xử lý đúng chuẩn', /xử lý đúng chuẩn/iu],
];

describe('câu chữ luồng Đổi rác lấy quà', () => {
  it('danh sách quét không rỗng', () => { expect(files).toContain('utils/waste-labels.ts'); });
  it.each(FORBIDDEN)('không có "%s"', (_n, re) => {
    const off = files.filter((f) => textsOf(strip(readFileSync(join(SRC, f), 'utf8'))).some((t) => re.test(t)));
    expect(off).toEqual([]);
  });
  it('bộ tách chữ bắt chuỗi và chữ JSX, bỏ tên biến', () => {
    const t = textsOf("const v = r.voucher; const k = 'VOUCHER'; <b>Đổi mã giảm giá</b>");
    expect(t).toContain('VOUCHER');
    expect(t).toContain('Đổi mã giảm giá');
    expect(t.some((x) => /[Vv]oucher/.test(x))).toBe(false);
  });
});

/** Biểu tượng dùng icon, không emoji; thẻ bấm được là ListRow/GameLinkRow, không Card onPress (spec 16.1). Regex emoji chép từ ds-c076-pc10a.spec.ts. */
const EMOJI = /[\p{Extended_Pictographic}\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}]/u;
const CARD_PRESS = /<Card\b[^>]*\bonPress=/s;

describe('giao diện luồng Đổi rác lấy quà (spec 16.1)', () => {
  it('không emoji (dùng icon)', () => {
    expect(files.filter((f) => EMOJI.test(strip(readFileSync(join(SRC, f), 'utf8'))))).toEqual([]);
  });
  it('không Card có onPress (dùng ListRow hoặc GameLinkRow)', () => {
    expect(files.filter((f) => CARD_PRESS.test(strip(readFileSync(join(SRC, f), 'utf8'))))).toEqual([]);
  });
  it('hai regex bắt đúng mẫu', () => {
    expect(EMOJI.test("label: '♻️ Đổi rác'")).toBe(true);
    expect(EMOJI.test("label: 'Đổi rác · 30.000đ – 45.000đ'")).toBe(false);
    expect(CARD_PRESS.test('<Card padding="md"\n  onPress={() => go()}>')).toBe(true);
    expect(CARD_PRESS.test('<Card padding="md">\n<ListRow onPress={go} />')).toBe(false);
  });
});
