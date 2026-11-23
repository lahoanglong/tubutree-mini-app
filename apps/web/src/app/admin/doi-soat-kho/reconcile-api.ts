import { apiDownload, apiFetch } from '@/lib/client-api';

/** Cờ của một biến thể, xếp từ nặng tới nhẹ (`RECONCILE_FLAGS` ở `apps/api/src/modules/admin/pancake-reconcile/pancake-reconcile.ts`). */
export type ReconcileFlag = 'NEGATIVE_LOCAL' | 'ZERO_LOCAL_PANCAKE_POSITIVE' | 'DRIFT' | 'UNLINKED' | 'NEVER_SYNCED';
export const RECONCILE_FLAGS: readonly ReconcileFlag[] = ['NEGATIVE_LOCAL', 'ZERO_LOCAL_PANCAKE_POSITIVE', 'DRIFT', 'UNLINKED', 'NEVER_SYNCED'];

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
  /** Số Pancake lần đồng bộ gần nhất; `null` khi chưa gắn Pancake hoặc chưa đồng bộ lần nào. */
  pancakeStock: number | null;
  /** Tồn cửa hàng đúng ra phải có: max(0, Pancake − đang giữ chỗ). */
  expectedStock: number | null;
  /** Tồn cửa hàng − tồn đúng ra. Dương là cửa hàng bán vượt Pancake. */
  drift: number | null;
  flags: ReconcileFlag[];
  lastSyncedAt: string | null;
}

/** `GET /admin/pancake-reconcile` (ADMIN và nhân viên KHO), chỉ đọc. */
export interface ReconcileReport {
  generatedAt: string;
  minDrift: number;
  /** Ô tìm đã áp (API cắt khoảng trắng); số đếm và bảng chỉ tính biến thể khớp. Thiếu = API cũ chưa có ô tìm. */
  q?: string;
  lastSyncedAt: string | null;
  counts: { scanned: number; linked: number; withIssues: number } & Record<ReconcileFlag, number>;
  rows: ReconcileRow[];
  truncated: boolean;
}

export const isReconcileFlag = (v: string | null | undefined): v is ReconcileFlag => RECONCILE_FLAGS.includes(v as ReconcileFlag);

function reconcileParams(minDrift: number, q: string, flag?: ReconcileFlag | null): string {
  const sp = new URLSearchParams({ minDrift: String(minDrift) });
  const term = q.trim();
  if (term) sp.set('q', term);
  if (flag) sp.set('flag', flag);
  return sp.toString();
}

export const getPancakeReconcile = (minDrift: number, q = '') => apiFetch<ReconcileReport>(`/admin/pancake-reconcile?${reconcileParams(minDrift, q)}`);

/** `GET /admin/pancake-reconcile/export`: CSV (BOM UTF-8) MỌI dòng có cờ khớp bộ lọc, không cắt ở trần dòng của bảng, kèm cột "Cách xử lý". */
export const downloadPancakeReconcileCsv = (minDrift: number, q: string, flag: ReconcileFlag | null) =>
  apiDownload(`/admin/pancake-reconcile/export?${reconcileParams(minDrift, q, flag)}`, 'doi-soat-ton-pancake.csv');
