// Nguồn duy nhất của nhãn phân loại hiện cho khách; web và Mini App chỉ re-export để hai app không bao giờ lệch nhau.

/** Chữ thay cho phân loại không có tên khi sản phẩm có từ 2 phân loại trở lên; phân loại duy nhất không tên thì không ghi gì. */
export const DEFAULT_VARIATION_LABEL = 'Mặc định';

const HAS_OBJECT_STRING = /\[object Object\]/i;
const ALL_OBJECT_STRINGS = /\[object Object\]/gi;

/**
 * Tên phân loại từ sàn đôi khi là một object bị ép thành chuỗi ("[object Object]", có khi dính sau tên thật hoặc lặp lại); khách không được thấy chuỗi đó.
 * Chuỗi không chứa nó được trả y nguyên (chỉ chuỗi bị gỡ mới gộp khoảng trắng thừa), để không đổi cách hiện của tên bình thường.
 */
function stripObjectString(text: string): string {
  if (!HAS_OBJECT_STRING.test(text)) return text;
  return text.replace(ALL_OBJECT_STRINGS, ' ').replace(/\s+/g, ' ').trim();
}

/**
 * Nhãn phân loại để hiện cho khách, hoặc `null` khi không có gì để hiện. Tên trống/toàn khoảng trắng (nhiều phân loại trên sàn không đặt tên)
 * hoặc chỉ gồm "[object Object]": chỉ có một phân loại thì ẩn hẳn (không có gì để chọn), có anh em thì "Mặc định" để còn phân biệt được với các phân loại có tên.
 * Nơi không biết số phân loại anh em (giỏ, đơn, thanh toán) để `siblingCount` mặc định: tên trống là ẩn.
 */
export function variationLabel(name: string | null | undefined, siblingCount = 1): string | null {
  const trimmed = typeof name === 'string' ? stripObjectString(name).trim() : '';
  if (trimmed) return trimmed;
  return siblingCount > 1 ? DEFAULT_VARIATION_LABEL : null;
}

/** Ghép nhãn vào sau `base` ("Tên SP · Nhãn"); không có nhãn thì trả đúng `base`, không để lại dấu phân cách treo. */
export function joinVariationLine(base: string, label: string | null | undefined, sep = ' · '): string {
  return label ? `${base}${sep}${label}` : base;
}

/** Nối các phần có chữ bằng `sep` (bỏ phần trống/null/chỉ còn "[object Object]" cùng dấu phân cách của nó): "Nhãn · còn trả được 2", "Nhãn · SL 3". */
export function joinDetailParts(parts: readonly (string | null | undefined | false)[], sep = ' · '): string {
  return parts
    .map((p) => (typeof p === 'string' ? stripObjectString(p) : ''))
    .filter((p) => p.trim() !== '')
    .join(sep);
}
