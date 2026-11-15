import type {
  CheckoutPickupFields,
  InlinePickupLine,
  PickupOptionItem,
  PickupOptionsExistingRequest,
  PickupOptionsResponse,
  QuotePendingGiftDTO,
} from '@tubutree/shared-types';
import { formatVnNumber } from './number-format';

/** Các mức kg gợi ý của gói rác gửi lại, theo gram. Máy chủ nhận mọi số nguyên từ 500 tới trần theo kiện mua; chip chỉ là lối chọn nhanh. */
export const RETURN_WEIGHT_LEVELS_GRAMS: readonly number[] = [500, 1000, 2000, 3000, 5000];

/** Từ ngần này quà tặng kèm trở lên thì gộp thành một dòng mở tấm nhỏ, để thanh toán không dài thêm theo số quà. */
export const GIFT_MERGE_THRESHOLD = 3;

/** Trần số lượng một món (máy chủ nhận tới 100.000; 999 đủ cho một gói rác và giữ ô số gọn). */
export const PICKUP_QTY_MAX = 999;

/** Lựa chọn thu rác kèm đơn của khách. `requestId` có giá trị = dùng nguyên phiếu mở có sẵn; null = chọn món ngay trên đơn (`qty`). */
export interface PickupDraft {
  requestId: string | null;
  qty: Record<string, number>;
  returnWeightGrams: number | null;
}

export type PickupConfirmReason = 'noItems' | 'belowMin' | 'noWeight';

export interface PickupConfirmState {
  ok: boolean;
  /** Một lý do duy nhất đang chặn nút Xong, null khi bấm được. */
  reason: PickupConfirmReason | null;
  points: number;
  /** Số điểm còn thiếu tới ngưỡng (0 khi đủ). */
  missingPoints: number;
}

export function returnWeightChips(maxReturnWeightGrams: number): number[] {
  return RETURN_WEIGHT_LEVELS_GRAMS.filter((g) => g <= maxReturnWeightGrams);
}

/** Mức nhỏ nhất không thấp hơn ước lượng (chưa có ước lượng thì mức nhỏ nhất); ước lượng vượt mọi mức thì mức lớn nhất. */
export function defaultReturnWeightGrams(chips: readonly number[], estimateGrams = 0): number | null {
  if (chips.length === 0) return null;
  return chips.find((g) => g >= estimateGrams) ?? chips[chips.length - 1]!;
}

/** Số kg hiện cho khách: 500 → "0,5", 2000 → "2" (dấu phẩy kiểu Việt). */
export function kgLabel(grams: number): string {
  return formatVnNumber(grams / 1000);
}

/** Điểm của một món theo đúng công thức máy chủ: cả nhóm mới tính, phần lẻ không có điểm. Món bị chặn không có điểm. */
export function itemPoints(item: PickupOptionItem, qty: number): number {
  if (item.blockedReason || item.unitsPerPoint <= 0 || qty <= 0) return 0;
  return Math.floor(qty / item.unitsPerPoint) * item.pointsPerGroup;
}

export function inlinePoints(items: readonly PickupOptionItem[], qty: Record<string, number>): number {
  return items.reduce((sum, it) => sum + itemPoints(it, qty[it.id] ?? 0), 0);
}

export function draftLines(draft: Pick<PickupDraft, 'qty'>): InlinePickupLine[] {
  return Object.entries(draft.qty)
    .filter(([, q]) => Number.isInteger(q) && q >= 1)
    .map(([itemId, qty]) => ({ itemId, qty }));
}

/** Điểm dự kiến của lựa chọn: phiếu có sẵn lấy điểm máy chủ đã tính, chọn món thì tính từ danh sách món. */
export function draftPoints(draft: PickupDraft, options: Pick<PickupOptionsResponse, 'items' | 'existingRequest'>): number {
  if (draft.requestId) return options.existingRequest?.id === draft.requestId ? options.existingRequest.estimatedPoints : 0;
  return inlinePoints(options.items, draft.qty);
}

export function setItemQty(draft: PickupDraft, item: PickupOptionItem, qty: number): PickupDraft {
  const next = item.blockedReason ? 0 : Math.max(0, Math.min(PICKUP_QTY_MAX, Math.trunc(Number.isFinite(qty) ? qty : 0)));
  const rest = { ...draft.qty };
  if (next === 0) delete rest[item.id];
  else rest[item.id] = next;
  return { ...draft, requestId: null, qty: rest };
}

/** Bản nháp đi từ phiếu có sẵn (mở danh sách để đổi món): điền sẵn số lượng cũ, giữ cân nặng đã chọn. */
export function draftFromRequestLines(request: PickupOptionsExistingRequest, returnWeightGrams: number | null): PickupDraft {
  const qty: Record<string, number> = {};
  for (const l of request.lines) if (l.declaredQty >= 1) qty[l.itemId] = l.declaredQty;
  return { requestId: null, qty, returnWeightGrams };
}

/** Bản nháp dùng nguyên phiếu mở có sẵn (không chọn lại món). */
export function draftUsingRequest(request: Pick<PickupOptionsExistingRequest, 'id'>, returnWeightGrams: number | null): PickupDraft {
  return { requestId: request.id, qty: {}, returnWeightGrams };
}

/** Nút Xong bấm được khi đủ điểm tối thiểu của máy chủ và đã có số kg hợp lệ. Mỗi lần chỉ nêu một lý do, theo thứ tự việc khách cần làm. */
export function pickupConfirmState(
  draft: PickupDraft,
  options: Pick<PickupOptionsResponse, 'items' | 'existingRequest' | 'minPoints' | 'maxReturnWeightGrams'>,
): PickupConfirmState {
  const points = draftPoints(draft, options);
  const missingPoints = Math.max(0, options.minPoints - points);
  const hasItems = draft.requestId ? options.existingRequest?.id === draft.requestId : draftLines(draft).length > 0;
  const w = draft.returnWeightGrams;
  const weightOk = w !== null && w >= 500 && w <= options.maxReturnWeightGrams;
  let reason: PickupConfirmReason | null = null;
  if (!hasItems) reason = 'noItems';
  else if (missingPoints > 0) reason = 'belowMin';
  else if (!weightOk) reason = 'noWeight';
  return { ok: reason === null, reason, points, missingPoints };
}

/** Trường gửi lên báo giá và đặt đơn: chỉ `wasteRequestId` HOẶC `inlinePickup` (loại trừ nhau), kèm cân nặng và quà để lại. Không có gì thì object rỗng (thân y hệt bản cũ). */
export function pickupFieldsOf(draft: PickupDraft | null, excludedGiftIds: readonly string[] = []): CheckoutPickupFields {
  const out: CheckoutPickupFields = {};
  if (draft) {
    if (draft.requestId) out.wasteRequestId = draft.requestId;
    else {
      const lines = draftLines(draft);
      if (lines.length > 0) out.inlinePickup = { lines };
    }
    if ((out.wasteRequestId || out.inlinePickup) && draft.returnWeightGrams !== null) out.returnWeightGrams = draft.returnWeightGrams;
  }
  if (excludedGiftIds.length > 0) out.excludeGiftRedemptionIds = [...excludedGiftIds].sort();
  return out;
}

/**
 * Đối chiếu lựa chọn đã áp với dữ liệu mới của máy chủ (đổi địa chỉ, phiếu bị dùng ở nơi khác). Máy chủ trả 400 với món Pin cũ ngoài TP.HCM,
 * nên món đó phải rời lựa chọn trước khi báo giá lại; hết món hoặc hụt ngưỡng điểm thì bỏ cả lựa chọn.
 */
export function reconcileDraft(draft: PickupDraft, options: PickupOptionsResponse): { draft: PickupDraft | null; changed: boolean } {
  if (!options.gateOpen) return { draft: null, changed: true };
  const chips = returnWeightChips(options.maxReturnWeightGrams);
  let weight = draft.returnWeightGrams;
  if (weight !== null && weight > options.maxReturnWeightGrams) weight = chips[chips.length - 1] ?? null;
  const weightChanged = weight !== draft.returnWeightGrams;
  if (draft.requestId) {
    if (options.existingRequest?.id !== draft.requestId) return { draft: null, changed: true };
    return { draft: { ...draft, returnWeightGrams: weight }, changed: weightChanged };
  }
  const byId = new Map(options.items.map((i) => [i.id, i]));
  const qty: Record<string, number> = {};
  for (const [id, q] of Object.entries(draft.qty)) {
    const item = byId.get(id);
    if (item && !item.blockedReason) qty[id] = q;
  }
  const dropped = Object.keys(qty).length !== Object.keys(draft.qty).length;
  const next: PickupDraft = { ...draft, qty, returnWeightGrams: weight };
  const { reason } = pickupConfirmState(next, options);
  // Hụt ngưỡng chỉ vì vừa bỏ món bị chặn: lựa chọn không còn đủ điều kiện nên bỏ hẳn, không để máy chủ báo lại.
  if (reason === 'noItems' || (dropped && reason === 'belowMin')) return { draft: null, changed: true };
  return { draft: next, changed: dropped || weightChanged };
}

/** Quà hiện trên thanh toán: quà đi cùng đơn (có kiện Tubu), cộng quà khách đã bấm "Để đơn sau" (còn hiện để bật lại). */
export function visibleGifts(pending: readonly QuotePendingGiftDTO[] | undefined, excludedIds: readonly string[]): QuotePendingGiftDTO[] {
  return (pending ?? []).filter((g) => g.included || excludedIds.includes(g.id));
}

/** Giữ lại các mã quà để lại chỉ khi quà còn trong ví chờ gắn đơn (quà đã gắn đơn khác thì không còn gì để bỏ). */
export function pruneExcludedGifts(excludedIds: readonly string[], pending: readonly QuotePendingGiftDTO[] | undefined): string[] {
  if (!pending) return [...excludedIds];
  const known = new Set(pending.map((g) => g.id));
  return excludedIds.filter((id) => known.has(id));
}

export function toggleExcludedGift(excludedIds: readonly string[], id: string, receive: boolean): string[] {
  const rest = excludedIds.filter((x) => x !== id);
  return receive ? rest : [...rest, id];
}

/** Một dòng cho mỗi quà, hoặc gộp thành một dòng mở tấm nhỏ khi từ `GIFT_MERGE_THRESHOLD` quà trở lên. */
export function giftLayout(count: number): 'none' | 'rows' | 'merged' {
  if (count <= 0) return 'none';
  return count >= GIFT_MERGE_THRESHOLD ? 'merged' : 'rows';
}
