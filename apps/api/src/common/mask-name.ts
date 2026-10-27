/**
 * Che tên người dùng khi hiển thị cho người khác: chỉ giữ từ cuối (trong tiếng Việt là "tên gọi"),
 * phần còn lại thay bằng "***". Có hai biến thể vì hai nhóm nơi gọi đang chạy hai hành vi khác nhau
 * ở biên (tab/nbsp trong tên, tên toàn khoảng trắng), không gộp để khỏi đổi cái khách đang thấy.
 */

/**
 * BXH và danh sách bạn bè của Vườn Xanh (game, game-gift, game-season). Chỉ tách theo dấu cách
 * thường; tên toàn khoảng trắng ra "***" (không rơi về tên mặc định).
 */
export function maskName(name: string | null | undefined): string {
  if (!name || looksLikeContact(name)) return 'Bạn Tubu';
  const parts = name.trim().split(' ');
  return `${parts[parts.length - 1] ?? ''}***`;
}

/**
 * Đơn gian hàng đối tác (merchant) cho CTV/đại lý xem. Tách theo mọi khoảng trắng; tên trống hoặc
 * toàn khoảng trắng rơi về "Khách Tubu".
 */
export function maskFullName(name: string | null | undefined): string {
  if (!name || !name.trim() || looksLikeContact(name)) return 'Khách Tubu';
  const parts = name.trim().split(/\s+/);
  return `${parts[parts.length - 1]}***`;
}

/** Tên có chữ số hay "@" (số điện thoại, email gõ làm tên; kể cả số toàn khổ hoặc kiểu chữ đậm) thì không đưa ra cho người khác. */
function looksLikeContact(name: string): boolean {
  return /[\p{Nd}@]/u.test(name);
}

const BRACKETED = /[([{][^)\]}]*[)\]}]/gu;
const EDGE_NON_LETTERS = /^[^\p{L}\p{M}]+|[^\p{L}\p{M}]+$/gu;

/**
 * Tên hiển thị công khai (bài viết, bình luận, đánh giá): tên gọi kèm chữ cái đầu của họ ("Lại N."), không lộ họ tên đầy đủ.
 * Tên trống, có chữ số hoặc "@" thì dùng `fallback`. Phần trong ngoặc, emoji và dấu câu không được chọn làm từ ("Hoa 🌸" ra "Hoa",
 * "Lan (Shop cây)" ra "Lan"); khoảng trắng gồm cả ký tự rộng 0 (U+200B) để tách từ.
 */
export function publicDisplayName(fullName: string | null | undefined, fallback = 'Bạn Tubu'): string {
  const name = fullName?.trim() ?? '';
  if (!name || looksLikeContact(name)) return fallback;
  const parts = name
    .replace(BRACKETED, ' ')
    .split(/[\s\u200B-\u200D\u2060\uFEFF]+/u)
    .map((w) => w.replace(EDGE_NON_LETTERS, ''))
    .filter(Boolean);
  if (parts.length === 0) return fallback;
  if (parts.length === 1) return parts[0]!;
  return `${parts.at(-1)} ${Array.from(parts[0]!)[0]!.toLocaleUpperCase('vi')}.`;
}
