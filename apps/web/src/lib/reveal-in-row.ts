/**
 * Cuộn ngang đúng hàng cuộn `row` để `el` nằm trọn trong khung, cách mép `gutter` px; không đụng cuộn của trang.
 * Không dùng `scrollIntoView`: nó cuộn cả trang theo `scroll-padding-top` của html, mà thanh đầu dính nằm trong vùng đệm đó nên trang bị kéo lên.
 * Phần tử rộng hơn khung thì canh theo mép đầu.
 */
export function revealInRow(row: HTMLElement, el: HTMLElement, gutter = 16): void {
  if (row.clientWidth === 0) return;
  const a = row.getBoundingClientRect();
  const b = el.getBoundingClientRect();
  const before = a.left + gutter - b.left;
  if (before > 0) {
    row.scrollLeft -= before;
    return;
  }
  const after = b.right - (a.right - gutter);
  if (after > 0) row.scrollLeft += Math.min(after, b.left - (a.left + gutter));
}
