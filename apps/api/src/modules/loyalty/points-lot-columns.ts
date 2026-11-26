import type { PointsLot } from '@prisma/client';

/**
 * Cột số dư của từng lô Điểm Xanh trên `users`. Sổ cái (points-ledger.ts) và đối soát (points-reconcile.ts) dùng chung bảng này,
 * nên thêm lô mới là thêm một dòng ở đây; `satisfies Record<PointsLot, …>` làm tsc đỏ khi enum có lô chưa có cột.
 *
 * - STANDARD: điểm thưởng thường, có hạn, tiêu ở mọi nơi (trần `loyalty.max_redeem_pct` khi đặt đơn).
 * - CONVERTED: điểm quy từ xu (tiền trả trước), không hạn, không trần % khi đặt đơn.
 * - MARKETPLACE (W42): điểm tích từ đơn sàn (claim SCAN), có hạn, CHỈ tiêu khi đặt đơn (chung trần % với STANDARD).
 */
export const POINTS_LOT_BALANCE_COLUMN = {
  STANDARD: 'pointsBalance',
  CONVERTED: 'pointsConvertedBalance',
  MARKETPLACE: 'pointsMarketplaceBalance',
} as const satisfies Record<PointsLot, string>;

export type PointsLotBalanceColumn = (typeof POINTS_LOT_BALANCE_COLUMN)[PointsLot];

/** Mọi lô, theo thứ tự cố định (đối soát, báo cáo). */
export const POINTS_LOTS = Object.keys(POINTS_LOT_BALANCE_COLUMN) as PointsLot[];

/** Lô có hạn: dòng cộng mang `expiresAt` và cron 01:00 trừ phần hết hạn (loyalty-expiry.service.ts). */
export const EXPIRING_POINTS_LOTS = ['STANDARD', 'MARKETPLACE'] as const satisfies readonly PointsLot[];
export type ExpiringPointsLot = (typeof EXPIRING_POINTS_LOTS)[number];
