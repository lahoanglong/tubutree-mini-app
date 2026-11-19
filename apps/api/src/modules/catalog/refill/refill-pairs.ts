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
 * Gói refill tự ghép chỉ khi lớn hơn chai và không quá chừng này lần chai: chai 3,8L sang can 10L là đổi cùng dòng; chai 100ml–2L sang can
 * 10L là mời khách mua lượng gấp 5–100 lần, nên chỉ admin ghép tay mới có.
 */
export const REFILL_AUTO_MAX_RATIO = 3;

/** Chai và gói refill đều ghi lượng, cùng chiều (ml hay g), gói lớn hơn chai và không quá `REFILL_AUTO_MAX_RATIO` lần. */
export function refillAutoSizeOk(bottleName: string, refillName: string): boolean {
  const b = parseMeasure(bottleName);
  const r = parseMeasure(refillName);
  return !!b && !!r && b.unit === r.unit && b.qty < r.qty && r.qty <= REFILL_AUTO_MAX_RATIO * b.qty;
}

/**
 * Trạng thái một chai trong bảng cặp: `auto` tự ghép; `manual` admin ghép tay; `size` cùng công thức nhưng lệch lượng (không ghi lượng,
 * khác chiều, gói không lớn hơn chai hay lớn quá `REFILL_AUTO_MAX_RATIO` lần) nên chờ admin; `ambiguous` nhiều gói refill cùng công thức;
 * `blocked` admin đã tắt chai này.
 */
export type RefillPairStatus = 'auto' | 'manual' | 'size' | 'ambiguous' | 'blocked';

export interface RefillPairRow {
  bottle: RefillCatalogRow;
  /** Gói refill của cặp; null khi `ambiguous` (hay `blocked` mà không còn đúng một ứng viên). */
  refill: RefillCatalogRow | null;
  status: RefillPairStatus;
  /** Số gói refill cùng thương hiệu, cùng tên công thức (chưa tính ghép tay). */
  candidates: number;
}

/**
 * Bảng cặp đầy đủ cho admin (THUẦN): mọi chai có ít nhất một gói refill cùng thương hiệu và cùng tên công thức, có ghép tay, hay đang bị
 * chặn mà vẫn có ứng viên. Chai là món không phải refill, không phải combo. Ghép tay thắng luật tên; slug trong danh sách chặn (chai hay
 * gói refill) không ghép, kể cả ghép tay. Thà thiếu cặp còn hơn mời khách đổi sang món khác công thức hay lượng gấp nhiều lần.
 */
export function refillPairRows(
  products: readonly RefillCatalogRow[],
  opts: { overrides?: readonly RefillPairOverride[]; block?: ReadonlySet<string> } = {},
): RefillPairRow[] {
  const block = opts.block ?? new Set<string>();
  const usable = products.filter((p) => !p.isCombo);
  const refillsByKey = new Map<string, RefillCatalogRow[]>();
  for (const r of usable) {
    if (!isRefillProduct(r) || block.has(r.slug)) continue;
    const key = `${brandOf(r)}|${refillFormulaKey(r.name)}`;
    refillsByKey.set(key, [...(refillsByKey.get(key) ?? []), r]);
  }
  const bySlug = new Map(usable.map((p) => [p.slug, p]));
  const manual = new Map<string, RefillCatalogRow>();
  for (const o of opts.overrides ?? []) {
    const bottle = bySlug.get(o.bottleSlug);
    const refill = bySlug.get(o.refillSlug);
    if (bottle && refill && !isRefillProduct(bottle) && !block.has(refill.slug)) manual.set(bottle.id, refill);
  }
  const rows: RefillPairRow[] = [];
  for (const b of usable) {
    if (isRefillProduct(b)) continue;
    const formula = refillFormulaKey(b.name);
    const found = formula ? (refillsByKey.get(`${brandOf(b)}|${formula}`) ?? []) : [];
    const only = found.length === 1 ? found[0]! : null;
    const hand = manual.get(b.id);
    if (block.has(b.slug)) {
      if (found.length > 0 || hand) rows.push({ bottle: b, refill: hand ?? only, status: 'blocked', candidates: found.length });
    } else if (hand) {
      rows.push({ bottle: b, refill: hand, status: 'manual', candidates: found.length });
    } else if (found.length > 1) {
      rows.push({ bottle: b, refill: null, status: 'ambiguous', candidates: found.length });
    } else if (only) {
      rows.push({ bottle: b, refill: only, status: refillAutoSizeOk(b.name, only.name) ? 'auto' : 'size', candidates: 1 });
    }
  }
  return rows;
}

/** Bảng cặp khách dùng (id chai → id gói refill): chỉ dòng `auto` và `manual` của `refillPairRows`. */
export function pairRefills(
  products: readonly RefillCatalogRow[],
  opts: { overrides?: readonly RefillPairOverride[]; block?: ReadonlySet<string> } = {},
): Map<string, string> {
  const pairs = new Map<string, string>();
  for (const row of refillPairRows(products, opts)) {
    if ((row.status === 'auto' || row.status === 'manual') && row.refill) pairs.set(row.bottle.id, row.refill.id);
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
