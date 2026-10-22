import type { AffiliatePayout, CommissionStatus, PayoutStatus } from '@tubutree/app-core/api/affiliate';
import type { BadgeTone } from '@/components/ui/badge';

/** Máy chủ lưu `version` cùng thời điểm đồng ý: đổi chữ điều khoản thì đổi version, và giữ khớp `vi.ctvTerms` của Mini App. */
export const CTV_TERMS = {
  version: '2026-10',
  heading: 'Điều khoản hoa hồng & thuế',
  items: [
    'Hoa hồng tính theo tỷ lệ của từng sản phẩm, hiển thị trong ứng dụng.',
    'Hoa hồng chỉ được chốt khi đơn đã giao và hết thời gian đổi/trả. Đơn bị huỷ, hoàn hoặc trả hàng thì hoa hồng của đơn đó bị thu hồi.',
    'Không tự mua, lên đơn ảo hoặc dùng số điện thoại của chính mình để hưởng hoa hồng. Tubu Tree có quyền từ chối hoặc thu hồi hoa hồng khi phát hiện gian lận.',
    'Hoa hồng là thu nhập của bạn: bạn tự kê khai và nộp thuế theo quy định. Khi pháp luật yêu cầu, Tubu Tree có thể khấu trừ thuế trước khi chi trả.',
  ],
  agree: 'Tôi đã đọc và đồng ý với điều khoản hoa hồng & thuế của CTV Tubu Tree',
  mustAgree: 'Chọn ô đồng ý điều khoản để đăng ký',
} as const;

// Thẻ tổng "Đang chờ" gộp cả PENDING lẫn LOCKED nên hai nhãn phải cùng tiền tố "Đang chờ" thì CTV mới cộng lại khớp thẻ.
export const COMMISSION_META: Record<CommissionStatus, { label: string; tone: BadgeTone }> = {
  PENDING: { label: 'Đang chờ · đơn chưa giao', tone: 'promo' },
  LOCKED: { label: 'Đang chờ · đang giữ', tone: 'info' },
  APPROVED: { label: 'Có thể rút', tone: 'success' },
  PAID: { label: 'Đã trả', tone: 'neutral' },
  REJECTED: { label: 'Từ chối', tone: 'danger' },
};
export const WITHDRAWING_META: { label: string; tone: BadgeTone } = { label: 'Đang rút', tone: 'info' };

export const PAYOUT_META: Record<PayoutStatus, { label: string; tone: BadgeTone }> = {
  REQUESTED: { label: 'Chờ duyệt', tone: 'promo' },
  APPROVED: { label: 'Đã duyệt · chờ chuyển', tone: 'info' },
  PAID: { label: 'Đã chuyển', tone: 'success' },
  REJECTED: { label: 'Bị từ chối', tone: 'danger' },
};
export const PAYOUT_METHOD: Record<AffiliatePayout['method'], string> = {
  BANK: 'Về ngân hàng',
  WALLET_BALANCE: 'Về Ví Tubu',
  ZALOPAY: 'Về ZaloPay',
};

/** Trạng thái đơn hiện cạnh dòng hoa hồng: chữ của Mini App ("Giao thành công"), khác nhãn "Đã giao" của danh sách đơn. */
export const COMMISSION_ORDER_STATUS: Record<string, string> = {
  PENDING_PAYMENT: 'Chờ thanh toán',
  CONFIRMED: 'Đã xác nhận',
  PACKED: 'Đang đóng gói',
  SHIPPING: 'Đang giao',
  DELIVERED: 'Giao thành công',
  RETURNED: 'Đã hoàn',
  CANCELLED: 'Đã huỷ',
};
