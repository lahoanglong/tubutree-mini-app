import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

/**
 * Q13: một kiểu đặt dấu cho chữ hiện ra với khách/nhân viên: "huỷ, xoá, khoá, hoá đơn, tuỳ, thuỷ"
 * (dấu trên chữ cái thứ hai của vần oa/oe/uy), khớp tài liệu và màn quản trị. Địa danh giữ chính tả hành chính.
 */
const OLD_STYLE_TONE = /(?:[òóỏõọ][ae]|[ùúủũụ]y)(?![\p{L}])/u;
const PLACE_NAMES = /Thanh Hóa|Khánh Hòa/g;
/**
 * Chuỗi tích hợp phải giữ nguyên từng ký tự, kể cả kiểu dấu cũ. Lý do huỷ quá hạn chuyển khoản được PO duyệt nguyên văn (19/11, A7),
 * đi theo đơn sang MSS qua webhook/đồng bộ trạng thái, và phía MSS lọc theo chuỗi con này. Đổi "hủy" thành "huỷ" là MSS không còn nhận
 * ra đơn tự huỷ. Chỉ miễn đúng chuỗi này ở đúng tệp này; chỗ khác trong tệp vẫn bị quét.
 */
const INTEGRATION_STRINGS: Record<string, string> = {
  'src/modules/orders/mss-payment-rescue.service.ts': 'Tự động hủy do quá hạn chuyển khoản',
};
const rel = (f: string) => relative(API_ROOT, f).split(sep).join('/');
const withoutIntegrationString = (f: string, text: string) => {
  const exact = INTEGRATION_STRINGS[rel(f)];
  return exact ? text.split(exact).join('') : text;
};
const stripComments = (t: string) => t.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`])\/\/.*$/gm, '$1');

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
}

const API_ROOT = join(__dirname, '..', '..');
const files = [
  ...walk(join(API_ROOT, 'src')).filter((f) => /\.ts$/.test(f) && !/\.(?:spec|fixtures)\.ts$/.test(f)),
  join(API_ROOT, 'prisma/seed.ts'),
  ...walk(join(API_ROOT, 'prisma/reference-data')).filter((f) => /\.(ts|json)$/.test(f) && !/\.spec\.ts$/.test(f)),
];

describe('kiểu đặt dấu chữ hiển thị (Q13)', () => {
  it('thông điệp lỗi, mẫu tin, dữ liệu mẫu không còn "hủy/xóa/khóa/hóa/hòa/tùy" kiểu cũ', () => {
    const bad = files
      .filter((f) => OLD_STYLE_TONE.test(withoutIntegrationString(f, stripComments(readFileSync(f, 'utf8'))).replace(PLACE_NAMES, '')))
      .map(rel);
    expect(bad).toEqual([]);
  });

  it('chuỗi tích hợp được miễn vẫn nằm nguyên văn trong tệp của nó (đổi chữ thì phải gỡ dòng miễn, không để miễn treo)', () => {
    for (const [file, exact] of Object.entries(INTEGRATION_STRINGS)) {
      expect([file, readFileSync(join(API_ROOT, file), 'utf8').includes(exact)]).toEqual([file, true]);
      expect(OLD_STYLE_TONE.test(exact)).toBe(true);
    }
  });

  it('mẫu quét bắt kiểu cũ và bỏ qua kiểu mới (đối chứng)', () => {
    for (const bad of ['Đã hủy', 'xóa', 'từ khóa', 'hóa đơn VAT', 'tùy', 'thủy']) expect(OLD_STYLE_TONE.test(bad)).toBe(true);
    for (const ok of ['Đã huỷ', 'xoá', 'từ khoá', 'hoá đơn VAT', 'tuỳ', 'thuỷ', 'khoản', 'hoạt']) expect(OLD_STYLE_TONE.test(ok)).toBe(false);
  });
});
