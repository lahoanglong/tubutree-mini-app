/** Chữ của trang thanh toán, form địa chỉ và màn đặt hàng thành công. Tách khỏi `vi.ts` vì chỉ màn tải lười dùng: `vi.ts` nằm trong gói đầu của Mini App. Quy tắc chữ như `vi.ts`. */
import { fillCopy } from '@tubutree/app-core/shop-copy';
import { formatNumber } from '../utils/format';

export const viCheckout = {
  backToCart: 'Về giỏ hàng',
  address: 'Địa chỉ giao hàng',
  addressEmpty: fillCopy('checkout.addressEmpty'),
  addressDefault: 'Mặc định',
  addressLegacy: 'Địa chỉ theo địa giới cũ nên chưa giao được. Bạn chọn lại tỉnh/thành và phường/xã nhé.',
  addressLegacyCta: 'Cập nhật địa chỉ',
  addressMismatch: 'Tỉnh/thành hoặc phường/xã chưa đúng nên chưa giao được. Bạn chọn lại nhé.',
  addressFixCta: 'Sửa địa chỉ',
  totalChangedTitle: 'Tổng tiền đơn vừa thay đổi',
  totalChangedCta: 'Xem lại đơn',
  recipient: 'Người nhận',
  phone: 'Số điện thoại',
  street: 'Số nhà, tên đường',
  payment: 'Phương thức thanh toán',
  paymentCod: 'Thanh toán khi nhận hàng (COD)',
  paymentBank: 'Chuyển khoản ngân hàng',
  paymentWallet: (balance: string) => `Ví Tubu (${balance})`,
  points: 'Điểm Xanh',
  note: 'Ghi chú cho Tubu',
  notePlaceholder: 'Ví dụ: giao giờ hành chính…',
  summary: 'Tóm tắt đơn hàng',
  shippingFee: 'Phí vận chuyển',
  total: 'Tổng cộng',
  pointsEarn: (n: number) => `Nhận +${formatNumber(n)} Điểm Xanh khi giao thành công`,
  placeOrder: 'Đặt hàng',
  placeOrderWith: (total: string) => `Đặt hàng · ${total}`,
  placing: 'Đang gửi đơn…',
} as const;

export const viSuccess = {
  prepareCash: 'Chuẩn bị tiền mặt khi nhận hàng',
  heading: 'Cảm ơn bạn đã chọn Tubu',
  subheading: 'Đơn hàng của bạn đã được ghi nhận',
  orderCode: 'Mã đơn hàng',
  /** Nhãn đọc của nút chép (icon-only): kèm mã để trình đọc màn hình báo đúng mã nào sẽ được chép. */
  copyCodeLabel: (codes: string) => `Sao chép mã đơn ${codes}`,
  copied: 'Đã sao chép mã đơn',
  copyFailed: (code: string) => `Không sao chép được — mã đơn: ${code}`,
  total: 'Tổng thanh toán',
  pointsLabel: 'Điểm Xanh sẽ nhận',
  pointsValueWhen: (n: number) => `+${formatNumber(n)} điểm, về khi đơn giao xong`,
  etaLabel: 'Giao dự kiến',
  nextTitle: 'Tiếp theo',
  steps: [
    { title: 'Xác nhận đơn', body: 'Tubu kiểm tra và xác nhận đơn của bạn.' },
    { title: 'Đóng gói', body: 'Sản phẩm được đóng gói cẩn thận.' },
    { title: 'Giao hàng', body: 'Đơn vị vận chuyển giao tới địa chỉ của bạn.' },
  ],
  subscribeTitle: (name: string) => `Đặt định kỳ ${name}`,
  subscribeBody: (pct: number) => `Tự động giao lại theo chu kỳ, tiết kiệm ${pct}% mỗi đơn.`,
  /** Nhóm gợi ý phụ dưới hai nút chính (kết bạn Zalo, Đặt định kỳ, mời bạn), cùng tên vùng với web. */
  extrasLabel: 'Thêm cho đơn này',
  trackOrder: 'Theo dõi đơn',
  keepShopping: 'Tiếp tục mua sắm',
} as const;
