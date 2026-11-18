import type { SystemConfigService } from '../../system-config/system-config.service';
import { formatVndText } from '../../../common/format-vnd';

/** Đặt hàng trên web không cần đăng nhập Zalo; mặc định tắt (seed createOnly + migration 20261118205436_web_guest_checkout). */
export const WEB_GUEST_CHECKOUT_ENABLED_KEY = 'web.guest_checkout_enabled';
export const GUEST_COD_MAX_KEY = 'checkout.guest_cod_max';
export const GUEST_DAILY_IP_CAP_KEY = 'checkout.guest_daily_ip_cap';
export const GUEST_BLOCKED_PHONES_KEY = 'checkout.guest_blocked_phones';

export const GUEST_COD_MAX_DEFAULT = 500_000;
export const GUEST_DAILY_IP_CAP_DEFAULT = 5;
/** Mỗi số: tối đa 2 đơn vãng lai chưa xong (chưa giao, chưa huỷ, chưa trả) cùng lúc. */
export const GUEST_PHONE_OPEN_CAP = 2;
/** Mỗi số: tối đa 4 đơn vãng lai trong 30 ngày, tính cả đơn đã xong hay đã huỷ. */
export const GUEST_PHONE_WINDOW_CAP = 4;
export const GUEST_PHONE_WINDOW_DAYS = 30;
/**
 * Mỗi tài khoản vãng lai (một deviceId): tối đa 3 đơn trong 24 giờ. deviceId do máy khách tự chọn nên đây chỉ là lớp phụ; hàng rào là trần
 * theo số điện thoại và theo IP.
 */
export const GUEST_DEVICE_DAILY_CAP = 3;
/** Biểu mẫu điền dưới 3 giây coi như máy tự điền. */
export const GUEST_MIN_FILL_MS = 3_000;
/** Đường dẫn theo dõi hết hiệu lực 60 ngày sau khi đơn giao xong (hay huỷ, hoàn trả). */
export const GUEST_TRACK_TTL_DAYS = 60;

export const GUEST_COD_OVER_MAX = 'GUEST_COD_OVER_MAX';
export const guestCodOverMaxMessage = (codMax: number) =>
  `Đơn trên ${formatVndText(codMax)} khi chưa đăng nhập cần chuyển khoản trước. Bạn chọn Chuyển khoản nhé.`;

/** Trạng thái đơn coi là đã xong: không tính vào trần "đơn chưa hoàn tất". */
export const GUEST_CLOSED_STATUSES = ['DELIVERED', 'CANCELLED', 'RETURNED'] as const;

export interface GuestCheckoutSettings {
  enabled: boolean;
  codMax: number;
  dailyIpCap: number;
  blockedPhones: ReadonlySet<string>;
}

const nonNegativeInt = (v: unknown, fallback: number): number =>
  typeof v === 'number' && Number.isFinite(v) && v >= 0 ? Math.floor(v) : fallback;

/** Chỉ boolean `true` mới bật; số hỏng rơi về mặc định; danh sách chặn chỉ nhận chuỗi dạng 0xxxxxxxxx. */
export async function readGuestCheckoutSettings(config: Pick<SystemConfigService, 'get'>): Promise<GuestCheckoutSettings> {
  const [enabled, codMax, dailyIpCap, blocked] = await Promise.all([
    config.get<unknown>(WEB_GUEST_CHECKOUT_ENABLED_KEY, false),
    config.get<unknown>(GUEST_COD_MAX_KEY, GUEST_COD_MAX_DEFAULT),
    config.get<unknown>(GUEST_DAILY_IP_CAP_KEY, GUEST_DAILY_IP_CAP_DEFAULT),
    config.get<unknown>(GUEST_BLOCKED_PHONES_KEY, []),
  ]);
  const phones = Array.isArray(blocked)
    ? blocked.filter((p): p is string => typeof p === 'string' && /^0\d{9}$/.test(p.trim())).map((p) => p.trim())
    : [];
  return {
    enabled: enabled === true,
    codMax: nonNegativeInt(codMax, GUEST_COD_MAX_DEFAULT),
    dailyIpCap: nonNegativeInt(dailyIpCap, GUEST_DAILY_IP_CAP_DEFAULT),
    blockedPhones: new Set(phones),
  };
}

export async function guestCheckoutEnabled(config: Pick<SystemConfigService, 'get'>): Promise<boolean> {
  return (await config.get<unknown>(WEB_GUEST_CHECKOUT_ENABLED_KEY, false)) === true;
}
