import { isOwnStaffCoupon } from '../coupons/coupon-scope';

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
  /** Người tạo bộ: nhân viên (không phải ADMIN) không hưởng bộ do chính mình tạo (`isOwnStaffBundle`). */
  createdById: string | null;
  /** `refPrice`: giá đang bán của phân loại ghim LÚC TẠO/SỬA bộ (chỉ ADDON); trần của khoản giảm mỗi đơn vị về sau (`addonUnitDiscount`). */
  items: { productId: string; variationId: string | null; addonPrice: number | null; refPrice: number | null; maxQty: number }[];
}

/** Cùng dạng `ComboResult` của combo gian hàng: key `perLine` là variationId. */
export interface BundleDiscount {
  total: number;
  perLine: Record<string, number>;
}

/** Bộ BUNDLE_PCT cần ít nhất từng này sản phẩm KHÁC NHAU (một món chỉ là mã giảm % trá hình). Cùng số với MIN_COMBO_PRODUCTS; khai lại ở đây vì combo.service import file này. */
export const BUNDLE_MIN_PRODUCTS = 2;

const EMPTY: BundleDiscount = { total: 0, perLine: {} };

/**
 * Khoản giảm (đồng) cho MỖI đơn vị món mua kèm. Giá kèm là một con số cố định so với giá tham chiếu lúc tạo bộ (`refPrice`), nên khoản
 * giảm không bao giờ vượt `refPrice − addonPrice`: phân loại tăng giá sau khi tạo (sửa tay, đồng bộ Pancake) không làm giảm vọt theo,
 * giá khách trả tăng đúng phần tăng. Giá hiện tại thấp hơn tham chiếu thì giảm theo giá hiện tại; không bao giờ làm giá tăng.
 */
export function addonUnitDiscount(unitPrice: number, addonPrice: number, refPrice: number | null | undefined): number {
  // Thiếu giá tham chiếu (dòng ghi tay, không qua admin) thì không có trần để tin: không giảm. Nằm ngay đây để API công khai và giỏ
  // cùng đi qua một hàm, nên không có chuyện PDP quảng cáo giá kèm mà giỏ tính giá thường.
  if (refPrice == null) return 0;
  return Math.max(0, Math.min(unitPrice, refPrice) - addonPrice);
}

/** Giá khách trả cho một đơn vị món mua kèm sau trần: dùng chung cho API công khai (giá quảng cáo) và giỏ (giá tính) để hai số bằng nhau. */
export function addonPayPrice(unitPrice: number, addonPrice: number, refPrice: number | null | undefined): number {
  return unitPrice - addonUnitDiscount(unitPrice, addonPrice, refPrice);
}

/**
 * Nhân viên (không phải ADMIN) tạo bộ thì chính người đó không hưởng: tạo bộ rồi tự đặt giá cho mình là tự cấp tiền. Cùng luật, cùng hàm
 * với mã giảm giá (`isOwnStaffCoupon`) và Giờ vàng (`ownSalesBlocked`): người tạo ADMIN được miễn, vai trò không rõ coi như nhân viên.
 */
export function isOwnStaffBundle(b: Pick<LiveBundle, 'createdById'>, user: { id: string; role?: string | null }): boolean {
  return isOwnStaffCoupon({ createdById: b.createdById }, user);
}

/** Mỗi dòng lấy khoản LỚN NHẤT trong hai kết quả (không cộng dồn); `total` tính lại từ `perLine` nên luôn khớp. */
export function mergeMaxPerLine(a: BundleDiscount, b: BundleDiscount): BundleDiscount {
  const perLine: Record<string, number> = { ...a.perLine };
  for (const [variationId, d] of Object.entries(b.perLine)) perLine[variationId] = Math.max(perLine[variationId] ?? 0, d);
  return { total: Object.values(perLine).reduce((s, d) => s + d, 0), perLine };
}

/** Các dòng của một món trong bộ: món ghim phân loại chỉ nhận đúng dòng đó, không ghim nhận mọi phân loại của sản phẩm (chỉ BUNDLE_PCT được không ghim: giảm theo %, không theo giá cố định). */
function matching(lines: readonly BundleLine[], it: LiveBundle['items'][number]): BundleLine[] {
  return lines.filter((l) => l.quantity >= 1 && l.productId === it.productId && (it.variationId == null || l.variationId === it.variationId));
}

const byVariationId = (a: BundleLine, b: BundleLine) => (a.variationId < b.variationId ? -1 : a.variationId > b.variationId ? 1 : 0);

const fromPerLine = (perLine: Record<string, number>): BundleDiscount => ({ total: Object.values(perLine).reduce((s, d) => s + d, 0), perLine });

/**
 * Chia `maxQty` đơn vị được hưởng của một món lần lượt theo `variationId` (món nhiều phân loại trong giỏ không nhân đơn vị được
 * hưởng lên). `discountOf(line, take)` là khoản giảm (đồng) của `take` đơn vị trên dòng đó; kẹp trong [0, total của dòng].
 */
function addUnits(perLine: Record<string, number>, rows: BundleLine[], maxQty: number, discountOf: (line: BundleLine, take: number) => number): void {
  let remaining = maxQty;
  // Thứ tự dòng giỏ không ổn định giữa giỏ, báo giá và đặt đơn (Postgres trả theo heap): chia đơn vị theo khoá ổn định `variationId`
  // để mọi đường ra cùng một số.
  for (const l of [...rows].sort(byVariationId)) {
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
    // Giá kèm là giá cố định của MỘT phân loại: không ghim thì mọi phân loại của sản phẩm (kể cả loại đắt gấp chục lần) sẽ về giá đó.
    if (it.productId === anchor || it.variationId == null || it.addonPrice == null || it.addonPrice < 0) continue;
    const { addonPrice, refPrice } = it;
    addUnits(perLine, matching(lines, it), it.maxQty, (l, take) => addonUnitDiscount(Math.floor(l.total / l.quantity), addonPrice, refPrice) * take);
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
 * `coupon.staff_max_amount_vnd`). `price` là giá CAO NHẤT một dòng của món có thể mang (phân loại ghim, hoặc phân loại đắt nhất của món
 * không ghim): giảm % áp cho mọi phân loại khách chọn.
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
