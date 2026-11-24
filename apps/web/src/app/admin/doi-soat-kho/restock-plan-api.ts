import { apiDownload, apiFetch } from '@/lib/client-api';

/** `/admin/doi-soat-kho?tab=nhap-hang` mở thẳng "Kế hoạch nhập hàng" (lối vào riêng ở menu quản trị); không có thì là bàn đối soát. */
export const RESTOCK_PLAN_TAB = 'nhap-hang';

/** Các mốc "Nhập đủ bán N ngày", bằng `RESTOCK_TARGET_DAYS_OPTIONS` ở `apps/api/src/modules/restock-alerts/restock-planner.ts`. */
export const RESTOCK_TARGET_DAYS_OPTIONS = [14, 21, 30, 45, 60] as const;
export const RESTOCK_TARGET_DAYS_DEFAULT = 30;

/** OUT: hết hàng (hoặc phần còn lại đã thuộc đơn đặt trước của đại lý). LOW: còn đủ bán dưới 7 ngày. OK: còn lại. */
export type RestockUrgency = 'OUT' | 'LOW' | 'OK';

export interface RestockPlanRow {
  variationId: string;
  productId: string;
  productName: string;
  variationName: string;
  sku: string;
  /** Thương hiệu của sản phẩm, dùng làm nhà cung cấp. */
  supplier: string;
  /** Tồn bán được; âm khi đã bán quá. */
  stock: number;
  /** Đơn vị đã bán trong `windowDays` ngày qua. */
  sold: number;
  /** Khách đang chờ chuông "Báo tôi khi có hàng". */
  waiting: number;
  /** Đại lý đã đặt trước mà kho chưa có hàng. */
  backordered: number;
  perDay: number;
  /** "Đủ bán N ngày"; null khi chưa bán đơn vị nào trong cửa sổ mà vẫn còn hàng. */
  coverDays: number | null;
  urgency: RestockUrgency;
  suggestedQty: number;
}

export interface RestockSupplierSummary {
  name: string;
  rows: number;
  units: number;
}

/** `GET /admin/restock-planner` (ADMIN và nhân viên KHO), chỉ đọc. */
export interface RestockPlanReport {
  generatedAt: string;
  windowDays: number;
  targetDays: number;
  q: string;
  supplier: string | null;
  counts: { scanned: number; needReorder: number; outOfStock: number; waiting: number; units: number };
  suppliers: RestockSupplierSummary[];
  rows: RestockPlanRow[];
  truncated: boolean;
}

function planParams(days: number, q: string, supplier: string | null): string {
  const sp = new URLSearchParams({ days: String(days) });
  const term = q.trim();
  if (term) sp.set('q', term);
  if (supplier) sp.set('brand', supplier);
  return sp.toString();
}

export const getRestockPlan = (days: number, q: string, supplier: string | null) =>
  apiFetch<RestockPlanReport>(`/admin/restock-planner?${planParams(days, q, supplier)}`);

/** `GET /admin/restock-planner/export`: CSV (BOM UTF-8) "Đơn đặt hàng nhà cung cấp", MỌI dòng cần nhập khớp bộ lọc, xếp theo nhà cung cấp. */
export const downloadRestockPoCsv = (days: number, q: string, supplier: string | null) =>
  apiDownload(`/admin/restock-planner/export?${planParams(days, q, supplier)}`, 'dat-hang-nha-cung-cap.csv');
