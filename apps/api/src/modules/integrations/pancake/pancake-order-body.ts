import { isNewGeoCode } from './geo-code';
import { isPrepaidMethod } from '../../orders/order-transition';
import type { PancakeCreateOrderBody, PancakeCreateOrderItem } from './pancake.types';

/** Tag máy đọc được trên đơn Pancake — kho/automation lọc đơn thu gom, không phải đọc note tự do. */
export const PANCAKE_TAG_RECYCLING = 'RECYCLING';
/** Đơn ĐÃ có vận đơn Gomdon — kho KHÔNG đặt thêm hãng vận chuyển khác (tránh giao 2 lần/thu COD 2 lần). */
export const PANCAKE_TAG_GOMDON = 'GOMDON';

/** Tiền của đơn với kho: thu COD, đã trả trước, đang chờ chuyển khoản hay ghi công nợ đại lý. */
export type PancakePaymentState = 'COD' | 'PAID' | 'AWAITING_TRANSFER' | 'AWAITING_GATEWAY' | 'CREDIT';

export const PANCAKE_PAYMENT_TAG: Record<PancakePaymentState, string> = {
  COD: 'COD',
  PAID: 'DA_THANH_TOAN',
  AWAITING_TRANSFER: 'CHO_CHUYEN_KHOAN',
  AWAITING_GATEWAY: 'CHO_THANH_TOAN',
  CREDIT: 'CONG_NO',
};

const METHOD_LABEL: Record<string, string> = {
  WALLET: 'VÍ TUBU',
  ZALOPAY: 'ZALOPAY',
  VNPAY: 'VNPAY',
  BANK_TRANSFER: 'CHUYỂN KHOẢN',
  XU: 'ĐIỂM',
};

export function pancakePaymentState(
  order: { paymentMethod: string; paymentStatus: string },
  onDealerCredit: boolean,
): PancakePaymentState {
  if (onDealerCredit) return 'CREDIT';
  if (order.paymentStatus === 'PAID') return 'PAID';
  if (!isPrepaidMethod(order.paymentMethod)) return 'COD';
  return order.paymentMethod === 'BANK_TRANSFER' ? 'AWAITING_TRANSFER' : 'AWAITING_GATEWAY';
}

/** Kho không thu tiền khi giao: đã trả trước hoặc đại lý ghi công nợ. */
export function isPancakePrepaid(state: PancakePaymentState): boolean {
  return state === 'PAID' || state === 'CREDIT';
}

export interface PancakeRecipient {
  name: string;
  phone: string;
  street: string;
  ward: string;
  district: string;
  province: string;
  provinceCode: string;
  districtCode: string;
  wardCode: string;
}

export interface PancakePushLine {
  id?: string;
  variationId: string;
  quantity: number;
  unitPrice: number;
  variationName?: string | null;
  productName?: string | null;
}

export interface PancakePushOrder {
  code: string;
  type: string;
  platform?: string | null;
  paymentMethod: string;
  paymentStatus: string;
  discount: number;
  shippingFee: number;
  total: number;
  invoiceRequest?: unknown;
  hasRecyclingPickup?: boolean | null;
  gomdonPartnerCode?: string | null;
  items: PancakePushLine[];
}

/**
 * Dòng nào do Tubu giao qua Pancake. Mặc định mọi dòng; dòng nhà bán tự giao (D4) được lọc bằng vị từ do
 * phần nhà bán cung cấp.
 */
export type PancakeLinePredicate = (line: PancakePushLine) => boolean;
export const ALL_LINES: PancakeLinePredicate = () => true;

export interface PancakeBodyContext {
  recipient: PancakeRecipient;
  /** variationId → mã biến thể Pancake + giá lẻ danh mục (đồng bộ từ Pancake). */
  variations: Map<string, { pancakeId: string | null; retailPrice: number | null }>;
  onDealerCredit: boolean;
  /** Phần ghi chú thu gom (đơn đổi hàng) — dựng riêng vì cần cân nặng từ DB. */
  recyclingNote?: string | null;
  isPancakeLine?: PancakeLinePredicate;
}

export interface PancakeBodyResult {
  body: PancakeCreateOrderBody;
  /** Tổng tiền phần đơn giao qua Pancake (= order.total khi mọi dòng do Tubu giao). */
  amountDue: number;
  /** Đơn Pancake đã mang thông tin không thu COD. */
  paymentSynced: boolean;
  paymentState: PancakePaymentState;
}

const vnd = (n: number) => `${n.toLocaleString('vi-VN')}đ`;

export function pancakePaymentNote(state: PancakePaymentState, paymentMethod: string, amountDue: number, cod: number): string {
  switch (state) {
    case 'PAID':
      return `[ĐÃ THANH TOÁN ${METHOD_LABEL[paymentMethod] ?? paymentMethod} ${vnd(amountDue)} - KHÔNG THU COD]`;
    case 'CREDIT':
      return '[ĐẠI LÝ GHI CÔNG NỢ - KHÔNG THU COD]';
    case 'AWAITING_TRANSFER':
      return `[CHỜ CHUYỂN KHOẢN ${vnd(amountDue)} - CHƯA GIAO, CHỜ TUBU XÁC NHẬN ĐÃ NHẬN TIỀN]`;
    case 'AWAITING_GATEWAY':
      return `[CHỜ THANH TOÁN ${METHOD_LABEL[paymentMethod] ?? paymentMethod} - CHƯA GIAO]`;
    default:
      return `[THU COD ${vnd(cod)}]`;
  }
}

export function pancakeTags(
  order: Pick<PancakePushOrder, 'type' | 'platform' | 'hasRecyclingPickup' | 'gomdonPartnerCode'>,
  state: PancakePaymentState,
): string[] {
  const tags = [order.platform === 'web' ? 'WEB' : 'MINIAPP', order.type === 'DEALER' ? 'DEALER' : 'RETAIL'];
  if (order.hasRecyclingPickup) {
    tags.push(PANCAKE_TAG_RECYCLING);
    if (order.gomdonPartnerCode) tags.push(PANCAKE_TAG_GOMDON);
  }
  tags.push(PANCAKE_PAYMENT_TAG[state]);
  return tags;
}

/** "Order code: <mã>" luôn đứng đầu — webhook Pancake và tra cứu đơn đọc mã từ đây. */
export function pancakeOrderNote(code: string, recyclingNote: string | null | undefined, paymentNote: string): string {
  return [`Order code: ${code}`, recyclingNote, paymentNote].filter(Boolean).join(' | ');
}

/**
 * Body tạo đơn Pancake. Giá: mỗi dòng gửi `retail_price` (giá lẻ danh mục, không thấp hơn giá bán) và giảm/đơn vị
 * về đúng đơn giá Tubu đã bán (flash, giá đại lý, giá sale); giảm cấp đơn (mã, combo, hạng, điểm) gom vào
 * `total_discount`, tính ngược từ tổng tiền đơn nên tổng Pancake luôn bằng số khách phải trả. Đơn trả trước/công nợ
 * gửi số đã trả để Pancake không thu COD lần nữa.
 */
export function buildPancakeOrderBody(order: PancakePushOrder, ctx: PancakeBodyContext): PancakeBodyResult {
  const isLine = ctx.isPancakeLine ?? ALL_LINES;
  const lines = order.items.filter(isLine);
  const value = (l: PancakePushLine) => l.unitPrice * l.quantity;
  const goodsAll = order.items.reduce((s, l) => s + value(l), 0);
  const goods = lines.reduce((s, l) => s + value(l), 0);
  const whole = lines.length === order.items.length;
  // Một phần dòng do nhà bán tự giao: phần giảm cấp đơn chia theo tỉ lệ giá trị hàng.
  const discountShare = whole || goodsAll === 0 ? order.discount : Math.round((order.discount * goods) / goodsAll);
  const amountDue = whole ? order.total : Math.max(0, goods - discountShare + order.shippingFee);

  const items: PancakeCreateOrderItem[] = lines.map((l) => {
    const v = ctx.variations.get(l.variationId);
    const retail = Math.max(v?.retailPrice ?? l.unitPrice, l.unitPrice);
    return {
      variation_id: v?.pancakeId ?? l.variationId,
      quantity: l.quantity,
      discount_each_product: retail - l.unitPrice,
      variation_info: { retail_price: retail },
    };
  });
  const listed = items.reduce((s, i) => s + (i.variation_info?.retail_price ?? 0) * i.quantity, 0);
  const lineDiscount = items.reduce((s, i) => s + (i.discount_each_product ?? 0) * i.quantity, 0);
  const totalDiscount = Math.max(0, listed - lineDiscount + order.shippingFee - amountDue);

  const state = pancakePaymentState(order, ctx.onDealerCredit);
  const prepaid = isPancakePrepaid(state) ? amountDue : 0;
  const cod = amountDue - prepaid;

  const r = ctx.recipient;
  // Hệ 2 cấp: district có thể rỗng → bỏ phần rỗng (tránh ", ,") và KHÔNG gửi id rỗng.
  const address = [r.street, r.ward, r.district, r.province].filter(Boolean).join(', ');
  // Hệ mới "84_VN*" không còn cấp quận: gửi kèm mã quận cũ là ghép phường mới với quận cũ.
  const districtId = isNewGeoCode(r.provinceCode) ? undefined : r.districtCode || undefined;
  const inv = order.invoiceRequest as { taxCode: string; companyName: string; address: string; email: string } | null | undefined;

  const body: PancakeCreateOrderBody = {
    bill_full_name: r.name,
    bill_phone_number: r.phone,
    shipping_address: {
      full_name: r.name,
      phone_number: r.phone,
      address: r.street || address,
      full_address: address,
      commune_id: r.wardCode || undefined,
      district_id: districtId,
      province_id: r.provinceCode || undefined,
    },
    // Không gửi fb_id: đó là Facebook ID — Zalo ID ở đây làm Pancake gộp nhầm khách, và đơn CTV lên hộ có user là
    // CTV chứ không phải người nhận.
    customer: {
      name: r.name,
      phone_number: r.phone,
      address,
      ward_id: r.wardCode || undefined,
      district_id: districtId,
      province_id: r.provinceCode || undefined,
    },
    items,
    shipping_fee: order.shippingFee,
    total_discount: totalDiscount,
    transfer_money: prepaid,
    cod,
    custom_id: order.code,
    tags: pancakeTags(order, state),
    note: pancakeOrderNote(order.code, ctx.recyclingNote, pancakePaymentNote(state, order.paymentMethod, amountDue, cod)),
    extension: {
      external_order_id: order.code,
      invoice_request: inv
        ? { tax_code: inv.taxCode, company_name: inv.companyName, address: inv.address, email: inv.email }
        : undefined,
    },
  };
  return { body, amountDue, paymentSynced: isPancakePrepaid(state), paymentState: state };
}
