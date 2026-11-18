import { canonicalCatalogBrand } from '@tubutree/shared-types';
import { formatSize, parseMeasure } from '../product-compare.unit';
import { foldVietnamese } from '../search-text';

/** Cờ gợi ý đổi sang gói Refill cho khách đã có chai (giỏ và kệ "Mua lại món quen"). Tắt thì hai endpoint trả `{}`. */
export const REFILL_FIRST_ENABLED_KEY = 'catalog.refill_first_enabled';
/** Cặp admin ghép tay, thắng luật tên: `[{"bottleSlug":"…","refillSlug":"…"}]`. */
export const REFILL_PAIRS_OVERRIDE_KEY = 'catalog.refill_pairs_override';
/** Slug không bao giờ được ghép (chai hay gói Refill đều được): `["slug-a","slug-b"]`. */
export const REFILL_PAIRS_BLOCK_KEY = 'catalog.refill_pairs_block';

/** Trần số id một lần hỏi: giỏ và kệ mua lại đều dưới mức này. */
export const REFILL_PAIRS_IDS_MAX = 50;

export interface RefillCatalogRow {
  id: string;
  slug: string;
  name: string;
  brand: string;
  isCombo?: boolean;
}

export interface RefillPairOverride {
  bottleSlug: string;
  refillSlug: string;
}

/**
 * Món refill theo đúng quy ước danh mục Fuwa3e mà huy hiệu REFILL_5 và hộ chiếu xanh đang dùng: slug bắt đầu bằng `refill-` hoặc tên bắt
 * đầu bằng "Refill". Hai nơi kia giữ bản SQL/của họ; đây là bản dùng cho việc ghép cặp.
 */
export function isRefillProduct(p: { slug: string; name: string }): boolean {
  return (p.slug ?? '').toLowerCase().startsWith('refill-') || foldVietnamese(p.name ?? '').startsWith('refill');
}

// Chạy trên chữ đã gấp dấu. Cùng dạng số đo với `product-compare.unit`: số không dính sau chữ ("fuwa3e"), đơn vị không là đầu từ khác.
const MEASURE_WORD_RE = /(?<![a-z0-9.,])\d+(?:[.,]\d+)?\s*(?:ml|lit|l|kg|gram|gr|g)(?![a-z0-9])/g;
const PACKAGING_WORDS = new Set(['chai', 'binh', 'can', 'tui']);

/**
 * Tên công thức để so chai với gói refill: bỏ dấu, chữ thường, bỏ chữ "refill", bỏ dung tích/khối lượng và chữ bao bì (chai, bình, can,
 * túi), bỏ ký tự không phải chữ hay số. "Refill Nước rửa chén Fuwa3e 10L" và "Nước rửa chén Fuwa3e 3,8L" cùng ra "nuoc rua chen fuwa3e".
 */
export function refillFormulaKey(name: string): string {
  return foldVietnamese(name ?? '')
    .replace(MEASURE_WORD_RE, ' ')
    .split(/[^a-z0-9]+/)
    .filter((w) => w !== '' && w !== 'refill' && !PACKAGING_WORDS.has(w))
    .join(' ');
}

/** "10L", "500ml"; null khi tên không ghi lượng hoặc ghi nhiều lượng khác nhau. */
export function refillSizeLabel(name: string): string | null {
  const m = parseMeasure(name ?? '');
  return m ? formatSize(m) : null;
}

const brandOf = (p: RefillCatalogRow) => canonicalCatalogBrand(p.brand ?? '');

/** Đọc cấu hình ghi đè; sai dạng ở phần tử nào thì bỏ phần tử đó (không làm hỏng cả danh sách). */
export function parseRefillOverrides(raw: unknown): RefillPairOverride[] {
  if (!Array.isArray(raw)) return [];
  const out: RefillPairOverride[] = [];
  for (const v of raw) {
    if (!v || typeof v !== 'object') continue;
    const { bottleSlug, refillSlug } = v as Record<string, unknown>;
    if (typeof bottleSlug === 'string' && typeof refillSlug === 'string' && bottleSlug.trim() && refillSlug.trim() && bottleSlug.trim() !== refillSlug.trim()) {
      out.push({ bottleSlug: bottleSlug.trim(), refillSlug: refillSlug.trim() });
    }
  }
  return out;
}

export function parseRefillBlock(raw: unknown): Set<string> {
  return new Set(Array.isArray(raw) ? raw.filter((s): s is string => typeof s === 'string' && s.trim() !== '').map((s) => s.trim()) : []);
}

/**
 * Ghép chai gốc → gói refill (THUẦN). Món gốc là món không phải refill, không phải combo, cùng thương hiệu, có tên công thức trùng khít với
 * đúng MỘT gói refill. Không ứng viên, nhiều ứng viên (hai dung tích refill của cùng công thức) hay "chai" không nhỏ hơn gói refill thì không
 * ghép: thà thiếu cặp còn hơn mời khách đổi sang món khác công thức. Ghi đè của admin thắng luật tên; slug trong danh sách chặn không ghép.
 * Kết quả: id chai → id gói refill. Nhiều cỡ chai của cùng công thức trỏ về cùng một gói refill.
 */
export function pairRefills(
  products: readonly RefillCatalogRow[],
  opts: { overrides?: readonly RefillPairOverride[]; block?: ReadonlySet<string> } = {},
): Map<string, string> {
  const block = opts.block ?? new Set<string>();
  const live = products.filter((p) => !p.isCombo && !block.has(p.slug));
  const refillsByKey = new Map<string, RefillCatalogRow[]>();
  for (const r of live) {
    if (!isRefillProduct(r)) continue;
    const key = `${brandOf(r)}|${refillFormulaKey(r.name)}`;
    refillsByKey.set(key, [...(refillsByKey.get(key) ?? []), r]);
  }
  const pairs = new Map<string, string>();
  for (const b of live) {
    if (isRefillProduct(b)) continue;
    const formula = refillFormulaKey(b.name);
    if (!formula) continue;
    const candidates = refillsByKey.get(`${brandOf(b)}|${formula}`) ?? [];
    if (candidates.length !== 1) continue;
    const refill = candidates[0]!;
    const bottleSize = parseMeasure(b.name);
    const refillSize = parseMeasure(refill.name);
    if (bottleSize && refillSize && (bottleSize.unit !== refillSize.unit || bottleSize.qty >= refillSize.qty)) continue;
    pairs.set(b.id, refill.id);
  }
  const bySlug = new Map(live.map((p) => [p.slug, p]));
  for (const o of opts.overrides ?? []) {
    const bottle = bySlug.get(o.bottleSlug);
    const refill = bySlug.get(o.refillSlug);
    if (bottle && refill && !isRefillProduct(bottle)) pairs.set(bottle.id, refill.id);
  }
  return pairs;
}

/** `?ids=a,b,c` → danh sách id khác rỗng, không trùng, tối đa `REFILL_PAIRS_IDS_MAX`. */
export function parseRefillIds(raw: string | undefined): string[] {
  const seen = new Set<string>();
  for (const s of (raw ?? '').split(',')) {
    const id = s.trim();
    if (id && seen.size < REFILL_PAIRS_IDS_MAX) seen.add(id);
  }
  return [...seen];
}
