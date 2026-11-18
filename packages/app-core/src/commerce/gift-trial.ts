import { GIFT_TRIAL_CHANGED, GIFT_TRIAL_UNAVAILABLE, type GiftTrialSummaryDTO } from '@tubutree/shared-types';
import { fillCopy } from '../shop-copy';
import { vnd } from './money';

/**
 * Quà tặng dùng thử 0đ theo mốc giỏ: chữ và trạng thái dùng chung cho Giỏ và Thanh toán của Mini App và web. Máy chủ quyết quà nào mở và quà
 * nào đang chọn; phần này chỉ đọc khối `giftTrial` của giỏ/báo giá.
 */
export interface GiftTrialRowView {
  state: 'locked' | 'chosen' | 'declined';
  label: string;
  /** Mốc kế tiếp còn quà chưa mở; null khi đã mở hết hoặc đang ở trạng thái chưa đủ mốc (câu chính đã nói số còn thiếu). */
  sub: string | null;
  /** Chữ nút mở tấm chọn quà; null khi chưa có quà nào mở (không có gì để chọn). */
  action: string | null;
}

/**
 * Dòng quà ở Giỏ (`showLocked` = true: chưa đủ mốc thì nhắc số còn thiếu) và Thanh toán (`showLocked` = false: chưa đủ mốc thì ẩn, khách
 * không thêm hàng ở bước này). Không có khối quà thì null.
 */
export function giftTrialRowView(summary: GiftTrialSummaryDTO | null | undefined, opts: { showLocked: boolean }): GiftTrialRowView | null {
  if (!summary || summary.options.length === 0) return null;
  const anyUnlocked = summary.options.some((o) => o.unlocked);
  if (!anyUnlocked) {
    if (!opts.showLocked) return null;
    return { state: 'locked', label: fillCopy('giftTrial.locked', { amount: vnd(summary.shortfall) }), sub: null, action: null };
  }
  const sub = summary.nextMinOrder !== null && summary.shortfall > 0 ? fillCopy('giftTrial.nextTier', { amount: vnd(summary.shortfall) }) : null;
  const chosen = summary.options.find((o) => o.variationId === summary.selectedVariationId && o.unlocked);
  if (summary.declined || !chosen) {
    return { state: 'declined', label: fillCopy('giftTrial.declined'), sub, action: fillCopy('giftTrial.choose') };
  }
  return {
    state: 'chosen',
    label: fillCopy('giftTrial.chosen', { name: giftTrialName(chosen) }),
    sub,
    action: fillCopy('giftTrial.change'),
  };
}

/** Tên quà: thêm tên biến thể khi nó nói thêm điều gì (bỏ "Mặc định" và tên đã nằm trong tên sản phẩm). */
function giftTrialName(o: { productName: string; variationName: string }): string {
  const v = o.variationName.trim();
  const product = o.productName.trim();
  return v && v.toLowerCase() !== 'mặc định' && !product.toLowerCase().includes(v.toLowerCase()) ? `${product} · ${v}` : product;
}

export interface GiftTrialSheetOption {
  /** null = "Không nhận quà". */
  variationId: string | null;
  title: string;
  hint: string;
  checked: boolean;
  disabled: boolean;
}

/** Các hàng của tấm "Chọn quà tặng 0đ": quà theo thứ tự mốc (quà chưa mở hiện mờ kèm mốc), cuối cùng là "Không nhận quà". */
export function giftTrialSheetView(summary: GiftTrialSummaryDTO): { title: string; options: GiftTrialSheetOption[]; footer: string | null } {
  const options: GiftTrialSheetOption[] = summary.options.map((o) => ({
    variationId: o.variationId,
    title: giftTrialName(o),
    hint: o.unlocked ? fillCopy('giftTrial.free') : fillCopy('giftTrial.lockedOption', { amount: vnd(o.minOrder) }),
    checked: !summary.declined && o.unlocked && o.variationId === summary.selectedVariationId,
    disabled: !o.unlocked,
  }));
  options.push({
    variationId: null,
    title: fillCopy('giftTrial.none'),
    hint: fillCopy('giftTrial.noneHint'),
    checked: summary.declined,
    disabled: false,
  });
  const footer = summary.nextMinOrder !== null && summary.shortfall > 0 ? fillCopy('giftTrial.nextTier', { amount: vnd(summary.shortfall) }) : null;
  return { title: fillCopy('giftTrial.sheetTitle'), options, footer };
}

/**
 * Trường gửi kèm đặt đơn: báo giá không có khối quà thì không gửi (máy chủ tự theo lựa chọn ở giỏ, như app cũ); có khối quà thì gửi đúng quà
 * khách đang thấy, `null` = không kèm quà (đã từ chối hoặc chưa đủ mốc).
 */
export function giftTrialPlaceField(summary: GiftTrialSummaryDTO | null | undefined): { giftVariationId?: string | null } {
  if (!summary) return {};
  const chosen = summary.declined ? undefined : summary.options.find((o) => o.unlocked && o.variationId === summary.selectedVariationId);
  return { giftVariationId: chosen?.variationId ?? null };
}

interface ErrorLike {
  code?: unknown;
  response?: { data?: { code?: unknown } };
}

/** Lỗi đặt đơn vì quà đổi (`GIFT_TRIAL_CHANGED`) hoặc vừa hết (`GIFT_TRIAL_UNAVAILABLE`): app tải lại báo giá và giữ màn. */
export function isGiftTrialError(err: unknown): boolean {
  if (typeof err !== 'object' || err === null) return false;
  const e = err as ErrorLike;
  const code = e.response?.data?.code ?? e.code;
  return code === GIFT_TRIAL_CHANGED || code === GIFT_TRIAL_UNAVAILABLE;
}
