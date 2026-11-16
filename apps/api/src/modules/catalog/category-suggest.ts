import { effectiveCatalogBrand } from '@tubutree/shared-types';

/**
 * Gợi ý danh mục cho sản phẩm chưa có danh mục (đồng bộ Pancake không ghi `categoryIds`). Hàm thuần: chỉ đọc tên, nhãn và slug, không
 * đoán từ mô tả. Kết quả là bản nháp cho admin duyệt ở màn "Gán danh mục hàng loạt"; không đường nào tự ghi nó vào DB.
 *
 * Luật khớp trên tên GIỮ DẤU (chữ thường, NFC) theo ranh giới từ: bỏ dấu thì "dưỡng" thành "duong" giống "đường", "trà" khớp nhầm
 * "tẩy trang". Mỗi luật có độ tin cậy; một danh mục lấy luật mạnh nhất khớp với nó. Luật `fallback` (chỉ dựa vào nhãn) chỉ dùng khi
 * không luật từ khoá nào khớp, để nhãn chung chung không thêm danh mục thứ hai cạnh loại hàng đã đọc được từ tên.
 */

/** Từ ngưỡng này admin có thể chọn hàng loạt; dưới ngưỡng thì cần người xem từng dòng. */
export const CATEGORY_SUGGEST_AUTO_MIN = 0.9;
/** Dưới ngưỡng này không gợi ý danh mục đó. */
const CATEGORY_SUGGEST_MIN = 0.6;
/** Hai loại hàng (vd Thực phẩm và Đồ uống) cùng khớp thì luật đang mâu thuẫn: hạ dưới ngưỡng chọn hàng loạt để người xem quyết. */
const MIXED_TYPES_CONFIDENCE = 0.8;

/** Danh mục theo người dùng (cho bé, mẹ bầu) đi kèm một loại hàng được; các danh mục còn lại là loại hàng. */
const AUDIENCE_CATEGORIES: ReadonlySet<string> = new Set(['cat-baby', 'cat-mom']);

export interface CategoryRule {
  id: string;
  /** Câu ngắn hiện cho admin biết vì sao có gợi ý. */
  label: string;
  categoryId: string;
  confidence: number;
  /** Nhãn hiệu lực (sau `effectiveCatalogBrand`) phải là một trong các nhãn này. */
  brands?: readonly string[];
  notBrands?: readonly string[];
  /** Tên chứa ít nhất một cụm (trọn từ). Không khai thì luật chỉ dựa vào nhãn. */
  terms?: readonly string[];
  /** Tên chứa một cụm trong đây thì luật không áp dụng. */
  without?: readonly string[];
  fallback?: boolean;
}

const CLEANING_TERMS = ['rửa chén', 'lau sàn', 'lau', 'giặt', 'toilet', 'bồn cầu', 'nhà tắm', 'ngâm rửa', 'làm bóng', 'xả vải', 'đa năng', 'rửa bình', 'tẩy rửa', 'rửa rau', 'ô tô'];
const SKIN_TERMS = ['son', 'mặt nạ', 'serum', 'sữa rửa mặt', 'rửa mặt', 'tẩy trang', 'kem dưỡng', 'dưỡng da', 'dưỡng ẩm', 'toner', 'nước hoa hồng', 'kem chống nắng', 'tẩy tế bào chết'];
const FOOD_TERMS = ['hạt', 'granola', 'tiêu', 'đường', 'mật', 'gạo', 'bánh', 'sấy', 'bột', 'nước tương', 'nước mắm', 'ngũ cốc', 'yến mạch', 'rong biển', 'muối', 'mứt', 'nông sản'];
// Thực phẩm: tên chứa các cụm này là đồ tẩy rửa, đồ uống hay ý khác ("điều hòa đường huyết" của nước uống, "muối rửa chén").
const FOOD_WITHOUT = ['rửa', 'ngâm', 'giặt', 'trà', 'cà phê', 'nước uống', 'hoà tan', 'uống liền', 'đường huyết', 'tiêu hoá'];
const DRINK_TERMS = ['cà phê', 'cafe', 'café', 'coffee', 'trà', 'socola', 'sô cô la', 'ca cao', 'cacao', 'hoà tan', 'uống liền', 'nước uống', 'đồ uống', 'nước ép'];
// "Mặt nạ trà xanh", "sữa tắm cà phê": loại hàng là mỹ phẩm/chăm sóc, không phải đồ uống.
const DRINK_WITHOUT = ['mặt nạ', 'rửa mặt', 'tẩy trang', 'son', 'dầu gội', 'sữa tắm', 'tẩy tế bào chết', 'kem'];

export const CATEGORY_RULES: readonly CategoryRule[] = [
  { id: 'fuwa3e-tay-rua', label: 'Fuwa3e + từ khoá tẩy rửa', categoryId: 'cat-cleaning', confidence: 0.97, brands: ['Fuwa3e'], terms: [...CLEANING_TERMS, 'rửa tay', 'khử mùi', 'xịt thơm'] },
  { id: 'tay-rua', label: 'Từ khoá tẩy rửa', categoryId: 'cat-cleaning', confidence: 0.9, terms: CLEANING_TERMS },
  { id: 'fuwa3e', label: 'Nhãn Fuwa3e (đồ tẩy rửa)', categoryId: 'cat-cleaning', confidence: 0.85, brands: ['Fuwa3e'], fallback: true },

  { id: 'cho-be', label: 'Tên có "cho bé"', categoryId: 'cat-baby', confidence: 0.95, terms: ['cho bé', 'em bé', 'trẻ em', 'trẻ sơ sinh', 'sơ sinh', 'bình sữa'] },
  { id: 'pineboo', label: 'Nhãn Pineboo (đồ cho bé)', categoryId: 'cat-baby', confidence: 0.95, brands: ['Pineboo'] },
  { id: 'me-bau', label: 'Tên có "mẹ bầu"', categoryId: 'cat-mom', confidence: 0.95, terms: ['mẹ bầu', 'bà bầu', 'sau sinh', 'thai kỳ', 'cho con bú'] },

  { id: 'toc-tam-goi', label: 'Từ khoá tóc, tắm gội', categoryId: 'cat-personal', confidence: 0.9, terms: ['dầu gội', 'dầu xả', 'gội', 'tóc', 'da đầu', 'sữa tắm', 'tắm gội', 'bọt tắm', 'dưỡng thể', 'kem đánh răng', 'lăn khử mùi', 'xịt tràm', 'tinh dầu tràm'] },
  { id: 'mui-gia', label: 'Nước mùi già (tắm)', categoryId: 'cat-personal', confidence: 0.85, terms: ['mùi già'] },
  { id: 'rua-tay', label: 'Từ khoá rửa tay', categoryId: 'cat-personal', confidence: 0.85, notBrands: ['Fuwa3e'], terms: ['rửa tay'] },
  { id: 'xit', label: 'Từ khoá xịt', categoryId: 'cat-personal', confidence: 0.75, notBrands: ['Fuwa3e'], terms: ['xịt'], without: ['ô tô', 'xịt thơm', 'khử mùi'] },

  { id: 'my-pham-nhan', label: 'Pơ Lang/Visante + từ khoá mỹ phẩm', categoryId: 'cat-skincare', confidence: 0.97, brands: ['Pơ Lang', 'Visante'], terms: SKIN_TERMS, without: ['da đầu'] },
  { id: 'my-pham', label: 'Từ khoá mỹ phẩm', categoryId: 'cat-skincare', confidence: 0.9, terms: SKIN_TERMS, without: ['da đầu'] },
  { id: 'my-pham-nhan-chung', label: 'Nhãn Pơ Lang/Visante (chưa rõ loại)', categoryId: 'cat-skincare', confidence: 0.7, brands: ['Pơ Lang', 'Visante'], fallback: true },

  { id: 'le-plateau', label: 'Nhãn Le Plateau (cà phê)', categoryId: 'cat-coffee', confidence: 0.95, brands: ['Le Plateau Coffee'] },
  { id: 'do-uong', label: 'Từ khoá cà phê, trà, đồ uống', categoryId: 'cat-coffee', confidence: 0.9, terms: DRINK_TERMS, without: DRINK_WITHOUT },
  { id: 'dong-trung', label: 'Nước đông trùng hạ thảo', categoryId: 'cat-coffee', confidence: 0.85, terms: ['đông trùng hạ thảo', 'đông trùng'] },
  { id: 'hector', label: 'Nhãn Hector (nước uống)', categoryId: 'cat-coffee', confidence: 0.75, brands: ['Hector'], fallback: true },

  { id: 'thuc-pham-nhan', label: 'BH.Nong/Sokfarm + từ khoá thực phẩm', categoryId: 'cat-food', confidence: 0.95, brands: ['BH.Nong', 'Sokfarm'], terms: FOOD_TERMS, without: FOOD_WITHOUT },
  { id: 'thuc-pham', label: 'Từ khoá thực phẩm', categoryId: 'cat-food', confidence: 0.9, terms: FOOD_TERMS, without: FOOD_WITHOUT },
  { id: 'thuc-pham-nhan-chung', label: 'Nhãn BH.Nong/Sokfarm (chưa rõ loại)', categoryId: 'cat-food', confidence: 0.8, brands: ['BH.Nong', 'Sokfarm'], fallback: true },
];

export interface CategoryMatch {
  categoryId: string;
  confidence: number;
  ruleId: string;
  rule: string;
}

export interface CategorySuggestion {
  /** Danh mục gợi ý, độ tin cậy giảm dần. Rỗng khi không luật nào khớp. */
  categoryIds: string[];
  /** Độ tin cậy của cả gợi ý: danh mục yếu nhất (áp dụng là ghi tất cả cùng lúc). 0 khi không có gợi ý. */
  confidence: number;
  matches: CategoryMatch[];
}

/**
 * Chữ thường NFC, dấu thanh đặt kiểu mới ("hoà", "tuỳ"): tên Pancake viết lẫn "hòa"/"hoà" nên đưa cả tên lẫn cụm khoá về một kiểu
 * trước khi so (dấu thanh nằm ngay sau o/u ở cuối từ, tách NFD thì dời ra sau a/e/y).
 */
const TONE_MARKS = '\u0300\u0301\u0303\u0309\u0323';
const OLD_TONE_OA = new RegExp(`o([${TONE_MARKS}])([ae])(?![\\p{L}\\p{M}])`, 'gu');
const OLD_TONE_UY = new RegExp(`u([${TONE_MARKS}])y(?![\\p{L}\\p{M}])`, 'gu');
const normalize = (s: string): string =>
  s
    .normalize('NFD')
    .toLocaleLowerCase('vi')
    .replace(OLD_TONE_OA, 'o$2$1')
    .replace(OLD_TONE_UY, 'uy$1')
    .normalize('NFC')
    .replace(/\s+/g, ' ')
    .trim();
const escapeRegExp = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const termCache = new Map<string, RegExp>();
function hasTerm(text: string, term: string): boolean {
  let re = termCache.get(term);
  if (!re) {
    // Ranh giới là chữ cái/chữ số Unicode: "trà" không khớp "tràm", "son" không khớp "sơn".
    re = new RegExp(`(?<![\\p{L}\\p{N}])${escapeRegExp(normalize(term))}(?![\\p{L}\\p{N}])`, 'u');
    termCache.set(term, re);
  }
  return re.test(text);
}

const sameBrand = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

function ruleFires(rule: CategoryRule, text: string, brand: string): boolean {
  if (rule.brands && !rule.brands.some((b) => sameBrand(b, brand))) return false;
  if (rule.notBrands?.some((b) => sameBrand(b, brand))) return false;
  if (rule.terms && !rule.terms.some((t) => hasTerm(text, t))) return false;
  if (rule.without?.some((t) => hasTerm(text, t))) return false;
  return true;
}

/**
 * Gợi ý danh mục cho một sản phẩm. `validIds` là danh mục lá đang có trong DB: luật trỏ tới danh mục đã xoá hay đã có mục con thì bị bỏ,
 * nên gợi ý không bao giờ chứa id không gán được.
 */
export function suggestCategories(
  product: { name: string; brand: string | null; slug?: string | null },
  validIds: ReadonlySet<string>,
  rules: readonly CategoryRule[] = CATEGORY_RULES,
): CategorySuggestion {
  const text = normalize(product.name ?? '');
  const brand = effectiveCatalogBrand(product.name, product.slug ?? null, product.brand ?? '');
  const best = new Map<string, CategoryMatch>();
  const take = (pool: readonly CategoryRule[]) => {
    for (const r of pool) {
      if (!validIds.has(r.categoryId) || !ruleFires(r, text, brand)) continue;
      const cur = best.get(r.categoryId);
      if (!cur || r.confidence > cur.confidence) best.set(r.categoryId, { categoryId: r.categoryId, confidence: r.confidence, ruleId: r.id, rule: r.label });
    }
  };
  take(rules.filter((r) => !r.fallback));
  if (best.size === 0) take(rules.filter((r) => r.fallback));
  const matches = [...best.values()]
    .filter((m) => m.confidence >= CATEGORY_SUGGEST_MIN)
    .sort((a, b) => b.confidence - a.confidence || (a.categoryId < b.categoryId ? -1 : a.categoryId > b.categoryId ? 1 : 0));
  if (matches.length === 0) return { categoryIds: [], confidence: 0, matches: [] };
  let confidence = Math.min(...matches.map((m) => m.confidence));
  if (matches.filter((m) => !AUDIENCE_CATEGORIES.has(m.categoryId)).length > 1) confidence = Math.min(confidence, MIXED_TYPES_CONFIDENCE);
  return { categoryIds: matches.map((m) => m.categoryId), confidence, matches };
}
