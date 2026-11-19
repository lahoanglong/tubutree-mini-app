import { createHash } from 'node:crypto';
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
 * `fsk:`; id người dùng là cuid (chữ và số) nên không bao giờ trùng một khoá có dấu hai chấm. SĐT được băm để bảng không giữ số thô.
 */
export const FLASH_LIMIT_KEY_PREFIX = 'fsk:';
export const FLASH_IP_KEY_PREFIX = `${FLASH_LIMIT_KEY_PREFIX}i:`;
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

const sha256Hex = (s: string) => createHash('sha256').update(s).digest('hex');

/** Khoá phụ của một lần mua, đã sắp xếp (thứ tự khoá dòng cố định giữa các lần đặt đồng thời). Rỗng khi không có gì để đếm. */
export function flashLimitKeys(identity: FlashBuyerIdentity | null | undefined): string[] {
  const keys: string[] = [];
  const phone = identity?.phone ? toLocalPhone(identity.phone) : null;
  if (phone) keys.push(`${FLASH_LIMIT_KEY_PREFIX}p:${sha256Hex(`flash-phone:${phone}`)}`);
  const ip = identity?.ipHash?.trim();
  if (ip) keys.push(`${FLASH_IP_KEY_PREFIX}${ip}`);
  return keys.sort();
}

/** Khoá phụ cho người mua `buyer` giao tới `identity`: khách thật không có khoá phụ. */
export function buyerFlashLimitKeys(
  buyer: { phone?: string | null; zaloId?: string | null } | null | undefined,
  identity: FlashBuyerIdentity,
): string[] {
  return isRealUser(buyer) ? [] : flashLimitKeys(identity);
}
