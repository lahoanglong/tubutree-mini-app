import type { Prisma } from '@prisma/client';

/** Lệch quá bấy nhiêu đơn vị giữa tồn cửa hàng và tồn tính từ số Pancake thì báo (mặc định). */
export const RECONCILE_DRIFT_DEFAULT = 3;
export const RECONCILE_DRIFT_MAX = 10_000;
/** Bảng chỉ trả bấy nhiêu dòng lệch nặng nhất; số đếm ở đầu bảng vẫn tính trên mọi biến thể. */
export const RECONCILE_ROWS_MAX = 300;

/**
 * NEGATIVE_LOCAL: tồn cửa hàng âm (bán quá).
 * ZERO_LOCAL_PANCAKE_POSITIVE: cửa hàng báo hết mà Pancake còn hàng chưa ai giữ — khách thấy "Hết hàng" oan.
 * DRIFT: tồn cửa hàng lệch tồn tính từ số Pancake (`pancakeStock − reservedStock`) quá ngưỡng.
 * UNLINKED: biến thể kho Tubu đang bán mà chưa gắn biến thể Pancake — đồng bộ không bao giờ cập nhật tồn của nó.
 * NEVER_SYNCED: đã gắn Pancake mà chưa lượt đồng bộ/webhook nào ghi số tồn.
 */
export const RECONCILE_FLAGS = ['NEGATIVE_LOCAL', 'ZERO_LOCAL_PANCAKE_POSITIVE', 'DRIFT', 'UNLINKED', 'NEVER_SYNCED'] as const;
export type ReconcileFlag = (typeof RECONCILE_FLAGS)[number];

/** Cột đọc cho bàn đối soát: không có khoá, token hay cấu hình nào của Pancake. */
export const RECONCILE_VARIATION_SELECT = {
  id: true,
  sku: true,
  name: true,
  stock: true,
  reservedStock: true,
  pancakeId: true,
  pancakeStock: true,
  pancakeStockSyncReadAt: true,
  pancakeStockWebhookReceivedAt: true,
  product: { select: { id: true, name: true, isActive: true } },
} satisfies Prisma.VariationSelect;

export type ReconcileVariation = Prisma.VariationGetPayload<{ select: typeof RECONCILE_VARIATION_SELECT }>;

export interface ReconcileRow {
  variationId: string;
  productId: string;
  productName: string;
  variationName: string;
  sku: string;
  productActive: boolean;
  linked: boolean;
  stock: number;
  reservedStock: number;
  pancakeStock: number | null;
  /** Tồn cửa hàng đúng ra phải có theo số Pancake: `max(0, pancakeStock − reservedStock)` (cùng công thức lượt đồng bộ). null khi chưa có số Pancake. */
  expectedStock: number | null;
  /** `stock − expectedStock`: dương là cửa hàng bán nhiều hơn kho thật, âm là cửa hàng giấu bớt hàng. */
  drift: number | null;
  flags: ReconcileFlag[];
  /** Lần gần nhất số tồn Pancake được áp (đồng bộ hoặc webhook), ISO. */
  lastSyncedAt: string | null;
}

/** Cùng công thức `variation-stock.ts` dùng khi áp số Pancake: tồn bán được = số Pancake trừ phần đơn của ta Pancake chưa trừ. */
export function expectedLocalStock(pancakeStock: number, reservedStock: number): number {
  return Math.max(0, pancakeStock - reservedStock);
}

const latest = (a: Date | null, b: Date | null): Date | null => (a && b ? (a > b ? a : b) : (a ?? b));

export function classifyVariation(v: ReconcileVariation, minDrift: number): ReconcileRow {
  const linked = v.pancakeId !== null && v.pancakeId !== '';
  const flags: ReconcileFlag[] = [];
  if (v.stock < 0) flags.push('NEGATIVE_LOCAL');
  let expected: number | null = null;
  let drift: number | null = null;
  if (linked && v.pancakeStock !== null) {
    expected = expectedLocalStock(v.pancakeStock, v.reservedStock);
    drift = v.stock - expected;
    if (v.stock <= 0 && expected > 0) flags.push('ZERO_LOCAL_PANCAKE_POSITIVE');
    if (Math.abs(drift) > minDrift) flags.push('DRIFT');
  }
  // Sản phẩm đang ẩn thì chưa gắn Pancake cũng không ai mua được: không báo.
  if (!linked && v.product.isActive) flags.push('UNLINKED');
  if (linked && v.pancakeStock === null) flags.push('NEVER_SYNCED');
  const synced = latest(v.pancakeStockSyncReadAt, v.pancakeStockWebhookReceivedAt);
  return {
    variationId: v.id,
    productId: v.product.id,
    productName: v.product.name,
    variationName: v.name,
    sku: v.sku,
    productActive: v.product.isActive,
    linked,
    stock: v.stock,
    reservedStock: v.reservedStock,
    pancakeStock: linked ? v.pancakeStock : null,
    expectedStock: expected,
    drift,
    flags: RECONCILE_FLAGS.filter((f) => flags.includes(f)),
    lastSyncedAt: synced ? synced.toISOString() : null,
  };
}

const severity = (r: ReconcileRow): number => (r.flags.length === 0 ? RECONCILE_FLAGS.length : RECONCILE_FLAGS.indexOf(r.flags[0]!));

/** Nặng trước (thứ tự RECONCILE_FLAGS), cùng mức thì lệch nhiều trước, rồi theo SKU cho ổn định. */
export function compareRows(a: ReconcileRow, b: ReconcileRow): number {
  return severity(a) - severity(b) || Math.abs(b.drift ?? 0) - Math.abs(a.drift ?? 0) || a.sku.localeCompare(b.sku);
}

export interface ReconcileReport {
  generatedAt: string;
  minDrift: number;
  /** Lượt áp số Pancake gần nhất trên mọi biến thể đã xét (đồng bộ hoặc webhook). */
  lastSyncedAt: string | null;
  counts: { scanned: number; linked: number; withIssues: number } & Record<ReconcileFlag, number>;
  rows: ReconcileRow[];
  truncated: boolean;
}

export function buildReport(variations: readonly ReconcileVariation[], minDrift: number, now: Date, rowsMax = RECONCILE_ROWS_MAX): ReconcileReport {
  const all = variations.map((v) => classifyVariation(v, minDrift));
  const issues = all.filter((r) => r.flags.length > 0).sort(compareRows);
  const counts = { scanned: all.length, linked: 0, withIssues: issues.length } as ReconcileReport['counts'];
  for (const f of RECONCILE_FLAGS) counts[f] = 0;
  let last: number | null = null;
  for (const r of all) {
    if (r.linked) counts.linked += 1;
    for (const f of r.flags) counts[f] += 1;
    const t = r.lastSyncedAt ? Date.parse(r.lastSyncedAt) : null;
    if (t !== null && (last === null || t > last)) last = t;
  }
  return {
    generatedAt: now.toISOString(),
    minDrift,
    lastSyncedAt: last === null ? null : new Date(last).toISOString(),
    counts,
    rows: issues.slice(0, rowsMax),
    truncated: issues.length > rowsMax,
  };
}
