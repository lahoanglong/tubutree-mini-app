import type { CartComboGroup, GiftTrialSummaryDTO } from '@tubutree/shared-types';
import type { GreenBoxState } from '../commerce/green-box';
import { vnd } from '../commerce/money';
import { fillCopy } from '../shop-copy';
import type { RefillOfferDTO, RefillPairsDTO } from './refill-api';

/** Phần dòng giỏ hàm cần (Mini và web có kiểu dòng riêng, cùng các trường này). */
export interface RefillCartLine {
  id: string;
  variationId: string;
  productId?: string;
  quantity: number;
  stock: number;
  total: number;
  isFlash?: boolean;
  fulfiller?: { kind: string } | null;
}

/** Giỏ máy chủ trả sau mỗi lệnh (chỉ cần dòng để tìm dòng refill khi hoàn tác). */
export interface RefillCartResult {
  items: readonly { id: string; variationId: string }[];
}

/** Thanh Hoàn tác sau khi đổi sang gói Refill. */
export const REFILL_UNDO_MS = 6_000;

/** Liên kết "Đã có chai? Đổi sang Refill …" dưới một dòng chai trong giỏ. */
export interface RefillSwapView {
  lineId: string;
  bottleVariationId: string;
  bottleQty: number;
  refill: RefillOfferDTO;
  label: string;
  /** Giá dòng sau khi đổi (1 gói refill) trừ giá dòng hiện tại, đồng. Dương thì liên kết ghi mức tăng. */
  delta: number;
  /** Giá tăng hoặc làm mất một mốc khách đang đạt: chạm lần đầu chỉ mở tấm xác nhận. */
  needsConfirm: boolean;
  /** Các mốc khách đang đạt sẽ mất nếu đổi (Miễn phí giao hàng, quà 0đ, bậc Hộp Xanh), nối bằng ". "; nói trước, không âm thầm. */
  warning: string | null;
}

/**
 * Mốc giỏ ĐÚNG như màn giỏ đang hiện (app tự tính theo phần đang chọn): tiến độ Miễn phí giao hàng, quà 0đ, bậc Hộp Xanh. Hàm chỉ so
 * "trước" và "sau khi đổi" trên cùng các số đó, không tự đặt ngưỡng nào.
 */
export interface RefillMilestones {
  freeship: { base: number; threshold: number; reached: boolean; /** Giỏ có hàng gian hàng tự giao: chỉ hàng Tubu giao được tính. */ tubuOnly: boolean } | null;
  giftTrial: GiftTrialSummaryDTO | null | undefined;
  greenBox: GreenBoxState | null;
}

export interface RefillSwapInput {
  lines: readonly RefillCartLine[];
  pairs: RefillPairsDTO | null | undefined;
  comboGroups: readonly CartComboGroup[] | undefined;
  milestones: RefillMilestones;
  /** Dòng đang được chọn để thanh toán (mặc định: mọi dòng). Dòng bỏ chọn không góp vào mốc. */
  isSelected?: (lineId: string) => boolean;
}

const isTubu = (l: RefillCartLine) => !l.fulfiller || l.fulfiller.kind === 'TUBU';

function inCombo(groups: readonly CartComboGroup[] | undefined, lineId: string): boolean {
  return (groups ?? []).some((g) => g.lineIds.includes(lineId) || g.keyLineIds.includes(lineId));
}

type Ctx = { line: RefillCartLine; offer: RefillOfferDTO };

function freeshipWarning(m: RefillMilestones['freeship'], c: Ctx): string | null {
  if (!m || !m.reached || !(m.threshold > 0)) return null;
  const lineShare = c.line.stock > 0 && (!m.tubuOnly || isTubu(c.line)) ? c.line.total : 0;
  const after = m.base - lineShare + (!m.tubuOnly || c.offer.tubu ? c.offer.price : 0);
  return after < m.threshold ? fillCopy('refill.dropFreeship', { amount: vnd(m.threshold - after) }) : null;
}

function giftWarning(gift: GiftTrialSummaryDTO | null | undefined, c: Ctx): string | null {
  if (!gift || gift.declined || gift.options.length === 0) return null;
  const lineShare = c.line.stock > 0 && isTubu(c.line) ? c.line.total : 0;
  const after = gift.base - lineShare + (c.offer.tubu ? c.offer.price : 0);
  const lost = gift.options.filter((o) => o.minOrder <= gift.base && o.minOrder > after);
  if (lost.length === 0) return null;
  const selected = lost.find((o) => o.variationId === gift.selectedVariationId);
  const target = selected ?? lost.reduce((a, b) => (b.minOrder < a.minOrder ? b : a));
  return fillCopy('refill.dropGift', { amount: vnd(target.minOrder - after) });
}

/**
 * Bậc Hộp Xanh đếm số SẢN PHẨM khác nhau đủ điều kiện (giá thường, Tubu giao, đủ hàng, không thuộc combo). Đổi chai lấy gói refill thường
 * giữ nguyên số đó; chỉ tụt khi chai đang được đếm mà gói refill thì không (gian hàng tự giao, hết hàng).
 */
function greenBoxWarning(input: RefillSwapInput, c: Ctx): string | null {
  const state = input.milestones.greenBox;
  if (!state?.tier) return null;
  const sel = input.isSelected ?? (() => true);
  const eligible = (l: RefillCartLine) =>
    sel(l.id) && !l.isFlash && isTubu(l) && l.stock >= l.quantity && l.total > 0 && !inCombo(input.comboGroups, l.id);
  const keepsProduct = input.lines.some((l) => l.id !== c.line.id && l.productId === c.line.productId && eligible(l));
  const items = state.items - (eligible(c.line) && !keepsProduct ? 1 : 0) + (c.offer.tubu && c.offer.inStock ? 1 : 0);
  const tierAfter = state.tiers.reduce<GreenBoxState['tier']>((best, t) => (t.minItems <= items && (!best || t.minItems > best.minItems) ? t : best), null);
  if (tierAfter && tierAfter.minItems >= state.tier.minItems) return null;
  return tierAfter ? fillCopy('refill.dropGreenBox', { pct: tierAfter.pct }) : fillCopy('refill.loseGreenBox');
}

/**
 * Liên kết đổi sang gói Refill cho từng dòng chai (THUẦN), key = id dòng. Chỉ khi: có cặp (máy chủ đã lọc chai khách từng nhận), gói refill
 * còn hàng và chưa có trong giỏ, dòng không thuộc combo đang áp (đổi sẽ làm mất giảm combo) và không phải dòng gian hàng tạm ngưng. Hai cỡ
 * chai cùng công thức trong giỏ thì chỉ dòng đầu có liên kết. Đổi = thêm 1 gói refill rồi bỏ dòng chai; giá, mốc và trần ưu đãi do máy chủ
 * tính lại như mọi lần sửa giỏ.
 */
export function refillSwapOffers(input: RefillSwapInput): Map<string, RefillSwapView> {
  const out = new Map<string, RefillSwapView>();
  const pairs = input.pairs;
  if (!pairs) return out;
  const sel = input.isSelected ?? (() => true);
  const inCart = new Set(input.lines.map((l) => l.productId).filter(Boolean));
  const usedRefills = new Set<string>();
  for (const line of input.lines) {
    // Dòng bỏ chọn (khách chưa định mua lúc này) và dòng Giờ vàng (Hoàn tác không chắc trả lại giá Giờ vàng) không mời đổi.
    if (line.id.startsWith('pending-') || !line.productId || line.fulfiller?.kind === 'UNAVAILABLE' || line.isFlash || !sel(line.id)) continue;
    const offer = pairs[line.productId];
    if (!offer || !offer.inStock || offer.productId === line.productId || inCart.has(offer.productId) || usedRefills.has(offer.productId)) continue;
    if (inCombo(input.comboGroups, line.id)) continue;
    usedRefills.add(offer.productId);
    const c: Ctx = { line, offer };
    const delta = offer.price - line.total;
    // Mọi mốc sẽ mất đều được nói, không chỉ mốc đầu tiên.
    const lost = [freeshipWarning(input.milestones.freeship, c), giftWarning(input.milestones.giftTrial, c), greenBoxWarning(input, c)].filter(Boolean);
    const warning = lost.length > 0 ? lost.join('. ') : null;
    // "Đã có chai? Đổi sang Refill 10L · 650.000đ", giá tăng thì thêm " (+530.000đ)".
    const label = fillCopy('refill.swapLink', { size: offer.sizeLabel ? ` ${offer.sizeLabel}` : '', price: vnd(offer.price) }) + (delta > 0 ? ` (+${vnd(delta)})` : '');
    out.set(line.id, {
      lineId: line.id,
      bottleVariationId: line.variationId,
      bottleQty: line.quantity,
      refill: offer,
      label,
      delta,
      needsConfirm: delta > 0 || warning !== null,
      warning,
    });
  }
  return out;
}

/** Chữ của tấm xác nhận: tên đủ + giá, mức tăng (nếu có), mốc sẽ mất (nếu có). */
export function refillConfirmText(view: RefillSwapView): { title: string; body: string; confirm: string; cancel: string } {
  const parts = [fillCopy('refill.confirmBody', { name: view.refill.name, price: vnd(view.refill.price) })];
  if (view.delta > 0) parts.push(fillCopy('refill.confirmUp', { amount: vnd(view.delta) }));
  if (view.warning) parts.push(`${view.warning}.`);
  return { title: fillCopy('refill.confirmTitle'), body: parts.join(' '), confirm: fillCopy('refill.confirmCta'), cancel: fillCopy('cart.comboRemoveKeep') };
}

/** Lệnh giỏ mà hai app cắm vào (Mini và web dùng client HTTP riêng). */
export interface RefillCartOps<C extends RefillCartResult = RefillCartResult> {
  add(variationId: string, quantity: number): Promise<C>;
  remove(lineId: string): Promise<C>;
}

/** Thứ cần để hoàn tác: đúng phân loại và số lượng của dòng chai cũ, và phân loại refill vừa thêm. */
export interface RefillSwapReceipt {
  bottleVariationId: string;
  bottleQty: number;
  refillVariationId: string;
}

/**
 * Đổi dòng: THÊM gói refill trước rồi mới bỏ dòng chai. Thêm lỗi (hết hàng, ngừng bán) thì giỏ không đổi gì; bỏ dòng lỗi thì giỏ còn cả
 * hai dòng và khách tự bỏ, không bao giờ mất món cũ mà chưa có món mới.
 */
export async function applyRefillSwap<C extends RefillCartResult>(
  ops: RefillCartOps<C>,
  view: Pick<RefillSwapView, 'lineId' | 'bottleVariationId' | 'bottleQty' | 'refill'>,
): Promise<{ cart: C; receipt: RefillSwapReceipt }> {
  await ops.add(view.refill.variationId, 1);
  const cart = await ops.remove(view.lineId);
  return { cart, receipt: { bottleVariationId: view.bottleVariationId, bottleQty: view.bottleQty, refillVariationId: view.refill.variationId } };
}

/** Hoàn tác: thêm lại đúng số chai cũ rồi bỏ dòng refill vừa thêm (dòng đó đã bị bỏ ở nơi khác thì thôi). */
export async function undoRefillSwap<C extends RefillCartResult>(ops: RefillCartOps<C>, receipt: RefillSwapReceipt): Promise<C> {
  const afterAdd = await ops.add(receipt.bottleVariationId, receipt.bottleQty);
  const refillLine = afterAdd.items.find((l) => l.variationId === receipt.refillVariationId);
  return refillLine ? ops.remove(refillLine.id) : afterAdd;
}
