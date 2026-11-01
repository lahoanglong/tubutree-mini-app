const EDGE_SYMBOLS = /^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu;
const HAS_LETTER = /\p{L}/u;

/**
 * Tên gọi của họ tên Việt: từ cuối ("Nguyễn Thị Quay Lại" → "Lại"). Lời chào thẻ thành viên dùng nó thay cả họ tên, vì họ tên dài bị cắt "Chào Nguyễ…" ở 375px.
 * Dấu câu và emoji ở hai đầu từ bị bỏ ("Hoa (Mẹ Bắp)" → "Bắp"); từ cuối chỉ còn ký hiệu hay chỉ có chữ số ("Lan 1990" → "Lan", năm sinh không phải tên) thì lùi về từ trước.
 * Không có từ nào có chữ cái thì null để nơi gọi dùng lời chào dự phòng.
 */
export function givenName(fullName: string | null | undefined): string | null {
  const words = (fullName ?? '').split(/\s+/);
  for (let i = words.length - 1; i >= 0; i--) {
    const word = words[i]!.replace(EDGE_SYMBOLS, '');
    if (HAS_LETTER.test(word)) return word;
  }
  return null;
}
