/** Không import và không "use client": cả server lẫn client bundle đều dùng được. */
export function formatVnd(n: number): string {
  return `${n.toLocaleString('vi-VN')}đ`;
}
