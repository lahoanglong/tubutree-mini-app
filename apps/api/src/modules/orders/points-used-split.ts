/**
 * Phần Điểm Xanh của một đơn theo lô. `orders.pointsUsed` là TỔNG ba lô; phần lô CONVERTED và MARKETPLACE có cột riêng, phần STANDARD
 * là phần còn lại. Mọi nơi cần phần STANDARD (trừ điểm lúc đặt, hoàn khi huỷ/trả, chia đơn tách) phải đi qua hàm ở đây: tự trừ
 * `pointsUsed - pointsUsedConverted` mà quên lô MARKETPLACE sẽ hoàn phần điểm sàn thành điểm thường, rồi điểm đó tiêu được cho vòng
 * quay, cây, đổi quà. Spec tĩnh `points-used-split.spec.ts` cấm biểu thức `pointsUsed - ` ở mọi tệp khác.
 */
export interface PointsUsedByLot {
  pointsUsed: number;
  pointsUsedConverted: number;
  /** Đơn trước W42 và các kiểu cũ không có cột này: 0. */
  pointsUsedMarketplace?: number | null;
}

const nonNeg = (n: number | null | undefined): number => (Number.isFinite(n) ? Math.max(0, n as number) : 0);

/** Phần lô MARKETPLACE, không quá tổng đã dùng. */
export function marketplacePointsUsed(o: PointsUsedByLot): number {
  return Math.min(nonNeg(o.pointsUsed), nonNeg(o.pointsUsedMarketplace));
}

/** Phần lô CONVERTED, không quá phần còn lại sau lô MARKETPLACE. */
export function convertedPointsUsed(o: PointsUsedByLot): number {
  return Math.min(nonNeg(o.pointsUsed) - marketplacePointsUsed(o), nonNeg(o.pointsUsedConverted));
}

/** Phần lô STANDARD = tổng − CONVERTED − MARKETPLACE (≥ 0). */
export function standardPointsUsed(o: PointsUsedByLot): number {
  return Math.max(0, nonNeg(o.pointsUsed) - convertedPointsUsed(o) - marketplacePointsUsed(o));
}

/** Đơn có dùng điểm thuộc lô có hạn (STANDARD hoặc MARKETPLACE): hoàn lại cần hạn mới (`loyalty.pointsExpiresAt`). */
export function usesExpiringPoints(o: PointsUsedByLot): boolean {
  return standardPointsUsed(o) + marketplacePointsUsed(o) > 0;
}
