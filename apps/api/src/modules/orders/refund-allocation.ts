/**
 * Số tiền/điểm một lần trả hàng được hoàn (D3). Tiền hàng của một dòng = tiền khách thực trả cho dòng đó lúc đặt
 * (`OrderItem.paidTotal`, mỗi khoản giảm đã chia về đúng dòng được hưởng — cùng số paidLineTotals và phiếu đối soát đối tác
 * dùng); phần của các đơn vị trả = paidTotal × số trả / số lượng, làm tròn từng dòng. Đơn cũ không có paidTotal: tiền hàng
 * thực trả `total − shippingFee` nhân tỉ lệ giá trị các đơn vị trả trên tổng `OrderItem.total`.
 *
 * Điểm Xanh đã dùng trả lại theo phần điểm của từng dòng (`OrderItem.pointsDiscount`; dòng hàng của gian hàng đối tác không
 * nhận điểm nên trả nó không hoàn điểm); đơn cũ chưa lưu thì theo tỉ lệ giá trị. Điểm Xanh đã tích thu hồi theo phần tiền thực
 * trả của các đơn vị trả trên tiền hàng thực trả, đúng cơ sở lúc cộng điểm (checkout: calcPointsEarned trên tiền hàng sau mọi
 * khoản giảm); đơn cũ không có paidTotal thì theo tỉ lệ giá trị.
 *
 * Mỗi đại lượng (tiền hàng, điểm đã dùng, điểm lô quy đổi, điểm tích) tính theo kiểu "luỹ kế sau trừ luỹ kế trước":
 * phần của lần này = share(đã trả sau lần này) − share(đã trả trước đó). Nhờ vậy trả nhiều lần cộng lại đúng bằng
 * cả đơn, không lệch đồng nào vì làm tròn, và lần trả nốt nhận đúng phần còn lại.
 */
import { convertedPointsUsed, marketplacePointsUsed, standardPointsUsed, type PointsUsedByLot } from './points-used-split';
export interface AllocItem {
  id: string;
  total: number;
  quantity: number;
  /** Tiền khách thực trả cho dòng lúc đặt (OrderItem.paidTotal); null ở đơn đặt trước khi có cột này. */
  paidTotal?: number | null;
  /** Phần Điểm Xanh (đồng) trừ vào dòng lúc đặt (OrderItem.pointsDiscount); hàng của gian hàng đối tác luôn 0. */
  pointsDiscount?: number | null;
}

/**
 * Tiền khách thực trả từng dòng đã lưu lúc đặt, khi mọi dòng đều có và cộng lại đúng bằng tiền hàng thực trả của đơn;
 * không thì null — caller chia theo giá trị dòng như đơn cũ.
 */
export function storedLinePaid(goodsPaid: number, items: readonly { paidTotal?: number | null }[]): number[] | null {
  if (items.length === 0) return null;
  const paid: number[] = [];
  for (const i of items) {
    if (i.paidTotal == null || !Number.isInteger(i.paidTotal) || i.paidTotal < 0) return null;
    paid.push(i.paidTotal);
  }
  return paid.reduce((s, v) => s + v, 0) === goodsPaid ? paid : null;
}

/** Phần tiền thực trả của các đơn vị đã trả trên từng dòng (luỹ kế), làm tròn từng dòng; trả hết dòng = đúng paidTotal. */
function returnedPaidByLine(items: AllocItem[], paid: number[], qty: ReadonlyMap<string, number>): number[] {
  return items.map((i, k) => {
    const q = Math.min(qty.get(i.id) ?? 0, i.quantity);
    if (q <= 0 || i.quantity <= 0) return 0;
    return q >= i.quantity ? paid[k]! : Math.round((paid[k]! * q) / i.quantity);
  });
}

export interface AllocOrder {
  total: number;
  shippingFee: number;
  pointsUsed: number;
  pointsUsedConverted: number;
  /** Phần của pointsUsed thuộc lô MARKETPLACE (W42); đơn cũ không có: 0. */
  pointsUsedMarketplace?: number | null;
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
  /** Phần của pointsUsedBack thuộc lô điểm sàn (MARKETPLACE); phần lô STANDARD = pointsUsedBack − convertedBack − marketplaceBack. */
  marketplaceBack: number;
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

/**
 * Tỉ lệ Điểm Xanh của các đơn vị đã trả khi đơn lưu phần điểm từng dòng: điểm chỉ nằm trên dòng hàng Tubu, nên trả hàng của
 * gian hàng đối tác không hoàn điểm. Đơn cũ chưa lưu (một dòng thiếu) → null, dùng tỉ lệ giá trị như trước.
 */
function returnedPointsRatio(items: AllocItem[], qty: ReadonlyMap<string, number>): number | null {
  if (items.length === 0 || items.some((i) => i.pointsDiscount == null || i.pointsDiscount < 0)) return null;
  if (items.every((i) => (qty.get(i.id) ?? 0) >= i.quantity)) return 1;
  const total = items.reduce((s, i) => s + i.pointsDiscount!, 0);
  if (total <= 0) return 0;
  let value = 0;
  for (const i of items) {
    const q = Math.min(qty.get(i.id) ?? 0, i.quantity);
    if (q > 0 && i.quantity > 0) value += (i.pointsDiscount! * q) / i.quantity;
  }
  return Math.min(1, value / total);
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

/** Điểm đã trả lại ở các lần trước, theo lô. Thiếu `marketplaceBack` (đơn trước W42) = 0. */
export interface PriorPointsBack {
  pointsUsedBack: number;
  convertedBack: number;
  marketplaceBack?: number;
}

export interface PointsBackByLot {
  converted: number;
  marketplace: number;
  standard: number;
}

/** Phần mỗi lô khách đã dùng mà chưa được trả lại (không âm). */
function lotRoom(order: PointsUsedByLot, prior: PriorPointsBack): PointsBackByLot {
  return {
    converted: Math.max(0, convertedPointsUsed(order) - prior.convertedBack),
    marketplace: Math.max(0, marketplacePointsUsed(order) - (prior.marketplaceBack ?? 0)),
    standard: Math.max(0, standardPointsUsed(order) - (prior.pointsUsedBack - prior.convertedBack - (prior.marketplaceBack ?? 0))),
  };
}

/**
 * Chia `total` điểm trả lại về các lô: theo phần mong muốn của lô CONVERTED và MARKETPLACE, lô STANDARD nhận phần còn lại; không lô nào
 * vượt phần còn chưa trả của lô đó. Phần dư do làm tròn (lô STANDARD đã hết chỗ) dồn về MARKETPLACE rồi CONVERTED trong giới hạn chỗ
 * của chúng, để điểm sàn không bao giờ thành điểm thường (tiêu được cho vòng quay, cây, đổi quà). Chỉ khi mọi lô hết chỗ (dữ liệu
 * trước W42 đã trả lệch) phần dư mới về STANDARD như trước.
 */
function splitPointsBack(total: number, want: Omit<PointsBackByLot, 'standard'>, room: PointsBackByLot): PointsBackByLot {
  const converted = Math.min(total, want.converted, room.converted);
  const marketplace = Math.min(total - converted, want.marketplace, room.marketplace);
  const standard = Math.min(total - converted - marketplace, room.standard);
  let left = total - converted - marketplace - standard;
  const extraMarketplace = Math.min(left, room.marketplace - marketplace);
  left -= extraMarketplace;
  const extraConverted = Math.min(left, room.converted - converted);
  left -= extraConverted;
  return { converted: converted + extraConverted, marketplace: marketplace + extraMarketplace, standard: standard + left };
}

/**
 * Điểm đã dùng còn phải trả khi đảo cả đơn sau các lần trả một phần (`prior`): đúng phần chưa trả của `pointsUsed`, mỗi lô không quá
 * phần lô đó chưa trả. Đơn trước W42 các lần trả một phần có thể đã trả nhiều điểm thường hơn phần thường của đơn; phần còn lại khi
 * đó vẫn trả đủ tổng, lô thường nhận phần dư.
 */
export function remainingPointsBack(order: PointsUsedByLot, prior: PriorPointsBack): PointsBackByLot {
  const left = Math.max(0, order.pointsUsed - prior.pointsUsedBack);
  const room = lotRoom(order, prior);
  return splitPointsBack(left, room, room);
}

export function computeReturnShares(
  order: AllocOrder,
  before: ReadonlyMap<string, number>,
  request: ReadonlyMap<string, number>,
  opts: {
    shopFault: boolean;
    priorShipping: number;
    /** Điểm đã trả theo lô ở các lần trả một phần trước: kẹp phần mỗi lô lần này trong phần lô đó chưa trả. Bỏ trống = chưa trả lần nào. */
    priorPoints?: PriorPointsBack;
  },
): ReturnShares {
  const after = new Map(before);
  for (const [id, q] of request) after.set(id, (after.get(id) ?? 0) + q);
  // Đơn không có dòng hàng (dữ liệu cũ) chỉ trả được nguyên đơn.
  const rb = order.items.length ? returnedRatio(order.items, before) : 0;
  const ra = order.items.length ? returnedRatio(order.items, after) : 1;
  const isFull = order.items.every((i) => (after.get(i.id) ?? 0) >= i.quantity);
  const delta = (amount: number) => Math.max(0, shareOf(amount, ra) - shareOf(amount, rb));

  const goodsPaid = Math.max(0, order.total - Math.max(0, order.shippingFee));
  const linePaid = storedLinePaid(goodsPaid, order.items);
  const shippingLeft = Math.max(0, order.shippingFee - opts.priorShipping);
  const shipping = isFull || opts.shopFault ? shippingLeft : 0;
  const prb = returnedPointsRatio(order.items, before) ?? rb;
  const pra = returnedPointsRatio(order.items, after) ?? ra;
  const pointsDelta = (amount: number) => Math.max(0, shareOf(amount, pra) - shareOf(amount, prb));
  const priorPoints = opts.priorPoints ?? { pointsUsedBack: 0, convertedBack: 0, marketplaceBack: 0 };
  const pointsUsedBack = Math.min(pointsDelta(order.pointsUsed), Math.max(0, order.pointsUsed - priorPoints.pointsUsedBack));
  const byLot = splitPointsBack(
    pointsUsedBack,
    { converted: pointsDelta(convertedPointsUsed(order)), marketplace: pointsDelta(marketplacePointsUsed(order)) },
    lotRoom(order, priorPoints),
  );
  const convertedBack = byLot.converted;
  const marketplaceBack = byLot.marketplace;

  const lineIds = [...request.keys()].filter((id) => (request.get(id) ?? 0) > 0);
  let goods: number;
  let perLine: number[];
  let pointsEarnedBack = delta(order.pointsEarned);
  if (linePaid) {
    const pb = returnedPaidByLine(order.items, linePaid, before);
    const pa = returnedPaidByLine(order.items, linePaid, after);
    perLine = lineIds.map((id) => {
      const k = order.items.findIndex((i) => i.id === id);
      return k < 0 ? 0 : Math.max(0, pa[k]! - pb[k]!);
    });
    goods = perLine.reduce((s, v) => s + v, 0);
    // Tỉ lệ giá gốc lệch khi giảm giá dồn vào dòng được giữ lại; trả hết thì cộng đúng goodsPaid nên tỉ lệ 1.
    if (goodsPaid > 0) {
      const paidRatio = (paid: number[]) => paid.reduce((s, v) => s + v, 0) / goodsPaid;
      pointsEarnedBack = Math.max(0, shareOf(order.pointsEarned, paidRatio(pa)) - shareOf(order.pointsEarned, paidRatio(pb)));
    }
  } else {
    goods = delta(goodsPaid);
    const weights = lineIds.map((id) => {
      const it = order.items.find((i) => i.id === id);
      return it && it.quantity > 0 ? (Math.max(0, it.total) * (request.get(id) ?? 0)) / it.quantity : 0;
    });
    perLine = distributeByWeight(goods, weights);
  }
  return {
    isFull,
    goods,
    shipping,
    pointsUsedBack,
    convertedBack,
    marketplaceBack,
    pointsEarnedBack,
    ratioBefore: rb,
    ratioAfter: ra,
    lines: lineIds.map((id, idx) => ({ orderItemId: id, quantity: request.get(id) ?? 0, refundAmount: perLine[idx] ?? 0 })),
  };
}

/**
 * Tiền hàng đã trả luỹ kế của các đơn vị trong `qty` (số đã duyệt trả theo dòng, gồm cả lần đang duyệt) và tiền hàng thực trả
 * của đơn (`total − shippingFee`). Cùng cơ sở với `goods` của computeReturnShares: mỗi lần trả là luỹ kế sau trừ luỹ kế trước,
 * nên tổng `goods` các lần trả đúng bằng `returned` ở đây, không phụ thuộc đơn có được hoàn tiền thật hay không.
 */
export function returnedGoods(order: AllocOrder, qty: ReadonlyMap<string, number>): { returned: number; goods: number } {
  return {
    returned: computeReturnShares(order, new Map(), qty, { shopFault: false, priorShipping: 0 }).goods,
    goods: Math.max(0, order.total - Math.max(0, order.shippingFee)),
  };
}
