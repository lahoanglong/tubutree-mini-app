/**
 * Gợi ý ảnh WordPress cho sản phẩm đang rỗng ảnh mà bảng ứng viên làm tay (`WP_IMAGE_CANDIDATES`) chưa có dòng.
 *
 * Chỉ để người duyệt NHÌN THẤY ảnh thật và chọn một chạm: kết quả luôn là hạng CANDIDATE (không phải EXACT), không bao giờ được `runExactSync`
 * nạp tự động, và duyệt vẫn phải qua hộp xác nhận ở trang Admin. Hàm thuần, không gọi mạng: kho WordPress do phía gọi tải về rồi truyền vào.
 *
 * Cách so: tách tên thành các từ khoá (bỏ dấu, bỏ quy cách 250g/1kg/50x16g/10L và từ bao bì hộp/túi/lon/combo), chấm mỗi sản phẩm WordPress bằng
 * tỉ lệ trọng số của từ khoá tên SKU mà tên WordPress cũng có. Trọng số theo độ hiếm trong kho WordPress (từ chung như "hạt", "gạo lứt", "nước"
 * nhẹ, từ riêng như "granola", "sầu riêng" nặng) để tên dài kiểu SEO ở WordPress không làm điểm tụt. Hãng ngoài (Sokfarm, Pơ Lang, BH.Nong, Fuwa3e...)
 * bắt buộc khớp hãng trong tên hoặc slug WordPress; nhãn Tubu Tree thì không ràng hãng.
 */

export interface WpCatalogItem {
  id: number;
  slug: string;
  name: string;
}

export interface WpSuggestion {
  source: { id: number; slug: string };
  /** Tên WordPress đã giải mã ký tự đặc biệt, để hiện cho người duyệt. */
  name: string;
  /** 0..1: tỉ lệ trọng số từ khoá của SKU mà sản phẩm WordPress có. */
  score: number;
  shared: string[];
}

export interface SuggestInput {
  name: string;
  brand: string;
}

export const SUGGEST_MIN_SCORE = 0.5;
/** Chỉ giữ ứng viên có điểm từ 80% điểm ứng viên đầu: bớt hàng đuôi chỉ trùng vài từ chung. */
export const SUGGEST_RELATIVE_CUTOFF = 0.8;
export const SUGGEST_MAX = 3;

const HOUSE_BRAND_KEYS: ReadonlySet<string> = new Set(['tubutree']);
/** Chính tả cũ còn nằm trong `products.brand` (W145 đổi Sokfram thành Sokfarm, ánh xạ khi đọc). */
const BRAND_ALIASES: Readonly<Record<string, string>> = { sokfram: 'sokfarm' };
/** Từ bao bì và từ nối: không phân biệt sản phẩm này với sản phẩm kia. */
const PACKAGING: ReadonlySet<string> = new Set(['hop', 'tui', 'lon', 'chai', 'hu', 'lo', 'goi', 'thung', 'can', 'combo', 'thiec', 'tien', 'loi', 'refill', 'set', 'thuy', 'tinh', 'cho', 'va', 'voi', 'cua', 'la', 'mot']);
/** Quy cách: 250g, 1,5kg, 160ml, 10L, 50x16g, 20 x 20g. */
const QUANTITY = /\d+(?:[.,]\d+)?\s*(?:x\s*\d+(?:[.,]\d+)?\s*)?(?:g|gr|gam|gram|kg|ml|l|lit)(?![a-z0-9])/g;

const foldVi = (s: string): string => s.normalize('NFD').replace(/\p{M}/gu, '').replace(/đ/gi, 'd').toLowerCase();
const alnum = (s: string): string => foldVi(s).replace(/[^a-z0-9]/g, '');

const NAMED_ENTITIES: Readonly<Record<string, string>> = { amp: '&', quot: '"', lt: '<', gt: '>', nbsp: ' ', apos: "'" };

/** WordPress trả tên đã mã hoá HTML (`&#8211;`, `&amp;`). Giải mã số và vài tên thông dụng; thực thể lạ thì thành khoảng trắng. */
export function cleanWpName(raw: string): string {
  return raw
    .replace(/&#(\d{1,6});/g, (_m, n: string) => {
      const cp = Number(n);
      return cp > 0 && cp <= 0x10ffff ? String.fromCodePoint(cp) : ' ';
    })
    .replace(/&([a-z]+);/gi, (_m, n: string) => NAMED_ENTITIES[n.toLowerCase()] ?? ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Từ khoá của một tên: không dấu, không trùng, bỏ quy cách, từ bao bì, số trần và chữ một ký tự. */
export function nameTokens(text: string): string[] {
  const folded = foldVi(cleanWpName(text)).replace(/[[\]()]/g, ' ').replace(QUANTITY, ' ');
  return [...new Set(folded.split(/[^a-z0-9]+/).filter((w) => w.length >= 2 && !/^\d+$/.test(w) && !PACKAGING.has(w)))];
}

const brandKey = (brand: string): string => {
  const key = alnum(brand);
  return BRAND_ALIASES[key] ?? key;
};

const SLUG_OK = /^[a-z0-9-]+$/;
const asRecord = (v: unknown): Record<string, unknown> | null => (typeof v === 'object' && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : null);

/** Đọc một trang `GET /wc/store/v1/products`: giữ sản phẩm có mã dương, slug an toàn, có tên và CÓ ít nhất một ảnh (không gợi ý sản phẩm không có ảnh để chọn). */
export function parseWpCatalog(json: unknown): WpCatalogItem[] {
  const out: WpCatalogItem[] = [];
  for (const row of Array.isArray(json) ? json : []) {
    const r = asRecord(row);
    if (!r || typeof r.id !== 'number' || !Number.isInteger(r.id) || r.id <= 0) continue;
    if (typeof r.slug !== 'string' || !SLUG_OK.test(r.slug) || typeof r.name !== 'string' || r.name.trim() === '') continue;
    if (!Array.isArray(r.images) || r.images.length === 0) continue;
    out.push({ id: r.id, slug: r.slug, name: cleanWpName(r.name) });
  }
  return out;
}

export type WpMatcher = (sku: SuggestInput) => WpSuggestion[];

/** Dựng bộ so khớp trên một kho WordPress (tính độ hiếm một lần, dùng cho nhiều SKU). */
export function buildWpMatcher(catalog: readonly WpCatalogItem[]): WpMatcher {
  const docs = catalog.map((item) => ({ item, tokens: new Set(nameTokens(item.name)), haystack: alnum(`${item.name} ${item.slug}`) }));
  const df = new Map<string, number>();
  for (const d of docs) for (const t of d.tokens) df.set(t, (df.get(t) ?? 0) + 1);
  const weight = (t: string): number => Math.log(1 + docs.length / (df.get(t) ?? 0.5));

  return (sku) => {
    const key = brandKey(sku.brand);
    const brandWords = new Set(nameTokens(sku.brand));
    const wanted = nameTokens(sku.name).filter((t) => !brandWords.has(t));
    if (wanted.length === 0) return [];
    const total = wanted.reduce((sum, t) => sum + weight(t), 0);
    const needShared = Math.min(2, wanted.length);

    const hits: { item: WpCatalogItem; score: number; shared: string[]; size: number }[] = [];
    for (const d of docs) {
      if (key !== '' && !HOUSE_BRAND_KEYS.has(key) && !d.haystack.includes(key)) continue;
      const shared = wanted.filter((t) => d.tokens.has(t));
      if (shared.length < needShared) continue;
      const score = shared.reduce((sum, t) => sum + weight(t), 0) / total;
      if (score >= SUGGEST_MIN_SCORE) hits.push({ item: d.item, score, shared, size: d.tokens.size });
    }
    hits.sort((a, b) => b.score - a.score || a.size - b.size || a.item.id - b.item.id);
    const top = hits[0]?.score ?? 0;
    return hits
      .filter((h) => h.score >= top * SUGGEST_RELATIVE_CUTOFF)
      .slice(0, SUGGEST_MAX)
      .map((h) => ({ source: { id: h.item.id, slug: h.item.slug }, name: h.item.name, score: Math.round(h.score * 100) / 100, shared: h.shared }));
  };
}
