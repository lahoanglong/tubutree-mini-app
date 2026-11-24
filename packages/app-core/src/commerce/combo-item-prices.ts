/**
 * Giá từng món trong một combo để so với giá lẻ, cho danh sách món của `ComboCard` ở trang sản phẩm và trang Bộ quà tặng (THUẦN). Module
 * không nhập gì: `ComboCard` nằm cả ở Trang chủ, thêm một module có phụ thuộc sẽ kéo thêm byte vào gói của trang đó.
 *
 * Giá trong bộ của mỗi món là giá lẻ trừ phần giảm làm tròn xuống từng món, đúng phép của `comboTotals` và `allocateBundleDiscounts` (giỏ).
 * Chỉ nêu giá trong bộ của từng món khi tổng các giá đó khớp đúng `comboTotal` của thẻ; máy chủ kẹp mức giảm (trần tiền của bộ, xem
 * `withServerSaving`) thì phần giảm không còn chia đều theo % nên từng món chỉ hiện giá lẻ, tổng cả bộ vẫn là số máy chủ. Dữ liệu lệch
 * (tổng giá lẻ khác `total`, giá hỏng, bộ không giảm) thì null: thẻ giữ danh sách tên như cũ.
 */
export interface ComboItemPrice {
  /** Giá lẻ của món (một đơn vị). */
  price: number;
  /** Giá của món khi mua cả bộ; null khi không chia được đúng tới từng món. */
  comboPrice: number | null;
}

const isMoney = (n: unknown): n is number => typeof n === 'number' && Number.isInteger(n) && n >= 0;

export function comboItemPrices(prices: readonly number[], pct: number, total: number, comboTotal: number): ComboItemPrice[] | null {
  if (prices.length === 0 || !prices.every(isMoney) || !isMoney(total) || !isMoney(comboTotal)) return null;
  if (prices.reduce((s, p) => s + p, 0) !== total || !(comboTotal < total)) return null;
  const rate = Number.isFinite(pct) && pct > 0 ? Math.min(pct, 100) : 0;
  const each = prices.map((p) => p - Math.floor((p * rate) / 100));
  const exact = rate > 0 && each.reduce((s, p) => s + p, 0) === comboTotal;
  return prices.map((price, i) => ({ price, comboPrice: exact ? each[i]! : null }));
}
