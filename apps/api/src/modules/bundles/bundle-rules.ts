/** Dòng giỏ không giờ vàng đưa vào tính bundle: `total = đơn giá × quantity` đã gồm giá sale. */
export interface BundleLine {
  variationId: string;
  productId: string;
  total: number;
  quantity: number;
}

export interface LiveBundle {
  id: string;
  kind: 'BUNDLE_PCT' | 'ADDON';
  pct: number | null;
  anchorProductId: string | null;
  items: { productId: string; variationId: string | null; addonPrice: number | null; maxQty: number }[];
}

/** Cùng dạng `ComboResult` của combo gian hàng: key `perLine` là variationId. */
export interface BundleDiscount {
  total: number;
  perLine: Record<string, number>;
}

/** Bộ BUNDLE_PCT cần ít nhất từng này sản phẩm KHÁC NHAU (một món chỉ là mã giảm % trá hình). Cùng số với MIN_COMBO_PRODUCTS; khai lại ở đây vì combo.service import file này. */
export const BUNDLE_MIN_PRODUCTS = 2;

const EMPTY: BundleDiscount = { total: 0, perLine: {} };

/** Mỗi dòng lấy khoản LỚN NHẤT trong hai kết quả (không cộng dồn); `total` tính lại từ `perLine` nên luôn khớp. */
export function mergeMaxPerLine(a: BundleDiscount, b: BundleDiscount): BundleDiscount {
  const perLine: Record<string, number> = { ...a.perLine };
  for (const [variationId, d] of Object.entries(b.perLine)) perLine[variationId] = Math.max(perLine[variationId] ?? 0, d);
  return { total: Object.values(perLine).reduce((s, d) => s + d, 0), perLine };
}

/** Các dòng của một món trong bộ: món ghim phân loại chỉ nhận đúng dòng đó, không ghim nhận mọi phân loại của sản phẩm. */
function matching(lines: readonly BundleLine[], it: LiveBundle['items'][number]): BundleLine[] {
  return lines.filter((l) => l.quantity >= 1 && l.productId === it.productId && (it.variationId == null || l.variationId === it.variationId));
}

const fromPerLine = (perLine: Record<string, number>): BundleDiscount => ({ total: Object.values(perLine).reduce((s, d) => s + d, 0), perLine });

/**
 * Chia `maxQty` đơn vị được hưởng của một món lần lượt theo thứ tự dòng (món nhiều phân loại trong giỏ không nhân đơn vị được
 * hưởng lên). `discountOf(line, take)` là khoản giảm (đồng) của `take` đơn vị trên dòng đó; kẹp trong [0, total của dòng].
 */
function addUnits(perLine: Record<string, number>, rows: BundleLine[], maxQty: number, discountOf: (line: BundleLine, take: number) => number): void {
  let remaining = maxQty;
  for (const l of rows) {
    const take = Math.min(l.quantity, remaining);
    if (take <= 0) continue;
    remaining -= take;
    const d = Math.min(l.total, Math.max(0, discountOf(l, take)));
    if (d > 0) perLine[l.variationId] = (perLine[l.variationId] ?? 0) + d;
  }
}

function percentBundle(b: LiveBundle, lines: readonly BundleLine[], maxPct: number): BundleDiscount {
  const pct = Math.min(b.pct ?? 0, maxPct, 100);
  if (pct <= 0 || new Set(b.items.map((i) => i.productId)).size < BUNDLE_MIN_PRODUCTS) return EMPTY;
  const rows = b.items.map((it) => ({ it, lines: matching(lines, it) }));
  if (rows.some((r) => r.lines.length === 0)) return EMPTY;
  const perLine: Record<string, number> = {};
  for (const r of rows) addUnits(perLine, r.lines, r.it.maxQty, (l, take) => Math.floor((l.total * take * pct) / (l.quantity * 100)));
  return fromPerLine(perLine);
}

function addonBundle(b: LiveBundle, lines: readonly BundleLine[]): BundleDiscount {
  const anchor = b.anchorProductId;
  if (!anchor || !lines.some((l) => l.productId === anchor && l.quantity >= 1)) return EMPTY;
  const perLine: Record<string, number> = {};
  for (const it of b.items) {
    if (it.productId === anchor || it.addonPrice == null || it.addonPrice < 0) continue;
    const price = it.addonPrice;
    addUnits(perLine, matching(lines, it), it.maxQty, (l, take) => Math.max(0, Math.floor(l.total / l.quantity) - price) * take);
  }
  return fromPerLine(perLine);
}

/**
 * Khoản giảm của các bundle đang chạy trên các dòng giỏ KHÔNG giờ vàng (THUẦN, không I/O): BUNDLE_PCT khi giỏ có đủ mọi món của
 * bộ, ADDON khi giỏ có sản phẩm chính. Mỗi dòng lấy khoản lớn nhất giữa mọi bộ; không bao giờ vượt `total` của dòng.
 * `maxPct` là trần `bundle.max_pct` đọc lại ở nơi tính tiền, phòng dữ liệu ghi thẳng DB vượt trần.
 */
export function allocateBundleDiscounts(bundles: readonly LiveBundle[], lines: readonly BundleLine[], maxPct: number): BundleDiscount {
  let acc = EMPTY;
  for (const b of bundles) acc = mergeMaxPerLine(acc, b.kind === 'ADDON' ? addonBundle(b, lines) : percentBundle(b, lines, maxPct));
  return acc;
}

/**
 * Số tiền tối đa MỘT đơn được giảm nhờ bộ này khi mỗi món mua đủ `maxQty` đơn vị: nền của trần nhân viên (mỗi đơn không vượt
 * `coupon.staff_max_amount_vnd`). `price` là giá đang bán của phân loại món.
 */
export function bundleExposure(
  b: { kind: 'BUNDLE_PCT' | 'ADDON'; pct: number | null },
  items: { price: number; addonPrice: number | null; maxQty: number }[],
): number {
  return items.reduce((sum, i) => {
    const perUnit = b.kind === 'ADDON' ? Math.max(0, i.price - (i.addonPrice ?? i.price)) : Math.floor((i.price * (b.pct ?? 0)) / 100);
    return sum + perUnit * i.maxQty;
  }, 0);
}
