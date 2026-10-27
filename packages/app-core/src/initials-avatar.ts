/**
 * Ảnh đại diện của người khác trên màn công khai (Cộng đồng, đánh giá) là vòng tròn chữ cái đầu của đúng cái tên đang hiển thị,
 * không phải ảnh Zalo của khách. Màu nền chọn theo tên để cùng một người luôn cùng màu, ở cả Mini App và web.
 */
export const AVATAR_TONES: readonly { background: string; color: string }[] = [
  { background: '#DCEFD9', color: '#1F4D2B' },
  { background: '#FBE8C8', color: '#6B4311' },
  { background: '#DDE8F7', color: '#1E3A6B' },
  { background: '#F6DDE5', color: '#7A1F3F' },
  { background: '#E6DFF5', color: '#44307A' },
  { background: '#D9EEF0', color: '#124E55' },
];

/** Tên chung khi người dùng không có tên dùng được: chữ "T" của Tubu thay cho chữ đầu của "Bạn"/"Khách", để nhiều người ẩn danh không thành một đám "B" hay "K". */
const FALLBACK_INITIAL = 'T';
const GENERIC_NAMES = new Set(['Bạn Tubu', 'Khách Tubu']);

/** Chữ cái (hoặc chữ số) đầu tiên của tên hiển thị, viết hoa; tên rỗng hoặc toàn ký hiệu thì "T". */
export function avatarInitial(displayName: string | null | undefined): string {
  const name = (displayName ?? '').trim();
  if (GENERIC_NAMES.has(name)) return FALLBACK_INITIAL;
  const first = Array.from(name).find((ch) => /[\p{L}\p{N}]/u.test(ch));
  return first ? first.toLocaleUpperCase('vi') : FALLBACK_INITIAL;
}

/** Màu của vòng tròn theo tên: băm cố định nên không đổi giữa các lần hiển thị hay giữa hai nền tảng. */
export function avatarTone(displayName: string | null | undefined): { background: string; color: string } {
  const name = (displayName ?? '').trim();
  let h = 0;
  for (const ch of name) h = (h * 31 + (ch.codePointAt(0) ?? 0)) >>> 0;
  return AVATAR_TONES[h % AVATAR_TONES.length]!;
}
