import { inRollout, normalizeVnPhone } from '../integrations/mss/mss-order-event-types';
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
}

/** Giá trị admin gõ sai (thiếu số, có dấu cách, số nước ngoài) rơi về số mặc định, không để nút mở trang Zalo hỏng. */
export function tubuZaloPhoneOf(raw: unknown): string {
  return typeof raw === 'string' && /^0\d{9}$/.test(raw.trim()) ? raw.trim() : TUBU_ZALO_PHONE_DEFAULT;
}

/** Cờ chung cho `/config/public`: client chỉ hỏi trạng thái riêng của khách khi cờ này bật, nên cờ tắt thì không có request mới. */
export function orderZaloGateOpen(gate: OrderZaloGate | null | undefined): boolean {
  return !!gate && gate.enabled && gate.open && gate.rolloutPct > 0;
}

/** Số đã xác minh của khách dạng `090•••4567`; chưa xác minh hoặc không đọc được thì null (MSS bỏ qua `no_verified_phone`). */
export function verifiedPhoneMasked(user: { phone: string | null; phoneVerifiedAt: Date | null }): string | null {
  const phone = user.phoneVerifiedAt ? normalizeVnPhone(user.phone) : null;
  return phone ? `${phone.slice(0, 3)}•••${phone.slice(-4)}` : null;
}

export interface OrderZaloStatus {
  /** Cờ bật, MSS nhận sự kiện và khách nằm trong tỉ lệ rollout: cùng điều kiện máy chủ dùng khi ghi sự kiện. */
  enabled: boolean;
  /** Ô đồng ý tick sẵn ở lần đầu (`mss.order_consent_prechecked`). */
  prechecked: boolean;
  /** Lựa chọn gần nhất của khách; null khi chưa từng chọn. */
  choice: boolean | null;
  phoneMasked: string | null;
  tubuZaloPhone: string;
}

export function orderZaloStatus(
  gate: OrderZaloGate | null | undefined,
  user: { id: string; phone: string | null; phoneVerifiedAt: Date | null; notifyOrderZalo: boolean; notifyOrderZaloAt: Date | null },
  prechecked: unknown,
  tubuZaloPhone: unknown,
): OrderZaloStatus {
  const enabled = orderZaloGateOpen(gate) && inRollout(user.id, gate!.rolloutPct);
  return {
    enabled,
    prechecked: prechecked === true,
    choice: user.notifyOrderZaloAt ? user.notifyOrderZalo : null,
    phoneMasked: enabled ? verifiedPhoneMasked(user) : null,
    tubuZaloPhone: tubuZaloPhoneOf(tubuZaloPhone),
  };
}
