import type { PickupOptionsResponse, ReturnPackagingLine } from '@tubutree/shared-types';
import {
  PICKUP_QTY_MAX,
  defaultReturnWeightGrams,
  draftUsingRequest,
  pickupConfirmState,
  returnWeightChips,
  type PickupDraft,
} from './checkout-pickup-state';
import { formatVnNumber } from './number-format';
import { fillCopy } from './shop-copy';

/**
 * Gợi ý gửi lại bao bì ở thẻ "Đổi rác kèm đơn" (cờ `checkout.return_packaging_nudge_enabled`). Mini App và web cùng luật: chỉ vẽ và gắn hành động.
 * Nguồn ưu tiên: phiếu thu kèm khách đã đăng ký (dùng nguyên phiếu), không có thì bao bì của các đơn đã giao tới cùng địa chỉ (máy chủ đếm).
 */

/** Tên đọc liền sau số lượng của món máy chủ đếm từ đơn; món khác lấy tên món viết thường chữ đầu. */
const SHORT_NAMES: Readonly<Record<string, string>> = { CARTON: 'thùng carton', TUBU_BOTTLE: 'vỏ chai Tubu Tree' };

const lowerFirst = (s: string) => (s ? s.charAt(0).toLocaleLowerCase('vi') + s.slice(1) : s);

/** "1 thùng carton, 2 vỏ chai Tubu Tree". */
export function packagingItemsText(lines: readonly Pick<ReturnPackagingLine, 'code' | 'name' | 'qty'>[]): string {
  return lines.map((l) => `${formatVnNumber(l.qty)} ${SHORT_NAMES[l.code] ?? lowerFirst(l.name)}`).join(', ');
}

export interface ReturnNudge {
  source: 'ORDER' | 'REQUEST';
  /** Lựa chọn điền sẵn: phiếu có sẵn, hoặc số lượng từng món từ đơn đã giao, kèm mức kg nhỏ nhất. */
  draft: PickupDraft;
  /** Đủ ngưỡng điểm và có mức kg: bật công tắc là áp luôn. false = mở ngăn chọn món đã điền sẵn để khách thêm món. */
  oneTap: boolean;
  points: number;
  missingPoints: number;
  /** "1 thùng carton, 2 vỏ chai Tubu Tree" (từ đơn), hoặc "Thùng carton cũ ×1" (phiếu). */
  itemsText: string;
  /** Số đơn góp bao bì (0 với phiếu có sẵn). */
  orderCount: number;
  /** Mã phiếu khi nguồn là phiếu có sẵn. */
  requestCode: string | null;
}

/**
 * Gợi ý của lần thanh toán, null khi không có gì để gợi ý (cổng đóng, không phiếu, không bao bì, hay mọi món gợi ý đều bị chặn ở địa chỉ này).
 * Món không còn trong danh sách nhận hoặc bị chặn thì rời gợi ý, để báo giá không đi với món máy chủ từ chối.
 */
export function returnNudge(options: PickupOptionsResponse | undefined): ReturnNudge | null {
  if (!options || !options.gateOpen) return null;
  const weight = defaultReturnWeightGrams(returnWeightChips(options.maxReturnWeightGrams));
  const existing = options.existingRequest;
  if (existing) {
    const draft = draftUsingRequest(existing, weight);
    const state = pickupConfirmState(draft, options);
    return {
      source: 'REQUEST',
      draft,
      oneTap: state.ok,
      points: state.points,
      missingPoints: state.missingPoints,
      itemsText: existing.lines.map((l) => `${l.itemName} ×${formatVnNumber(l.declaredQty)}`).join(', '),
      orderCount: 0,
      requestCode: existing.code,
    };
  }
  const suggestion = options.suggestion;
  if (!suggestion) return null;
  const items = new Map(options.items.map((i) => [i.id, i]));
  const qty: Record<string, number> = {};
  const used: ReturnPackagingLine[] = [];
  for (const line of suggestion.lines) {
    const item = items.get(line.itemId);
    const q = Math.min(PICKUP_QTY_MAX, Math.trunc(line.qty));
    if (!item || item.blockedReason || !(q >= 1)) continue;
    qty[line.itemId] = q;
    used.push({ ...line, qty: q });
  }
  if (used.length === 0) return null;
  const draft: PickupDraft = { requestId: null, qty, returnWeightGrams: weight };
  const state = pickupConfirmState(draft, options);
  return {
    source: 'ORDER',
    draft,
    oneTap: state.ok,
    points: state.points,
    missingPoints: state.missingPoints,
    itemsText: packagingItemsText(used),
    orderCount: suggestion.orderCodes.length,
    requestCode: null,
  };
}

export interface PickupNudgeView {
  /** Dòng nêu bao bì khách đang giữ. */
  lead: string;
  /** Dòng lợi ích và việc cần làm: bật một chạm, hoặc còn thiếu bao nhiêu điểm. */
  benefit: string;
  oneTap: boolean;
  ariaLabel: string;
}

export function pickupNudgeView(nudge: ReturnNudge): PickupNudgeView {
  const lead =
    nudge.source === 'REQUEST'
      ? fillCopy('checkout.pickup.nudgeRequest', { code: nudge.requestCode ?? '', items: nudge.itemsText })
      : nudge.orderCount > 1
        ? fillCopy('checkout.pickup.nudgeOrders', { n: formatVnNumber(nudge.orderCount), items: nudge.itemsText })
        : fillCopy('checkout.pickup.nudgeOrder', { items: nudge.itemsText });
  const benefit = nudge.oneTap
    ? fillCopy('checkout.pickup.nudgeOneTap', { points: formatVnNumber(nudge.points) })
    : fillCopy('checkout.pickup.nudgeMore', { points: formatVnNumber(nudge.missingPoints) });
  return { lead, benefit, oneTap: nudge.oneTap, ariaLabel: `${fillCopy('checkout.pickup.title')} — ${lead}. ${benefit}` };
}
