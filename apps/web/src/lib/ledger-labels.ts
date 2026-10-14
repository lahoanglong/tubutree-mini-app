/**
 * Nhãn tiếng Việt cho sổ Điểm Xanh và sổ Ví Tubu — cùng bảng với Mini App (account-api.ts `pointsReasonLabel`,
 * wallet-rules.ts `walletTxLabel`) để khách đối chiếu số dư ở đâu cũng thấy cùng một câu. Không bao giờ in mã kỹ thuật thô.
 */

/** `reason` của dòng sổ Điểm Xanh có dạng "MÃ:tham-chiếu"; chỉ mã đầu quyết định nhãn. */
export function pointsReasonLabel(reason: string): string {
  if (reason.startsWith('DAILY_CHECKIN')) return 'Điểm danh hằng ngày';
  if (reason.startsWith('POS_OFFLINE_ORDER')) return 'Tích điểm mua tại cửa hàng';
  if (reason.startsWith('LOYALTY_REDEEM_VOUCHER')) return 'Đổi điểm lấy mã giảm giá';
  if (reason.startsWith('ORDER_DELIVERED')) return 'Tích điểm từ đơn hàng';
  if (reason.startsWith('ORDER_REDEEM')) return 'Dùng điểm khi thanh toán';
  if (reason.startsWith('ORDER_REVERSED')) return 'Hoàn ngược điểm (hủy/trả)';
  if (reason.startsWith('ORDER_REFUND_POINTS')) return 'Hoàn lại điểm đã dùng';
  if (reason.startsWith('ORDER_REFUND_CONVERTED') || reason.startsWith('ORDER_REFUND_XU')) return 'Hoàn điểm đơn huỷ/trả';
  if (reason.startsWith('POINTS_EXPIRED')) return 'Điểm hết hạn';
  if (reason.startsWith('XU_TO_POINTS')) return 'Chuyển từ xu cũ sang Điểm Xanh';
  if (reason.startsWith('REFERRAL')) {
    return reason.includes('REVOKE') ? 'Thu hồi thưởng giới thiệu' : 'Thưởng giới thiệu bạn bè';
  }
  if (reason.startsWith('COMMUNITY')) return 'Thưởng cộng đồng';
  if (reason.startsWith('STOREFRONT_QUEST')) return 'Thưởng nhiệm vụ gian hàng';
  if (reason.startsWith('CTV_MILESTONE')) return 'Thưởng mốc doanh số CTV';
  if (reason.startsWith('GAME_BUY_TREE')) return 'Góp quỹ trồng cây';
  if (reason.startsWith('GAME') || reason.startsWith('SEASONPASS')) return 'Phần thưởng Vườn Xanh';
  if (reason.startsWith('REVIEW')) return 'Đánh giá sản phẩm';
  return 'Điều chỉnh Điểm Xanh';
}

const WALLET_TX_LABELS: Record<string, string> = {
  OPENING: 'Số dư đầu kỳ',
  ORDER_PAY: 'Thanh toán đơn hàng',
  ORDER_REFUND: 'Hoàn tiền đơn hàng',
  COMMISSION_PAYOUT: 'Hoa hồng CTV về Ví',
  CASHBACK: 'Hoàn tiền sàn ngoài',
  WITHDRAW: 'Rút về ngân hàng',
  WITHDRAW_REFUND: 'Hoàn lệnh rút bị từ chối',
  XU_CONVERT: 'Đổi sang xu cũ (nay là Điểm Xanh)',
  MERGE_IN: 'Chuyển từ phiên mua khách',
  MERGE_OUT: 'Chuyển sang tài khoản chính',
  ADJUST: 'Điều chỉnh',
};

/** Nhãn dòng sao kê Ví theo loại biến động; loại API mới thêm mà web chưa biết vẫn hiện được. */
export function walletTxLabel(type: string): string {
  return WALLET_TX_LABELS[type] ?? 'Biến động ví';
}
