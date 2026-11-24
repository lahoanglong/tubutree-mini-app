import { listOrders, type InvoiceFilter, type OrderListExtra, type PancakeFilter, type RecyclingFilter } from './admin-client';
import { apiFetch } from './client-api';
import { PAYMENT_METHOD_LABELS } from './export-csv';
import { formatVnd } from './shop-client';

/** Trần một lượt in (`PICK_LIST_MAX` ở `apps/api/src/modules/orders/pick-list.ts`). */
export const PICK_LIST_MAX = 200;
/** Trang lớn nhất `GET /admin/orders` nhận (`limit` ≤ 100). */
const LIST_PAGE = 100;

/** Cùng kiểu `PancakePaymentState` của API: tiền của đơn với kho lúc giao. */
export type PickPaymentState = 'COD' | 'PAID' | 'AWAITING_TRANSFER' | 'AWAITING_GATEWAY' | 'CREDIT';

export interface PickLine {
  variationId: string;
  sku: string | null;
  productName: string;
  variationName: string;
  quantity: number;
  backorderedQty: number;
  /** Quà đổi điểm gắn vào đơn: `sku` là mã QG ở phiếu từng đơn, null ở Phần 1. */
  redeemed: boolean;
}
export interface PickSummaryRow extends PickLine {
  isGift: boolean;
  orderCount: number;
}
export interface PickOrder {
  id: string;
  code: string;
  status: string;
  statusLabel: string;
  type: string;
  createdAt: string;
  recipient: string;
  phoneMasked: string | null;
  address: string;
  note: string | null;
  hasRecyclingPickup: boolean;
  items: PickLine[];
  gifts: PickLine[];
  payment: { method: string; state: PickPaymentState; total: number; collect: number };
}
export interface PickListExcluded {
  id: string;
  code: string | null;
  status: string | null;
  reason: string;
}
/** `GET /admin/orders/pick-list` (PickListService.build). */
export interface PickListResponse {
  generatedAt: string;
  orderCount: number;
  totalUnits: number;
  giftUnits: number;
  summary: PickSummaryRow[];
  orders: PickOrder[];
  excluded: PickListExcluded[];
}

export const getPickList = (ids: readonly string[]) =>
  // wave-preflight-ignore mock-api-fallback: chỉ gọi khi nhân viên kho bấm nút in, không có lời gọi lúc tải trang
  apiFetch<PickListResponse>(`/admin/orders/pick-list?ids=${ids.map(encodeURIComponent).join(',')}`, { timeoutMs: 60_000 });

/**
 * Dòng tiền in đậm ở góc phiếu từng đơn. Số thu COD là `total`, đúng số "Tổng" ở chi tiết đơn và số thu hộ gửi Pancake. Đơn còn chờ
 * chuyển khoản/thanh toán online ghi CHƯA GIAO như ghi chú đơn Pancake, để kho không giao nhầm đơn chưa có tiền.
 */
export function pickPaymentText(p: PickOrder['payment']): { text: string; tone: 'collect' | 'none' | 'hold' } {
  switch (p.state) {
    case 'COD':
      return { text: `Thu COD ${formatVnd(p.collect)}`, tone: 'collect' };
    case 'PAID':
      return { text: `Đã thanh toán (${PAYMENT_METHOD_LABELS[p.method] ?? p.method}) · không thu tiền`, tone: 'none' };
    case 'CREDIT':
      return { text: 'Đại lý ghi công nợ · không thu tiền', tone: 'none' };
    case 'AWAITING_TRANSFER':
      return { text: `Chờ chuyển khoản ${formatVnd(p.total)} · CHƯA GIAO`, tone: 'hold' };
    case 'AWAITING_GATEWAY':
      return { text: `Chờ thanh toán online ${formatVnd(p.total)} · CHƯA GIAO`, tone: 'hold' };
  }
}

export interface PickListFilter {
  status?: string;
  search?: string;
  recycling?: RecyclingFilter;
  invoice?: InvoiceFilter;
  pancake?: PancakeFilter;
  from?: string;
  to?: string;
  extra?: OrderListExtra;
}

export interface FilterOrderIds {
  ids: string[];
  /** Số đơn khớp bộ lọc theo lần đọc cuối. */
  total: number;
  tooMany: boolean;
  /** false = danh sách đổi giữa hai lần đọc trang (đơn vừa đổi trạng thái, đơn mới vào) và vẫn thiếu sau một lần gom lại. */
  complete: boolean;
}

async function collectOnce(f: PickListFilter): Promise<FilterOrderIds> {
  const ids = new Set<string>();
  let total: number | null = null;
  // Tổng đổi giữa hai trang là danh sách đã trượt: một đơn rời bộ lọc làm trang sau bỏ qua một đơn, mà đơn vừa rời vẫn nằm trong
  // các mã đã gom nên chỉ so số mã với tổng thì không thấy thiếu.
  let shifted = false;
  for (let n = 1; n <= Math.ceil(PICK_LIST_MAX / LIST_PAGE); n++) {
    const page = await listOrders(n, f.status, f.search, f.recycling, LIST_PAGE, f.invoice, f.pancake, f.from, f.to, f.extra);
    if (total !== null && page.meta.total !== total) shifted = true;
    total = page.meta.total;
    if (total > PICK_LIST_MAX) return { ids: [], total, tooMany: true, complete: true };
    for (const o of page.data) ids.add(o.id || o.code);
    if (ids.size >= total || page.data.length === 0) break;
  }
  const t = total ?? 0;
  return { ids: [...ids].slice(0, PICK_LIST_MAX), total: t, tooMany: false, complete: !shifted && ids.size >= t };
}

/**
 * Mã mọi đơn khớp bộ lọc của tab Đơn hàng, theo đúng thứ tự danh sách, để in cả bộ lọc một lượt. Bộ lọc quá `PICK_LIST_MAX` đơn thì
 * trả `tooMany` và không trả mã nào: in một phần bộ lọc dễ làm kho tưởng đã in hết. Đọc theo trang nên đơn đổi trạng thái giữa hai trang
 * làm trang sau trượt và sót một đơn: thiếu thì gom lại một lần, vẫn thiếu thì báo `complete: false` để màn in cảnh báo.
 */
export async function collectFilterOrderIds(f: PickListFilter): Promise<FilterOrderIds> {
  const first = await collectOnce(f);
  return first.tooMany || first.complete ? first : collectOnce(f);
}
