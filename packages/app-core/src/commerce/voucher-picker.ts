import type { CouponPreviewDTO } from '@tubutree/shared-types';
import type { CouponDTO } from '../api/loyalty';
import { fillCopy } from '../shop-copy';
import { vnd, vndShort } from './money';
import { voucherView, type VoucherView } from './voucher';

/**
 * applied: mã đang chọn cho đơn · usable: dùng được · short: chưa đủ tiền hàng (mua thêm là dùng được) ·
 * blocked: không áp dụng được cho đơn này (máy chủ chặn, sai sản phẩm, đơn đã miễn phí giao).
 */
export type PickerGroup = 'applied' | 'usable' | 'short' | 'blocked';
export type PickerAction = 'use' | 'remove' | 'short' | 'blocked';

/** Một hàng của bảng chọn mã: `view` cho `VoucherTicket`, phần còn lại là nhãn nút, tên đọc, lý do và mức giảm đã chọn sẵn chữ. */
export interface PickerRow<T extends CouponDTO = CouponDTO> {
  coupon: T;
  view: VoucherView;
  group: PickerGroup;
  applied: boolean;
  action: PickerAction;
  label: string;
  ariaLabel: string;
  saving: string | null;
  reason: string | null;
}

export interface PickerContext {
  currentCode?: string | null;
  /** Tiền hàng đang tính (đã chọn); phép đoán "chưa đủ" khi chưa có xem trước của máy chủ. */
  subtotal: number;
  shippingFee?: number | null;
  /** Sản phẩm của các dòng đang mua: mã gắn riêng cho sản phẩm khác thì không áp dụng. Thiếu thì không kiểm. */
  productIds?: readonly string[];
  /** Xem trước từng mã của máy chủ (khoá viết hoa); rỗng khi chưa về, đang tải lại, lỗi hay giỏ vừa đổi. */
  previews: ReadonlyMap<string, CouponPreviewDTO>;
  now: number;
  /** Tên thân thiện cho mã tự cấp (`MILESTONE…-<id khách>`): hiện thay mã thô, mã thật vẫn nằm ở `coupon.code`. */
  displayCode?: (code: string) => string | null;
}

const GROUP_RANK: Record<PickerGroup, number> = { applied: 0, usable: 1, short: 2, blocked: 3 };
// Câu của CouponsService khi chưa đạt đơn tối thiểu; dòng điều kiện của phiếu đã nói đúng số đó nên không vẽ hai lần.
const MIN_ORDER_SENTENCE = /^Đơn tối thiểu [\d.,]+đ để dùng mã này\.?$/;

const endTime = (c: Pick<CouponDTO, 'endAt'>): number => {
  const t = Date.parse(c.endAt);
  return Number.isNaN(t) ? Infinity : t;
};

/** Mức giảm ước cho đơn `amount` (chỉ để xếp thứ tự, không bao giờ hiện cho khách). Freeship tính theo phí giao nếu biết. */
function estimate(c: CouponDTO, amount: number, shippingFee: number | null | undefined): number {
  if (c.type === 'AMOUNT') return Math.min(c.value, amount);
  if (c.type === 'PERCENT') return Math.min(Math.round((amount * c.value) / 100), c.maxDiscount ?? Infinity);
  return shippingFee ?? 0;
}

const shortfall = (c: CouponDTO, amount: number): number => (c.minOrder != null && c.minOrder > 0 ? Math.max(0, c.minOrder - amount) : 0);

const needMore = (missing: number): string => fillCopy('coupon.needMore', { x: vndShort(missing) });

function savingText(p: CouponPreviewDTO | undefined): string | null {
  if (!p) return null;
  if (p.discount > 0) return fillCopy('coupon.saveOrder', { amount: vnd(p.discount) });
  if ((p.freeshipSaving ?? 0) > 0) return fillCopy('coupon.saveShip', { amount: vnd(p.freeshipSaving!) });
  return null;
}

const ACTION: Record<PickerGroup, { action: PickerAction; label: string; aria: string }> = {
  applied: { action: 'remove', label: 'coupon.pickRemove', aria: 'coupon.pickRemoveAria' },
  usable: { action: 'use', label: 'coupon.pickUse', aria: 'coupon.pickUseAria' },
  short: { action: 'short', label: 'coupon.pickShort', aria: 'coupon.pickShortAria' },
  blocked: { action: 'blocked', label: 'coupon.pickBlocked', aria: 'coupon.pickBlockedAria' },
};

/**
 * Các hàng của bảng chọn mã ở giỏ và thanh toán. Có xem trước của máy chủ thì theo số đó (máy chủ tính trên hàng không Giờ vàng, sau combo,
 * theo phạm vi sản phẩm của mã) và chỉ nói lại câu của nó; chưa có thì phép đoán phía máy (đơn tối thiểu, sản phẩm, phí giao đã 0), đúng như bảng
 * cũ của cả hai app, và chỉ phép đoán này mới ghi "Mua thêm …" (`subtotal` gồm cả dòng Giờ vàng, nên con số chỉ là ước cho tới khi xem trước về).
 * Mã đang chọn luôn là `applied` dù xem trước nói gì: khách phải gỡ được nó.
 * Thứ tự: đang chọn, dùng được (giảm nhiều trước, hoà thì hạn sớm trước), chưa đủ (thiếu ít trước), không áp dụng; trong nhóm giữ thứ tự vào.
 */
export function pickerRows<T extends CouponDTO>(coupons: readonly T[], ctx: PickerContext): PickerRow<T>[] {
  const current = ctx.currentCode?.toUpperCase() ?? null;
  const built = coupons.map((coupon, index) => {
    const upper = coupon.code.toUpperCase();
    const applied = current === upper;
    const preview = ctx.previews.get(upper);
    const scope = coupon.products?.length ? coupon.products : null;
    const missing = shortfall(coupon, ctx.subtotal);
    const scopeText = scope ? fillCopy('coupon.scopeOnly', { names: scope.map((x) => x.name).join(', ') }) : null;

    let group: PickerGroup = 'usable';
    let reason: string | null = null;
    let scopeAsReason = false;
    let minInReason = false;
    if (applied) group = 'applied';
    else if (preview?.eligible) group = 'usable';
    else if (preview) {
      // Máy chủ kiểm khách mới, sản phẩm, lượt dùng, hạn trước đơn tối thiểu. Câu đơn tối thiểu của nó tính trên hàng không Giờ vàng, sau combo,
      // nên số "mua thêm" tự trừ từ `subtotal` sẽ thấp hơn số thật: giữ nguyên câu của máy chủ, không tự đếm.
      const serverReason = preview.reason?.trim() || null;
      reason = serverReason;
      const serverMin = serverReason !== null && MIN_ORDER_SENTENCE.test(serverReason);
      group = serverMin || (serverReason === null && missing > 0) ? 'short' : 'blocked';
      // Tạm tính trên màn đã đạt ngưỡng mà máy chủ vẫn đòi: máy chủ loại dòng Giờ vàng và trừ phần giảm combo trước khi so đơn tối thiểu, nên
      // nhắc lại câu "Đơn tối thiểu …" chỉ khiến khách thấy đã đủ mà bị chặn; nói đúng phần không được tính.
      // Máy chủ gửi kèm số còn thiếu (đã tính trên đúng phần hàng nó xét): nói "Mua thêm …" theo số đó thay vì câu đơn tối thiểu, kể cả khi tạm tính đã đủ.
      if (serverMin && preview.shortfall != null && preview.shortfall > 0) {
        reason = needMore(preview.shortfall);
        minInReason = true;
      } else if (serverMin && coupon.minOrder != null && coupon.minOrder > 0 && ctx.subtotal >= coupon.minOrder) {
        reason = fillCopy('coupon.minOrderBase', { min: vndShort(coupon.minOrder) });
        minInReason = true;
      }
    } else if (scope && ctx.productIds && !scope.some((x) => ctx.productIds!.includes(x.id))) {
      group = 'blocked';
      reason = scopeText;
      scopeAsReason = true;
    } else if (missing > 0) {
      group = 'short';
      reason = needMore(missing);
    } else if (coupon.type === 'FREESHIP' && ctx.shippingFee === 0) {
      group = 'blocked';
      reason = fillCopy('coupon.shipAlreadyFree');
    }

    const live = voucherView({ ...coupon, claimed: true, ineligible: group === 'short' || group === 'blocked' }, ctx.now);
    // VoucherTicket ẩn nút chính của phiếu hết hạn/đã dùng: đồng hồ máy lệch hay ví lấy từ cache cũ không được lấy mất nút "Bỏ chọn" của mã đang áp.
    const view: VoucherView = applied && (live.state === 'expired' || live.state === 'used' || live.state === 'soldout') ? { ...live, state: 'saved' } : live;
    const duplicatesMin = minInReason || (reason !== null && MIN_ORDER_SENTENCE.test(reason));
    const condition = [duplicatesMin ? null : view.condition, scopeText && !scopeAsReason ? scopeText : null].filter(Boolean).join(' · ');
    const display = ctx.displayCode?.(coupon.code) ?? null;
    const a = ACTION[group];
    const shown = display ?? coupon.code;
    const row: PickerRow<T> = {
      coupon,
      view: { ...view, code: shown, condition },
      group,
      applied,
      action: a.action,
      label: fillCopy(a.label),
      ariaLabel: fillCopy(a.aria, { code: shown }),
      saving: group === 'applied' || group === 'usable' ? savingText(preview) : null,
      reason,
    };
    const gain = preview ? Math.max(0, preview.discount || 0) + Math.max(0, preview.freeshipSaving ?? 0) : estimate(coupon, ctx.subtotal, ctx.shippingFee);
    return { row, index, gain, missing, end: endTime(coupon) };
  });
  built.sort(
    (a, b) =>
      GROUP_RANK[a.row.group] - GROUP_RANK[b.row.group] ||
      (a.row.group === 'usable' ? b.gain - a.gain || a.end - b.end : 0) ||
      (a.row.group === 'short' ? a.missing - b.missing : 0) ||
      a.index - b.index,
  );
  return built.map((b) => b.row);
}

/**
 * Tiền hàng của món đang xem để so với đơn tối thiểu của mã. Máy chủ không tính dòng Giờ vàng vào tiền hàng áp mã, nên món đang ở
 * giá Giờ vàng góp 0: nói "đã đủ" ở đây mà ra thanh toán lại thiếu là nói sai.
 */
export const offerAmount = (unitPrice: number, quantity: number, isFlash: boolean): number => (isFlash ? 0 : unitPrice * quantity);

export interface OfferRow<T extends CouponDTO = CouponDTO> {
  coupon: T;
  view: VoucherView;
  /** usable: dùng được cho món · short: thiếu đơn tối thiểu (mua thêm là dùng) · blocked: món này không được giảm theo mã (số giảm 0): xếp cuối và có lý do, nút chép vẫn bật. */
  group: Exclude<PickerGroup, 'applied'>;
  /** "Mua thêm 130k để dùng" khi món đang xem chưa đạt đơn tối thiểu của mã; lý do máy chủ khi món không được giảm; null khi đủ. */
  reason: string | null;
}

/**
 * Ví mã trong sheet Ưu đãi của trang sản phẩm, xếp theo mức có lợi cho món đang xem (`amount` = giá × số lượng): mã đủ điều kiện trước
 * (giảm tiền nhiều trước, freeship sau vì số tiền phụ thuộc phí giao), mã chưa đủ sau (thiếu ít trước, kèm "Mua thêm … để dùng"), mã món này
 * không được giảm cuối. Mã chưa đủ vẫn là `saved` và chép được: khách còn có thể mua thêm món khác trong cùng đơn. Mã không có đơn tối thiểu mà
 * `amount` là 0 (món đang Giờ vàng, máy chủ không giảm thêm theo mã) xếp cuối kèm lý do, nhưng cũng `saved`: đây chỉ là ví mã (nút chỉ chép, không áp
 * thẳng như bảng chọn mã thanh toán), và khách mua thêm món không Giờ vàng thì mã có tác dụng, nên khoá nút chép là chặn nhầm. FREESHIP không tính theo
 * tiền hàng nên vẫn dùng được.
 */
export function offerRows<T extends CouponDTO>(
  coupons: readonly T[],
  o: { amount: number; now: number; /** Tên thân thiện cho mã tự cấp (thay mã thô kèm id khách); null thì giữ mã. */ displayCode?: (code: string) => string | null },
): OfferRow<T>[] {
  const built = coupons.map((coupon, index) => {
    const missing = shortfall(coupon, o.amount);
    const nothing = missing === 0 && o.amount <= 0 && coupon.type !== 'FREESHIP';
    const group: OfferRow['group'] = nothing ? 'blocked' : missing > 0 ? 'short' : 'usable';
    return {
      row: {
        coupon,
        view: { ...voucherView({ ...coupon, claimed: true, ineligible: false }, o.now), code: o.displayCode?.(coupon.code) ?? coupon.code },
        group,
        reason: nothing ? fillCopy('coupon.zeroDiscountPdp') : missing > 0 ? needMore(missing) : null,
      } as OfferRow<T>,
      index,
      missing,
      gain: missing > 0 ? 0 : coupon.type === 'FREESHIP' ? 0 : estimate(coupon, o.amount, null),
      end: endTime(coupon),
    };
  });
  built.sort(
    (a, b) =>
      GROUP_RANK[a.row.group] - GROUP_RANK[b.row.group] ||
      (a.row.group === 'short' ? a.missing - b.missing : a.row.group === 'usable' ? b.gain - a.gain || a.end - b.end : 0) ||
      a.index - b.index,
  );
  return built.map((b) => b.row);
}
