import { categoryTrail, type CategoryNode } from '../browse/category-tree';
import { fillTemplate } from '../copy-template';
import type { PdpRefillOfferView } from '../refill/refill-saving';
import { vnd } from './money';

/**
 * Khối "Hỏi nhanh · Cùng danh mục · Bản Refill tiết kiệm" cuối trang sản phẩm web (THUẦN): hỏi–đáp dựng từ dữ liệu trang đã có (thành phần, câu
 * Cách dùng chủ hàng viết trong mô tả, gói Refill đã ghép) và liên kết nội bộ sang danh mục, sản phẩm cùng danh mục và gói Refill. Trang máy chủ
 * dựng khối này và khai cùng các câu hỏi đó trong JSON-LD FAQPage, nên chữ trong JSON-LD luôn là chữ khách đọc được trên trang.
 * Không bịa: thiếu thành phần thì không có câu hỏi thành phần, mô tả không có câu Cách dùng thì không có câu hỏi cách dùng, chai chưa ghép gói
 * Refill còn hàng thì không có câu hỏi Refill.
 */

/** Chữ riêng của khối (như `PDP_ORIGIN_COPY`): chỉ trang máy chủ nạp module này, nên chữ không vào JS nào của trình duyệt. */
export const PDP_LINK_HUB_COPY = {
  faqTitle: 'Hỏi nhanh về sản phẩm',
  faqIngredients: '{name} có thành phần gì?',
  faqIngredientsAnswer: 'Thành phần: {list}.',
  faqUsage: 'Dùng {name} thế nào?',
  faqRefill: '{name} có bản Refill không?',
  faqRefillAnswer: 'Có: {pack}.',
  faqRefillAnswerSave: 'Có: {pack}, tiết kiệm {amount} so với mua chai cùng lượng.',
  linksLabel: 'Sản phẩm liên quan',
  sameCategory: 'Cùng danh mục',
  refillTitle: 'Bản Refill tiết kiệm',
  refillTitlePlain: 'Bản Refill',
  refillSave: '{pack} · tiết kiệm {amount}',
} as const;

export type PdpLinkHubCopyKey = keyof typeof PDP_LINK_HUB_COPY;

/**
 * Trần độ dài phần chữ cố định (không tính tên sản phẩm, tên gói hay danh sách thành phần, vốn đã có trần riêng ở nơi nhập): tiêu đề một dòng
 * ở cột nửa trang của khổ máy tính.
 */
export const PDP_LINK_HUB_COPY_MAX: Record<PdpLinkHubCopyKey, number> = {
  faqTitle: 24,
  faqIngredients: 24,
  faqIngredientsAnswer: 16,
  faqUsage: 20,
  faqRefill: 28,
  faqRefillAnswer: 8,
  faqRefillAnswerSave: 56,
  linksLabel: 24,
  sameCategory: 16,
  refillTitle: 24,
  refillTitlePlain: 16,
  refillSave: 36,
};

export function pdpLinkHubCopy(key: PdpLinkHubCopyKey, vars: Record<string, string | number> = {}): string {
  return fillTemplate(PDP_LINK_HUB_COPY[key], vars, key);
}

/** Số câu thành phần đưa vào câu trả lời; danh sách dài hơn (bảng INCI) vẫn nằm đủ ở khối Thành phần. */
export const PDP_FAQ_INGREDIENTS_MAX = 40;
/** Số sản phẩm cùng danh mục trong khối: một hàng chữ ở khổ máy tính, không thành lưới thứ hai cạnh dải gợi ý. */
export const PDP_CATEGORY_LINKS_MAX = 6;

export interface PdpFaqItem {
  key: 'ingredients' | 'usage' | 'refill';
  q: string;
  /** Câu trả lời một khối chữ (JSON-LD `acceptedAnswer.text`); nhiều câu thì nối bằng xuống dòng. */
  a: string;
  /** Các câu của câu trả lời để vẽ thành danh sách khi có hơn một câu. */
  lines: string[];
}

interface FaqInput {
  name: string;
  ingredients?: readonly { name: string; percentage?: string | null }[] | null;
  /** Các câu của dòng Cách dùng (`pdpOriginView(...).rows` khoá `usage`): đúng chữ khối "Nguồn gốc & cách dùng" đang hiện. */
  usage?: readonly string[] | null;
  /** Thẻ gói Refill của trang (`pdpRefillOffer`): null khi chai chưa ghép hoặc gói hết hàng. */
  refill?: Pick<PdpRefillOfferView, 'name' | 'comparison'> | null;
}

const clean = (s: string | null | undefined): string => (s ?? '').replace(/\s+/g, ' ').trim();

function ingredientsAnswer(list: FaqInput['ingredients']): string | null {
  const seen = new Set<string>();
  const parts: string[] = [];
  for (const ing of list ?? []) {
    const name = clean(ing.name);
    const key = name.toLowerCase();
    if (!name || seen.has(key)) continue;
    seen.add(key);
    const pct = clean(ing.percentage);
    parts.push(pct ? `${name} (${pct})` : name);
    if (parts.length >= PDP_FAQ_INGREDIENTS_MAX) break;
  }
  return parts.length > 0 ? pdpLinkHubCopy('faqIngredientsAnswer', { list: parts.join(', ') }) : null;
}

/**
 * Hỏi–đáp dựng từ dữ liệu sản phẩm theo thứ tự Thành phần → Cách dùng → Refill (THUẦN). Câu hỏi nêu tên sản phẩm để đứng riêng được trong kết quả
 * tìm kiếm. Tên rỗng thì không có câu nào (câu hỏi không đứng được).
 */
export function pdpGeneratedFaq(input: FaqInput): PdpFaqItem[] {
  const name = clean(input.name);
  if (!name) return [];
  const out: PdpFaqItem[] = [];
  const ing = ingredientsAnswer(input.ingredients);
  if (ing) out.push({ key: 'ingredients', q: pdpLinkHubCopy('faqIngredients', { name }), a: ing, lines: [ing] });
  const usage = (input.usage ?? []).map(clean).filter(Boolean);
  if (usage.length > 0) out.push({ key: 'usage', q: pdpLinkHubCopy('faqUsage', { name }), a: usage.join('\n'), lines: usage });
  const pack = clean(input.refill?.name);
  if (pack) {
    const cmp = input.refill?.comparison;
    const a = cmp
      ? pdpLinkHubCopy('faqRefillAnswerSave', { pack, amount: vnd(cmp.savedVnd) })
      : pdpLinkHubCopy('faqRefillAnswer', { pack });
    out.push({ key: 'refill', q: pdpLinkHubCopy('faqRefill', { name }), a, lines: [a] });
  }
  return out;
}

/**
 * Vệt danh mục của sản phẩm (gốc → lá) trong cây công khai: trong các danh mục của sản phẩm, lấy danh mục sâu nhất có trong cây (cụ thể nhất);
 * bằng sâu thì danh mục đứng trước. Id không còn trong cây (danh mục đã xoá) thì bỏ qua; không còn danh mục nào thì rỗng.
 */
export function pdpCategoryTrail(tree: CategoryNode[] | undefined, categoryIds: readonly string[] | null | undefined): CategoryNode[] {
  let best: CategoryNode[] = [];
  for (const id of categoryIds ?? []) {
    const trail = categoryTrail(tree, id);
    if (trail.length > best.length) best = trail;
  }
  return best;
}

export interface PdpLinkItem {
  slug: string;
  name: string;
}

/**
 * Sản phẩm cùng danh mục cho khối liên kết: bỏ chính sản phẩm đang xem và các món đã có ở dải "Cùng thương hiệu" ngay phía trên (dải máy chủ dựng
 * sẵn), bỏ trùng, tối đa `PDP_CATEGORY_LINKS_MAX`, giữ thứ tự của nguồn (bán chạy trước). Lưới "Có thể bạn cũng thích" chỉ tải ở trình duyệt nên
 * máy chủ không biết trước; một món có thể có mặt ở cả lưới đó lẫn khối này.
 */
export function pdpCategoryLinks(
  products: readonly { id: string; slug: string; name: string }[] | null | undefined,
  opts: { currentId: string; exclude?: readonly { id: string }[] | null },
): PdpLinkItem[] {
  const skip = new Set([opts.currentId, ...(opts.exclude ?? []).map((p) => p.id)]);
  const out: PdpLinkItem[] = [];
  for (const p of products ?? []) {
    const name = clean(p.name);
    if (skip.has(p.id) || !p.slug || !name) continue;
    skip.add(p.id);
    out.push({ slug: p.slug, name });
    if (out.length >= PDP_CATEGORY_LINKS_MAX) break;
  }
  return out;
}

/**
 * Mục "Bản Refill" của khối liên kết: chỉ nói "tiết kiệm" (tiêu đề và số tiền) khi thẻ gói Refill cũng nói, tức khi so được với chai cùng lượng
 * (`comparison`); chai hay gói đang Giờ vàng, hoặc không đọc được lượng, thì tiêu đề trung tính và chữ chỉ là tên gói.
 */
export function pdpRefillLink(refill: Pick<PdpRefillOfferView, 'slug' | 'name' | 'comparison'>): { slug: string; title: string; text: string } {
  const pack = clean(refill.name);
  return refill.comparison
    ? { slug: refill.slug, title: pdpLinkHubCopy('refillTitle'), text: pdpLinkHubCopy('refillSave', { pack, amount: vnd(refill.comparison.savedVnd) }) }
    : { slug: refill.slug, title: pdpLinkHubCopy('refillTitlePlain'), text: pack };
}
