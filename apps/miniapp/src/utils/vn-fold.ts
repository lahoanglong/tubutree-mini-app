/**
 * Gấp chữ tiếng Việt để so khớp không dấu ở client (gợi ý danh mục, từ khoá gần đây).
 * CÙNG bảng với apps/api/src/modules/catalog/search-text.ts — đổi một bên phải đổi bên kia
 * (vn-fold.spec.ts có test parity đọc cả hai file nên lệch bảng là test đỏ).
 */
const LETTER_GROUPS: ReadonlyArray<readonly [string, string]> = [
  ['a', 'àáạảãâầấậẩẫăằắặẳẵ'],
  ['e', 'èéẹẻẽêềếệểễ'],
  ['i', 'ìíịỉĩ'],
  ['o', 'òóọỏõôồốộổỗơờớợởỡ'],
  ['u', 'ùúụủũưừứựửữ'],
  ['y', 'ỳýỵỷỹ'],
  ['d', 'đ'],
];

/** Dấu kết hợp của tiếng Việt (dạng NFD): móc, nặng, huyền, sắc, ngã, hỏi, mũ, trăng. */
const VN_COMBINING_MARKS = '̛̣̀́̃̉̂̆';

const COMBINING = new Set(VN_COMBINING_MARKS);
const FOLD = new Map<string, string>();
for (const [base, chars] of LETTER_GROUPS) {
  for (const ch of chars + chars.toUpperCase()) FOLD.set(ch, base);
}

export function foldVietnamese(input: string): string {
  let out = '';
  for (const ch of input) {
    if (COMBINING.has(ch)) continue;
    out += FOLD.get(ch) ?? ch;
  }
  return out.toLowerCase().replace(/\s+/g, ' ').trim();
}

export function includesFolded(haystack: string, needle: string): boolean {
  const n = foldVietnamese(needle);
  return n.length > 0 && foldVietnamese(haystack).includes(n);
}
