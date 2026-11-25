import { buyerPhoneOf, inRollout, type MssPhoneSource } from '../integrations/mss/mss-order-event-types';
import { MSS_ORDER_CONSENT_PRECHECKED_KEY } from '../integrations/mss/mss-flag-keys';

/** Zalo cá nhân của Tubu Tree mà MSS dùng để nhắn khách (quyết định PO số 3); khách bấm "Mở Zalo Tubu Tree" để tự kết bạn. */
export const TUBU_ZALO_PHONE_KEY = 'support.tubu_zalo_phone';
export const TUBU_ZALO_PHONE_DEFAULT = '0899149229';

export { MSS_ORDER_CONSENT_PRECHECKED_KEY };

/** Cổng tin đơn qua MSS nhìn từ phía khách: chỉ cần ba trường của `MssOrderEventGate`. */
export interface OrderZaloGate {
  enabled: boolean;
  open: boolean;
  rolloutPct: number;
  /** Được ghi thêm tin giao hàng cho số người nhận (cờ `mss.order_recipient_enabled` + năng lực MSS). Thiếu thì coi như tắt. */
  recipient?: boolean;
}

/** Giá trị admin gõ sai (thiếu số, có dấu cách, số nước ngoài) rơi về số mặc định, không để nút mở trang Zalo hỏng. */
export function tubuZaloPhoneOf(raw: unknown): string {
  return typeof raw === 'string' && /^0\d{9}$/.test(raw.trim()) ? raw.trim() : TUBU_ZALO_PHONE_DEFAULT;
}

/** Cờ chung cho `/config/public`: client chỉ hỏi trạng thái riêng của khách khi cờ này bật, nên cờ tắt thì không có request mới. */
export function orderZaloGateOpen(gate: OrderZaloGate | null | undefined): boolean {
  return !!gate && gate.enabled && gate.open && gate.rolloutPct > 0;
}

/** Số dạng `090•••4567` (cùng dạng với app-core `maskOrderZaloPhone`); null khi không có số. */
export function maskOrderZaloPhone(phone: string | null): string | null {
  return phone ? `${phone.slice(0, 3)}•••${phone.slice(-4)}` : null;
}

export interface OrderZaloStatus {
  /** Cờ bật, MSS nhận sự kiện và khách nằm trong tỉ lệ rollout: cùng điều kiện máy chủ dùng khi ghi sự kiện. */
  enabled: boolean;
  /** Ô đồng ý tick sẵn ở lần đầu (`mss.order_consent_prechecked`). */
  prechecked: boolean;
  /** Lựa chọn gần nhất của khách; null khi chưa từng chọn. */
  choice: boolean | null;
  /** Số tài khoản (đã xác minh hay chưa) dạng `090•••4567`; null khi tài khoản chưa có số: client dùng số nhận hàng của lần đặt. */
  phoneMasked: string | null;
  /** Số tài khoản đã chuẩn hoá `0xxxxxxxxx` của chính người gọi, để so với số nhận hàng (ô người nhận). null khi chưa có số. */
  buyerPhone: string | null;
  phoneSource: MssPhoneSource | null;
  /** Hiện được công tắc "gửi thêm thông báo giao hàng cho số người nhận" (cờ người nhận + năng lực MSS). */
  recipientEnabled: boolean;
  tubuZaloPhone: string;
}

export function orderZaloStatus(
  gate: OrderZaloGate | null | undefined,
  user: { id: string; phone: string | null; phoneVerifiedAt: Date | null; notifyOrderZalo: boolean; notifyOrderZaloAt: Date | null },
  prechecked: unknown,
  tubuZaloPhone: unknown,
): OrderZaloStatus {
  const enabled = orderZaloGateOpen(gate) && inRollout(user.id, gate!.rolloutPct);
  // Chỉ số của chính tài khoản (không lấy số nhận hàng): số nhận hàng đổi theo địa chỉ khách chọn ở màn thanh toán.
  const buyer = enabled ? buyerPhoneOf({ user }) : null;
  return {
    enabled,
    prechecked: prechecked === true,
    choice: user.notifyOrderZaloAt ? user.notifyOrderZalo : null,
    phoneMasked: maskOrderZaloPhone(buyer?.phone ?? null),
    buyerPhone: buyer?.phone ?? null,
    phoneSource: buyer?.source ?? null,
    recipientEnabled: enabled && gate!.recipient === true,
    tubuZaloPhone: tubuZaloPhoneOf(tubuZaloPhone),
  };
}
