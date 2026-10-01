/**
 * Tìm không dấu tiếng Việt (spec 4b §2, Ruling 1 của plan 4b) — KHÔNG dùng extension `unaccent`:
 * quyền/phiên bản Postgres prod chưa rõ, và một migration `CREATE EXTENSION` lỗi sẽ chặn mọi lần
 * `prisma migrate deploy` sau đó (P3009). `translate()` có sẵn trong Postgres, không cần quyền gì.
 *
 * Cùng MỘT bảng ký tự dùng cho cả hai phía:
 *  - SQL: `lower(translate(p.name, VN_FOLD_FROM, VN_FOLD_TO))` (catalog.service.ts);
 *  - TypeScript: `foldVietnamese(q)` cho từ khoá khách gõ.
 * Bảng gồm cả chữ HOA (để không phụ thuộc `lower()` của collation DB — collation C không hạ được
 * chữ có dấu) và 8 dấu kết hợp (tên lưu dạng NFD: dấu bị xoá, giữ chữ gốc).
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

function buildFoldMap(): { from: string; to: string; map: Map<string, string> } {
  let from = '';
  let to = '';
  const map = new Map<string, string>();
  for (const [base, chars] of LETTER_GROUPS) {
    for (const ch of chars + chars.toUpperCase()) {
      from += ch;
      to += base;
      map.set(ch, base);
    }
  }
  return { from: from + VN_COMBINING_MARKS, to, map };
}

const FOLD = buildFoldMap();
const COMBINING = new Set(VN_COMBINING_MARKS);

/** Tham số `from` của translate(): mọi chữ có dấu (thường + HOA) rồi 8 dấu kết hợp ở cuối. */
export const VN_FOLD_FROM = FOLD.from;
/** Tham số `to` của translate(): ngắn hơn `from` đúng 8 ký tự → Postgres xoá các dấu kết hợp. */
export const VN_FOLD_TO = FOLD.to;

/** "  NƯỚC  Rửa " → "nuoc rua". Cùng bảng với SQL (xem đầu file). */
export function foldVietnamese(input: string): string {
  let out = '';
  for (const ch of input) {
    if (COMBINING.has(ch)) continue;
    out += FOLD.map.get(ch) ?? ch;
  }
  return out.toLowerCase().replace(/\s+/g, ' ').trim();
}

/** Ký tự escape cho LIKE — dùng '!' thay '\\' để không phải đoán cách template literal escape. */
export const LIKE_ESCAPE = '!';

/** `%` và `_` khách gõ phải khớp đúng nghĩa đen, không thành ký tự đại diện. */
export function escapeLike(s: string): string {
  return s.replace(/[!%_]/g, (c) => `${LIKE_ESCAPE}${c}`);
}

/** Mẫu "chứa" cho `... LIKE <mẫu> ESCAPE '!'`. */
export function likeContainsPattern(q: string): string {
  return `%${escapeLike(foldVietnamese(q))}%`;
}
