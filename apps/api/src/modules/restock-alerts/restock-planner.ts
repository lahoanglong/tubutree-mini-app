import { foldSearch } from '../admin/pancake-reconcile/pancake-reconcile';

/** Tốc độ bán tính trên đơn đặt trong bấy nhiêu ngày gần nhất. */
export const RESTOCK_VELOCITY_WINDOW_DAYS = 14;
/** Các mốc "Nhập đủ bán N ngày" màn cho chọn; API chỉ nhận đúng các mốc này. */
export const RESTOCK_TARGET_DAYS_OPTIONS = [14, 21, 30, 45, 60] as const;
export const RESTOCK_TARGET_DAYS_DEFAULT = 30;
/** Còn đủ bán ít hơn bấy nhiêu ngày thì xếp vào nhóm "Sắp hết" (khoảng thời gian thường gặp từ lúc đặt tới lúc hàng về kho). */
export const RESTOCK_LOW_COVER_DAYS = 7;
/** Bảng chỉ trả bấy nhiêu dòng gấp nhất; số đếm và file CSV vẫn tính đủ. */
export const RESTOCK_PLAN_ROWS_MAX = 300;
/** Ô tìm SKU / tên sản phẩm / nhà cung cấp, cùng trần với ô tìm của bàn đối soát. */
export const RESTOCK_SEARCH_MAX = 100;
/** Trần tên nhà cung cấp gửi lên để lọc (chọn từ danh sách API trả về, không phải ô gõ). */
export const RESTOCK_SUPPLIER_MAX = 200;
/** Nhãn nhóm của sản phẩm chưa ghi thương hiệu: vẫn cần nhập, chỉ chưa biết đặt ở đâu. */
export const RESTOCK_NO_SUPPLIER = 'Chưa ghi nhà cung cấp';

/** OUT: hết hàng (tồn bán được ≤ 0, hoặc mọi đơn vị còn lại đã thuộc đơn đặt trước của đại lý). LOW: còn đủ bán dưới RESTOCK_LOW_COVER_DAYS ngày. OK: còn đủ lâu nhưng chưa đủ tới mốc đã chọn. */
export const RESTOCK_URGENCY = ['OUT', 'LOW', 'OK'] as const;
export type RestockUrgency = (typeof RESTOCK_URGENCY)[number];

/** Số liệu thô của một biến thể bán được của hàng kho Tubu, đọc từ DB (RestockPlannerService). */
export interface RestockPlanInput {
  variationId: string;
  productId: string;
  productName: string;
  variationName: string;
  sku: string;
  /** Thương hiệu của sản phẩm, dùng làm nhà cung cấp để gom đơn đặt hàng. Rỗng thì RESTOCK_NO_SUPPLIER. */
  supplier: string;
  /** Tồn bán được (`variations.stock`): đã trừ phần giữ chỗ cho đơn chưa đẩy Pancake. Có thể âm khi đã bán quá. */
  stock: number;
  /** Số đơn vị đã bán trong cửa sổ tốc độ bán (đơn thật đã xác nhận trở đi, không tính quà tặng). */
  sold: number;
  /** Số khách đang chờ chuông "Báo tôi khi có hàng" của biến thể (đăng ký chưa được báo). */
  waiting: number;
  /** Số đơn vị đại lý đã đặt trước mà kho chưa có hàng để giữ (đơn chưa huỷ/trả). */
  backordered: number;
}

export interface RestockPlanRow extends RestockPlanInput {
  /** Đơn vị bán mỗi ngày trong cửa sổ, làm tròn 2 chữ số. */
  perDay: number;
  /**
   * "Đủ bán N ngày": phần tồn chưa phải trả cho đại lý chia cho tốc độ bán, làm tròn xuống. 0 khi phần đó hết; null khi không bán đơn vị nào
   * trong cửa sổ mà vẫn còn hàng (không có tốc độ để chia).
   */
  coverDays: number | null;
  urgency: RestockUrgency;
  /** Số nên đặt nhà cung cấp, ≥ 0. Công thức ở `planRow`. */
  suggestedQty: number;
}

/**
 * Một biến thể → một dòng kế hoạch:
 *   nhu cầu = ⌈ bán trong cửa sổ × số ngày muốn đủ bán ÷ số ngày cửa sổ ⌉
 *   đề xuất = max(0, nhu cầu + khách đang chờ chuông + đại lý đặt trước chưa có hàng − tồn bán được)
 * Mỗi khách chờ chuông tính một đơn vị: biến thể hết hàng cả cửa sổ thì không bán được gì, chuông là tín hiệu cầu duy nhất. Tồn âm (đã bán
 * quá) làm đề xuất tăng đúng phần thiếu. Phép tính dùng số nguyên trước khi chia nên ⌈15⌉ không thành 16 vì sai số dấu phẩy động.
 */
export function planRow(v: RestockPlanInput, targetDays: number, windowDays = RESTOCK_VELOCITY_WINDOW_DAYS): RestockPlanRow {
  const sold = Math.max(0, v.sold);
  const waiting = Math.max(0, v.waiting);
  const backordered = Math.max(0, v.backordered);
  const perDay = sold / windowDays;
  const free = Math.max(0, v.stock - backordered);
  const coverDays = free === 0 ? 0 : sold > 0 ? Math.floor((free * windowDays) / sold) : null;
  const demand = Math.ceil((sold * targetDays) / windowDays);
  const suggestedQty = Math.max(0, demand + waiting + backordered - v.stock);
  const urgency: RestockUrgency = coverDays === 0 ? 'OUT' : coverDays !== null && coverDays < RESTOCK_LOW_COVER_DAYS ? 'LOW' : 'OK';
  return { ...v, sold, waiting, backordered, perDay: Math.round(perDay * 100) / 100, coverDays, urgency, suggestedQty };
}

/** Lọc theo SKU, tên sản phẩm, tên biến thể hoặc nhà cung cấp; không dấu, không hoa thường, mọi từ phải có mặt. Chuỗi rỗng thì giữ hết. */
export function matchesPlanSearch(v: Pick<RestockPlanInput, 'sku' | 'productName' | 'variationName' | 'supplier'>, q: string): boolean {
  const words = foldSearch(q).split(' ').filter(Boolean);
  if (words.length === 0) return true;
  const hay = foldSearch(`${v.sku} ${v.productName} ${v.variationName} ${v.supplier}`);
  return words.every((w) => hay.includes(w));
}

const urgencyRank = (u: RestockUrgency) => RESTOCK_URGENCY.indexOf(u);

/** Gấp trước: hết hàng → sắp hết → còn lại; cùng nhóm thì còn ít ngày trước (chưa bán gì xếp cuối), nhiều khách chờ trước, đề xuất nhiều trước, rồi SKU. */
export function comparePlanRows(a: RestockPlanRow, b: RestockPlanRow): number {
  const cover = (r: RestockPlanRow) => (r.coverDays === null ? Number.POSITIVE_INFINITY : r.coverDays);
  const byCover = cover(a) === cover(b) ? 0 : cover(a) < cover(b) ? -1 : 1;
  return urgencyRank(a.urgency) - urgencyRank(b.urgency) || byCover || b.waiting - a.waiting || b.suggestedQty - a.suggestedQty || a.sku.localeCompare(b.sku);
}

export interface RestockSupplierSummary {
  name: string;
  /** Số biến thể cần nhập của nhà cung cấp này. */
  rows: number;
  /** Tổng số đơn vị đề xuất nhập. */
  units: number;
}

export interface RestockPlanReport {
  generatedAt: string;
  windowDays: number;
  targetDays: number;
  /** Ô tìm đã áp (đã cắt khoảng trắng); rỗng = không lọc. */
  q: string;
  /** Nhà cung cấp đang lọc; null = mọi nhà cung cấp. */
  supplier: string | null;
  counts: {
    /** Biến thể bán được của hàng kho Tubu khớp bộ lọc. */
    scanned: number;
    /** Biến thể có đề xuất nhập > 0. */
    needReorder: number;
    /** Trong số cần nhập, số đang hết hàng. */
    outOfStock: number;
    /** Tổng khách đang chờ chuông báo hàng về trên các biến thể khớp bộ lọc. */
    waiting: number;
    /** Tổng đơn vị đề xuất nhập. */
    units: number;
  };
  /** Nhà cung cấp có dòng cần nhập (khớp ô tìm, KHÔNG theo bộ lọc nhà cung cấp, để màn luôn có đủ lựa chọn), nhiều đơn vị trước. */
  suppliers: RestockSupplierSummary[];
  rows: RestockPlanRow[];
  truncated: boolean;
}

export interface RestockPlanFilter {
  targetDays: number;
  q?: string;
  supplier?: string | null;
}

/** Mọi dòng cần nhập khớp bộ lọc, gấp trước (nguồn chung của bảng và file CSV), kèm các dòng đã quét và danh sách nhà cung cấp. */
export function plannedRows(inputs: readonly RestockPlanInput[], f: RestockPlanFilter) {
  const q = (f.q ?? '').trim();
  const supplier = f.supplier?.trim() || null;
  const searched = inputs.filter((v) => matchesPlanSearch(v, q)).map((v) => planRow(v, f.targetDays));
  const bySupplier = new Map<string, RestockSupplierSummary>();
  for (const r of searched) {
    if (r.suggestedQty <= 0) continue;
    const s = bySupplier.get(r.supplier) ?? { name: r.supplier, rows: 0, units: 0 };
    s.rows += 1;
    s.units += r.suggestedQty;
    bySupplier.set(r.supplier, s);
  }
  const suppliers = [...bySupplier.values()].sort((a, b) => b.units - a.units || a.name.localeCompare(b.name, 'vi'));
  const scanned = supplier ? searched.filter((r) => r.supplier === supplier) : searched;
  const need = scanned.filter((r) => r.suggestedQty > 0).sort(comparePlanRows);
  return { q, supplier, scanned, need, suppliers };
}

export function buildRestockPlan(inputs: readonly RestockPlanInput[], f: RestockPlanFilter, now: Date, rowsMax = RESTOCK_PLAN_ROWS_MAX): RestockPlanReport {
  const { q, supplier, scanned, need, suppliers } = plannedRows(inputs, f);
  return {
    generatedAt: now.toISOString(),
    windowDays: RESTOCK_VELOCITY_WINDOW_DAYS,
    targetDays: f.targetDays,
    q,
    supplier,
    counts: {
      scanned: scanned.length,
      needReorder: need.length,
      outOfStock: need.filter((r) => r.urgency === 'OUT').length,
      waiting: scanned.reduce((n, r) => n + r.waiting, 0),
      units: need.reduce((n, r) => n + r.suggestedQty, 0),
    },
    suppliers,
    rows: need.slice(0, rowsMax),
    truncated: need.length > rowsMax,
  };
}

/** Thứ tự dòng trong file đặt hàng: theo nhà cung cấp (nhóm "chưa ghi" cuối), rồi tên sản phẩm, rồi SKU. */
export function comparePurchaseRows(a: RestockPlanRow, b: RestockPlanRow): number {
  const last = (s: string) => (s === RESTOCK_NO_SUPPLIER ? 1 : 0);
  return (
    last(a.supplier) - last(b.supplier) ||
    a.supplier.localeCompare(b.supplier, 'vi') ||
    a.productName.localeCompare(b.productName, 'vi') ||
    a.sku.localeCompare(b.sku)
  );
}
