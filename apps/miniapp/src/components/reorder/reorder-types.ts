import type { OrderItemView, PurchasedItem } from '../../services/shop-api';
import {
  isDiscontinuedItem, purchasedPricing, reorderLineNotices, reorderPriceAt, reorderPricing, type ReorderLineNotice, type ReorderPricing,
} from '@tubutree/app-core/commerce/reorder-notice';
import { qtyPickMax } from '@tubutree/app-core/commerce/stock-text';

export type { ReorderSource } from '../../services/buy-flow-events';

/** Trần số lượng khi API không cho biết tồn kho (API cũ) — server vẫn kẹp theo tồn thật. */
export const MAX_REORDER_QTY = 99;

/** Một dòng trong ReorderSheet. `key` = orderItemId (mua lại cả đơn) hoặc variationId (1 SP). */
export interface ReorderLine {
  key: string;
  variationId: string;
  productName: string;
  variationName: string;
  thumbnail: string | null;
  /** Đơn giá ở số lượng mặc định; ở số lượng khác xem `lineAt`. */
  unitPrice: number;
  defaultQuantity: number;
  maxQuantity: number;
  available: boolean;
  /** Câu dưới dòng: hết hàng hay ngừng bán, đã giảm số lượng (thiếu hàng hoặc quá trần), giá đổi so với giá đã trả. */
  notices: readonly ReorderLineNotice[];
  /** Dữ kiện giá (giá Giờ vàng theo số suất) để tính lại giá và câu giá theo số lượng chọn. Thiếu: giá và câu cố định như `unitPrice`, `notices`. */
  pricing?: ReorderPricing;
}

/** Đơn giá và câu dưới dòng ở số lượng khách chọn: Giờ vàng chỉ áp tới số suất còn mua được, vượt thì cả dòng giá đang bán (như giỏ). */
export function lineAt(line: ReorderLine, quantity: number): { unitPrice: number; notices: readonly ReorderLineNotice[] } {
  if (!line.pricing) return { unitPrice: line.unitPrice, notices: line.notices };
  const { unitPrice, notice } = reorderPriceAt(line.pricing, quantity);
  const rest = line.notices.filter((n) => n.kind !== 'priceUp' && n.kind !== 'priceDown');
  return { unitPrice, notices: notice ? [...rest, notice] : rest };
}

export type ReorderTarget =
  | { kind: 'order'; orderCode: string; lines: ReorderLine[] }
  | { kind: 'item'; line: ReorderLine };

export interface LineSelection {
  checked: boolean;
  quantity: number;
}

export interface ReorderSelection {
  key: string;
  variationId: string;
  quantity: number;
}

const clampQty = (n: number, max: number) => Math.max(1, Math.min(Math.floor(n) || 1, Math.max(max, 1)));

export function lineFromOrderItem(it: OrderItemView): ReorderLine {
  // API cũ không trả stock/available → coi như còn hàng (Ruling 19), server kẹp theo tồn thật.
  const stock = typeof it.stock === 'number' ? Math.max(it.stock, 0) : MAX_REORDER_QTY;
  const available = it.available !== false && stock > 0;
  const maxQuantity = Math.min(qtyPickMax(stock), MAX_REORDER_QTY);
  const defaultQuantity = available ? clampQty(it.quantity, maxQuantity) : it.quantity;
  const pricing = reorderPricing(it);
  const price = reorderPriceAt(pricing, defaultQuantity);
  const notices = reorderLineNotices({
    available,
    discontinued: isDiscontinuedItem(it),
    orderedQuantity: it.quantity,
    stock: typeof it.stock === 'number' ? Math.max(it.stock, 0) : null,
    cap: MAX_REORDER_QTY,
    paidPrice: it.unitPrice,
    currentPrice: pricing.comparable ? price.unitPrice : null,
  });
  return {
    key: it.id,
    variationId: it.variationId,
    productName: it.productName,
    variationName: it.variationName,
    thumbnail: it.thumbnail ?? null,
    unitPrice: price.unitPrice,
    defaultQuantity,
    maxQuantity,
    available,
    notices,
    pricing,
  };
}

export function lineFromPurchasedItem(p: PurchasedItem): ReorderLine {
  const stock = Math.max(p.stock, 0);
  const available = p.inStock !== false && stock > 0;
  const pricing = purchasedPricing(p);
  const price = reorderPriceAt(pricing, 1).unitPrice;
  return {
    key: p.variationId,
    variationId: p.variationId,
    productName: p.productName,
    variationName: p.variationName,
    thumbnail: p.thumbnail,
    unitPrice: price,
    defaultQuantity: 1,
    maxQuantity: Math.min(qtyPickMax(stock), MAX_REORDER_QTY),
    available,
    notices: reorderLineNotices({ available, discontinued: false, orderedQuantity: 1, stock, cap: MAX_REORDER_QTY, paidPrice: price, currentPrice: price }),
    pricing,
  };
}

export function orderReorderTarget(order: { code: string; items: OrderItemView[] }): ReorderTarget {
  return { kind: 'order', orderCode: order.code, lines: order.items.map(lineFromOrderItem) };
}

export function itemReorderTarget(p: PurchasedItem): ReorderTarget {
  return { kind: 'item', line: lineFromPurchasedItem(p) };
}

export function targetLines(t: ReorderTarget): ReorderLine[] {
  return t.kind === 'order' ? t.lines : [t.line];
}

export function initialSelection(t: ReorderTarget): Record<string, LineSelection> {
  return Object.fromEntries(targetLines(t).map((l) => [l.key, { checked: l.available, quantity: l.defaultQuantity }]));
}

export function selectedLines(t: ReorderTarget, sel: Record<string, LineSelection>): ReorderSelection[] {
  return targetLines(t)
    .filter((l) => l.available && sel[l.key]?.checked)
    .map((l) => ({ key: l.key, variationId: l.variationId, quantity: clampQty(sel[l.key]!.quantity, l.maxQuantity) }));
}

export function selectionTotals(t: ReorderTarget, sel: Record<string, LineSelection>): { units: number; subtotal: number } {
  const lines = new Map(targetLines(t).map((l) => [l.key, l]));
  return selectedLines(t, sel).reduce(
    (acc, s) => ({ units: acc.units + s.quantity, subtotal: acc.subtotal + s.quantity * lineAt(lines.get(s.key)!, s.quantity).unitPrice }),
    { units: 0, subtotal: 0 },
  );
}
