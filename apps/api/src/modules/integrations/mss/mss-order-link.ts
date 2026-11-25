import { isRealUser } from '../../../common/real-user';
import { GUEST_TRACK_TTL_DAYS } from '../../checkout/guest/guest-checkout.config';
import { isLiveGuestOwner, signGuestLookupKey } from '../../checkout/guest/guest-track-link';

/** Trần link trong thân sự kiện. `allowedLink` của MSS cho 150 ký tự; link dài nhất hôm nay (khách vãng lai, mã cũ 15 ký tự) là 86. */
export const MSS_DETAIL_URL_MAX = 120;

/** Hạn khoá đã ký trong link của khách vãng lai, tính từ lúc ghi sự kiện: bằng hạn theo dõi sau khi đơn đóng. */
export const MSS_GUEST_LINK_TTL_MS = GUEST_TRACK_TTL_DAYS * 86_400_000;

export interface OrderDetailUrlInput {
  /** Gốc web đã đăng ký với MSS (`MSS_ORDER_LINK_ORIGIN`). */
  origin: string;
  code: string;
  guestTokenHash: string | null;
  owner: { zaloId: string | null; phone: string | null; mergedIntoId: string | null };
  /** `JWT_ACCESS_SECRET`, cùng nguồn với `GuestCheckoutService.linkSecret` (bên kiểm khoá). */
  secret: string | undefined;
  now: number;
}

/**
 * Link xem đơn gửi trong tin Zalo của người mua. Chỉ mang mã đơn và (với khách vãng lai) khoá đã ký; không SĐT, tên hay địa chỉ.
 *
 * - Đơn vãng lai mà chủ vẫn là khách vãng lai: `/don/<mã>#k=<khoá 60 ngày>`. Khoá nằm sau `#` nên không vào log máy chủ hay Referer, và chết
 *   khi đơn về một tài khoản (`orderByKey` chỉ nhận khoá gốc của trình duyệt cho đơn đã về tài khoản). Thiếu bí mật thì trỏ trang tra cứu
 *   điền sẵn mã (`/don?ma=`), khách tự nhập SĐT: không ký bằng bí mật dev công khai.
 * - Chủ là tài khoản thật: `/tai-khoan/don-hang/<mã>` (cần đăng nhập đúng chủ đơn; API lọc theo userId).
 * - Còn lại (khách vãng lai Mini theo deviceId, dòng khách đã gộp): null. Họ không có tài khoản web để mở trang đơn, như trước w37.
 *
 * Dài quá MSS_DETAIL_URL_MAX cũng trả null: thân sự kiện bỏ khoá link chứ không bỏ cả tin.
 */
export function orderDetailUrl(i: OrderDetailUrlInput): string | null {
  const code = encodeURIComponent(i.code);
  let url: string | null = null;
  if (i.guestTokenHash && isLiveGuestOwner(i.owner)) {
    url = i.secret
      ? `${i.origin}/don/${code}#k=${signGuestLookupKey(i.code, i.guestTokenHash, i.secret, i.now, MSS_GUEST_LINK_TTL_MS).key}`
      : `${i.origin}/don?ma=${code}`;
  } else if (isRealUser(i.owner)) {
    url = `${i.origin}/tai-khoan/don-hang/${code}`;
  }
  return url && url.length <= MSS_DETAIL_URL_MAX ? url : null;
}
