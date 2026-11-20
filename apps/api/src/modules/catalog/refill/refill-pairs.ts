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

/** Trần số phần tử của hai khoá ghép tay/chặn: danh mục cả trăm món, vài trăm cặp là đã dư. */
export const REFILL_PAIRS_CONFIG_MAX = 500;

/**
 * Luật ghi khoá `catalog.refill_pairs_override` (cả khi sửa thô ở tab Cấu hình): mảng `{bottleSlug, refillSlug}` chuỗi khác rỗng, hai slug
 * khác nhau, mỗi chai một cặp, không slug nào vừa làm chai vừa làm gói Refill (không vòng A → B → A, không chuỗi). Không tra danh mục: đúng
 * sản phẩm hay không do `checkRefillOverrides` của thẻ Cặp Refill kiểm; phía đọc bỏ qua cặp không còn khớp.
 */
export function refillOverridesProblem(value: unknown): string | null {
  if (!Array.isArray(value)) return 'phải là mảng [{"bottleSlug":"<slug chai>","refillSlug":"<slug gói Refill>"}]';
  if (value.length > REFILL_PAIRS_CONFIG_MAX) return `tối đa ${REFILL_PAIRS_CONFIG_MAX} cặp`;
  const bottles = new Set<string>();
  const refills = new Set<string>();
  for (const v of value) {
    const { bottleSlug, refillSlug } = (v && typeof v === 'object' ? v : {}) as Record<string, unknown>;
    if (typeof bottleSlug !== 'string' || typeof refillSlug !== 'string' || !bottleSlug.trim() || !refillSlug.trim()) {
      return 'mỗi phần tử cần bottleSlug và refillSlug là chuỗi khác rỗng';
    }
    const b = bottleSlug.trim();
    const r = refillSlug.trim();
    if (b === r) return `chai và gói Refill phải là hai sản phẩm khác nhau ("${b}")`;
    if (bottles.has(b)) return `"${b}" có hai cặp, giữ một`;
    bottles.add(b);
    refills.add(r);
  }
  for (const b of bottles) if (refills.has(b)) return `"${b}" vừa là chai vừa là gói Refill: không ghép vòng hay nối chuỗi`;
  return null;
}

/** Luật ghi khoá `catalog.refill_pairs_block`: mảng slug (chuỗi khác rỗng). */
export function refillBlockProblem(value: unknown): string | null {
  if (!Array.isArray(value)) return 'phải là mảng slug ["<slug>"]';
  if (value.length > REFILL_PAIRS_CONFIG_MAX) return `tối đa ${REFILL_PAIRS_CONFIG_MAX} slug`;
  return value.every((s) => typeof s === 'string' && s.trim() !== '') ? null : 'mỗi phần tử phải là slug (chuỗi khác rỗng)';
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

// "Nước giặt hương Bạc hà" và "Refill nước giặt Bạc hà" chỉ lệch các chữ này: đủ để GỢI Ý cho admin, không đủ để tự ghép cho khách.
const FAMILY_FILLER_WORDS = new Set(['nuoc', 'huong']);

/** Tên họ sản phẩm: tên công thức bỏ thêm chữ đệm ("nước", "hương"). Chỉ dùng để gợi ý trạng thái `near`. */
export function refillFamilyKey(name: string): string {
  return refillFormulaKey(name)
    .split(' ')
    .filter((w) => w !== '' && !FAMILY_FILLER_WORDS.has(w))
    .join(' ');
}

/**
 * Trạng thái một chai trong bảng cặp: `auto` tự ghép; `manual` admin ghép tay; `size` cùng công thức nhưng lệch lượng (không ghi lượng,
 * khác chiều, gói không lớn hơn chai hay lớn quá `REFILL_AUTO_MAX_RATIO` lần) nên chờ admin; `ambiguous` nhiều gói refill cùng công thức;
 * `near` không gói nào cùng công thức nhưng đúng một gói cùng thương hiệu cùng họ tên (chỉ lệch "nước"/"hương"), chờ admin xác nhận;
 * `blocked` admin đã tắt chai này.
 */
export type RefillPairStatus = 'auto' | 'manual' | 'size' | 'ambiguous' | 'near' | 'blocked';

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
  const refillsByFamily = new Map<string, RefillCatalogRow[]>();
  const push = (m: Map<string, RefillCatalogRow[]>, key: string, r: RefillCatalogRow) => m.set(key, [...(m.get(key) ?? []), r]);
  for (const r of usable) {
    if (!isRefillProduct(r) || block.has(r.slug)) continue;
    push(refillsByKey, `${brandOf(r)}|${refillFormulaKey(r.name)}`, r);
    const family = refillFamilyKey(r.name);
    if (family) push(refillsByFamily, `${brandOf(r)}|${family}`, r);
  }
  const bySlug = new Map(usable.map((p) => [p.slug, p]));
  const manual = new Map<string, RefillCatalogRow>();
  // Ghép tay chỉ từ chai sang GÓI REFILL: chai không bao giờ là đích, gói refill không bao giờ là chai, nên không có vòng hay chuỗi cặp.
  for (const o of opts.overrides ?? []) {
    const bottle = bySlug.get(o.bottleSlug);
    const refill = bySlug.get(o.refillSlug);
    if (bottle && refill && bottle.id !== refill.id && !isRefillProduct(bottle) && isRefillProduct(refill) && !block.has(refill.slug)) manual.set(bottle.id, refill);
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
    } else if (found.length === 0) {
      const family = refillFamilyKey(b.name);
      const near = family ? (refillsByFamily.get(`${brandOf(b)}|${family}`) ?? []) : [];
      if (near.length === 1) rows.push({ bottle: b, refill: near[0]!, status: 'near', candidates: 0 });
    }
  }
  return rows;
}

/**
 * Kiểm danh sách ghép tay trước khi lưu (THUẦN). Cặp MỚI (không có nguyên trong `kept`, danh sách đang lưu): chai đang bán (không phải gói
 * refill) sang một gói Refill đang bán, hai slug khác nhau, cùng thương hiệu, không slug nào đang chặn. Vì đích luôn là gói refill và chai
 * không bao giờ là gói refill, cặp mới không thể tạo vòng (A → B → A) hay chuỗi cặp. Cặp đã lưu giữ nguyên dù sản phẩm nay ngừng bán
 * (khách không thấy vì bảng chỉ dựng từ hàng đang bán): một món bị tắt không được khoá mọi lần lưu sau. Mỗi chai một cặp. Trả lỗi đầu
 * tiên gặp, câu tiếng Việt cho admin.
 */
export function checkRefillOverrides(
  input: readonly RefillPairOverride[],
  bySlug: ReadonlyMap<string, RefillCatalogRow>,
  opts: { kept?: readonly RefillPairOverride[]; block?: ReadonlySet<string> } = {},
): { ok: RefillPairOverride[] } | { error: string } {
  const kept = new Set((opts.kept ?? []).map((o) => `${o.bottleSlug}\u0000${o.refillSlug}`));
  const block = opts.block ?? new Set<string>();
  const seen = new Set<string>();
  const ok: RefillPairOverride[] = [];
  for (const o of input) {
    const bottleSlug = o.bottleSlug.trim();
    const refillSlug = o.refillSlug.trim();
    if (bottleSlug === refillSlug) return { error: 'Chai và gói Refill phải là hai sản phẩm khác nhau.' };
    const bottle = bySlug.get(bottleSlug);
    if (seen.has(bottleSlug)) return { error: `"${bottle?.name ?? bottleSlug}" đang có hai cặp ghép tay, giữ một.` };
    seen.add(bottleSlug);
    ok.push({ bottleSlug, refillSlug });
    if (kept.has(`${bottleSlug}\u0000${refillSlug}`)) continue;
    const refill = bySlug.get(refillSlug);
    if (!bottle || !refill) return { error: `Không có sản phẩm đang bán "${!bottle ? bottleSlug : refillSlug}".` };
    if (isRefillProduct(bottle)) return { error: `"${bottle.name}" là gói Refill, không làm chai được.` };
    if (!isRefillProduct(refill)) return { error: `"${refill.name}" không phải gói Refill (tên hay slug phải bắt đầu bằng Refill).` };
    if (brandOf(bottle) !== brandOf(refill)) return { error: `"${bottle.name}" và "${refill.name}" khác thương hiệu, không ghép được.` };
    const off = block.has(bottleSlug) ? bottle : block.has(refillSlug) ? refill : null;
    if (off) return { error: `"${off.name}" đang tắt ở thẻ Cặp Refill: bật lại trước khi ghép.` };
  }
  return { ok };
}

/**
 * Một thao tác ghép tay trên danh sách ĐANG LƯU (THUẦN): bỏ cặp của chai `remove`, rồi `add` thay cặp cũ của cùng chai và nằm cuối. Admin
 * gửi thao tác thay vì cả mảng, nên trang mở từ trước (chưa thấy cặp người khác hay migration vừa thêm) không xoá mất các cặp đó.
 */
export function applyRefillOverrideOps(current: readonly RefillPairOverride[], ops: { add?: RefillPairOverride; remove?: string }): RefillPairOverride[] {
  const drop = new Set([ops.remove?.trim(), ops.add?.bottleSlug.trim()].filter((s): s is string => !!s));
  const next = current.filter((o) => !drop.has(o.bottleSlug));
  if (ops.add) next.push({ bottleSlug: ops.add.bottleSlug.trim(), refillSlug: ops.add.refillSlug.trim() });
  return next;
}

/** Dòng có gói Refill gợi ý mà admin duyệt được bằng một chạm: tên gần giống (`near`) và cùng công thức nhưng lệch lượng (`size`). */
export const REFILL_CONFIRMABLE_STATUSES: readonly RefillPairStatus[] = ['near', 'size'];

/**
 * Duyệt gợi ý (THUẦN), trên bảng dựng từ danh sách ghép tay ĐANG LƯU: mỗi cặp phải đúng là gói bảng đang gợi ý cho chai đó, hoặc chai đã
 * được ghép tay đúng gói đó (duyệt lại không thêm gì, nên bấm hai lần hay gửi lại vẫn ra một kết quả). Một cặp không còn khớp (trang mở từ
 * trước: admin khác đã ghép chai sang gói khác, đã tắt chai, danh mục đổi) thì cả lần duyệt bị từ chối (`stale`), để admin không duyệt thứ
 * họ không còn thấy. Một chai hai lần trong cùng lần duyệt là `error`.
 */
export function confirmRefillSuggestions(
  rows: readonly RefillPairRow[],
  confirm: readonly RefillPairOverride[],
): { add: RefillPairOverride[] } | { stale: string } | { error: string } {
  const bySlug = new Map(rows.map((r) => [r.bottle.slug, r]));
  const seen = new Set<string>();
  const add: RefillPairOverride[] = [];
  for (const c of confirm) {
    const bottleSlug = c.bottleSlug.trim();
    const refillSlug = c.refillSlug.trim();
    if (seen.has(bottleSlug)) return { error: `Chai "${bySlug.get(bottleSlug)?.bottle.name ?? bottleSlug}" có hai lần trong cùng lần duyệt.` };
    seen.add(bottleSlug);
    const row = bySlug.get(bottleSlug);
    if (row?.status === 'manual' && row.refill?.slug === refillSlug) continue;
    if (row && REFILL_CONFIRMABLE_STATUSES.includes(row.status) && row.refill?.slug === refillSlug) {
      add.push({ bottleSlug, refillSlug });
      continue;
    }
    return {
      stale: `"${row?.bottle.name ?? bottleSlug}" không còn được gợi ý ghép với gói này: bảng cặp vừa đổi, chưa cặp nào được duyệt. Tải lại thẻ Cặp Refill rồi duyệt lại.`,
    };
  }
  return { add };
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
