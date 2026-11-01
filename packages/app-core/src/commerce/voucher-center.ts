import type { CollectableCouponDTO, CollectableMineDTO } from '../api/coupon-collect';
import type { CouponDTO, CouponHistoryDTO } from '../api/loyalty';
import { isCouponExpiring } from '../home-layout';
import { fillCopy } from '../shop-copy';
import { sortVouchers, voucherView, type VoucherFlags, type VoucherView } from './voucher';

export type VoucherTab = 'claim' | 'mine' | 'history';
export type VoucherFilter = 'all' | 'discount' | 'freeship' | 'shop' | 'expiring';

/** Một dòng của kho mã: `view` để vẽ thẻ, `coupon` giữ dữ liệu gốc cho nút bấm và chi tiết điều kiện. */
export interface VoucherRow {
  view: VoucherView;
  coupon: CouponDTO & VoucherFlags;
  /** Lý do mã chưa nhận được ("Chỉ dành cho khách đặt đơn đầu tiên"); chỉ có ở dòng `ineligible`, truyền vào `reason` của thẻ. */
  reason?: string;
}

export const VOUCHER_TABS: readonly { key: VoucherTab; label: string }[] = [
  { key: 'claim', label: fillCopy('coupon.tabClaim') },
  { key: 'mine', label: fillCopy('coupon.tabMine') },
  { key: 'history', label: fillCopy('coupon.tabHistory') },
];

const FILTER_LABEL: Record<VoucherFilter, string> = {
  all: fillCopy('coupon.filterAll'),
  discount: fillCopy('coupon.filterDiscount'),
  freeship: fillCopy('coupon.filterFreeship'),
  shop: fillCopy('coupon.filterShop'),
  expiring: fillCopy('coupon.filterExpiring'),
};

/** "Của shop" chỉ hiện khi tab đang có mã của gian hàng: API chưa trả phạm vi gian hàng nên thường không có, chip rỗng là nhiễu. */
export function voucherFilters(views: readonly VoucherView[]): { key: VoucherFilter; label: string }[] {
  const keys: VoucherFilter[] = ['all', 'discount', 'freeship'];
  if (views.some((v) => v.kind === 'shop')) keys.push('shop');
  keys.push('expiring');
  return keys.map((key) => ({ key, label: FILTER_LABEL[key] }));
}

export function filterVouchers<T extends { view: VoucherView; coupon: { endAt: string } }>(rows: T[], filter: VoucherFilter, now: number): T[] {
  switch (filter) {
    case 'all':
      return rows;
    case 'expiring':
      return rows.filter((r) => isCouponExpiring(r.coupon, now));
    default:
      return rows.filter((r) => r.view.kind === filter);
  }
}

const toRow = (coupon: CouponDTO & VoucherFlags, now: number): VoucherRow => ({ view: voucherView(coupon, now), coupon });

const STATE_RANK: Partial<Record<VoucherView['state'], number>> = { collectable: 0, saved: 1, soldout: 2 };

/**
 * Tab Nhận mã. `walletCodes` là mã trong `/me/coupons` của khách (rỗng khi chưa đăng nhập). Ví chỉ giữ mã còn dùng được nên không đủ để biết
 * khách đã nhận chưa: mã nhận rồi mà đã dùng hết lượt cá nhân biến khỏi ví, còn `/coupons/collectable` (công khai) vẫn trả nó. `mine` (khách đã
 * đăng nhập) nói rõ hai trường hợp đó: mã đã nhận mà không còn trong ví thành `used`, mã chỉ-khách-mới của khách đã có đơn thành `ineligible` kèm
 * lý do; cả hai đều không còn nút "Lưu mã" (bấm chỉ nhận lời từ chối của máy chủ). Thiếu `mine` thì mọi mã ngoài ví là chưa nhận như trước.
 * Mã khách đã nhận không bao giờ thành "hết lượt" dù lượt cuối vừa bị nhận: khách đang giữ nó. Chưa nhận đứng trước, rồi đã lưu, rồi hết
 * lượt/hết hạn; mỗi nhóm sắp hết hạn trước.
 */
export function collectRows(
  collectable: readonly CollectableCouponDTO[],
  walletCodes: ReadonlySet<string>,
  now: number,
  mine?: CollectableMineDTO,
): VoucherRow[] {
  const taken = new Set(mine?.claimed);
  const newOnly = new Set(mine?.newCustomerOnly);
  const rows = sortVouchers([...collectable], now).map((c) => {
    const inWallet = walletCodes.has(c.code);
    const spent = !inWallet && taken.has(c.code);
    const gated = !inWallet && !spent && newOnly.has(c.code);
    const remaining = c.usageLimit === null ? null : Math.max(0, c.usageLimit - c.claimedCount);
    const row = toRow(
      {
        code: c.code,
        type: c.type,
        value: c.value,
        minOrder: c.minOrder,
        maxDiscount: c.maxDiscount,
        endAt: c.endAt,
        title: c.title,
        claimed: inWallet || spent,
        used: spent,
        ineligible: gated,
        soldOut: !inWallet && !spent && remaining === 0,
        remaining,
      },
      now,
    );
    return gated ? { ...row, reason: fillCopy('coupon.newCustomerOnlyReason') } : row;
  });
  const rank = (r: VoucherRow) => STATE_RANK[r.view.state] ?? 3;
  return rows
    .map((r, i) => ({ r, i }))
    .sort((a, b) => rank(a.r) - rank(b.r) || a.i - b.i)
    .map(({ r }) => r);
}

/** Tab Mã của tôi: mã còn dùng được trong ví, sắp hết hạn trước. */
export function mineRows(wallet: readonly CouponDTO[], now: number): VoucherRow[] {
  return sortVouchers([...wallet], now).map((c) => toRow(c, now));
}

/**
 * Tab Đã dùng–hết hạn, giữ thứ tự máy chủ (mới nhất trước). Trạng thái theo máy chủ: đồng hồ máy khách chậm vài giây không làm
 * mã hết hạn hiện như còn dùng được. Chữ hạn bỏ trống vì nhãn trạng thái đã nói đủ.
 */
export function historyRows(items: readonly CouponHistoryDTO[], now: number): VoucherRow[] {
  return items.map((h) => {
    const coupon: CouponDTO & VoucherFlags = {
      code: h.code,
      type: h.type,
      value: h.value,
      minOrder: h.minOrder,
      maxDiscount: h.maxDiscount,
      endAt: h.endAt,
      title: h.title,
      used: h.state === 'used',
    };
    const view = voucherView(coupon, now);
    return { view: { ...view, state: h.state, expiry: '', quota: null }, coupon };
  });
}
