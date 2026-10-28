/** Gõ số vào ô số lượng: bỏ ký tự không phải số, kẹp vào [min, max]; rỗng thì về min. Tách riêng để ô số lượng không kéo theo cả bộ chữ của Đổi rác. */
export function parseQtyInput(raw: string, min: number, max: number): number {
  const digits = raw.replace(/\D/g, '').slice(0, 7);
  if (digits === '') return min;
  return Math.max(min, Math.min(max, Number(digits)));
}
