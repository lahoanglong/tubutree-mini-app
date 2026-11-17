import type { MiniChoiceItem, MiniProductCard, MiniReview, MiniRoundContent, MiniSortBin } from '@tubutree/shared-types';
import type { ProductCard } from '../api/catalog';
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

const isPair = (x: unknown): x is [string, string] => Array.isArray(x) && x.length === 2 && typeof x[0] === 'string' && typeof x[1] === 'string';

/** Ghép Cặp: nguyên liệu → công dụng khách đã ghép với nó (theo nhãn, vì máy chủ chấm theo mục còn khách gửi mã thẻ). */
function matchGivenUses(content: MiniRoundContent, answers: readonly unknown[] | null | undefined): Map<string, string> {
  const cards = new Map(content.game === 'match' ? content.cards.map((c) => [c.cardId, c]) : []);
  const given = new Map<string, string>();
  for (const pair of answers ?? []) {
    if (!isPair(pair)) continue;
    const x = cards.get(pair[0]);
    const y = cards.get(pair[1]);
    if (!x || !y || x.side === y.side) continue;
    const [ing, use] = x.side === 'ingredient' ? [x, y] : [y, x];
    given.set(ing.label, use.label);
  }
  return given;
}

/**
 * Ghép phần chấm của máy chủ với nội dung ván: Đúng Thùng lấy tên thùng, Đố Xanh và Đoán Xuất Xứ lấy chữ của lựa chọn (máy chủ chỉ trả chỉ số),
 * Ghép Cặp lấy công dụng khách đã ghép (từ `answers` đã nộp), Giỏ Đúng Việc lấy tên sản phẩm: một dòng cho đề (bộ đúng và lời giải thích), mỗi
 * món chọn sai một dòng "vì sao".
 */
export function miniReviewRows(review: MiniReview, content: MiniRoundContent, answers?: readonly unknown[] | null): MiniReviewRow[] {
  if (review.game === 'match') {
    const given = matchGivenUses(content, answers);
    return review.items.map((it, i) => {
      const pick = given.get(it.ingredient) ?? null;
      return {
        key: `${it.contentId}-${i}`,
        title: gameCopy('result.pairTitle', { ingredient: it.ingredient, use: it.use }),
        state: it.correct ? 'correct' : pick === null ? 'skipped' : 'wrong',
        given: pick,
        expected: '',
        explanation: it.explanation,
        sourceUrl: it.sourceUrl,
      };
    });
  }
  if (review.game === 'basket') {
    const task = content.game === 'basket' ? content.task : null;
    const name = (slug: string) => task?.products.find((p) => p.slug === slug)?.name ?? slug;
    return review.items.flatMap((it) => {
      const head: MiniReviewRow = {
        key: `${it.contentId}-task`,
        title: task?.task ?? '',
        state: it.correct ? 'correct' : it.picks.length === 0 ? 'skipped' : 'wrong',
        given: null,
        expected: it.correctSlugs.map(name).join(', '),
        explanation: it.explanation,
        sourceUrl: it.sourceUrl,
      };
      const wrong = it.picks
        .filter((p) => !p.correct)
        .map<MiniReviewRow>((p) => ({
          key: `${it.contentId}-${p.slug}`,
          title: name(p.slug),
          state: 'wrong',
          given: null,
          expected: '',
          explanation: p.reason ?? it.explanation,
          sourceUrl: '',
        }));
      return [head, ...wrong];
    });
  }
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

/** Thẻ sản phẩm sau Đố Xanh và Đoán Xuất Xứ: sản phẩm của câu/lượt cuối cùng có gắn sản phẩm (máy chủ đặt lượt sản phẩm ở cuối). */
export function miniQuizProduct(content: MiniRoundContent | undefined): MiniProductCard | null {
  if (!content || (content.game !== 'daily_quiz' && content.game !== 'origin')) return null;
  return [...content.items].reverse().find((x) => x.product)?.product ?? null;
}

/** "Nguyên liệu này có trong" sau Ghép Cặp: tối đa `max` sản phẩm theo `productSlug` của các cặp, cặp khách ghép đúng trước. */
export function miniMatchProductSlugs(review: MiniReview, max = 2): string[] {
  if (review.game !== 'match') return [];
  const ordered = [...review.items.filter((x) => x.correct), ...review.items.filter((x) => !x.correct)];
  return [...new Set(ordered.flatMap((x) => (x.productSlug ? [x.productSlug] : [])))].slice(0, max);
}

/** Bộ đúng của Giỏ Đúng Việc (thẻ sản phẩm lấy từ nội dung ván, theo thứ tự máy chủ đã xáo). */
export function miniBasketSet(review: MiniReview, content: MiniRoundContent | undefined): MiniProductCard[] {
  if (review.game !== 'basket' || !content || content.game !== 'basket') return [];
  const correct = new Set(review.items.flatMap((x) => x.correctSlugs));
  return content.task.products.filter((p) => correct.has(p.slug));
}

/**
 * Sản phẩm gợi ý của ván ở dạng thẻ `line` của bộ thẻ sản phẩm chung (ProductTile), không dựng thẻ riêng. Nội dung game chỉ mang giá đang bán,
 * nên thẻ không có giá gạch và không có nhãn nổi bật.
 */
export function miniProductView(p: MiniProductCard, now = Date.now()): ProductCardView {
  const product = { id: p.slug, slug: p.slug, brand: '', name: p.name, thumbnail: p.imageUrl, basePrice: p.price, salePrice: null, isFeatured: false, inStock: p.inStock };
  return productCardView({ product, variant: 'line', now, showBrand: false });
}

/** Thẻ `line` cho sản phẩm tải từ danh mục (`GET /products?slugs=`), như sau Ghép Cặp: giá và tồn kho hiện hành. */
export const miniCatalogView = (card: ProductCard, now = Date.now()): ProductCardView => productCardView({ product: card, variant: 'line', now, showBrand: false });

/** Khoá truy vấn thẻ sản phẩm của màn kết quả (theo đúng danh sách slug). Không bắt đầu bằng 'game': màn chơi làm mới cả nhóm 'game' lúc có kết quả. */
export const miniProductsKey = (slugs: readonly string[]) => ['game-mini-products', ...slugs] as const;
