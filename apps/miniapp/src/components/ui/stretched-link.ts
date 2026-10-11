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

/** Vùng chạm 44px cho nút phủ khi chữ của nó thấp hơn 44px, mà không làm bố cục cao thêm: đệm dọc làm hộp nút
 * cao đủ 44px, lề âm cùng cỡ trả lại phần đệm cho dòng quanh nó (hộp trong suốt nằm trong khoảng trống bên cạnh).
 * `textHeight` = chiều cao một dòng chữ của nút; chữ nhiều dòng chỉ cao thêm nên vẫn đúng. Cần lề dọc riêng thì
 * bọc nút trong một div có lề, đừng ghi đè `margin` ở đây. */
export function stretchedLinkHit44(textHeight: number): CSSProperties {
  const pad = Math.max(0, Math.ceil((44 - textHeight) / 2));
  return { boxSizing: 'border-box', minHeight: 44, padding: `${pad}px 0`, margin: `${-pad}px 0` };
}
