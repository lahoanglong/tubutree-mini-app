/**
 * Che tên người dùng khi hiển thị cho người khác: chỉ giữ từ cuối (trong tiếng Việt là "tên gọi"), phần còn lại thay bằng "***".
 * Hai hàm chỉ khác tên chung khi tên không dùng được.
 */

/**
 * BXH và danh sách bạn bè của Vườn Xanh (game, game-gift, game-season): chỉ giữ từ cuối của tên rồi thêm "***". Tên không còn từ nào
 * (trống, toàn emoji hay dấu câu, chỉ có phần trong ngoặc) hoặc giống số điện thoại, email thì dùng "Bạn Tubu".
 */
export function maskName(name: string | null | undefined): string {
  const words = nameWords(name);
  return words.length === 0 ? 'Bạn Tubu' : `${words.at(-1)}***`;
}

/** Đơn gian hàng đối tác (merchant) cho CTV/đại lý xem: cùng cách che, tên không dùng được thì "Khách Tubu". */
export function maskFullName(name: string | null | undefined): string {
  const words = nameWords(name);
  return words.length === 0 ? 'Khách Tubu' : `${words.at(-1)}***`;
}

/** Tên có chữ số hay "@" (số điện thoại, email gõ làm tên; kể cả số toàn khổ hoặc kiểu chữ đậm) thì không đưa ra cho người khác. */
function looksLikeContact(name: string): boolean {
  return /[\p{Nd}@]/u.test(name);
}

const BRACKETED = /[([{][^)\]}]*[)\]}]/gu;
// Ký tự thuộc nhóm chữ (Lo) hay dấu kết hợp (Mn) nhưng hiển thị trắng: phụ âm đệm Hangul, ô braille trống, nối ký tự (U+034F), nguyên âm ngầm Khmer, chọn dạng Mông Cổ; coi như khoảng trắng.
const BLANKS = ['\u115F', '\u1160', '\u3164', '\uFFA0', '\u2800', '\u034F', '\u17B4', '\u17B5', '\u180B', '\u180C', '\u180D'];
const NON_LETTERS = new RegExp(`[^\\p{L}\\p{M}]+|(?:${BLANKS.join('|')})+`, 'u');

/**
 * Các từ chữ của tên để chọn từ hiển thị: bỏ phần trong ngoặc, emoji và dấu câu; tách ở mọi đoạn ký tự không phải chữ hay dấu kết hợp (khoảng trắng, chấm, gạch, gạch dưới, ・, ký tự rộng 0 hay U+00AD), để tên dính liền bằng dấu phân cách vẫn che được.
 * Rỗng khi không có tên dùng được (trống, toàn ký hiệu, có chữ số hoặc "@").
 */
function nameWords(fullName: string | null | undefined): string[] {
  const name = fullName?.trim() ?? '';
  if (!name || looksLikeContact(name)) return [];
  return name
    .replace(BRACKETED, ' ')
    .split(NON_LETTERS)
    .filter(Boolean);
}

/**
 * Tên hiển thị công khai (bài viết, bình luận, đánh giá): tên gọi kèm chữ cái đầu của họ ("Lại N."), không lộ họ tên đầy đủ.
 * Tên không dùng được (xem `nameWords`) thì dùng `fallback`. "Hoa 🌸" ra "Hoa", "Lan (Shop cây)" ra "Lan".
 */
export function publicDisplayName(fullName: string | null | undefined, fallback = 'Bạn Tubu'): string {
  const parts = nameWords(fullName);
  if (parts.length === 0) return fallback;
  if (parts.length === 1) return parts[0]!;
  return `${parts.at(-1)} ${Array.from(parts[0]!)[0]!.toLocaleUpperCase('vi')}.`;
}
