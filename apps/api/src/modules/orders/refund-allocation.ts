/**
 * Số tiền/điểm một lần trả hàng được hoàn (D3). Tiền của một dòng = giá trị dòng sau khi chia đều giảm giá cấp đơn
 * và Điểm Xanh theo tỉ lệ giá trị (cùng cách paidLineTotals tính nền hoa hồng): tiền hàng thực trả là
 * `total − shippingFee`, phần của các đơn vị trả là tiền đó nhân tỉ lệ giá trị của chúng trên tổng `OrderItem.total`.
 *
 * Mỗi đại lượng (tiền hàng, điểm đã dùng, điểm lô quy đổi, điểm tích) tính theo kiểu "luỹ kế sau trừ luỹ kế trước":
 * phần của lần này = share(đã trả sau lần này) − share(đã trả trước đó). Nhờ vậy trả nhiều lần cộng lại đúng bằng
 * cả đơn, không lệch đồng nào vì làm tròn, và lần trả nốt nhận đúng phần còn lại.
 */
export interface AllocItem {
  id: string;
  total: number;
  quantity: number;
}

export interface AllocOrder {
  total: number;
  shippingFee: number;
  pointsUsed: number;
  pointsUsedConverted: number;
  pointsEarned: number;
  items: AllocItem[];
}

export interface ReturnShares {
  /** Lần này trả nốt mọi đơn vị còn lại của đơn. */
  isFull: boolean;
  goods: number;
  shipping: number;
  /** Điểm Xanh khách đã dùng cho đơn, trả lại theo phần (gồm cả phần lô quy đổi). */
  pointsUsedBack: number;
  /** Phần của pointsUsedBack thuộc lô quy đổi (CONVERTED). */
  convertedBack: number;
  /** Điểm Xanh tích từ đơn cần thu hồi. */
  pointsEarnedBack: number;
  /** Tỉ lệ giá trị đã trả trước và sau lần này — để giảm hoa hồng CTV cùng cách. */
  ratioBefore: number;
  ratioAfter: number;
  lines: { orderItemId: string; quantity: number; refundAmount: number }[];
}

/** Giá trị (đồng, có thể lẻ) của các đơn vị đã trả trên tổng giá trị dòng; dòng 0đ không làm đổi tỉ lệ. */
function returnedRatio(items: AllocItem[], qty: ReadonlyMap<string, number>): number {
  const gross = items.reduce((s, i) => s + Math.max(0, i.total), 0);
  if (items.every((i) => (qty.get(i.id) ?? 0) >= i.quantity)) return 1;
  if (gross <= 0) return 0;
  let value = 0;
  for (const i of items) {
    const q = Math.min(qty.get(i.id) ?? 0, i.quantity);
    if (q > 0 && i.quantity > 0) value += (Math.max(0, i.total) * q) / i.quantity;
  }
  return Math.min(1, value / gross);
}

/** Phần của `amount` ứng với tỉ lệ; tỉ lệ 1 trả đúng `amount` để luỹ kế khép kín. */
export function shareOf(amount: number, ratio: number): number {
  if (amount <= 0 || ratio <= 0) return 0;
  if (ratio >= 1) return amount;
  return Math.round(amount * ratio);
}

/** Chia `amount` theo trọng số, phần dư chia cho phần lẻ lớn nhất — tổng luôn khớp tuyệt đối. */
export function distributeByWeight(amount: number, weights: number[]): number[] {
  if (weights.length === 0) return [];
  const sum = weights.reduce((s, w) => s + Math.max(0, w), 0);
  if (sum <= 0) return weights.map((_, i) => (i === 0 ? amount : 0));
  const raw = weights.map((w) => (amount * Math.max(0, w)) / sum);
  const out = raw.map((r) => Math.floor(r));
  let rest = amount - out.reduce((s, v) => s + v, 0);
  const order = raw.map((r, i) => ({ i, frac: r - Math.floor(r) })).sort((a, b) => b.frac - a.frac || a.i - b.i);
  for (const { i } of order) {
    if (rest <= 0) break;
    out[i]! += 1;
    rest -= 1;
  }
  return out;
}

export function computeReturnShares(
  order: AllocOrder,
  before: ReadonlyMap<string, number>,
  request: ReadonlyMap<string, number>,
  opts: { shopFault: boolean; priorShipping: number },
): ReturnShares {
  const after = new Map(before);
  for (const [id, q] of request) after.set(id, (after.get(id) ?? 0) + q);
  // Đơn không có dòng hàng (dữ liệu cũ) chỉ trả được nguyên đơn.
  const rb = order.items.length ? returnedRatio(order.items, before) : 0;
  const ra = order.items.length ? returnedRatio(order.items, after) : 1;
  const isFull = order.items.every((i) => (after.get(i.id) ?? 0) >= i.quantity);
  const delta = (amount: number) => Math.max(0, shareOf(amount, ra) - shareOf(amount, rb));

  const goodsPaid = Math.max(0, order.total - Math.max(0, order.shippingFee));
  const goods = delta(goodsPaid);
  const shippingLeft = Math.max(0, order.shippingFee - opts.priorShipping);
  const shipping = isFull || opts.shopFault ? shippingLeft : 0;
  const usedConverted = Math.min(order.pointsUsed, order.pointsUsedConverted);
  const pointsUsedBack = delta(order.pointsUsed);
  const convertedBack = Math.min(pointsUsedBack, delta(usedConverted));

  const lineIds = [...request.keys()].filter((id) => (request.get(id) ?? 0) > 0);
  const weights = lineIds.map((id) => {
    const it = order.items.find((i) => i.id === id);
    return it && it.quantity > 0 ? (Math.max(0, it.total) * (request.get(id) ?? 0)) / it.quantity : 0;
  });
  const perLine = distributeByWeight(goods, weights);
  return {
    isFull,
    goods,
    shipping,
    pointsUsedBack,
    convertedBack,
    pointsEarnedBack: delta(order.pointsEarned),
    ratioBefore: rb,
    ratioAfter: ra,
    lines: lineIds.map((id, idx) => ({ orderItemId: id, quantity: request.get(id) ?? 0, refundAmount: perLine[idx] ?? 0 })),
  };
}
