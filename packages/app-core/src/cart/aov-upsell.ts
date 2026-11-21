import { FREESHIP_UPSELL_MAX_PRICE, type GiftTrialSummaryDTO } from '@tubutree/shared-types';
import { FREESHIP_ADDON_WINDOW, type FreeshipAddonCandidate } from '../commerce/freeship-progress';
import { vnd } from '../commerce/money';
import { fillCopy } from '../shop-copy';

/**
 * Dải "mua thêm món nhỏ" ở đầu Giỏ (tubu-w7-02), dùng chung cho Mini App và web: mốc kế tiếp khách đang nhắm, dòng nói số còn thiếu, và các món gợi ý.
 * Hai mốc đọc từ dữ liệu máy chủ, không ghi cứng: Miễn phí giao hàng theo `freeshipThreshold` của giỏ (mặc định 199.000đ), quà dùng thử 0đ theo
 * `giftTrial.minOrder` (khoá `commerce.gift_trial_min_order`, mặc định 299.000đ). Dải chỉ đổi thứ tự khách nhìn thấy món; tiền, quà và điểm vẫn do máy chủ tính.
 */

/** Số món tối đa trên dải (tubu-w13-01): hai thẻ gọn xếp dọc, không cuộn ngang, để danh sách giỏ vẫn hiện trong màn đầu ở khổ 375. */
export const AOV_ADDON_MAX = 2;
/** Dưới số này thì ẩn cả dải (PO duyệt sàn 2 ở tubu-w7-02): một thẻ trơ dưới dòng chữ trông như lỗi, và khách vẫn còn nút "Mua thêm" của thanh Miễn phí giao hàng. */
export const AOV_ADDON_MIN = 2;
/** Trần giá một món nhỏ (đồng), cùng số máy chủ dùng khi xếp `GET /upsell/freeship`. */
export const AOV_ADDON_MAX_PRICE = FREESHIP_UPSELL_MAX_PRICE;

export type AovStage = 'freeship' | 'gift';

export interface AovUpsellGoal {
  /** `freeship`: chưa được Miễn phí giao hàng. `gift`: đã được, còn thiếu để mở quà dùng thử 0đ đầu tiên. */
  stage: AovStage;
  /** Số còn thiếu tới mốc (đồng, > 0): cũng là `gap` gửi cho `GET /upsell/freeship`. */
  shortfall: number;
  /** Mốc đang nhắm (đồng). */
  target: number;
  /**
   * Dòng đầu dải. Mốc giao hàng: tiêu đề không số, vì thanh tiến độ ngay trên dải đã nói "Mua thêm {số} để được Miễn phí giao hàng" (`freeship.progress`)
   * và một màn không nói một tin hai lần. Mốc quà: câu có số còn thiếu tới quà, vì ở đầu Giỏ chỉ dải này nói số đó (dải ngay trên chỉ báo đã Miễn phí giao hàng).
   */
  headline: string;
}

export interface AovUpsellGoalInput {
  /** Tiền hàng đang chọn tính mốc: phần Tubu Tree giao, không gồm dòng hết hàng (cùng số với thanh Miễn phí giao hàng và với `giftTrialBase` của máy chủ). */
  base: number;
  /** Thanh Miễn phí giao hàng đang vẽ; null khi giỏ không có phần Tubu Tree giao (không mốc nào áp dụng). */
  freeship: { reached: boolean; remaining: number; threshold: number } | null;
  /** Khối quà của giỏ hoặc của phần đang chọn; thiếu khi cờ tắt, hết quà, hay giá phần chọn chưa về. */
  giftTrial?: GiftTrialSummaryDTO | null;
  /** Giỏ có hàng gian hàng tự giao: dòng chữ nói rõ chỉ hàng Tubu Tree giao được tính. */
  tubuOnly?: boolean;
}

/**
 * Mốc kế tiếp của giỏ, hoặc null khi không còn gì để nhắm (đã Miễn phí giao hàng và quà đã mở, khách đã chọn không nhận quà, hay không có quà).
 * Chưa đạt Miễn phí giao hàng thì nhắm mốc đó trước, kể cả khi mốc quà thấp hơn (cấu hình lạ): dải chỉ nói chuyện quà khi đã qua mốc giao hàng.
 * Mốc quà xét theo `base` của app, không theo cờ `unlocked` của máy chủ, để dải đổi ngay khi khách vừa thêm món (giỏ tạm), không chờ giỏ đọc lại.
 */
export function aovUpsellGoal(input: AovUpsellGoalInput): AovUpsellGoal | null {
  const { freeship, giftTrial } = input;
  if (!freeship) return null;
  if (!freeship.reached) {
    if (!(freeship.remaining > 0)) return null;
    return { stage: 'freeship', shortfall: Math.ceil(freeship.remaining), target: freeship.threshold, headline: fillCopy('freeship.addonsTitle') };
  }
  if (!giftTrial || giftTrial.declined || giftTrial.options.length === 0) return null;
  const base = Math.max(0, Number.isFinite(input.base) ? input.base : 0);
  const target = giftTrial.minOrder;
  if (!(target > base)) return null;
  const shortfall = Math.ceil(target - base);
  return {
    stage: 'gift',
    shortfall,
    target,
    headline: fillCopy(input.tubuOnly === true ? 'aov.giftLineTubu' : 'aov.giftLine', { amount: vnd(shortfall) }),
  };
}

export interface AovGiftRowInput {
  goal: AovUpsellGoal | null;
  /** Dải mua thêm báo về (`onShownChange`): true đang hiện, false không hiện, null còn chờ nguồn món. */
  railShown: boolean | null;
  /** Cùng `base` đã đưa vào `aovUpsellGoal` (tiền hàng app đang thấy, gồm giỏ tạm). */
  base: number;
  giftTrial: GiftTrialSummaryDTO | null | undefined;
}

/**
 * Ô quà khoá dưới danh sách Giỏ ("🎁 Thêm {số} để nhận quà dùng thử 0đ") có được hiện không. Không hiện khi:
 * - dải mốc quà đang hiện hay còn chờ nguồn món: dải nói số còn thiếu ở đầu Giỏ, ô không nói lại, và không hiện rồi biến mất lúc dải tải xong;
 * - tiền hàng app đang thấy đã đủ mốc mà khối quà của máy chủ chưa mở (giỏ tạm vừa thêm món, giỏ chưa đọc lại): ô không được nói "Thêm …" lúc khách đã đủ.
 * Dải không hiện (dưới 2 món, nguồn lỗi) thì ô nói số còn thiếu như cũ. Ô đã mở quà (tên quà, nút "Đổi") không qua hàm này.
 */
export function aovGiftLockedRowShown(input: AovGiftRowInput): boolean {
  if (input.goal?.stage === 'gift' && input.railShown !== false) return false;
  const gift = input.giftTrial;
  if (!gift || gift.options.length === 0 || gift.options.some((o) => o.unlocked)) return true;
  return input.base < gift.minOrder;
}

/** Món là quà dùng thử 0đ của đợt đang chạy: không gợi ý khách trả tiền cho món mà đơn đủ mốc được tặng. */
export function aovGiftExclusions(giftTrial: GiftTrialSummaryDTO | null | undefined): { slugs: Set<string>; variationIds: Set<string> } {
  const slugs = new Set<string>();
  const variationIds = new Set<string>();
  for (const o of giftTrial?.options ?? []) {
    if (o.slug) slugs.add(o.slug);
    variationIds.add(o.variationId);
  }
  return { slugs, variationIds };
}

export interface AovPickOptions {
  shortfall: number;
  /** Món đã trong giỏ (theo slug hoặc phân loại): không gợi ý lại. */
  inCartSlugs?: ReadonlySet<string>;
  inCartVariationIds?: ReadonlySet<string>;
  /** Món không được gợi ý (quà dùng thử 0đ, `aovGiftExclusions`). */
  excludeSlugs?: ReadonlySet<string>;
  excludeVariationIds?: ReadonlySet<string>;
  /** Món được đắt hơn số còn thiếu tối đa chừng này; mặc định `FREESHIP_ADDON_WINDOW`. Nguồn `GET /upsell/freeship` truyền `FREESHIP_BOOSTER_WINDOW`. */
  window?: number;
  /** Nguồn đã xếp ở máy chủ (bán chạy trước): giữ thứ tự nguồn trong nhóm món bù đủ. */
  ranked?: boolean;
}

/**
 * Món nhỏ gợi ý mua thêm: đang bán và còn hàng, có phân loại để thêm một chạm, giá dương không quá `AOV_ADDON_MAX_PRICE` và không quá số còn thiếu + cửa sổ,
 * chưa có trong giỏ, không phải quà 0đ, mỗi sản phẩm một thẻ. Thứ tự: món bù đủ khoảng thiếu một mình trước (nguồn đã xếp thì giữ thứ tự nguồn, không thì rẻ
 * trước để khách vượt mốc ít tiền nhất), rồi món gần đủ (đắt trước: gần số còn thiếu nhất). Tối đa `AOV_ADDON_MAX` (2); dưới `AOV_ADDON_MIN` thì rỗng.
 * Giá là giá thẻ app đang hiện (gồm Giờ vàng), nên món máy chủ trả vẫn được xét lại theo giá và giỏ mới nhất.
 */
export function pickAovAddons<T extends FreeshipAddonCandidate>(candidates: readonly T[] | null | undefined, opts: AovPickOptions): T[] {
  const { shortfall } = opts;
  if (!(shortfall > 0)) return [];
  const maxPrice = Math.min(AOV_ADDON_MAX_PRICE, shortfall + (opts.window ?? FREESHIP_ADDON_WINDOW));
  const seen = new Set<string>();
  const eligible: T[] = [];
  for (const c of candidates ?? []) {
    if (!c.inStock || !c.variationId || !(c.price > 0) || c.price > maxPrice || seen.has(c.slug)) continue;
    if (opts.inCartSlugs?.has(c.slug) || opts.inCartVariationIds?.has(c.variationId)) continue;
    if (opts.excludeSlugs?.has(c.slug) || opts.excludeVariationIds?.has(c.variationId)) continue;
    seen.add(c.slug);
    eligible.push(c);
  }
  const closers = eligible.filter((c) => c.price >= shortfall);
  if (!opts.ranked) closers.sort((a, b) => a.price - b.price);
  const partial = eligible.filter((c) => c.price < shortfall).sort((a, b) => b.price - a.price);
  const picked = [...closers, ...partial].slice(0, AOV_ADDON_MAX);
  return picked.length >= AOV_ADDON_MIN ? picked : [];
}
