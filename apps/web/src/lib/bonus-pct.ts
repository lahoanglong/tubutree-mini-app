/** % bậc thưởng quý ghi kiểu Việt (4,5%): tối đa 1 chữ số lẻ, giống Mini App. */
export const bonusPctText = (pct: number) =>
  `${pct.toLocaleString('vi-VN', { maximumFractionDigits: 1 })}%`;
