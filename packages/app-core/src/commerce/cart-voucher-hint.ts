import type { CouponPreviewDTO } from '@tubutree/shared-types';
import type { CouponDTO } from '../api/loyalty';
import { fillCopy } from '../shop-copy';
import { vnd } from './money';
import { pickerRows, type PickerContext } from './voucher-picker';

/**
 * Gợi ý mã giảm giá ở đầu Giỏ, cạnh thanh Miễn phí giao hàng. Mini App và web cùng gọi `cartVoucherHint`: mã nào được nhắc, số tiền
 * nào được nói không được lệch giữa hai nền tảng.
 *
 * Chỉ nói số của máy chủ: mức giảm lấy từ xem trước từng mã (`discount`), số còn thiếu lấy từ `shortfall` (máy chủ đã loại dòng Giờ vàng
 * và trừ combo trước khi so đơn tối thiểu). Chưa có xem trước thì không nhắc gì, thay vì đoán từ tạm tính rồi hứa sai.
 */

/** Chỉ nhắc mở khoá khi còn thiếu không quá chừng này: xa hơn thì không còn là "một khoản nhỏ" mà thành ép khách mua thêm. */
export const CART_VOUCHER_UNLOCK_MAX_GAP = 100_000;

export interface CartVoucherApply {
  /** Mã thật gửi cho máy chủ khi bấm "Áp dụng ngay". */
  code: string;
  /** Tên hiện cho khách (mã tự cấp có tên thân thiện), mã thật nằm ở `code`. */
  label: string;
  /** Số tiền hàng mã giảm cho giỏ đang chọn, theo máy chủ. */
  saving: number;
  text: string;
  ariaLabel: string;
}

export interface CartVoucherUnlock {
  code: string;
  /** Số tiền hàng còn thiếu để đạt đơn tối thiểu của mã, theo máy chủ. */
  missing: number;
  /** 0–99: phần đã đạt của đơn tối thiểu; chưa mở khoá thì không bao giờ chạm 100. */
  pct: number;
  text: string;
  barAria: string;
}

export interface CartVoucherHint {
  apply: CartVoucherApply | null;
  unlock: CartVoucherUnlock | null;
}

const none: CartVoucherHint = { apply: null, unlock: null };

const savingOf = (p: CouponPreviewDTO | undefined): number => (p ? Math.max(0, p.discount || 0) + Math.max(0, p.freeshipSaving ?? 0) : 0);

/**
 * Mức giảm TỐI THIỂU khi giỏ vừa đủ đơn tối thiểu của mã (đủ hơn thì mã giảm bằng hoặc nhiều hơn): chỉ để so với mã đang dùng được, không bao giờ hiện số này.
 * Freeship tính theo phí giao mà giỏ chưa biết (chưa chọn địa chỉ) nên là 0: không bao giờ vượt một mã đã dùng được.
 */
function unlockFloor(c: CouponDTO): number {
  if (c.type === 'AMOUNT') return c.value;
  if (c.type === 'PERCENT') return Math.min(Math.round(((c.minOrder ?? 0) * c.value) / 100), c.maxDiscount ?? Infinity);
  return 0;
}

/**
 * Mã % có trần giảm mà trần đã chạm ngay tại đơn tối thiểu: khách đọc "10%" sẽ tưởng giảm nhiều hơn trần, nên nói thẳng số trần (đó là mức giảm chắc chắn,
 * mua thêm cũng không hơn).
 */
function cappedAtMinOrder(c: CouponDTO): number | null {
  if (c.type !== 'PERCENT' || c.maxDiscount == null) return null;
  return Math.round(((c.minOrder ?? 0) * c.value) / 100) >= c.maxDiscount ? c.maxDiscount : null;
}

function unlockText(c: CouponDTO, missing: number): string {
  const price = vnd(missing);
  if (c.type === 'AMOUNT') return fillCopy('cart.voucherHint.unlockAmount', { price, amount: vnd(c.value) });
  if (c.type === 'PERCENT') {
    const cap = cappedAtMinOrder(c);
    if (cap != null) return fillCopy('cart.voucherHint.unlockAmount', { price, amount: vnd(cap) });
    return fillCopy('cart.voucherHint.unlockPercent', { price, pct: c.value });
  }
  return fillCopy('cart.voucherHint.unlockShip', { price });
}

/**
 * `ctx` là đúng ngữ cảnh của bảng chọn mã ở Giỏ (tạm tính phần đang chọn, sản phẩm đang chọn, xem trước của máy chủ), nên gợi ý và bảng chọn mã
 * không nói khác nhau. Giỏ đã có mã thì không gợi ý (khách đã chọn; đổi mã là việc của bảng chọn mã).
 *
 * apply: mã dùng được giảm nhiều nhất (hoà thì mã hết hạn sớm hơn, như thứ tự của bảng chọn mã và mã tự áp ở thanh toán), chỉ khi giảm > 0.
 * unlock: mã chưa đủ đơn tối thiểu mà máy chủ báo còn thiếu không quá `CART_VOUCHER_UNLOCK_MAX_GAP`, thiếu ít nhất trước (hoà thì mức giảm
 * cao hơn). Đã có mã dùng được thì chỉ nhắc mã mở khoá sẽ giảm nhiều hơn nó.
 */
export function cartVoucherHint(coupons: readonly CouponDTO[], ctx: PickerContext): CartVoucherHint {
  if (ctx.currentCode || ctx.previews.size === 0) return none;
  const rows = pickerRows(coupons, ctx);

  let apply: CartVoucherApply | null = null;
  const best = rows.find((r) => r.group === 'usable' && savingOf(ctx.previews.get(r.coupon.code.toUpperCase())) > 0);
  /**
   * Mức giảm của mã đang mời áp khi khách mua thêm `missing`: mã % tăng theo giỏ (đến trần), nên mã mở khoá chỉ đáng nhắc khi vẫn hơn số này.
   * Tính trên tạm tính đang chọn (có thể gồm dòng Giờ vàng mà mã không áp) nên chỉ có thể cao hơn thực tế: sai về phía im lặng, không hứa suông.
   */
  const applySavingAfter = (missing: number): number => {
    if (!best) return 0;
    const now = savingOf(ctx.previews.get(best.coupon.code.toUpperCase()));
    if (best.coupon.type !== 'PERCENT') return now;
    const grown = Math.min(Math.round(((ctx.subtotal + missing) * best.coupon.value) / 100), best.coupon.maxDiscount ?? Infinity);
    return Math.max(now, grown);
  };
  if (best) {
    const saving = savingOf(ctx.previews.get(best.coupon.code.toUpperCase()));
    const label = best.view.code;
    apply = {
      code: best.coupon.code,
      label,
      saving,
      text: fillCopy('cart.voucherHint.apply', { amount: vnd(saving) }),
      ariaLabel: fillCopy('cart.voucherHint.applyAria', { code: label }),
    };
  }

  const candidates = rows
    .filter((r) => r.group === 'short')
    .map((r) => {
      const missing = ctx.previews.get(r.coupon.code.toUpperCase())?.shortfall ?? 0;
      return { coupon: r.coupon, missing, floor: unlockFloor(r.coupon) };
    })
    .filter((c) => c.missing > 0 && c.missing <= CART_VOUCHER_UNLOCK_MAX_GAP && (c.coupon.minOrder ?? 0) > 0 && (!apply || c.floor > applySavingAfter(c.missing)))
    .sort((a, b) => a.missing - b.missing || b.floor - a.floor);
  const next = candidates[0];
  const unlock: CartVoucherUnlock | null = next
    ? {
        code: next.coupon.code,
        missing: next.missing,
        pct: Math.min(99, Math.max(0, Math.floor(((next.coupon.minOrder! - next.missing) / next.coupon.minOrder!) * 100))),
        text: unlockText(next.coupon, next.missing),
        barAria: '',
      }
    : null;
  if (unlock) unlock.barAria = fillCopy('cart.voucherHint.barAria', { pct: unlock.pct });

  return apply || unlock ? { apply, unlock } : none;
}
