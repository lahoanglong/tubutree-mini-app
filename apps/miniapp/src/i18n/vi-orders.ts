/** Chữ của danh sách đơn, chi tiết đơn, trạng thái đơn và phương thức thanh toán. Tách khỏi `vi.ts` vì chỉ màn tải lười dùng: `vi.ts` nằm trong gói đầu của Mini App. Quy tắc chữ như `vi.ts`. */
import { orderCopy } from '@tubutree/app-core/account-copy';

export const viOrders = {
  /** Đơn chưa "Đang giao" nhưng kho đã đặt hãng (có mã vận đơn) — không tự huỷ được nữa. */
  carrierBooked: 'Đã đặt đơn vị vận chuyển',
  emptyHeading: 'Bạn chưa có đơn nào',
  // Số do admin đặt (voucher.welcome_amount, voucher.welcome_min_order): nhận từ config công khai, không viết cứng ở đây.
  emptyBody: (minOrder: string, amount: string) => `Đơn đầu từ ${minOrder} dùng được mã giảm giá chào mừng ${amount}`,
  emptyBodyNoMin: (amount: string) => `Đơn đầu dùng được mã giảm giá chào mừng ${amount}`,
  emptyCta: 'Bắt đầu mua',
  tabAll: 'Tất cả',
  tabTitle: 'Đơn hàng',
  tabProcessing: 'Đang xử lý',
  tabShipping: 'Đang giao',
  tabDelivered: 'Đã giao',
  tabClosed: 'Đã huỷ/hoàn',
  tabSubscriptions: 'Định kỳ',
  emptyTabHeading: 'Không có đơn nào ở mục này',
  loadMore: 'Xem thêm',
  itemCount: (n: number) => `${n} món`,
  cancelConfirmTitle: 'Bạn muốn huỷ đơn này?',
  cancelConfirmBody: 'Đơn đã huỷ không thể khôi phục lại',
  cancelKeep: 'Giữ đơn',
  cancelYes: 'Huỷ đơn',
  cancelled: 'Đã huỷ đơn cho bạn',
  products: 'Sản phẩm',
  note: 'Ghi chú',
  paymentLabel: 'Thanh toán',
  payNow: orderCopy.payNow,
  searchLabel: orderCopy.searchLabel,
  searchPlaceholder: orderCopy.searchPlaceholder,
  searchClear: orderCopy.searchClear,
  searchNoMatch: orderCopy.searchNoMatch,
  payBy: (when: string) => `Hạn ${when}`,
  pointsUsed: 'Điểm Xanh đã dùng',
  reviewItem: 'Viết đánh giá',
  editReviewItem: 'Sửa đánh giá',
  pointsCredited: (n: string) => `Đã cộng +${n} Điểm Xanh vào tài khoản`,
  pointsReversed: 'Điểm Xanh của đơn này đã được thu hồi',
  pointsCreditedPartlyReversed: (earned: string, reversed: string) => `Đã cộng +${earned}, đã thu lại tối đa ${reversed} do trả hàng`,
  pointsCreditedReturnTaken: (earned: string, taken: string) => `Đã cộng +${earned}, đã thu lại ${taken} điểm do trả hàng`,
} as const;

export const viOrderStatus = {
  PENDING_PAYMENT: 'Chờ thanh toán',
  CONFIRMED: 'Đã xác nhận',
  PACKED: 'Đang đóng gói',
  SHIPPING: 'Đang giao',
  DELIVERED: 'Giao thành công',
  RETURNED: 'Đã hoàn',
  CANCELLED: 'Đã huỷ',
} as Record<string, string>;

export const viPaymentMethod = {
  COD: 'Khi nhận hàng (COD)',
  ZALOPAY: 'ZaloPay',
  VNPAY: 'VNPay',
  XU: 'Điểm Xanh (xu cũ)',
  BANK_TRANSFER: 'Chuyển khoản',
  WALLET: 'Ví Tubu',
} as Record<string, string>;
