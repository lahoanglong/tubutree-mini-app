import type { CouponDTO } from '../api/loyalty';
import { fillCopy } from '../shop-copy';
import { vnd, vndShort } from './money';

const DAY_MS = 86_400_000;
// Việt Nam là UTC+7 quanh năm: cộng cố định 7 giờ rồi đọc bằng getUTC*, nên ngày hiện ra giống nhau dù máy khách đặt múi giờ nào.
const VN_OFFSET_MS = 7 * 3_600_000;
const EXPIRING_DAYS = 3;
const QUOTA_SHOWN_MAX = 10;

export interface VoucherView {
  id: string;
  code: string;
  title: string;
  kind: 'discount' | 'freeship' | 'shop';
  /** "Đơn từ 199k"; rỗng khi không có đơn tối thiểu. */
  condition: string;
  expiry: string;
  /** Tên admin đặt cho mã (đã trim); null khi chưa đặt: thẻ dùng nhãn theo loại giảm. */
  name: string | null;
  /** "Còn 3 lượt": chỉ mã chưa nhận còn 1 đến 10 lượt, để khách thấy gấp mà không lộ số lớn. */
  quota: string | null;
  state: 'collectable' | 'saved' | 'used' | 'expired' | 'soldout' | 'ineligible';
}

/** Ngữ cảnh mà `CouponDTO` không mang; thiếu hết thì là mã đang nằm trong ví. */
export interface VoucherFlags {
  claimed?: boolean;
  used?: boolean;
  soldOut?: boolean;
  ineligible?: boolean;
  /** Số lượt nhận còn lại của mã trong kho; null/thiếu = không giới hạn. */
  remaining?: number | null;
  /** Mã của gian hàng: chỉ gọi nơi có nguồn chắc chắn. `CouponDTO.products` là mã mua chung nên không dùng để suy ra. */
  shop?: boolean;
}

/** Nhãn ngắn của mã giảm giá, một bản cho Mini App và web (gộp bốn bản cũ, giữ nguyên chữ). */
export function couponLabel(c: Pick<CouponDTO, 'type' | 'value' | 'maxDiscount'>): string {
  if (c.type === 'FREESHIP') return fillCopy('coupon.freeship');
  if (c.type === 'PERCENT') {
    return c.maxDiscount ? fillCopy('coupon.percentMax', { pct: c.value, max: vnd(c.maxDiscount) }) : fillCopy('coupon.percent', { pct: c.value });
  }
  return fillCopy('coupon.amount', { amount: vnd(c.value) });
}

/** Số ngày lịch (giờ Việt Nam) kể từ epoch: hiệu hai số này là số ngày lịch còn lại, không phải cửa sổ 24 giờ. */
function vnDay(ms: number): number {
  return Math.floor((ms + VN_OFFSET_MS) / DAY_MS);
}

/** Chữ hạn dùng: "Dùng đến 30/11", "Còn 2 ngày", "Hết hạn hôm nay"; hạn không đọc được (null) thì rỗng. */
export function expiryText(endMs: number | null, now: number): string {
  if (endMs === null) return '';
  if (endMs - now <= 0) return fillCopy('coupon.expired');
  const days = vnDay(endMs) - vnDay(now);
  if (days <= 0) return fillCopy('coupon.expiresToday');
  if (days <= EXPIRING_DAYS) return fillCopy('coupon.expiresInDays', { n: days });
  const d = new Date(endMs + VN_OFFSET_MS);
  const dd = String(d.getUTCDate()).padStart(2, '0');
  const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
  return fillCopy('coupon.expires', { date: `${dd}/${mm}` });
}

/**
 * Dữ liệu vẽ một thẻ mã. Trạng thái theo ưu tiên đã dùng > hết hạn > hết lượt > chưa đủ điều kiện > chưa nhận > đã lưu.
 * `kind: 'shop'` chỉ khi nơi gọi báo `shop: true`; API chưa trả phạm vi gian hàng và `products` là mã mua chung.
 * "Hết hạn hôm nay" và "Còn {n} ngày" tính theo ngày lịch giờ Việt Nam.
 * Hạn không đọc được thì không đoán hết hạn: mã vẫn dùng được, chữ hạn rỗng.
 */
export function voucherView(c: CouponDTO & VoucherFlags, now: number): VoucherView {
  const parsed = Date.parse(c.endAt);
  const endMs = Number.isNaN(parsed) ? null : parsed;
  const expired = endMs !== null && endMs <= now;
  const state: VoucherView['state'] = c.used
    ? 'used'
    : expired
      ? 'expired'
      : c.soldOut
        ? 'soldout'
        : c.ineligible
          ? 'ineligible'
          : c.claimed === false
            ? 'collectable'
            : 'saved';
  return {
    id: c.code,
    code: c.code,
    title: couponLabel(c),
    kind: c.type === 'FREESHIP' ? 'freeship' : c.shop ? 'shop' : 'discount',
    condition: c.minOrder ? fillCopy('coupon.minOrder', { min: vndShort(c.minOrder) }) : '',
    expiry: expiryText(endMs, now),
    name: c.title?.trim() || null,
    quota:
      state === 'collectable' && typeof c.remaining === 'number' && c.remaining >= 1 && c.remaining <= QUOTA_SHOWN_MAX
        ? fillCopy('coupon.usesLeft', { n: c.remaining })
        : null,
    state,
  };
}

/** Còn hạn thì sắp hết hạn trước; không hạn (hoặc hạn không đọc được) sau đó; đã hết hạn cuối cùng. Ổn định, không đổi mảng vào. */
export function sortVouchers<T extends { endAt?: string | null }>(list: T[], now: number): T[] {
  const at = (x: T): number | null => {
    const t = x.endAt ? Date.parse(x.endAt) : Number.NaN;
    return Number.isNaN(t) ? null : t;
  };
  const group = (x: T) => {
    const t = at(x);
    return t === null ? 1 : t <= now ? 2 : 0;
  };
  return [...list].sort((a, b) => group(a) - group(b) || (group(a) === 0 ? at(a)! - at(b)! : 0));
}
