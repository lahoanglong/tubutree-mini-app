import { MARKETPLACE_POINTS_ORDER_ONLY_NOTE } from '@tubutree/shared-types';

/**
 * Câu báo thiếu điểm ở các chỗ tiêu điểm ngoài đơn hàng (vòng quay, cây, đổi quà, phí lấy rác). Khách có điểm sàn (lô MARKETPLACE) thấy
 * tổng điểm đủ nhưng bị từ chối, nên câu báo nói thêm điểm sàn chỉ dùng khi mua hàng. Không có điểm sàn: câu báo giữ nguyên.
 */
export function withMarketplaceNote(message: string, marketplaceBalance: number | null | undefined): string {
  return (marketplaceBalance ?? 0) > 0 ? `${message} ${MARKETPLACE_POINTS_ORDER_ONLY_NOTE}` : message;
}
