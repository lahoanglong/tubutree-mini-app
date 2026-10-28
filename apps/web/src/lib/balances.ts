import type { QueryClient } from '@tanstack/react-query';

/**
 * Mọi query đang giữ số dư/sổ cái của khách (Điểm Xanh, Ví Tubu). Sau thao tác làm đổi tiền hay điểm (đặt đơn, huỷ đơn
 * có hoàn tiền, chọn nơi nhận hoàn tiền) phải làm mới cả nhóm, nếu không thẻ tài khoản và màn thanh toán còn số cũ
 * cho tới khi tải lại trang.
 */
export const BALANCE_QUERY_KEYS = ['me', 'wallet', 'wallet-txn', 'points-txn'] as const;

export function invalidateBalances(qc: QueryClient): Promise<unknown> {
  return Promise.all(BALANCE_QUERY_KEYS.map((key) => qc.invalidateQueries({ queryKey: [key] })));
}
