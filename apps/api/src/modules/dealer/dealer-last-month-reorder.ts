import { vnMonthBounds } from './dealer-tier-progress';

/**
 * Trạng thái đơn đáng đặt lại: đơn đã nhận (ghi công nợ hoặc đã trả tiền) tới đã giao. Đơn chờ thanh toán chưa phải hàng đã mua,
 * đơn huỷ hay trả cả đơn thì đại lý đã không giữ hàng đó.
 */
export const LAST_MONTH_REORDER_STATUSES = ['CONFIRMED', 'PACKED', 'SHIPPING', 'DELIVERED'] as const;

/** Trần số lượng một dòng, cùng trần với ô số lượng của bảng giá (`DEALER_MAX_QTY` ở app-core). */
export const LAST_MONTH_REORDER_MAX_QTY = 9999;

/** Trần số dòng của một đơn đại lý, cùng `ArrayMaxSize` của `DealerOrderDto.items`. */
export const LAST_MONTH_REORDER_MAX_LINES = 100;

/** Số đơn nguồn tối đa đọc cho một tháng: đủ cho đại lý đặt mỗi ngày vài đơn, chặn tháng bất thường kéo cả nghìn đơn vào một lần đọc. */
export const LAST_MONTH_REORDER_MAX_ORDERS = 200;

/** Tháng liền trước theo giờ VN: nhãn "10/2026" và mốc UTC [start, end). */
export function vnPreviousMonthBounds(now: Date): { label: string; start: Date; end: Date } {
  return vnMonthBounds(new Date(vnMonthBounds(now).start.getTime() - 1));
}

export interface ReorderSourceItem {
  id: string;
  variationId: string | null;
  quantity: number;
  isGift: boolean;
  productName: string;
  variationName: string | null;
}

export interface ReorderSourceLine {
  variationId: string;
  quantity: number;
  name: string;
}

const lineName = (it: Pick<ReorderSourceItem, 'productName' | 'variationName'>) =>
  [it.productName, it.variationName].map((s) => (typeof s === 'string' ? s.trim() : '')).filter(Boolean).join(' – ') || 'Mặt hàng';

/**
 * Gộp dòng của các đơn tháng trước theo phân loại: bỏ quà 0đ, trừ phần đã trả (yêu cầu trả đã duyệt), cộng hai dòng cùng phân loại và kẹp
 * ở trần ô số lượng. Thứ tự theo lần đầu phân loại xuất hiện, nên đơn mới nhất đứng trước khi `orders` đã sắp mới nhất trước.
 */
export function aggregateReorderLines(
  orders: readonly { items: readonly ReorderSourceItem[] }[],
  returnedQtyByItem: ReadonlyMap<string, number>,
): ReorderSourceLine[] {
  const out = new Map<string, ReorderSourceLine>();
  for (const order of orders) {
    for (const it of order.items) {
      if (!it.variationId || it.isGift || !Number.isInteger(it.quantity)) continue;
      const kept = it.quantity - (returnedQtyByItem.get(it.id) ?? 0);
      if (kept <= 0) continue;
      const cur = out.get(it.variationId);
      if (cur) cur.quantity = Math.min(LAST_MONTH_REORDER_MAX_QTY, cur.quantity + kept);
      else out.set(it.variationId, { variationId: it.variationId, quantity: Math.min(LAST_MONTH_REORDER_MAX_QTY, kept), name: lineName(it) });
    }
  }
  return [...out.values()];
}

/** Lý do không đặt lại được bằng một chạm (ghi công nợ). Mã đi kèm lỗi 400 của lệnh đặt là `DEALER_REORDER_<mã>`. */
export type LastMonthReorderBlock =
  | 'NO_ORDERS'
  | 'NOTHING_SELLABLE'
  | 'TOO_MANY_LINES'
  | 'BELOW_MIN'
  | 'OVER_MAX'
  | 'NO_TIER'
  | 'OVERDUE'
  | 'OVER_LIMIT';

export interface LastMonthReorderCredit {
  limit: number;
  debt: number;
  /** Hạn mức còn dùng được trước đơn này, không âm. */
  available: number;
  /** Hạn mức còn lại nếu ghi công nợ đơn này; âm là phần vượt. */
  after: number;
}

/** Hạn mức còn lại trước và sau đơn, đọc từ cùng một lần đọc dư nợ. */
export function creditAfterOrder(limit: number, debt: number, total: number): LastMonthReorderCredit {
  return { limit, debt, available: Math.max(0, limit - debt), after: limit - debt - total };
}
