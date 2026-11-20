import { createHash } from 'node:crypto';
import { hmacPhone } from '../../common/crypto/phone-hmac';
import { hashIp } from '../../common/ip-hash';
import { isRealUser } from '../../common/real-user';
import { toLocalPhone } from '../../common/phone';

/**
 * Giới hạn mua Giờ vàng của người mua CHƯA xác thực (tài khoản `guest_` của Mini, khách đặt không đăng nhập trên web). Giới hạn mỗi
 * khách đếm theo userId, mà deviceId mới là một tài khoản vãng lai mới, nên người mua loại này còn bị đếm thêm theo SĐT nhận hàng (trần
 * `perUserLimit`) và theo IP đã băm (trần `FLASH_IP_LIMIT_FACTOR` lần `perUserLimit`: mạng di động và Wi-Fi văn phòng dùng chung IP, trần
 * bằng một khách sẽ chặn nhầm người thứ hai). Lấy được giá Giờ vàng như mọi khách, nhưng đổi thiết bị và gõ SĐT khác vẫn không vượt trần
 * của IP. Khách thật (isRealUser) không có khoá phụ: hành vi như cũ.
 *
 * Số đã mua theo khoá nằm cùng bảng `flash_sale_purchases`, ở cột `userId` (cột không có khoá ngoại tới users) với tiền tố
 * `fsk:`; id người dùng là cuid (chữ và số) nên không bao giờ trùng một khoá có dấu hai chấm. SĐT được băm có khoá (`hmacPhone`) để bảng
 * không giữ số thô và không vét cạn ngược lại được.
 */
export const FLASH_LIMIT_KEY_PREFIX = 'fsk:';
export const FLASH_IP_KEY_PREFIX = `${FLASH_LIMIT_KEY_PREFIX}i:`;
/** Khoá SĐT: `hmacPhone` của số nhận hàng. */
export const FLASH_PHONE_KEY_PREFIX = `${FLASH_LIMIT_KEY_PREFIX}h:`;
/**
 * Khoá SĐT trước tubu-w11-01: sha256 trần của `flash-phone:<số>`, vét cạn ra số được. Không ghi thêm dòng nào dưới khoá này; nó chỉ còn
 * là bí danh CHỈ ĐỌC: lượt đã mua dưới khoá cũ (đợt Giờ vàng đang chạy lúc deploy) trừ vào trần của khoá SĐT mới, và đơn cũ ghi khoá này
 * vẫn hoàn đúng vào nó khi huỷ.
 */
export const FLASH_LEGACY_PHONE_KEY_PREFIX = `${FLASH_LIMIT_KEY_PREFIX}p:`;
/** Trần của khoá IP so với `perUserLimit` của suất. */
export const FLASH_IP_LIMIT_FACTOR = 3;
/** Mục đích HMAC của IP: trùng mã băm `orders.guestIpHash` của khách web, nên một IP đếm chung giữa web và Mini. */
const FLASH_IP_HASH_PURPOSE = 'guest-checkout';

/** Trần mua của một khoá phụ trong suất có `perUserLimit`. */
export function flashKeyLimit(key: string, perUserLimit: number): number {
  return key.startsWith(FLASH_IP_KEY_PREFIX) ? perUserLimit * FLASH_IP_LIMIT_FACTOR : perUserLimit;
}

/** IP (đã gom như throttle: IPv4, IPv6 theo /64) → mã băm dùng cho khoá IP và `orders.guestIpHash`. */
export function flashIpHash(ip: string | null | undefined, secret: string | undefined): string | null {
  return ip ? hashIp(ip, secret, FLASH_IP_HASH_PURPOSE) : null;
}

export interface FlashBuyerIdentity {
  /** SĐT nhận hàng của lần đặt (dạng nào cũng được, chuẩn hoá về 0xxxxxxxxx trước khi băm). */
  phone?: string | null;
  /** IP đã băm của lần đặt web vãng lai (orders.guestIpHash). */
  ipHash?: string | null;
}

/** Khoá phụ chỉ để đọc (bí danh SĐT cũ): không cộng, không ghi lên đơn. */
export const isLegacyFlashKey = (key: string): boolean => key.startsWith(FLASH_LEGACY_PHONE_KEY_PREFIX);

/** Các khoá được cộng lúc đặt và ghi lên đơn (`orders.flashLimitKeys`): bỏ bí danh chỉ đọc. */
export const writableFlashKeys = (keys: readonly string[]): string[] => keys.filter((k) => !isLegacyFlashKey(k));

/**
 * Khoá phụ của một lần mua, đã sắp xếp (thứ tự khoá dòng cố định giữa các lần đặt đồng thời). Rỗng khi không có gì để đếm. Đây là các
 * khoá được cộng và ghi lên đơn; `buyerFlashLimitKeys` thêm bí danh chỉ đọc để kiểm trần.
 */
export function flashLimitKeys(identity: FlashBuyerIdentity | null | undefined): string[] {
  const keys: string[] = [];
  const phone = hmacPhone(identity?.phone);
  if (phone) keys.push(`${FLASH_PHONE_KEY_PREFIX}${phone}`);
  const ip = identity?.ipHash?.trim();
  if (ip) keys.push(`${FLASH_IP_KEY_PREFIX}${ip}`);
  return keys.sort();
}

function legacyPhoneKey(phone: string | null | undefined): string | null {
  const local = phone ? toLocalPhone(phone) : null;
  return local ? `${FLASH_LEGACY_PHONE_KEY_PREFIX}${createHash('sha256').update(`flash-phone:${local}`).digest('hex')}` : null;
}

/**
 * Khoá phụ để kiểm trần cho người mua `buyer` giao tới `identity`: khách thật không có khoá phụ. Gồm các khoá của `flashLimitKeys` và bí
 * danh khoá SĐT cũ (chỉ đọc, xem FLASH_LEGACY_PHONE_KEY_PREFIX), đã sắp xếp. Đơn chỉ ghi `writableFlashKeys` của danh sách này.
 */
export function buyerFlashLimitKeys(
  buyer: { phone?: string | null; zaloId?: string | null } | null | undefined,
  identity: FlashBuyerIdentity,
): string[] {
  if (isRealUser(buyer)) return [];
  const keys = flashLimitKeys(identity);
  const legacy = legacyPhoneKey(identity.phone);
  return legacy ? [...keys, legacy].sort() : keys;
}
