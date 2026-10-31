import type { CouponDTO } from '../api/loyalty';
import { fillCopy } from '../shop-copy';
import { vnd, vndShort } from './money';

const DAY_MS = 86_400_000;
// Việt Nam là UTC+7 quanh năm: cộng cố định 7 giờ rồi đọc bằng getUTC*, nên ngày hiện ra giống nhau dù máy khách đặt múi giờ nào.
const VN_OFFSET_MS = 7 * 3_600_000;
const EXPIRING_DAYS = 3;

export interface VoucherView {
  id: string;
  code: string;
  title: string;
  kind: 'discount' | 'freeship' | 'shop';
  /** "Đơn từ 199k"; rỗng khi không có đơn tối thiểu. */
  condition: string;
  expiry: string;
  state: 'collectable' | 'saved' | 'used' | 'expired' | 'soldout' | 'ineligible';
}

/** Ngữ cảnh mà `CouponDTO` không mang; thiếu hết thì là mã đang nằm trong ví. */
export interface VoucherFlags {
  claimed?: boolean;
  used?: boolean;
  soldOut?: boolean;
  ineligible?: boolean;
}

/** Nhãn ngắn của mã giảm giá, một bản cho Mini App và web (gộp bốn bản cũ, giữ nguyên chữ). */
export function couponLabel(c: Pick<CouponDTO, 'type' | 'value' | 'maxDiscount'>): string {
  if (c.type === 'FREESHIP') return fillCopy('coupon.freeship');
  if (c.type === 'PERCENT') {
    return c.maxDiscount ? fillCopy('coupon.percentMax', { pct: c.value, max: vnd(c.maxDiscount) }) : fillCopy('coupon.percent', { pct: c.value });
  }
  return fillCopy('coupon.amount', { amount: vnd(c.value) });
}

function expiryText(endMs: number | null, now: number): string {
  if (endMs === null) return '';
  const left = endMs - now;
  if (left <= 0) return fillCopy('coupon.expired');
  if (left < DAY_MS) return fillCopy('coupon.expiresToday');
  if (left <= EXPIRING_DAYS * DAY_MS) return fillCopy('coupon.expiresInDays', { n: Math.ceil(left / DAY_MS) });
  const d = new Date(endMs + VN_OFFSET_MS);
  const dd = String(d.getUTCDate()).padStart(2, '0');
  const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
  return fillCopy('coupon.expires', { date: `${dd}/${mm}` });
}

/**
 * Dữ liệu vẽ một thẻ mã. Trạng thái theo ưu tiên đã dùng > hết hạn > hết lượt > chưa đủ điều kiện > chưa nhận > đã lưu.
 * `kind: 'shop'` hiện suy từ mã gắn riêng cho vài sản phẩm (`products`) vì API chưa trả phạm vi gian hàng; P14 tinh chỉnh khi có.
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
    kind: c.type === 'FREESHIP' ? 'freeship' : c.products && c.products.length > 0 ? 'shop' : 'discount',
    condition: c.minOrder ? fillCopy('coupon.minOrder', { min: vndShort(c.minOrder) }) : '',
    expiry: expiryText(endMs, now),
    state,
  };
}

/** Còn hạn thì sắp hết hạn trước; không hạn (hoặc hạn không đọc được) sau đó; đã hết hạn cuối cùng. Ổn định, không đổi mảng vào. */
export function sortVouchers<T extends { expiresAt?: string | null }>(list: T[], now: number): T[] {
  const at = (x: T): number | null => {
    const t = x.expiresAt ? Date.parse(x.expiresAt) : Number.NaN;
    return Number.isNaN(t) ? null : t;
  };
  const group = (x: T) => {
    const t = at(x);
    return t === null ? 1 : t <= now ? 2 : 0;
  };
  return [...list].sort((a, b) => group(a) - group(b) || (group(a) === 0 ? at(a)! - at(b)! : 0));
}
