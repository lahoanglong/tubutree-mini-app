import type { MiniChoiceItem, MiniProductCard, MiniReview, MiniRoundContent, MiniSortBin } from '@tubutree/shared-types';
import { productCardView, type ProductCardView } from '../commerce/product-card-view';
import { gameCopy } from './copy';

/** Một dòng "Vì sao" ở màn kết quả, đã quy về cùng một dạng cho mọi game có giao diện. */
export interface MiniReviewRow {
  key: string;
  title: string;
  state: 'correct' | 'wrong' | 'skipped';
  given: string | null;
  expected: string;
  explanation: string;
  sourceUrl: string;
}

export const MINI_REVIEW_BADGE = { correct: 'result.correct', wrong: 'result.wrong', skipped: 'result.skipped' } as const;

const binName = (b: MiniSortBin) => gameCopy(`sort.bin.${b}`);

/**
 * Ghép phần chấm của máy chủ với nội dung ván: Đúng Thùng lấy tên thùng, Đố Xanh lấy chữ của lựa chọn (máy chủ chỉ trả chỉ số).
 * Game chưa có giao diện trả mảng rỗng.
 */
export function miniReviewRows(review: MiniReview, content: MiniRoundContent): MiniReviewRow[] {
  if (review.game === 'sort') {
    return review.items.map((it, i) => ({
      key: `${it.contentId}-${i}`,
      title: it.label,
      state: it.given === null ? 'skipped' : it.correct ? 'correct' : 'wrong',
      given: it.given === null ? null : binName(it.given),
      expected: binName(it.expected),
      explanation: it.explanation,
      sourceUrl: it.sourceUrl,
    }));
  }
  if (review.game === 'daily_quiz' || review.game === 'origin') {
    const items: MiniChoiceItem[] = content.game === 'daily_quiz' || content.game === 'origin' ? content.items : [];
    return review.items.map((it, i) => {
      const opts = (items.find((x) => x.id === it.contentId) ?? items[i])?.options ?? [];
      return {
        key: `${it.contentId}-${i}`,
        title: it.prompt,
        state: it.given === null ? 'skipped' : it.correct ? 'correct' : 'wrong',
        given: it.given === null ? null : opts[it.given] ?? null,
        expected: opts[it.expected] ?? '',
        explanation: it.explanation,
        sourceUrl: it.sourceUrl,
      };
    });
  }
  return [];
}

/** Thẻ sản phẩm sau Đố Xanh: sản phẩm của câu cuối cùng có gắn sản phẩm. */
export function miniQuizProduct(content: MiniRoundContent | undefined): MiniProductCard | null {
  if (!content || content.game !== 'daily_quiz') return null;
  return [...content.items].reverse().find((x) => x.product)?.product ?? null;
}

/**
 * Sản phẩm gợi ý của ván ở dạng thẻ `line` của bộ thẻ sản phẩm chung (ProductTile), không dựng thẻ riêng. Nội dung game chỉ mang giá đang bán,
 * nên thẻ không có giá gạch và không có nhãn nổi bật.
 */
export function miniProductView(p: MiniProductCard, now = Date.now()): ProductCardView {
  const product = { id: p.slug, slug: p.slug, brand: '', name: p.name, thumbnail: p.imageUrl, basePrice: p.price, salePrice: null, isFeatured: false, inStock: p.inStock };
  return productCardView({ product, variant: 'line', now, showBrand: false });
}
