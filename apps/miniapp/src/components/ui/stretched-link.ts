import type { CSSProperties } from 'react';

/** Lớp CSS (tokens.css) cho nút "phủ cả thẻ": `::after` của nút giãn ra theo vỏ thẻ `position:relative`, nên chạm
 * đâu trên thẻ cũng kích hoạt nút này. Nhờ vậy thẻ có thể chứa nút khác (tim, "Mua lại", chip tag) làm ANH EM của
 * nó thay vì để cả thẻ là phần tử bấm được chứa phần tử bấm được (axe nested-interactive). */
export const STRETCHED_LINK_CLASS = 'tubu-tile-link';

/** Nút trông như chữ thường. Cố ý KHÔNG đặt `position`: `::after` phải định vị theo vỏ thẻ, không theo nút. */
export const STRETCHED_LINK_RESET: CSSProperties = {
  padding: 0,
  border: 'none',
  background: 'none',
  font: 'inherit',
  color: 'inherit',
  textAlign: 'left',
  cursor: 'pointer',
};

/** Vùng chạm 44px cho nút phủ khi chữ của nó thấp hơn 44px, mà không làm hàng chứa nó cao thêm: hộp nút cao 44px,
 * lề âm hai đầu trả lại phần thừa cho bố cục (hộp trong suốt nằm trong đệm/khoảng cách quanh nó). */
export function stretchedLinkHit44(textHeight: number): CSSProperties {
  const overflow = Math.max(0, 44 - textHeight);
  return { minHeight: 44, margin: `${-overflow / 2}px 0` };
}
