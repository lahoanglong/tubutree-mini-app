import type { ReferralGuardReason } from '@tubutree/shared-types';
import { toLocalPhone } from '../../common/phone';

/**
 * Luật chống tự giới thiệu của thưởng ĐƠN ĐẦU (growth.referral_viral_enabled). Hàm thuần, không đọc DB: caller gom dữ liệu của
 * người mời và người được mời rồi hỏi một lần. Mỗi luật chặn cả cặp (không ai nhận), vì người được mời giả là chính người mời.
 */

/** Cửa sổ so IP: đơn của người mời đặt trong ±24 giờ quanh đơn đầu của bạn được mời, cùng mã băm IP thì chặn. */
export const FIRST_ORDER_IP_WINDOW_MS = 24 * 3600_000;

/** Cùng danh sách với REFERRAL_GUARD_REASONS: Trung tâm tăng trưởng đếm theo đúng các lý do này. */
export type FirstOrderBlockReason = ReferralGuardReason;

export interface AddressLike {
  phone?: unknown;
  street?: unknown;
  ward?: unknown;
  wardCode?: unknown;
  district?: unknown;
  province?: unknown;
}

export interface OrderTrace {
  createdAt: Date;
  /** `orders.placedIpHash` (mọi đơn từ khi có cột) hoặc `orders.guestIpHash` (đơn web vãng lai). */
  ipHashes: (string | null | undefined)[];
}

export interface FirstOrderParty {
  id: string;
  phone: string | null;
  /** zaloId của tài khoản và của các phiên khách đã gộp vào nó. */
  zaloIds: (string | null | undefined)[];
}

export interface FirstOrderFraudInput {
  referrer: FirstOrderParty & {
    /** Sổ địa chỉ của người mời. */
    addresses: AddressLike[];
    /** Đơn gần đây của người mời (địa chỉ giao + IP + giờ đặt). */
    orders: (OrderTrace & { shippingAddress: unknown })[];
  };
  referee: FirstOrderParty & {
    /** SĐT khách gõ ở đơn web vãng lai (`orders.guestPhone`). */
    guestPhone?: string | null;
  };
  /** Đơn đầu đang xét của người được mời. */
  order: OrderTrace & { shippingAddress: unknown };
}

const phoneKey = (raw: unknown): string | null => {
  if (typeof raw !== 'string') return null;
  const p = toLocalPhone(raw);
  return p && p.length >= 9 ? p : null;
};

/** Chữ thường, bỏ dấu, chỉ giữ chữ và số: "12 Lê Lợi, P.1" và "12 le loi p1" là một. */
const fold = (raw: unknown): string =>
  typeof raw === 'string'
    ? raw
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/đ/gi, 'd')
        .toLowerCase()
        .replace(/[^a-z0-9]/g, '')
    : '';

/**
 * Khoá địa chỉ giao: số nhà và đường đã gấp + phường (mã phường nếu có, không thì tên phường, quận, tỉnh đã gấp). Thiếu số nhà
 * hoặc phường thì không có khoá: không so địa chỉ rỗng với nhau.
 */
export function addressKey(a: unknown): string | null {
  if (!a || typeof a !== 'object') return null;
  const x = a as AddressLike;
  const street = fold(x.street);
  const wardCode = typeof x.wardCode === 'string' && x.wardCode.trim() ? x.wardCode.trim() : '';
  const ward = wardCode || [fold(x.ward), fold(x.district), fold(x.province)].filter(Boolean).join('|');
  return street.length >= 3 && ward ? `${ward}#${street}` : null;
}

const nonEmpty = (xs: (string | null | undefined)[]): string[] => xs.filter((x): x is string => typeof x === 'string' && x.trim() !== '');

/** Phiên khách đã gộp đổi zaloId thành `<khoá>_merged_<giờ>` (auth.service): bỏ đuôi đó để cùng một máy so ra trùng. */
const zaloKey = (z: string): string => z.replace(/_merged_\d+$/, '');

/** Lý do chặn đầu tiên, hoặc null khi cặp này được thưởng. Thứ tự cố định để log và test ổn định. */
export function firstOrderBlockReason(input: FirstOrderFraudInput): FirstOrderBlockReason | null {
  const { referrer, referee, order } = input;
  if (referrer.id === referee.id) return 'SELF';

  const referrerPhones = new Set(nonEmpty([phoneKey(referrer.phone), ...referrer.addresses.map((a) => phoneKey(a.phone))]));
  const refereePhones = nonEmpty([
    phoneKey(referee.phone),
    phoneKey(referee.guestPhone),
    phoneKey((order.shippingAddress as AddressLike | null)?.phone),
  ]);
  if (refereePhones.some((p) => referrerPhones.has(p))) return 'PHONE';

  const referrerZalo = new Set(nonEmpty(referrer.zaloIds).map(zaloKey));
  if (nonEmpty(referee.zaloIds).some((z) => referrerZalo.has(zaloKey(z)))) return 'ZALO';

  const orderAddress = addressKey(order.shippingAddress);
  if (orderAddress) {
    const referrerAddresses = new Set(nonEmpty([...referrer.addresses.map(addressKey), ...referrer.orders.map((o) => addressKey(o.shippingAddress))]));
    if (referrerAddresses.has(orderAddress)) return 'ADDRESS';
  }

  const orderIps = new Set(nonEmpty(order.ipHashes));
  if (orderIps.size > 0) {
    const at = order.createdAt.getTime();
    const near = referrer.orders.filter((o) => Math.abs(o.createdAt.getTime() - at) <= FIRST_ORDER_IP_WINDOW_MS);
    if (near.some((o) => nonEmpty(o.ipHashes).some((h) => orderIps.has(h)))) return 'IP';
  }
  return null;
}

/** Mốc đầu tháng theo giờ Việt Nam (UTC+7, không đổi giờ) chứa `now`: trần thưởng mỗi tháng đếm từ mốc này. */
export function vnMonthStart(now: Date): Date {
  const vn = new Date(now.getTime() + 7 * 3600_000);
  return new Date(Date.UTC(vn.getUTCFullYear(), vn.getUTCMonth(), 1) - 7 * 3600_000);
}
