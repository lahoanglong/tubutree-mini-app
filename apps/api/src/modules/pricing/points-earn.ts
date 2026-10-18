/**
 * Điểm Xanh tích cho một kiện hàng: giá trị hàng sau mọi giảm giá chia mốc `loyalty.vnd_per_point`, nhân hệ số hạng, làm
 * tròn xuống. File không phụ thuộc gì để miniapp đối chiếu được (apps/miniapp/src/utils/points-earn.ts có bản sao, spec
 * của nó chạy so từng giá trị với hàm này): đổi công thức ở đâu thì đổi ở cả hai.
 */
export function pointsForGoods(goodsValue: number, vndPerPoint: number, tierMultiplier = 1): number {
  if (vndPerPoint <= 0) return 0;
  return Math.floor((goodsValue / vndPerPoint) * tierMultiplier);
}
