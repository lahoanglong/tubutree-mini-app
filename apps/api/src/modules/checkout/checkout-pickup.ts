import { BadRequestException } from '@nestjs/common';
import {
  GIFT_ATTACH_MAX_PER_ORDER,
  GIFT_ATTACH_MIN_NET_GOODS_VND,
  type GiftAttachBlockedReason,
  type PendingGiftRedemptionDTO,
  type QuotePendingGiftDTO,
} from '@tubutree/shared-types';
import { GOMDON_MAX_PARCEL_GRAMS, recyclingWeight } from '../integrations/gomdon/gomdon-weight';
import { PICKUP_PAUSED_MESSAGE } from '../waste-exchange/pickup/waste-pickup-attach';
import type { CheckoutPickupFieldsDto } from './dto/checkout.dto';

export const PICKUP_GATE_CLOSED = 'Thu kèm rác hiện chưa mở, bạn tắt công tắc hoặc tải lại trang nhé.';
export const PICKUP_NEEDS_TUBU =
  'Thu kèm rác chỉ đi cùng hàng do Tubu Tree giao. Bạn tắt công tắc thu kèm rác hoặc thêm hàng Tubu Tree vào đơn nhé.';
export const PICKUP_EXCLUSIVE_MESSAGE = 'Chọn một trong hai: phiếu thu rác có sẵn hoặc chọn món rác ngay trên đơn, không gửi cả hai.';
export const PICKUP_CHANGED_MESSAGE = 'Phiếu thu rác vừa thay đổi nên chưa đủ điều kiện miễn phí vận chuyển. Bạn tải lại trang thanh toán nhé.';

/** Mã freeship không cần dùng khi phí giao đã được miễn nhờ đổi rác kèm đơn: giữ mã cho đơn sau. */
export const COUPON_FREESHIP_RECYCLE_REASON =
  'Phí giao đã được miễn nhờ đổi rác kèm đơn, mã miễn phí giao hàng được giữ cho đơn sau.';
export const COUPON_FREESHIP_TUBU_PART_RECYCLE_REASON =
  'Phần hàng Tubu Tree giao đã được miễn phí giao nhờ đổi rác kèm đơn, mã miễn phí giao hàng chỉ áp cho hàng Tubu Tree nên được giữ cho đơn sau.';

/** Sàn cân nặng gói rác gửi lại (Gomdon tính tối thiểu 0,5 kg một kiện). */
export const RETURN_WEIGHT_FLOOR_GRAMS = 500;

export interface PickupRequestInput {
  wasteRequestId: string | null;
  inline: { lines: { itemId: string; qty: number }[] } | null;
  returnWeightGrams: number | null;
  excludeGiftIds: Set<string>;
}

/** Gom trường thu rác của báo giá/đặt đơn. `wasteRequestId` và `inlinePickup` loại trừ nhau; cân nặng trong `inlinePickup` thắng cân nặng cấp trên. */
export function pickupInputOf(dto: Pick<CheckoutPickupFieldsDto, 'wasteRequestId' | 'inlinePickup' | 'returnWeightGrams' | 'excludeGiftRedemptionIds'>): PickupRequestInput {
  if (dto.wasteRequestId && dto.inlinePickup) throw new BadRequestException(PICKUP_EXCLUSIVE_MESSAGE);
  return {
    wasteRequestId: dto.wasteRequestId ?? null,
    inline: dto.inlinePickup ? { lines: dto.inlinePickup.lines.map((l) => ({ itemId: l.itemId, qty: l.qty })) } : null,
    returnWeightGrams: dto.inlinePickup?.returnWeightGrams ?? dto.returnWeightGrams ?? null,
    excludeGiftIds: new Set(dto.excludeGiftRedemptionIds ?? []),
  };
}

export const hasPickupRequest = (input: PickupRequestInput): boolean => input.wasteRequestId !== null || input.inline !== null;

/**
 * Cân nặng kiện Tubu: cùng công thức vận đơn Gomdon (`recyclingWeight`, dòng thiếu cân dùng cân mặc định). Trần gói rác gửi lại là
 * cân hàng của kiện, chặn trong [0,5 kg; 10 kg].
 */
export function pickupWeights(
  lines: { variationId: string; quantity: number; weight?: number | null }[],
  fallbackGrams: number,
): { orderWeightGrams: number; maxReturnWeightGrams: number } {
  const { totalGrams } = recyclingWeight(lines, new Map(lines.map((l) => [l.variationId, l.weight])), fallbackGrams);
  return {
    orderWeightGrams: totalGrams,
    maxReturnWeightGrams: Math.max(RETURN_WEIGHT_FLOOR_GRAMS, Math.min(totalGrams, GOMDON_MAX_PARCEL_GRAMS)),
  };
}

/** Câu báo khi cân nặng gói rác gửi lại ngoài khoảng cho phép; null = hợp lệ. */
export function returnWeightProblem(grams: number, maxGrams: number): string | null {
  if (!Number.isInteger(grams) || grams < RETURN_WEIGHT_FLOOR_GRAMS) {
    return `Cân nặng gói rác gửi lại tối thiểu ${(RETURN_WEIGHT_FLOOR_GRAMS / 1000).toFixed(1)} kg, tối đa ${(maxGrams / 1000).toFixed(1)} kg theo kiện mua.`;
  }
  if (grams > maxGrams) {
    return `Gói rác gửi lại tối đa ${(maxGrams / 1000).toFixed(1)} kg theo kiện mua, bạn chọn ít hơn nhé.`;
  }
  return null;
}

export function pausedReason(flags: { blockedAt: Date | null; shipLockedAt: Date | null } | null): string | null {
  return flags?.blockedAt || flags?.shipLockedAt ? PICKUP_PAUSED_MESSAGE : null;
}

export interface GiftAttachDecisionInput<T extends PendingGiftRedemptionDTO = PendingGiftRedemptionDTO> {
  hasTubuShipment: boolean;
  phoneVerified: boolean;
  /** Tiền hàng ròng của kiện Tubu (`subtotal - discount`, không tính phí giao; trả bằng Ví không trừ). */
  netGoodsVnd: number;
  pending: readonly T[];
  excludedIds: ReadonlySet<string>;
}

export interface GiftAttachDecisionResult {
  /** Tối đa `GIFT_ATTACH_MAX_PER_ORDER` (1) mã quà được gắn vào đơn này. */
  attachIds: string[];
  lines: QuotePendingGiftDTO[];
  minNetGoodsVnd: number;
  shortfallVnd: number;
}

/**
 * W179-C (G2): Một hàm thuần duy nhất quyết định quà hiện vật 0đ được gắn vào kiện Tubu cho CẢ báo giá lẫn đặt đơn.
 * - Phải có kiện Tubu giao.
 * - SĐT khách phải xác minh Zalo (`phoneVerified = true`).
 * - Tiền hàng ròng của kiện Tubu (`subtotal - discount`) >= 99.000đ.
 * - Mỗi đơn gắn tối đa 1 quà (phần tử đầu tiên không nằm trong `excludedIds`).
 */
export function giftAttachDecision(input: GiftAttachDecisionInput): GiftAttachDecisionResult {
  const { hasTubuShipment, phoneVerified, netGoodsVnd, pending, excludedIds } = input;
  const shortfallVnd = hasTubuShipment ? Math.max(0, GIFT_ATTACH_MIN_NET_GOODS_VND - netGoodsVnd) : 0;
  const attachIds: string[] = [];
  const lines: QuotePendingGiftDTO[] = pending.map((g) => {
    if (!hasTubuShipment || excludedIds.has(g.id)) {
      return { ...g, included: false, blockedReason: null };
    }
    if (!phoneVerified) {
      return { ...g, included: false, blockedReason: 'PHONE_NOT_VERIFIED' as GiftAttachBlockedReason };
    }
    if (netGoodsVnd < GIFT_ATTACH_MIN_NET_GOODS_VND) {
      return { ...g, included: false, blockedReason: 'MIN_ORDER' as GiftAttachBlockedReason };
    }
    if (attachIds.length < GIFT_ATTACH_MAX_PER_ORDER) {
      attachIds.push(g.id);
      return { ...g, included: true, blockedReason: null };
    }
    return { ...g, included: false, blockedReason: 'ONE_PER_ORDER' as GiftAttachBlockedReason };
  });
  return { attachIds, lines, minNetGoodsVnd: GIFT_ATTACH_MIN_NET_GOODS_VND, shortfallVnd };
}

/** Một dòng giống nhau giữa hai danh sách món (cùng món, cùng số lượng, bất kể thứ tự) — nhận lại đơn đã đặt khi khách gửi lại. */
export function sameInlineLines(prior: { itemId: string; declaredQty: number }[], lines: { itemId: string; qty: number }[]): boolean {
  const key = (itemId: string, qty: number) => `${itemId}:${qty}`;
  const a = prior.map((l) => key(l.itemId, l.declaredQty)).sort();
  const b = lines.map((l) => key(l.itemId, l.qty)).sort();
  return a.length === b.length && a.every((k, i) => k === b[i]);
}
