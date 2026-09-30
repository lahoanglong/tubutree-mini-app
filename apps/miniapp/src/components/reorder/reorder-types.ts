import type { OrderItemView, PurchasedItem } from '../../services/shop-api';

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
  unitPrice: number;
  defaultQuantity: number;
  maxQuantity: number;
  available: boolean;
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
  const maxQuantity = Math.min(stock, MAX_REORDER_QTY);
  return {
    key: it.id,
    variationId: it.variationId,
    productName: it.productName,
    variationName: it.variationName,
    thumbnail: it.thumbnail ?? null,
    unitPrice: it.currentPrice ?? it.unitPrice,
    defaultQuantity: available ? clampQty(it.quantity, maxQuantity) : it.quantity,
    maxQuantity,
    available,
  };
}

export function lineFromPurchasedItem(p: PurchasedItem): ReorderLine {
  const stock = Math.max(p.stock, 0);
  return {
    key: p.variationId,
    variationId: p.variationId,
    productName: p.productName,
    variationName: p.variationName,
    thumbnail: p.thumbnail,
    unitPrice: p.salePrice ?? p.price,
    defaultQuantity: 1,
    maxQuantity: Math.min(stock, MAX_REORDER_QTY),
    available: p.inStock !== false && stock > 0,
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
  const price = new Map(targetLines(t).map((l) => [l.key, l.unitPrice]));
  return selectedLines(t, sel).reduce(
    (acc, s) => ({ units: acc.units + s.quantity, subtotal: acc.subtotal + s.quantity * (price.get(s.key) ?? 0) }),
    { units: 0, subtotal: 0 },
  );
}
