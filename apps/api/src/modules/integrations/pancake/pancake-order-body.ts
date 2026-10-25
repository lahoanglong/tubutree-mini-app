import { isNewGeoCode } from './geo-code';
import { isPrepaidMethod } from '../../orders/order-transition';
import type { PancakeCreateOrderBody, PancakeCreateOrderItem } from './pancake.types';
import { isRealPancakeId } from './pancake-fulfilment';

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
  /** Ghi chú giao hàng khách nhập lúc đặt (Order.note) — kho và shipper đọc trên Pancake. */
  note?: string | null;
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
  /** Tên thẻ logic (pancakeTags); service đổi sang id thẻ có trong shop trước khi gửi. */
  tagNames: string[];
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

export const CUSTOMER_NOTE_MAX = 200;
/** Bằng trần của checkout.dto cho ghi chú thu gom tái chế để không cắt chữ khách đã được phép nhập. */
const RECYCLING_NOTE_MAX = 500;
export const CUSTOMER_PAYMENT_HINT_HIDDEN = '(đã ẩn nội dung thanh toán)';

/** Mỗi ký tự → một ký tự thường không dấu, giữ nguyên độ dài: vị trí khớp trên bản gấp cũng là vị trí trên chuỗi gốc. */
function foldKeepLength(s: string): string {
  let out = '';
  for (const ch of s) {
    const base = (ch === 'đ' || ch === 'Đ' ? 'd' : ch.normalize('NFD').charAt(0)).toLowerCase();
    out += base.length === ch.length ? base : ch;
  }
  return out;
}

const WORD_START = '(?<![\\p{L}\\p{N}_])';
const WORD_END = '(?![\\p{L}\\p{N}_])';
const MONEY_WORD = '(?:tien|cod|ho|phi)';
/**
 * Cụm khách tự viết kiểu chỉ dẫn thu tiền (trên bản đã gấp không dấu). Cụm dài đứng trước. Tránh từ dễ nhầm với lời dặn
 * giao hàng: "ck" một mình (= "chồng"), "lấy hộ" (nhờ người nhận hộ), "không lấy." (từ chối nhận), "dùng thử", "đã chuyển"
 * (chuyển nhà), "đã trả lời", "ngân hàng" (mốc địa chỉ).
 */
const PAYMENT_HINT = new RegExp(
  WORD_START +
    '(?:' +
    [
      `(?:khong|ko|k|kg|hong|hok|khoi|dung|mien)\\s+(?:can\\s+|duoc\\s+|phai\\s+)?thu(?:\\s+${MONEY_WORD})+`,
      '(?:khong|ko|k|kg|hong|hok|khoi|dung|mien)\\s+(?:can\\s+|duoc\\s+|phai\\s+)?lay(?:\\s+(?:tien|cod|phi))+',
      '(?:khong|ko|k|kg|hong|hok)\\s+(?:can\\s+|phai\\s+)?thu(?=\\s*(?:[^\\p{L}\\p{N}\\s]|$))',
      `(?:da|dc)\\s+(?:thanh\\s+toan|chuyen\\s+khoan|chuyen\\s+tien|chuyen\\s+ck|tra\\s+(?:tien|truoc|roi|du|het|bang)|tt|ck|bank(?:ing)?|nop\\s+tien)`,
      `thu(?:\\s+${MONEY_WORD})+`,
      'lay(?:\\s+(?:tien|cod|phi))+',
      'ck\\s+(?:roi|du|truoc)',
      'thanh\\s+toan',
      'chuyen\\s+khoan',
      'tra\\s+truoc',
      'cod',
      'zalo\\s*pay',
      'momo',
      'vn\\s*pay(?:\\s*qr)?',
      'shopee\\s*pay',
      'viettel\\s*(?:pay|money)',
      '(?:internet\\s+)?banking',
      '(?:pre)?paid',
    ].join('|') +
    ')' +
    WORD_END,
  'gu',
);
const HIDDEN_RUN = new RegExp(`${CUSTOMER_PAYMENT_HINT_HIDDEN.replace(/[()]/g, '\\$&')}(?:\\s+${CUSTOMER_PAYMENT_HINT_HIDDEN.replace(/[()]/g, '\\$&')})+`, 'g');

/**
 * Ẩn các cụm khách viết kiểu chỉ dẫn thu tiền ("ĐÃ THANH TOÁN", "KHÔNG THU COD", "đã ck"...): chỉ dẫn thu tiền duy nhất
 * kho/shipper được thấy là dấu của hệ thống ([THU COD …] / [ĐÃ THANH TOÁN …]) — chiêu ghi chú giả "đã trả" trên đơn COD.
 */
function hidePaymentHints(text: string): string {
  const folded = foldKeepLength(text);
  let out = '';
  let last = 0;
  for (const m of folded.matchAll(PAYMENT_HINT)) {
    out += text.slice(last, m.index) + CUSTOMER_PAYMENT_HINT_HIDDEN;
    last = m.index + m[0].length;
  }
  return (out + text.slice(last)).replace(HIDDEN_RUN, CUSTOMER_PAYMENT_HINT_HIDDEN);
}

/**
 * Lời khách tự viết (lời dặn giao hàng, ghi chú thu gom tái chế) đã làm sạch: một dòng, không có dấu tách " | " hay ngoặc vuông
 * của các dấu hệ thống, không mạo được "Order code:" (webhook đọc mã đơn từ note), không chứa chỉ dẫn thu tiền, cắt
 * CUSTOMER_NOTE_MAX ký tự. Rỗng → null.
 */
function sanitizeCustomerText(note: string | null | undefined, max = CUSTOMER_NOTE_MAX): string | null {
  const clean = hidePaymentHints(
    (note ?? '')
      .normalize('NFC')
      // eslint-disable-next-line no-control-regex
      .replace(/[\u0000-\u001f\u007f]+/g, ' ')
      .replace(/\|/g, '/')
      .replace(/\[/g, '(')
      .replace(/\]/g, ')')
      .replace(/order\s*code\s*:/gi, 'Mã đơn:')
      .replace(/\s+/g, ' ')
      .trim(),
  );
  if (!clean) return null;
  return clean.length > max ? `${clean.slice(0, max - 1).trimEnd()}…` : clean;
}

/** Lời dặn của khách cho kho/shipper, đã làm sạch (xem sanitizeCustomerText). Rỗng → null. */
export function customerDeliveryNote(note: string | null | undefined): string | null {
  const clean = sanitizeCustomerText(note);
  return clean ? `Khách dặn: ${clean}` : null;
}

/**
 * Đoạn " - Ghi chú: …" của ghi chú thu gom tái chế (ghi chú khách tự nhập lúc đặt, nằm trong ngoặc vuông của dấu hệ thống trên đơn
 * Pancake và trên vận đơn Gomdon) — cùng bộ lọc với lời dặn giao hàng để khách không mạo được dấu "[ĐÃ THANH TOÁN …]". Rỗng → ''.
 */
export function recyclingNoteDetail(note: string | null | undefined): string {
  const clean = sanitizeCustomerText(note, RECYCLING_NOTE_MAX);
  return clean ? ` - Ghi chú: ${clean}` : '';
}

/** "Order code: <mã>" luôn đứng đầu — webhook Pancake và tra cứu đơn đọc mã từ đây. */
export function pancakeOrderNote(
  code: string,
  recyclingNote: string | null | undefined,
  paymentNote: string,
  customerNote?: string | null,
): string {
  return [`Order code: ${code}`, recyclingNote, paymentNote, customerDeliveryNote(customerNote)].filter(Boolean).join(' | ');
}

/**
 * Body tạo đơn Pancake. Giá: mỗi dòng gửi `retail_price` (giá lẻ danh mục, không thấp hơn giá bán) và giảm/đơn vị
 * về đúng đơn giá Tubu đã bán (flash, giá đại lý, giá sale); giảm cấp đơn (mã, combo, hạng, điểm) gom vào
 * `total_discount`, tính ngược từ tổng tiền đơn nên tổng Pancake luôn bằng số khách phải trả. Đơn trả trước/công nợ
 * gửi số đã trả để Pancake không thu COD lần nữa.
 */
export function buildPancakeOrderBody(order: PancakePushOrder, ctx: PancakeBodyContext): PancakeBodyResult {
  const isLine = ctx.isPancakeLine ?? ALL_LINES;
  // Dòng không có mã biến thể Pancake thật (hàng đối tác tự giao, mã giả MCH_) không bao giờ tới kho — kể cả khi người gọi
  // quên lọc: gửi id nội bộ thay mã Pancake là kho nhận một dòng hàng không tồn tại.
  const lines = order.items.filter((l) => isLine(l) && isRealPancakeId(ctx.variations.get(l.variationId)?.pancakeId));
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
      variation_id: v!.pancakeId!,
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
    note: pancakeOrderNote(order.code, ctx.recyclingNote, pancakePaymentNote(state, order.paymentMethod, amountDue, cod), order.note),
    extension: {
      external_order_id: order.code,
      invoice_request: inv
        ? { tax_code: inv.taxCode, company_name: inv.companyName, address: inv.address, email: inv.email }
        : undefined,
    },
  };
  return { body, amountDue, paymentSynced: isPancakePrepaid(state), paymentState: state, tagNames: pancakeTags(order, state) };
}
