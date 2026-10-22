import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

/**
 * Q13: một kiểu đặt dấu cho chữ hiện ra với khách/nhân viên: "huỷ, xoá, khoá, hoá đơn, tuỳ, thuỷ"
 * (dấu trên chữ cái thứ hai của vần oa/oe/uy), khớp tài liệu và màn quản trị. Địa danh giữ chính tả hành chính.
 */
const OLD_STYLE_TONE = /(?:[òóỏõọ][ae]|[ùúủũụ]y)(?![\p{L}])/u;
const PLACE_NAMES = /Thanh Hóa|Khánh Hòa/g;
const stripComments = (t: string) => t.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`])\/\/.*$/gm, '$1');

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
}

const API_ROOT = join(__dirname, '..', '..');
const files = [
  ...walk(join(API_ROOT, 'src')).filter((f) => /\.ts$/.test(f) && !/\.spec\.ts$/.test(f)),
  join(API_ROOT, 'prisma/seed.ts'),
  ...walk(join(API_ROOT, 'prisma/reference-data')).filter((f) => /\.(ts|json)$/.test(f) && !/\.spec\.ts$/.test(f)),
];

describe('kiểu đặt dấu chữ hiển thị (Q13)', () => {
  it('thông điệp lỗi, mẫu tin, dữ liệu mẫu không còn "hủy/xóa/khóa/hóa/hòa/tùy" kiểu cũ', () => {
    const bad = files
      .filter((f) => OLD_STYLE_TONE.test(stripComments(readFileSync(f, 'utf8')).replace(PLACE_NAMES, '')))
      .map((f) => relative(API_ROOT, f).split(sep).join('/'));
    expect(bad).toEqual([]);
  });

  it('mẫu quét bắt kiểu cũ và bỏ qua kiểu mới (đối chứng)', () => {
    for (const bad of ['Đã hủy', 'xóa', 'từ khóa', 'hóa đơn VAT', 'tùy', 'thủy']) expect(OLD_STYLE_TONE.test(bad)).toBe(true);
    for (const ok of ['Đã huỷ', 'xoá', 'từ khoá', 'hoá đơn VAT', 'tuỳ', 'thuỷ', 'khoản', 'hoạt']) expect(OLD_STYLE_TONE.test(ok)).toBe(false);
  });
});
