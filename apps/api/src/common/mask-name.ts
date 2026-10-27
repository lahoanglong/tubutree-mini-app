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
  if (!name) return 'Bạn Tubu';
  const parts = name.trim().split(' ');
  return `${parts[parts.length - 1] ?? ''}***`;
}

/**
 * Đơn gian hàng đối tác (merchant) cho CTV/đại lý xem. Tách theo mọi khoảng trắng; tên trống hoặc
 * toàn khoảng trắng rơi về "Khách Tubu".
 */
export function maskFullName(name: string | null | undefined): string {
  if (!name || !name.trim()) return 'Khách Tubu';
  const parts = name.trim().split(/\s+/);
  return `${parts[parts.length - 1]}***`;
}

/**
 * Tên hiển thị công khai (bài viết, bình luận, đánh giá): tên gọi kèm chữ cái đầu của họ ("Lại N."), không lộ họ tên đầy đủ.
 * Tên trống, có chữ số hoặc "@" (người dùng gõ số điện thoại hay email làm tên) thì dùng `fallback`, không bao giờ in số ra.
 */
export function publicDisplayName(fullName: string | null | undefined, fallback = 'Bạn Tubu'): string {
  const name = fullName?.trim() ?? '';
  if (!name || /[\d@]/.test(name)) return fallback;
  const parts = name.split(/\s+/);
  if (parts.length === 1) return parts[0]!;
  return `${parts.at(-1)} ${Array.from(parts[0]!)[0]!.toLocaleUpperCase('vi')}.`;
}
