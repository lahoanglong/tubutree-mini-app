/** Mã lý do miễn phí giao kiện Tubu vì thu rác kèm đơn (`shippingFeeWaivedReason`). */
export const RECYCLE_PICKUP = 'RECYCLE_PICKUP' as const;
export type ShippingFeeWaivedReason = typeof RECYCLE_PICKUP;

/** `REQUEST`: phiếu thu kèm (PICKUP, OPEN) khách đã tạo; `INLINE`: món rác khách chọn ngay trên thanh toán, phiếu chỉ được tạo khi đặt đơn. */
export type CheckoutPickupMode = 'REQUEST' | 'INLINE';

/** Một dòng món rác khách chọn ngay trên thanh toán. */
export interface InlinePickupLine {
  itemId: string;
  /** Số lượng nguyên >= 1, theo đơn vị của món (thùng, túi, vỏ...). */
  qty: number;
}

export interface InlinePickupInput {
  /** Tối đa 50 dòng. */
  lines: InlinePickupLine[];
  /** Cân nặng gói rác gửi lại (gram), ưu tiên hơn `returnWeightGrams` cấp trên. */
  returnWeightGrams?: number;
}

/**
 * Trường thu rác kèm đơn dùng chung cho báo giá và đặt đơn. `wasteRequestId` và `inlinePickup` loại trừ nhau (gửi cả hai là 400).
 * Bản app cũ không gửi trường nào thì hành vi như trước.
 */
export interface CheckoutPickupFields {
  wasteRequestId?: string;
  inlinePickup?: InlinePickupInput;
  /** Cân nặng gói rác gửi lại (gram), dùng cho cả chế độ `wasteRequestId`; nguyên, từ 500 tới `maxReturnWeightGrams`. */
  returnWeightGrams?: number;
  /** Quà hiện vật khách bỏ ra khỏi đơn này (tối đa 50), quà đó ở lại ví cho đơn sau. */
  excludeGiftRedemptionIds?: string[];
}

/**
 * Báo giá phần thu rác kèm đơn. `null` khi giỏ không có kiện Tubu giao, hoặc cổng thu kèm đang đóng và khách không chọn thu kèm.
 * Cổng đóng mà khách vẫn gửi thu kèm: `gateOpen=false`, `eligible=false`, `reason` nói rõ.
 */
export interface CheckoutPickupQuote {
  gateOpen: boolean;
  /** Phần thu kèm khách chọn đủ điều kiện miễn phí giao. Chưa chọn gì (`mode=null`) thì luôn false. */
  eligible: boolean;
  /** Vì sao chưa đủ điều kiện, hoặc vì sao thu kèm đang tạm dừng với tài khoản (khi `mode=null`); null = không có gì cần báo. */
  reason: string | null;
  mode: CheckoutPickupMode | null;
  /** Điểm Xanh dự kiến của phần thu kèm đã chọn (0 khi chưa chọn). Điểm chỉ cộng khi kho kiểm nhận. */
  estimatedPoints: number;
  /** Ngưỡng điểm tối thiểu của gói thu kèm (`waste.pickup_min_points`). */
  minPoints: number;
  /** Kiện Tubu được miễn phí giao nhờ thu kèm đơn (= `eligible`). */
  freeShip: boolean;
  /** Số tiền phí giao thực sự được miễn (0 khi phí vốn đã 0 vì lý do khác). */
  shippingFeeWaived: number;
  /** Tổng cân nặng (gram) các dòng của kiện Tubu. */
  orderWeightGrams: number;
  /** `max(500, min(orderWeightGrams, 10000))`. */
  maxReturnWeightGrams: number;
  /** Cân nặng gửi lại khách khai và đã được chấp nhận; null = chưa khai. */
  returnWeightGrams: number | null;
}

/** Sàn tiền hàng ròng (`subtotal - discount` của kiện Tubu, không tính phí giao) để gắn quà hiện vật 0đ vào đơn. */
export const GIFT_ATTACH_MIN_NET_GOODS_VND = 99_000;
/** Số quà hiện vật 0đ tối đa được gắn vào một đơn mua. */
export const GIFT_ATTACH_MAX_PER_ORDER = 1;

export const GIFT_ATTACH_BLOCKED_REASON_VALUES = ['PHONE_NOT_VERIFIED', 'MIN_ORDER', 'ONE_PER_ORDER'] as const;
export type GiftAttachBlockedReason = (typeof GIFT_ATTACH_BLOCKED_REASON_VALUES)[number];

/** Quà hiện vật 0đ khách đã đổi và chưa gắn đơn nào. */
export interface PendingGiftRedemptionDTO {
  id: string;
  /** Mã QG-xxxx đọc khi nhận quà ở kho; null khi quà chưa có mã. */
  code: string | null;
  giftName: string;
  kind: 'GIFT' | 'SEED_PACK';
  pointsCost: number;
}

/** Dòng quà trong báo giá: `included` = đơn đủ điều kiện nhận quà này và khách không bỏ quà ra. */
export interface QuotePendingGiftDTO extends PendingGiftRedemptionDTO {
  included: boolean;
  /** Vì sao quà chưa gắn vào đơn này; null khi quà được gắn, khách tự bỏ, hoặc giỏ không có kiện Tubu. */
  blockedReason?: GiftAttachBlockedReason | null;
}

export type PickupBlockedReason = 'BATTERY_OUT_OF_HCM';

export interface PickupOptionItem {
  id: string;
  code: string;
  name: string;
  unitLabel: string;
  unitsPerPoint: number;
  pointsPerGroup: number;
  hazardous: boolean;
  /** Món không chọn được với địa chỉ này: Pin cũ chỉ thu kèm đơn khi giao tới TP.HCM. */
  blockedReason: PickupBlockedReason | null;
  prepInstructions: string | null;
}

export interface PickupOptionsExistingRequest {
  id: string;
  code: string;
  estimatedPoints: number;
  lines: { itemId: string; itemName: string; unitLabel: string; declaredQty: number }[];
}

/** `GET /checkout/pickup-options?addressId=&itemIds=`: dữ liệu dựng ngăn chọn món rác ngay trên thanh toán. */
export interface PickupOptionsResponse {
  gateOpen: boolean;
  minPoints: number;
  orderWeightGrams: number;
  maxReturnWeightGrams: number;
  items: PickupOptionItem[];
  /** Phiếu thu kèm đang mở, chưa gắn đơn của khách (cũ nhất); null = chưa có. */
  existingRequest: PickupOptionsExistingRequest | null;
  /**
   * Bao bì của các đơn Tubu đã giao tới đúng địa chỉ này mà khách chưa gửi lại (cờ `checkout.return_packaging_nudge_enabled`).
   * null = không có gì để gợi ý hoặc cờ tắt; thiếu khi API cũ.
   */
  suggestion?: ReturnPackagingSuggestion | null;
}

/** Một dòng bao bì gửi lại, đếm từ đơn đã giao: thùng carton của kiện, vỏ chai/hộp của món có nhãn "Trả vỏ đổi điểm". */
export interface ReturnPackagingLine {
  itemId: string;
  /** Mã món rác (`CARTON`, `TUBU_BOTTLE`). */
  code: string;
  name: string;
  unitLabel: string;
  /** Số lượng nguyên >= 1, đã kẹp theo trần ngày/tháng của món. */
  qty: number;
  unitsPerPoint: number;
  pointsPerGroup: number;
}

/** Gợi ý gói gửi lại điền sẵn từ đơn đã giao. */
export interface ReturnPackagingSuggestion {
  /** Mã các đơn góp bao bì, mới giao trước. */
  orderCodes: string[];
  lines: ReturnPackagingLine[];
  /** Điểm Xanh dự kiến theo đúng công thức nhóm của máy chủ; chỉ cộng khi kho kiểm nhận. */
  estimatedPoints: number;
  /** Ngưỡng điểm tối thiểu của gói thu kèm đơn (`waste.pickup_min_points`). */
  minPoints: number;
}

/** `GET /waste/return-packaging?orderCode=<mã đơn>`: bao bì của một đơn đã giao; null khi đơn không đủ điều kiện hoặc cờ tắt. */
export interface ReturnPackagingResponse {
  suggestion: ReturnPackagingSuggestion | null;
}
