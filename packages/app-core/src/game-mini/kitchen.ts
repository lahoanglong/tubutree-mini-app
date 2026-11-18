import type { MiniProductCard, MiniReview, MiniRoundContent } from '@tubutree/shared-types';
import { kitchenCopy, kitchenCornerName } from './kitchen-copy';
import type { MiniReviewRow } from './review';

/**
 * Logic thuần của Căn Bếp Xanh (bàn chơi web và màn kết quả). Máy chủ giữ đáp án: bàn chơi chỉ ghi sản phẩm khách đổi vào ở mỗi món, mỗi món đổi
 * đúng một lần (đổi xong là khoá, hiện điều nhãn ghi rồi sang góc tiếp). Đúng/sai, "Vì sao" và nguồn hiện ở màn kết quả sau khi máy chủ chấm.
 */
export interface KitchenProgress {
  /** Món đang mở. */
  index: number;
  /** Slug đã đổi vào ở mỗi món; null là chưa đổi. */
  answers: (string | null)[];
}

export const kitchenStart = (total: number): KitchenProgress => ({ index: 0, answers: Array.from({ length: total }, () => null) });

export const kitchenSwapped = (p: KitchenProgress): boolean => (p.answers[p.index] ?? null) !== null;

export const kitchenIsLast = (p: KitchenProgress): boolean => p.index >= p.answers.length - 1;

export const kitchenDoneCount = (p: KitchenProgress): number => p.answers.filter((a) => a !== null).length;

/** Đổi món đang mở sang `slug`. Slug lạ hoặc món đã đổi rồi thì trả lại đúng object cũ (nơi gọi so sánh để bỏ qua chạm thừa). */
export function kitchenSwap(p: KitchenProgress, slug: string, allowed: readonly string[]): KitchenProgress {
  if (kitchenSwapped(p) || !allowed.includes(slug)) return p;
  const answers = p.answers.slice();
  answers[p.index] = slug;
  return { ...p, answers };
}

/** Sang món tiếp khi món đang mở đã đổi và chưa phải món cuối; ngoài ra trả lại object cũ. */
export function kitchenNext(p: KitchenProgress): KitchenProgress {
  if (!kitchenSwapped(p) || kitchenIsLast(p)) return p;
  return { ...p, index: p.index + 1 };
}

function productsOf(content: MiniRoundContent | undefined): Map<string, MiniProductCard> {
  const out = new Map<string, MiniProductCard>();
  if (content?.game !== 'kitchen_swap') return out;
  for (const sw of content.swaps) for (const o of sw.options) out.set(o.product.slug, o.product);
  return out;
}

/**
 * Sản phẩm Tubu của ván: sản phẩm đúng việc của từng món, theo thứ tự góc đã chơi, không trùng. Thẻ lấy từ nội dung ván (máy chủ chỉ phát món
 * có cả 3 sản phẩm còn hàng); giá và tồn kho mới nhất do bước thêm giỏ tải lại.
 */
export function kitchenDiscovered(review: MiniReview, content: MiniRoundContent | undefined): MiniProductCard[] {
  if (review.game !== 'kitchen_swap') return [];
  const cards = productsOf(content);
  const seen = new Set<string>();
  const out: MiniProductCard[] = [];
  for (const it of review.items) {
    const card = cards.get(it.expected);
    if (!card || seen.has(card.slug)) continue;
    seen.add(card.slug);
    out.push(card);
  }
  return out;
}

/** Dòng "Vì sao" của từng món: góc và món, sản phẩm khách đổi vào, sản phẩm đúng việc, lời giải thích và nguồn. */
export function kitchenReviewRows(review: MiniReview, content: MiniRoundContent | undefined): MiniReviewRow[] {
  if (review.game !== 'kitchen_swap') return [];
  const cards = productsOf(content);
  const name = (slug: string) => cards.get(slug)?.name ?? slug;
  return review.items.map((it, i) => ({
    key: `${it.contentId}-${i}`,
    title: kitchenCopy('reviewTitle', { corner: kitchenCornerName(it.corner), item: it.item }),
    state: it.given === null ? 'skipped' : it.correct ? 'correct' : 'wrong',
    given: it.given === null ? null : name(it.given),
    expected: name(it.expected),
    explanation: it.explanation,
    sourceUrl: it.sourceUrl,
  }));
}
