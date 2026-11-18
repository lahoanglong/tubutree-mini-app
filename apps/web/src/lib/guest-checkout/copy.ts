import { fillTemplate } from '@tubutree/app-core/copy-template';

/**
 * Chữ của đặt hàng không đăng nhập trên web (biểu mẫu /thanh-toan, trang theo dõi /don/[mã], nút của giỏ khách). Tính năng chỉ có trên web
 * nên chữ không nằm trong SHOP_COPY: Mini App nhập SHOP_COPY nguyên khối, thêm khoá vào đó làm gói Mini lớn thêm dù Mini không dùng.
 */
export const GUEST_CHECKOUT_COPY = {
  loginLine: 'Đã có tài khoản? Đăng nhập Zalo để dùng mã, Điểm Xanh và quà đơn đầu {amount}',
  contactTitle: 'Thông tin nhận hàng',
  name: 'Họ tên người nhận',
  phone: 'Số điện thoại',
  phoneHint: 'Tubu gọi số này để xác nhận đơn và giao hàng.',
  nameMissing: 'Bạn nhập họ tên người nhận nhé.',
  phoneInvalid: 'Số di động gồm 10 số, bắt đầu bằng 03, 05, 07, 08 hoặc 09.',
  street: 'Số nhà, tên đường',
  streetMissing: 'Bạn nhập số nhà, tên đường nhé.',
  provinceMissing: 'Bạn chọn tỉnh/thành phố nhé.',
  wardMissing: 'Bạn chọn phường/xã nhé.',
  note: 'Ghi chú cho đơn (không bắt buộc)',
  payTitle: 'Phương thức thanh toán',
  cod: 'Thanh toán khi nhận hàng',
  bank: 'Chuyển khoản ngân hàng',
  flashLogin: 'Đăng nhập Zalo để mua giá Giờ vàng',
  place: 'Đặt hàng',
  placing: 'Đang đặt hàng…',
  fixForm: 'Điền đủ thông tin nhận hàng để đặt hàng.',
  cartCta: 'Đặt hàng',
  quoteFailed: 'Chưa tính được tổng tiền. Bấm Thử lại.',
  trackTitle: 'Theo dõi đơn hàng',
  copyLink: 'Chép đường dẫn theo dõi',
  copied: 'Đã chép đường dẫn',
  copyFailed: 'Chưa chép được. Bạn giữ lại địa chỉ trang này nhé.',
  claimLink: 'Đăng nhập Zalo trên trình duyệt này để đưa đơn về tài khoản',
  claimed: 'Đơn đã về tài khoản của bạn.',
  claimedLink: 'Xem trong Đơn của tôi',
  placedNote: 'Lưu đường dẫn trang này để xem đơn khi chưa đăng nhập.',
  notFound: 'Không tìm thấy đơn hàng. Đường dẫn có thể đã hết hạn hoặc chép thiếu.',
  expires: 'Đường dẫn dùng được tới {date}.',
  receiver: 'Người nhận',
  area: 'Giao tới',
} as const;

export type GuestCopyKey = keyof typeof GUEST_CHECKOUT_COPY;

/** Trần số ký tự của từng câu, cùng quy ước với shop-copy-budget: null là câu dài được phép xuống dòng. */
export const GUEST_CHECKOUT_COPY_BUDGET: Record<GuestCopyKey, number | null> = {
  loginLine: null,
  contactTitle: 24,
  name: 24,
  phone: 16,
  phoneHint: 60,
  nameMissing: 40,
  phoneInvalid: 64,
  street: 24,
  streetMissing: 40,
  provinceMissing: 40,
  wardMissing: 40,
  note: 40,
  payTitle: 24,
  cod: 28,
  bank: 28,
  flashLogin: 40,
  place: 12,
  placing: 16,
  fixForm: 48,
  cartCta: 24,
  quoteFailed: 48,
  trackTitle: 24,
  copyLink: 28,
  copied: 24,
  copyFailed: 56,
  claimLink: null,
  claimed: 36,
  claimedLink: 28,
  placedNote: 60,
  notFound: null,
  expires: 44,
  receiver: 16,
  area: 12,
};

export function guestCopy(key: GuestCopyKey, vars: Record<string, string | number> = {}): string {
  return fillTemplate(GUEST_CHECKOUT_COPY[key], vars, `guestCheckout.${key}`);
}
