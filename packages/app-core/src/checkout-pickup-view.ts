import type {
  CheckoutPickupQuote,
  PickupOptionItem,
  PickupOptionsExistingRequest,
  QuotePendingGiftDTO,
  ShippingFeeWaivedReason,
} from '@tubutree/shared-types';
import { formatVnNumber } from './number-format';
import { fillCopy } from './shop-copy';
import {
  giftLayout,
  kgLabel,
  returnWeightChips,
  type PickupConfirmState,
} from './checkout-pickup-state';

const vnd = (n: number) => `${formatVnNumber(n)}đ`;

export interface PickupCardView {
  title: string;
  /** Câu đọc của cả hàng; luôn nêu đủ tên thẻ và lợi ích để người dùng đọc màn hình nghe một lần. */
  ariaLabel: string;
  /** Huy hiệu số tiền phí giao được miễn; null khi không có phí nào để miễn. */
  badge: string | null;
  /** Dòng thứ hai: lợi ích khi chưa chọn, tóm tắt gói gửi lại khi đã chọn, hoặc lý do máy chủ nêu. */
  sub: string;
  subTone: 'normal' | 'warn';
  checked: boolean;
  /** Thu kèm tạm dừng với tài khoản (máy chủ nêu lý do, chưa chọn): hàng chỉ đọc. */
  disabled: boolean;
}

/**
 * Thẻ đổi rác kèm đơn ở thanh toán. null = không hiện (không có kiện Tubu giao, hoặc cổng thu kèm đóng).
 * Huy hiệu lấy số phí thực sự được miễn khi đã chọn đủ, còn chưa chọn thì lấy phí giao hiện tại của kiện Tubu.
 */
export function pickupCardView(args: { pickup: CheckoutPickupQuote | null | undefined; applied: boolean; tubuShippingFee: number }): PickupCardView | null {
  const { pickup, applied, tubuShippingFee } = args;
  if (!pickup || !pickup.gateOpen) return null;
  const title = fillCopy('checkout.pickup.title');
  const benefit = fillCopy('checkout.pickup.sub');
  const fee = applied && pickup.eligible ? pickup.shippingFeeWaived : tubuShippingFee;
  const badge = fee > 0 ? fillCopy('checkout.pickup.badge', { amount: vnd(fee) }) : null;
  let sub = benefit;
  let subTone: PickupCardView['subTone'] = 'normal';
  let disabled = false;
  if (applied) {
    if (pickup.eligible) {
      sub = fillCopy('checkout.pickup.summary', { n: kgLabel(pickup.returnWeightGrams ?? 0), points: formatVnNumber(pickup.estimatedPoints) });
    } else if (pickup.reason) {
      sub = pickup.reason;
      subTone = 'warn';
    }
  } else if (pickup.reason) {
    sub = pickup.reason;
    subTone = 'warn';
    disabled = true;
  }
  const ariaLabel = applied || disabled ? `${title} — ${sub}` : fillCopy('checkout.pickup.aria');
  return { title, ariaLabel, badge, sub, subTone, checked: applied, disabled };
}

export interface PickupItemRowView {
  id: string;
  name: string;
  /** "N đơn vị = X điểm": N là số đơn vị của một nhóm điểm. */
  detail: string;
  blocked: boolean;
  qty: number;
}

export interface PickupItemListView {
  rows: PickupItemRowView[];
  /** Câu giải thích món bị chặn, hiện đúng một lần dưới danh sách; null khi không món nào bị chặn. */
  blockedNote: string | null;
}

/** Món chọn được lên trước, món bị chặn xuống cuối (mờ, không chọn được) để câu giải thích đứng liền sau nhóm đó. */
export function pickupItemList(items: readonly PickupOptionItem[], qty: Record<string, number>): PickupItemListView {
  const row = (it: PickupOptionItem): PickupItemRowView => ({
    id: it.id,
    name: it.name,
    detail: fillCopy('checkout.pickup.itemPoints', { n: formatVnNumber(it.unitsPerPoint), unit: it.unitLabel, points: formatVnNumber(it.pointsPerGroup) }),
    blocked: it.blockedReason !== null,
    qty: it.blockedReason ? 0 : (qty[it.id] ?? 0),
  });
  const ok = items.filter((i) => !i.blockedReason).map(row);
  const blocked = items.filter((i) => i.blockedReason).map(row);
  return { rows: [...ok, ...blocked], blockedNote: blocked.length > 0 ? fillCopy('checkout.pickup.blockedBattery') : null };
}

export function pickupProgressView(points: number, minPoints: number): { label: string; percent: number } {
  const percent = minPoints <= 0 ? 100 : Math.max(0, Math.min(100, Math.round((points / minPoints) * 100)));
  return { label: fillCopy('checkout.pickup.progress', { points: formatVnNumber(points), min: formatVnNumber(minPoints) }), percent };
}

export function pickupExistingLine(existing: PickupOptionsExistingRequest): string {
  const items = existing.lines.map((l) => `${l.itemName} ×${formatVnNumber(l.declaredQty)}`).join(', ');
  return fillCopy('checkout.pickup.existing', { code: existing.code, items, points: formatVnNumber(existing.estimatedPoints) });
}

export interface PickupWeightView {
  chips: { grams: number; label: string }[];
  note: string;
}

export function pickupWeightView(maxReturnWeightGrams: number): PickupWeightView {
  return {
    chips: returnWeightChips(maxReturnWeightGrams).map((grams) => ({ grams, label: fillCopy('checkout.pickup.kgChip', { n: kgLabel(grams) }) })),
    note: fillCopy('checkout.pickup.kgNote', { max: kgLabel(maxReturnWeightGrams) }),
  };
}

/** Lý do duy nhất đang chặn nút Xong; null khi bấm được. */
export function pickupConfirmReasonLabel(state: PickupConfirmState): string | null {
  switch (state.reason) {
    case 'noItems':
      return fillCopy('checkout.pickup.needItems');
    case 'belowMin':
      return fillCopy('checkout.pickup.needPoints', { points: formatVnNumber(state.missingPoints) });
    case 'noWeight':
      return fillCopy('checkout.pickup.needWeight');
    default:
      return null;
  }
}

export interface GiftSectionView {
  layout: 'none' | 'rows' | 'merged';
  rows: { id: string; label: string; receive: boolean }[];
  mergedLabel: string;
  deferLabel: string;
  sheetTitle: string;
}

/** Dòng quà 0đ trên thanh toán: mỗi quà một dòng, từ 3 quà trở lên gộp một dòng. `receive` = quà đi cùng đơn này (chưa bấm "Để đơn sau"). */
export function giftSectionView(gifts: readonly QuotePendingGiftDTO[], excludedIds: readonly string[]): GiftSectionView {
  return {
    layout: giftLayout(gifts.length),
    rows: gifts.map((g) => ({ id: g.id, label: fillCopy('checkout.gift.line', { name: g.giftName }), receive: !excludedIds.includes(g.id) })),
    mergedLabel: fillCopy('checkout.gift.merged', { n: gifts.length }),
    deferLabel: fillCopy('checkout.gift.defer'),
    sheetTitle: fillCopy('checkout.gift.sheetTitle'),
  };
}

export interface ShippingRowView {
  waived: boolean;
  /** Phí giao gốc trước khi miễn (gạch ngang); bằng phí hiện tại khi không miễn. */
  originalFee: number;
  note: string | null;
}

/** Dòng phí giao ở tóm tắt tiền: chỉ đổi dáng khi phí được miễn vì đổi rác kèm đơn. */
export function shippingRowView(args: { shippingFee: number; shippingFeeWaived?: number; shippingFeeWaivedReason?: ShippingFeeWaivedReason | null }): ShippingRowView {
  const waivedAmount = args.shippingFeeWaived ?? 0;
  const waived = args.shippingFeeWaivedReason === 'RECYCLE_PICKUP' && waivedAmount > 0;
  return {
    waived,
    originalFee: waived ? args.shippingFee + waivedAmount : args.shippingFee,
    note: waived ? fillCopy('checkout.shipWaived') : null,
  };
}
