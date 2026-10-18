import type { OrderItemView, PurchasedItem, RepurchaseResponse, RepurchaseSkipReason } from '@tubutree/app-core/api/orders';

/** Điểm vào luồng mua lại (cùng tên với Mini App); web chưa gửi sự kiện phân tích nên chỉ để biết khách vào từ đâu. */
export type ReorderSource = 'order_card' | 'order_detail' | 'orders_tab';

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
  // API cũ không trả stock/available → coi như còn hàng, server kẹp theo tồn thật.
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

const SKIP_REASON: Record<RepurchaseSkipReason, string> = {
  OUT_OF_STOCK: 'hết hàng',
  INACTIVE: 'ngừng bán',
  NOT_APPROVED: 'ngừng bán',
  EXCEEDS_STOCK: 'không đủ hàng',
};

export interface ReorderSummary {
  addedLines: number;
  skippedLines: number;
  addedUnits: number;
  hasProblems: boolean;
  message: string;
}

/** Câu báo kết quả mua lại — nêu rõ dòng nào không thêm được và vì sao. */
export function summarizeReorder(res: RepurchaseResponse, lines: ReorderLine[], selections: ReorderSelection[]): ReorderSummary {
  if (res.legacy) {
    const units = selections.reduce((s, x) => s + x.quantity, 0);
    return { addedLines: selections.length, skippedLines: 0, addedUnits: units, hasProblems: false, message: 'Đã thêm vào giỏ' };
  }
  // Cùng tên sản phẩm lặp lại trong đơn (khác phân loại) → kèm tên phân loại để biết dòng nào bị bỏ.
  const nameOf = (key: string) => {
    const l = lines.find((x) => x.key === key);
    if (!l) return 'Sản phẩm';
    const repeated = lines.filter((x) => x.productName === l.productName).length > 1;
    return repeated && l.variationName ? `${l.productName} - ${l.variationName}` : l.productName;
  };
  const addedUnits = res.results.reduce((s, r) => s + r.addedQuantity, 0);
  const addedLines = res.results.filter((r) => r.status !== 'skipped').length;
  const skippedLines = res.results.filter((r) => r.status === 'skipped').length;
  const problems = res.results
    .filter((r) => r.status !== 'added')
    .map((r) => `${nameOf(r.orderItemId)} (${r.status === 'partial' ? `chỉ thêm được ${r.addedQuantity}` : SKIP_REASON[r.reason ?? 'OUT_OF_STOCK']})`);
  const message =
    addedUnits > 0
      ? problems.length > 0
        ? `Đã thêm ${addedUnits} món vào giỏ. Chưa thêm đủ: ${problems.join(', ')}`
        : `Đã thêm ${addedUnits} món vào giỏ`
      : problems.length > 0
        ? `Chưa thêm được món nào vào giỏ: ${problems.join(', ')}`
        : 'Chưa thêm được món nào vào giỏ';
  // Không thêm được đơn vị nào thì luôn là "có vấn đề", kể cả khi server không nêu dòng lỗi.
  return { addedLines, skippedLines, addedUnits, hasProblems: problems.length > 0 || addedUnits === 0, message };
}
