import { tubuZaloUrl } from '@tubutree/app-core/order-zalo';
import { fillCopy } from '@tubutree/app-core/shop-copy';

/** Cùng khuôn với `GUEST_LOOKUP_CODE_RE` của API: mã đơn in trên đơn hàng. */
export const GUEST_ORDER_CODE_RE = /^[A-Z0-9-]{4,40}$/;

export interface GuestSupportHandoff {
  /** Trang chat Zalo của Tubu, mở ở thẻ mới. */
  href: string;
  /** "Hỗ trợ đơn <mã>" để chép vào bộ nhớ tạm lúc chạm; mã sai khuôn thì null (không chép chuỗi lạ). */
  message: string | null;
}

/**
 * Một chạm từ đơn đặt không đăng nhập sang chat Zalo của Tubu. `zalo.me/<id>` không nhận sẵn nội dung tin nhắn (Mini App thì có), nên câu
 * "Hỗ trợ đơn <mã>" được chép vào bộ nhớ tạm ngay lúc chạm để khách dán vào khung chat. Câu chỉ mang mã đơn: không SĐT, không khoá theo dõi
 * (phần `#k=` là chìa mở bản xem đơn, nằm trong tin nhắn là trao chìa cho bất kỳ ai đọc được cuộc trò chuyện).
 * Ưu tiên OA (NEXT_PUBLIC_ZALO_OA_ID); OA chưa cấu hình thì số Zalo Tubu ở cấu hình công khai (`tubuZaloPhone`, sai khuôn thì số mặc định).
 */
export function guestSupportHandoff(code: string, opts: { oaUrl: string | null; zaloPhone?: string | null }): GuestSupportHandoff {
  const orderCode = code.trim().toUpperCase();
  return {
    href: opts.oaUrl ?? tubuZaloUrl(opts.zaloPhone),
    message: GUEST_ORDER_CODE_RE.test(orderCode) ? fillCopy('support.orderContext', { code: orderCode }) : null,
  };
}
