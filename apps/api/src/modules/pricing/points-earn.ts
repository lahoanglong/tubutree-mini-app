/**
 * Điểm Xanh tích cho một kiện hàng: `earnPct` phần trăm giá trị hàng sau mọi giảm giá (không gồm ship), nhân hệ số hạng,
 * làm tròn xuống; 1 điểm = 1đ. File không phụ thuộc gì để miniapp đối chiếu được (apps/miniapp/src/utils/points-earn.ts có
 * bản sao, spec của nó chạy so từng giá trị với hàm này): đổi công thức ở đâu thì đổi ở cả hai.
 *
 * Tính toàn số nguyên (phần trăm và hệ số nhân 100 rồi làm tròn) vì 199.000 × 0,02 × 1,2 trong số thực dễ ra 4775,999…
 * và rớt mất 1 điểm. Lớn nhất 2e9 × 2.000 × 200 = 8e14 < 2^53.
 */
export function pointsForGoods(goodsValue: number, earnPct: number, tierMultiplier = 1): number {
  if (!(earnPct > 0) || !(goodsValue > 0) || !(tierMultiplier > 0)) return 0;
  return Math.floor((Math.floor(goodsValue) * Math.round(earnPct * 100) * Math.round(tierMultiplier * 100)) / 1_000_000);
}
