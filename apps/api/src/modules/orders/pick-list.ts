import { maskPhoneOrNull, maskVnPhonesInText } from '../../common/mask-pii';
import { GIFT_NAME_MAX, pancakePaymentState, sanitizeCustomerText, type PancakePaymentState } from '../integrations/pancake/pancake-order-body';
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
  /** Ghi chú nội bộ CSKH/Admin gửi kho (order_staff_notes); không có thì null hoặc vắng. */
  staffNote?: { note: string } | null;
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
  /** Quà đổi điểm gắn vào đơn: `sku` là mã QG của lượt đổi ở phiếu từng đơn, null ở Phần 1 (gộp theo tên quà). */
  redeemed: boolean;
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
  /** Ghi chú nội bộ CSKH/Admin cho kho, che SĐT như ghi chú khách: phiếu in nằm trên bàn kho. */
  staffNote: string | null;
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

/** Quà hiện vật 0đ khách đổi bằng điểm rồi gắn vào đơn (`WasteGiftRedemption.attachedOrderId`): không phải dòng đơn, Pancake ghi ở ghi chú. */
export interface PickRedeemedGift {
  code: string | null;
  giftName: string;
}

/**
 * Lý do không đưa đơn vào phiếu; null = in. Phiếu chỉ gồm đơn kho soạn được ngay (Đã xác nhận, Đang đóng gói): đơn đã huỷ/đã hoàn
 * không còn hàng đi, đơn đang giao/đã giao đã rời kho (in lại là nhặt hàng hai lần), đơn còn chờ khách trả tiền thì Pancake giữ lại
 * chưa giao, đơn gian hàng tự giao không qua kho Tubu.
 */
export function pickExclusionReason(o: Pick<PickSourceOrder, 'code' | 'status' | 'fulfiller'>, state: PancakePaymentState): string | null {
  if (o.status === 'CANCELLED') return `Đơn ${o.code} đã huỷ: không soạn, không đóng gói.`;
  if (o.status === 'RETURNED') return `Đơn ${o.code} đã hoàn: không soạn, không đóng gói.`;
  if (o.status === 'SHIPPING' || o.status === 'DELIVERED') return `Đơn ${o.code} ${o.status === 'SHIPPING' ? 'đang giao' : 'đã giao'}: hàng đã rời kho, không soạn lại.`;
  if (o.fulfiller === 'MERCHANT') return `Đơn ${o.code} do gian hàng đối tác tự giao, kho Tubu không đóng gói.`;
  if (o.status === 'PENDING_PAYMENT' || state === 'AWAITING_TRANSFER' || state === 'AWAITING_GATEWAY')
    return `Đơn ${o.code} chờ khách thanh toán: chưa soạn, chưa giao.`;
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

export interface PickListLookups {
  skuByVariation: ReadonlyMap<string, string>;
  /** Id đơn đại lý ghi công nợ (có dòng sổ công nợ `refType = ORDER`). */
  onCredit: ReadonlySet<string>;
  /** Quà đổi điểm theo id đơn, đúng thứ tự khách đổi. */
  redeemedGifts: ReadonlyMap<string, readonly PickRedeemedGift[]>;
  now: Date;
}

/**
 * Dựng phiếu soạn hàng từ các đơn đã đọc. Thứ tự phiếu từng đơn giữ đúng thứ tự `ids` người bấm gửi; mã gửi trùng (id và mã đơn
 * của cùng một đơn) chỉ in một lần.
 */
/**
 * Ghi chú nội bộ trên phiếu in: một dòng, bỏ ký tự điều khiển. Không qua `sanitizeCustomerText` vì luật ẩn câu "đã chuyển khoản" dành cho
 * chữ của khách; ghi chú do CSKH viết, còn tình trạng tiền thì phiếu in riêng ở ô thanh toán.
 */
function staffNoteLine(note: string | null | undefined): string | null {
  // eslint-disable-next-line no-control-regex
  const line = (note ?? '').normalize('NFC').replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim();
  return line || null;
}

export function buildPickList(ids: readonly string[], found: readonly PickSourceOrder[], { skuByVariation, onCredit, redeemedGifts, now }: PickListLookups): PickListResponse {
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
    redeemed: false,
  });

  for (const id of ids) {
    const o = byKey.get(id);
    if (!o) {
      excluded.push({ id, code: null, status: null, reason: `Không tìm thấy đơn ${id}.` });
      continue;
    }
    if (seen.has(o.id)) continue;
    seen.add(o.id);
    const state = pancakePaymentState(o, onCredit.has(o.id));
    const reason = pickExclusionReason(o, state);
    if (reason) {
      excluded.push({ id, code: o.code, status: o.status, reason });
      continue;
    }

    const items: PickLine[] = [];
    const gifts: PickLine[] = [];
    const add = (key: string, l: PickLine, gift: boolean) => {
      (gift ? gifts : items).push(l);
      const base = l.redeemed ? { ...l, variationId: key, sku: null } : l;
      const row = rows.get(key) ?? { ...base, quantity: 0, backorderedQty: 0, isGift: gift, orderCount: 0, orders: new Set<string>() };
      row.quantity += l.quantity;
      row.backorderedQty += l.backorderedQty;
      row.orders.add(o.id);
      row.orderCount = row.orders.size;
      rows.set(key, row);
    };
    for (const i of o.items) {
      const gift = isGiftLine(i);
      add(`${i.variationId}|${gift ? 'gift' : 'sale'}`, line(i), gift);
    }
    // Quà đổi điểm không có biến thể: gộp Phần 1 theo tên quà (đã làm sạch như ghi chú Pancake), mã QG của từng lượt đổi in ở phiếu từng đơn.
    for (const g of redeemedGifts.get(o.id) ?? []) {
      const name = sanitizeCustomerText(g.giftName, GIFT_NAME_MAX) ?? 'Quà đổi điểm';
      add(
        `redeem|${name}`,
        { variationId: `redeem:${g.code ?? name}`, sku: g.code, productName: name, variationName: 'Quà đổi điểm', quantity: 1, backorderedQty: 0, redeemed: true },
        true,
      );
    }

    const addr = addressOf(o.shippingAddress);
    const note = sanitizeCustomerText(o.note);
    const staffNote = staffNoteLine(o.staffNote?.note);
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
      note: note ? maskVnPhonesInText(note) : null,
      staffNote: staffNote ? maskVnPhonesInText(staffNote) : null,
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
