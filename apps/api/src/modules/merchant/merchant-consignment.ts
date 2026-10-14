import { distributeByWeight } from '../orders/refund-allocation';
import { RETURN_REF_PREFIX } from './merchant-config';
import type { SettlementLine } from './merchant-fulfilment.service';

/**
 * Đối soát hàng "Tubu giao hộ" (D4, Q8): kho Tubu giao qua Pancake và tiền khách luôn về Tubu, nên mỗi dòng hàng giao hộ là
 * một khoản Tubu trả gian hàng trên cùng phiếu đối soát với đơn tự giao. Thực nhận của dòng = tiền khách thực trả cho dòng
 * (sau phần mã giảm/Điểm Xanh/giảm hạng chia theo giá trị dòng) − phí sàn của gian hàng − phí Tubu giao hộ (% và phần chia
 * của phí cố định mỗi đơn). Phí giao là của Tubu (Tubu cũng chịu freeship) nên không bao giờ vào tiền của gian hàng.
 */

export const ITEM_REF_PREFIX = 'ITEM:';

/** Khoá của dòng SALE và dòng đảo khi cả đơn bị trả. */
export const consignmentRefKey = (orderItemId: string) => `${ITEM_REF_PREFIX}${orderItemId}`;

/** Khoá dòng đảo của một lần trả một phần chạm tới dòng hàng này. */
export const consignmentReturnRefKey = (requestId: string, orderItemId: string) =>
  `${RETURN_REF_PREFIX}${requestId}:${ITEM_REF_PREFIX}${orderItemId}`;

export interface ConsignmentTerms {
  /** Phí sàn của gian hàng (phân số) — cùng mức với đơn tự giao. */
  commissionPct: number;
  /** Phí Tubu giao hộ theo tiền hàng (phân số). */
  feePct: number;
  /** Phí Tubu giao hộ cố định mỗi đơn (đồng). */
  feeFixed: number;
}

export interface ConsignmentLink {
  variationId: string;
  linkedAt: Date;
  unlinkedAt: Date | null;
}

export interface ConsignmentItem {
  id: string;
  variationId: string;
  productName: string;
  variationName: string | null;
  quantity: number;
  total: number;
}

export interface ConsignmentOrder {
  id: string;
  code: string;
  total: number;
  shippingFee: number;
  createdAt: Date;
  deliveredAt: Date | null;
  items: ConsignmentItem[];
}

/** Biến thể đang liên kết với gian hàng đúng lúc đặt đơn: khoảng [linkedAt, unlinkedAt). */
export function linkedAtOrder(links: ConsignmentLink[], variationId: string, at: Date): boolean {
  return links.some((l) => l.variationId === variationId && at >= l.linkedAt && (l.unlinkedAt === null || at < l.unlinkedAt));
}

/**
 * Tiền khách thực trả từng dòng hàng: tiền hàng thực trả (`total − shippingFee`) chia theo giá trị dòng — cùng tỉ lệ
 * paidLineTotals/refund-allocation dùng cho hoa hồng và hoàn tiền, nhưng chia phần dư cho phần lẻ lớn nhất nên cộng lại đúng
 * bằng số khách trả.
 */
export function paidGoodsByLine(order: { total: number; shippingFee: number; items: { total: number }[] }): number[] {
  const totals = order.items.map((i) => Math.max(0, i.total));
  const gross = totals.reduce((s, v) => s + v, 0);
  const paid = Math.max(0, order.total - Math.max(0, order.shippingFee));
  if (paid >= gross) return totals;
  return distributeByWeight(paid, totals);
}

/** Dòng SALE cho mọi dòng hàng của đơn mà biến thể liên kết với gian hàng lúc đặt (thứ tự theo id dòng để số luôn như nhau). */
export function consignmentSaleLines(order: ConsignmentOrder, links: ConsignmentLink[], terms: ConsignmentTerms): SettlementLine[] {
  const items = [...order.items].sort((a, b) => a.id.localeCompare(b.id));
  const paid = paidGoodsByLine({ ...order, items });
  const mine = items.flatMap((it, idx) =>
    linkedAtOrder(links, it.variationId, order.createdAt) ? [{ it, goods: paid[idx] ?? 0 }] : [],
  );
  if (mine.length === 0) return [];
  const fixed = terms.feeFixed > 0 ? distributeByWeight(terms.feeFixed, mine.map((m) => m.goods)) : mine.map(() => 0);
  return mine.map(({ it, goods }, idx) => {
    const commissionAmount = Math.round(goods * terms.commissionPct);
    const opsFeeAmount = Math.round(goods * terms.feePct) + (fixed[idx] ?? 0);
    return {
      orderId: order.id,
      orderCode: order.code,
      kind: 'SALE' as const,
      refKey: consignmentRefKey(it.id),
      goodsAmount: goods,
      shippingFee: 0,
      commissionAmount,
      opsFeeAmount,
      codCollected: 0,
      netAmount: goods - commissionAmount - opsFeeAmount,
      deliveredAt: order.deliveredAt,
      orderItemId: it.id,
      item: { productName: it.productName, variationName: it.variationName, quantity: it.quantity },
    };
  });
}

/** Số đã vào dòng SALE của một dòng hàng giao hộ (tính lúc xem hoặc đọc từ phiếu đã lập). */
export interface ConsignmentSale {
  orderId: string;
  orderCode: string;
  orderItemId: string;
  quantity: number;
  goodsAmount: number;
  commissionAmount: number;
  opsFeeAmount: number;
  item?: SettlementLine['item'];
}

const shareOfUnits = (amount: number, units: number, quantity: number) =>
  units >= quantity ? amount : Math.round((amount * units) / quantity);

function reversalOf(sale: ConsignmentSale, refKey: string, goods: number, commission: number, fee: number): SettlementLine {
  return {
    orderId: sale.orderId,
    orderCode: sale.orderCode,
    kind: 'REVERSAL',
    refKey,
    goodsAmount: -goods,
    shippingFee: 0,
    commissionAmount: -commission,
    opsFeeAmount: -fee,
    codCollected: 0,
    netAmount: -(goods - commission - fee),
    deliveredAt: null,
    orderItemId: sale.orderItemId,
    item: sale.item ?? null,
  };
}

/**
 * Dòng đảo cho từng lần trả một phần đã duyệt chạm tới dòng hàng: phần của các đơn vị trả trên chính số của dòng SALE (tiền
 * hàng, phí sàn, phí giao hộ). Tính luỹ kế theo thứ tự duyệt rồi lấy hiệu như partialReversalLinesOf, nên trả nhiều lần cộng
 * lại đúng bằng cả dòng. Hàng trả về kho Tubu/Pancake, gian hàng không nhận hàng.
 */
export function consignmentPartialReversals(
  sale: ConsignmentSale,
  requests: { id: string; reviewedAt: Date | null; quantity: number }[],
): SettlementLine[] {
  if (sale.quantity <= 0) return [];
  const ordered = [...requests].sort(
    (a, b) => (a.reviewedAt?.getTime() ?? 0) - (b.reviewedAt?.getTime() ?? 0) || a.id.localeCompare(b.id),
  );
  const out: SettlementLine[] = [];
  let before = 0;
  for (const r of ordered) {
    const after = Math.min(sale.quantity, before + Math.max(0, r.quantity));
    const delta = (amount: number) => shareOfUnits(amount, after, sale.quantity) - shareOfUnits(amount, before, sale.quantity);
    const goods = delta(sale.goodsAmount);
    const commission = delta(sale.commissionAmount);
    const fee = delta(sale.opsFeeAmount);
    before = after;
    if (goods === 0 && commission === 0 && fee === 0) continue;
    out.push(reversalOf(sale, consignmentReturnRefKey(r.id, sale.orderItemId), goods, commission, fee));
  }
  return out;
}

/** Đơn bị trả (RETURNED) sau khi dòng đã vào phiếu: đảo phần còn lại sau các lần trả một phần; không còn gì thì null. */
export function consignmentWholeReversal(sale: ConsignmentSale, partials: SettlementLine[]): SettlementLine | null {
  const left = (k: 'goodsAmount' | 'commissionAmount' | 'opsFeeAmount') => sale[k] + partials.reduce((s, p) => s + p[k], 0);
  const goods = left('goodsAmount');
  const commission = left('commissionAmount');
  const fee = left('opsFeeAmount');
  if (goods === 0 && commission === 0 && fee === 0) return null;
  return reversalOf(sale, consignmentRefKey(sale.orderItemId), goods, commission, fee);
}
