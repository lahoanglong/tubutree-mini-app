import { maskPhoneOrNull, maskVnPhonesInText } from '../../common/mask-pii';
import { pancakePaymentState, type PancakePaymentState } from '../integrations/pancake/pancake-order-body';
import { orderStatusLabelVi } from './order-transition';

/** Trần một lượt in: 200 mã đơn vẫn nằm gọn trong giới hạn dòng yêu cầu 8 KB của Apache (mã đơn cuid ~25 ký tự). */
export const PICK_LIST_MAX = 200;
/** Độ dài tối đa một mã trong `ids` (id cuid hoặc mã đơn TB…), cùng trần với `POST /admin/orders/bulk-status`. */
export const PICK_LIST_ID_MAX_LEN = 40;

export interface PickSourceItem {
  variationId: string;
  productName: string;
  variationName: string;
  unitPrice: number;
  quantity: number;
  isGift: boolean;
  backorderedQty: number;
}

export interface PickSourceOrder {
  id: string;
  code: string;
  status: string;
  type: string;
  fulfiller: string;
  paymentMethod: string;
  paymentStatus: string;
  total: number;
  shippingAddress: unknown;
  note: string | null;
  hasRecyclingPickup: boolean;
  createdAt: Date;
  items: PickSourceItem[];
}

export interface PickLine {
  variationId: string;
  sku: string | null;
  productName: string;
  variationName: string;
  quantity: number;
  /** Phần chưa có hàng thật (đơn đại lý đặt vượt tồn), kho chưa nhặt được. */
  backorderedQty: number;
}

/** Một dòng của Phần 1: một biến thể, hàng bán và quà 0đ tách hai dòng để kho không lấy nhầm hàng tặng vào phần bán. */
export interface PickSummaryRow extends PickLine {
  isGift: boolean;
  /** Số đơn có dòng này. */
  orderCount: number;
}

/**
 * Tiền bưu tá thu khi giao, cùng luật với số thu hộ gửi Pancake (`buildPancakeOrderBody`): đơn chưa trả trước thu đúng
 * `total` (số "Tổng" ở chi tiết đơn), đơn đã trả hoặc đại lý ghi công nợ thu 0. Đơn chuyển khoản/cổng thanh toán còn chờ tiền
 * thì `collect` = 0 và phiếu ghi CHƯA GIAO, đúng ghi chú đơn bên Pancake.
 */
export interface PickPayment {
  method: string;
  state: PancakePaymentState;
  total: number;
  collect: number;
}

export interface PickOrder {
  id: string;
  code: string;
  status: string;
  statusLabel: string;
  type: string;
  createdAt: string;
  recipient: string;
  /** 3 số đầu + **** + 3 số cuối: phiếu in nằm trên bàn kho, không mang SĐT đầy đủ. Nhãn vận đơn Pancake mới có số thật. */
  phoneMasked: string | null;
  address: string;
  note: string | null;
  hasRecyclingPickup: boolean;
  items: PickLine[];
  gifts: PickLine[];
  payment: PickPayment;
}

export interface PickListExcluded {
  /** Đúng chuỗi đã gửi. */
  id: string;
  code: string | null;
  status: string | null;
  reason: string;
}

export interface PickListResponse {
  generatedAt: string;
  orderCount: number;
  totalUnits: number;
  giftUnits: number;
  summary: PickSummaryRow[];
  orders: PickOrder[];
  excluded: PickListExcluded[];
}

/** Dòng quà: cờ `isGift` (quà mốc giỏ) hoặc đơn giá 0đ. Cả hai đều không tính tiền khách nên in tách khỏi hàng bán. */
export const isGiftLine = (i: Pick<PickSourceItem, 'isGift' | 'unitPrice'>) => i.isGift || i.unitPrice === 0;

/** Lý do không đưa đơn vào phiếu; null = in. Đơn đã huỷ/đã hoàn không còn hàng đi, đơn gian hàng tự giao không qua kho Tubu. */
export function pickExclusionReason(o: Pick<PickSourceOrder, 'code' | 'status' | 'fulfiller'>): string | null {
  if (o.status === 'CANCELLED') return `Đơn ${o.code} đã huỷ: không soạn, không đóng gói.`;
  if (o.status === 'RETURNED') return `Đơn ${o.code} đã hoàn: không soạn, không đóng gói.`;
  if (o.fulfiller === 'MERCHANT') return `Đơn ${o.code} do gian hàng đối tác tự giao, kho Tubu không đóng gói.`;
  return null;
}

const text = (v: unknown) => (typeof v === 'string' ? v.trim() : '');

function addressOf(raw: unknown): { recipient: string; phone: string; line: string } {
  const a = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  return {
    recipient: text(a.recipient),
    phone: text(a.phone),
    line: [a.street, a.ward, a.district, a.province].map(text).filter(Boolean).join(', '),
  };
}

const viCompare = (a: string, b: string) => a.localeCompare(b, 'vi');

/**
 * Dựng phiếu soạn hàng từ các đơn đã đọc. Thứ tự phiếu từng đơn giữ đúng thứ tự `ids` người bấm gửi; mã gửi trùng (id và mã đơn
 * của cùng một đơn) chỉ in một lần. `onCredit` là id đơn đại lý ghi công nợ (có dòng sổ công nợ `refType = ORDER`).
 */
export function buildPickList(
  ids: readonly string[],
  found: readonly PickSourceOrder[],
  skuByVariation: ReadonlyMap<string, string>,
  onCredit: ReadonlySet<string>,
  now: Date,
): PickListResponse {
  const byKey = new Map<string, PickSourceOrder>();
  for (const o of found) {
    byKey.set(o.id, o);
    byKey.set(o.code, o);
  }
  const seen = new Set<string>();
  const orders: PickOrder[] = [];
  const excluded: PickListExcluded[] = [];
  const rows = new Map<string, PickSummaryRow & { orders: Set<string> }>();

  const line = (i: PickSourceItem): PickLine => ({
    variationId: i.variationId,
    sku: skuByVariation.get(i.variationId) ?? null,
    productName: i.productName,
    variationName: i.variationName,
    quantity: i.quantity,
    backorderedQty: i.backorderedQty,
  });

  for (const id of ids) {
    const o = byKey.get(id);
    if (!o) {
      excluded.push({ id, code: null, status: null, reason: `Không tìm thấy đơn ${id}.` });
      continue;
    }
    if (seen.has(o.id)) continue;
    seen.add(o.id);
    const reason = pickExclusionReason(o);
    if (reason) {
      excluded.push({ id, code: o.code, status: o.status, reason });
      continue;
    }

    const items: PickLine[] = [];
    const gifts: PickLine[] = [];
    for (const i of o.items) {
      const gift = isGiftLine(i);
      (gift ? gifts : items).push(line(i));
      const key = `${i.variationId}|${gift ? 'gift' : 'sale'}`;
      const row = rows.get(key) ?? { ...line(i), quantity: 0, backorderedQty: 0, isGift: gift, orderCount: 0, orders: new Set<string>() };
      row.quantity += i.quantity;
      row.backorderedQty += i.backorderedQty;
      row.orders.add(o.id);
      row.orderCount = row.orders.size;
      rows.set(key, row);
    }

    const addr = addressOf(o.shippingAddress);
    const state = pancakePaymentState(o, onCredit.has(o.id));
    orders.push({
      id: o.id,
      code: o.code,
      status: o.status,
      statusLabel: orderStatusLabelVi(o.status),
      type: o.type,
      createdAt: o.createdAt.toISOString(),
      recipient: addr.recipient,
      phoneMasked: maskPhoneOrNull(addr.phone),
      address: addr.line,
      note: o.note ? maskVnPhonesInText(o.note) : null,
      hasRecyclingPickup: o.hasRecyclingPickup,
      items,
      gifts,
      payment: { method: o.paymentMethod, state, total: o.total, collect: state === 'COD' ? o.total : 0 },
    });
  }

  const summary = [...rows.values()]
    .map(({ orders: _orders, ...r }) => r)
    .sort((a, b) => Number(a.isGift) - Number(b.isGift) || viCompare(a.productName, b.productName) || viCompare(a.variationName, b.variationName) || viCompare(a.sku ?? '', b.sku ?? ''));

  return {
    generatedAt: now.toISOString(),
    orderCount: orders.length,
    totalUnits: summary.filter((r) => !r.isGift).reduce((s, r) => s + r.quantity, 0),
    giftUnits: summary.filter((r) => r.isGift).reduce((s, r) => s + r.quantity, 0),
    summary,
    orders,
    excluded,
  };
}
