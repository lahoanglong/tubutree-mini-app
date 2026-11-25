import { createHash, randomBytes } from 'node:crypto';
import { MSS_RECIPIENT_EVENT_TYPES, MSS_SENDER, type MssCancelReason, type MssOrderEventType, type MssPhoneSource } from './mss-order-event-types';

/**
 * Dựng thân yêu cầu `POST /order-events` (hợp đồng tubu-mss-order-events v1.2 mục 3.3) bằng cách GHÉP từng trường cho phép, không
 * lọc từ object đơn: địa chỉ, email, `userId`, `zaloId`, giá từng dòng, mã giảm giá, điểm… không có đường nào lọt vào. Thân được
 * tuần tự hoá MỘT lần ở đây và lưu nguyên chuỗi; mọi lần gửi lại dùng đúng các byte đó.
 */

/** Thân tối đa theo hợp đồng mục 3.1 (lớn hơn MSS trả 413). */
export const MSS_EVENT_BODY_MAX_BYTES = 8 * 1024;
const ORDER_CODE_MAX = 32;
const FIRST_ITEM_MAX = 60;
const NAME_MAX = 30;
const GROUP_CODE_MAX = 40;
const CARRIER_MAX = 40;
const TRACKING_CODE_MAX = 64;

/** Bill (năng lực `order_events.bill_v1`): tối đa 15 món theo `OrderItem.id` tăng dần, phần còn lại báo bằng `items_more`. MSS nhận tới 30. */
export const BILL_MAX_ITEMS = 15;
export const BILL_ITEM_NAME_MAX = 60;
export const BILL_VARIANT_MAX = 30;
const BILL_QTY_MAX = 9_999;
/** Link xem đơn tối đa (khớp `MSS_DETAIL_URL_MAX` của mss-order-link.ts; khai lại ở đây để file này không import gì của checkout). */
const BILL_LINK_MAX = 120;
/**
 * Thân có bill phải nằm dưới ngưỡng này, còn dư 2 KB dưới trần 8 KB của cả hai bên: vượt thì bỏ món từ cuối (tăng `items_more`), hết món mà
 * vẫn vượt thì bỏ hết khoá bill. Bill không bao giờ làm mất sự kiện.
 */
export const MSS_BILL_BODY_BUDGET_BYTES = 6_144;

export class MssEventBodyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MssEventBodyError';
  }
}

export interface MssEventBodyInput {
  eventId: string;
  eventType: MssOrderEventType;
  occurredAt: Date;
  sequence: number;
  order: {
    code: string;
    total: number;
    paymentMethod: string;
    platform: 'web' | 'miniapp';
    itemNames: readonly string[];
    shippingPartner?: string | null;
    shippingCode?: string | null;
    checkoutGroup?: string | null;
    groupSize?: number | null;
    /**
     * Link xem đơn đã dựng sẵn (`orderDetailUrl`). Có thì `tracking_url` (và `detail_url` khi có bill) dùng đúng chuỗi này, sai gốc hoặc dài quá
     * thì bỏ khoá link; vắng (undefined/null) thì `tracking_url` dựng đường dẫn tài khoản như v1.2.
     */
    linkUrl?: string | null;
  };
  /**
   * Hoá đơn cho MSS vẽ ảnh (năng lực `order_events.bill_v1`): chỉ có tác dụng ở `order.created`/`order.payment_confirmed` của người mua, loại khác
   * bỏ qua. Dòng người nhận mà có bill là lỗi lập trình: ném MssEventBodyError.
   */
  bill?: MssBillInput | null;
  cancelReason?: MssCancelReason;
  refundExpected?: boolean;
  /**
   * `role` vắng hoặc `buyer`: thân y hệt v1.2 (không có khoá `role`). `recipient` (PO A1): tin giao hàng cho số nhận hàng, gửi `total_vnd: 0`
   * và bỏ tên món, link theo dõi (trang có giá của người mua) và tên gọi.
   */
  recipient: { phone: string; phoneSource: MssPhoneSource; name?: string | null; role?: 'buyer' | 'recipient' };
  consent: { capturedAt: Date; source: 'checkout' | 'account_settings' };
  /** Gốc web Tubu đã đăng ký với MSS (`tubu_order_events_link_hosts`), null thì không gửi link. */
  linkOrigin: string | null;
}

export interface MssBillItemInput {
  name: string;
  variant: string | null;
  qty: number;
  unitPrice: number;
  lineTotal: number;
  gift: boolean;
}

export interface MssBillInput {
  subtotal: number;
  discount: number;
  shippingFee: number;
  items: readonly MssBillItemInput[];
}

export interface MssEventBody {
  json: string;
  sha256: string;
}

const isMoney = (n: unknown): n is number => Number.isInteger(n) && (n as number) >= 0;

/** Tiền bill khớp tổng đơn: tạm tính − giảm + phí ship = tổng. Lệch thì không gửi ba khoá tiền (MSS vẽ tổng sai còn tệ hơn không vẽ). */
export function billMoneyConsistent(total: number, bill: Pick<MssBillInput, 'subtotal' | 'discount' | 'shippingFee'>): boolean {
  return isMoney(bill.subtotal) && isMoney(bill.discount) && isMoney(bill.shippingFee) && bill.subtotal - bill.discount + bill.shippingFee === total;
}

/** Một món của bill theo hợp đồng bill_v1, hoặc null khi món không hợp lệ (cả danh sách món bị bỏ: MSS trả 422 cho cả sự kiện nếu gửi món sai). */
function billItem(it: MssBillItemInput): Record<string, string | number | boolean> | null {
  const name = clip(it.name ?? '', BILL_ITEM_NAME_MAX);
  if (!name || !Number.isInteger(it.qty) || it.qty < 1 || it.qty > BILL_QTY_MAX || !isMoney(it.unitPrice) || !isMoney(it.lineTotal)) return null;
  const out: Record<string, string | number | boolean> = { name };
  const variant = it.variant ? clip(it.variant, BILL_VARIANT_MAX) : '';
  if (variant) out.variant = variant;
  out.qty = it.qty;
  out.unit_vnd = it.unitPrice;
  out.line_vnd = it.lineTotal;
  if (it.gift === true) out.gift = true;
  return out;
}

/** Link nhận được: cùng gốc web đã đăng ký với MSS, không quá trần. Không thì null (bỏ khoá link, không bỏ tin). */
function linkOf(linkUrl: string, origin: string): string | null {
  return linkUrl.startsWith(`${origin}/`) && linkUrl.length <= BILL_LINK_MAX && !/\s/.test(linkUrl) ? linkUrl : null;
}

const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

/** ULID 26 ký tự (48 bit thời gian + 80 bit ngẫu nhiên, bảng chữ Crockford): sắp theo thời gian, khớp `[A-Za-z0-9_-]{16,64}` của hợp đồng. */
export function newEventId(now = Date.now()): string {
  let time = '';
  let t = now;
  for (let i = 0; i < 10; i++) {
    time = CROCKFORD[t % 32]! + time;
    t = Math.floor(t / 32);
  }
  const bytes = randomBytes(16);
  let rand = '';
  for (let i = 0; i < 16; i++) rand += CROCKFORD[bytes[i]! % 32];
  return time + rand;
}

/** ISO 8601 theo giờ Việt Nam, có múi giờ: `2026-11-16T14:05:09+07:00`. */
export function vnIso(d: Date): string {
  const shifted = new Date(d.getTime() + 7 * 3_600_000).toISOString();
  return `${shifted.slice(0, 19)}+07:00`;
}

/** Cắt theo ký tự (không theo đơn vị UTF-16) để không chẻ đôi một ký tự ngoài BMP. */
function clip(text: string, max: number): string {
  const chars = [...text.replace(/\s+/g, ' ').trim()];
  return chars.length <= max ? chars.join('') : chars.slice(0, max).join('').trimEnd();
}

/** Tên gọi để chào: chữ cuối của họ tên ("Nguyễn Thị Lan" → "Lan"); tên mặc định của khách vãng lai thì bỏ. */
export function greetingName(fullName: string | null | undefined): string | null {
  const name = (fullName ?? '').replace(/[<>]/g, '').replace(/\s+/g, ' ').trim();
  if (!name || name === 'Khách') return null;
  const last = name.split(' ').pop()!;
  return clip(last, NAME_MAX) || null;
}

export function contractPaymentMethod(method: string): 'COD' | 'PREPAID' {
  return method === 'COD' ? 'COD' : 'PREPAID';
}

export function buildMssEventBody(input: MssEventBodyInput): MssEventBody {
  const { order } = input;
  const code = order.code.trim();
  if (!code || code.length > ORDER_CODE_MAX) throw new MssEventBodyError(`Mã đơn không hợp lệ cho hợp đồng (dài ${code.length})`);
  if (!/^[A-Za-z0-9_-]{16,64}$/.test(input.eventId)) throw new MssEventBodyError('event_id không hợp lệ');
  if (!Number.isInteger(input.sequence) || input.sequence < 1) throw new MssEventBodyError('sequence phải là số nguyên ≥ 1');
  if (!Number.isInteger(order.total) || order.total < 0) throw new MssEventBodyError('Tổng tiền phải là số nguyên ≥ 0');
  if (order.itemNames.length < 1) throw new MssEventBodyError('Đơn không có dòng hàng');
  const forRecipient = input.recipient.role === 'recipient';
  if (forRecipient && !MSS_RECIPIENT_EVENT_TYPES.includes(input.eventType)) throw new MssEventBodyError(`Người nhận không có tin ${input.eventType}`);
  if (forRecipient && input.recipient.phoneSource !== 'checkout_contact') throw new MssEventBodyError('Tin người nhận phải có phone_source checkout_contact');
  if (forRecipient && input.bill) throw new MssEventBodyError('Tin người nhận không được kèm bill (giá của người mua)');

  // Link của người mua: gốc chưa đăng ký thì không link; có link dựng sẵn thì dùng đúng nó (sai thì bỏ), không thì đường dẫn tài khoản như v1.2.
  const link =
    !input.linkOrigin || forRecipient
      ? null
      : order.linkUrl
        ? linkOf(order.linkUrl, input.linkOrigin)
        : `${input.linkOrigin}/tai-khoan/don-hang/${encodeURIComponent(code)}`;

  const orderPart: Record<string, string | number | boolean | Record<string, string | number | boolean>[]> = {
    code,
    total_vnd: forRecipient ? 0 : order.total,
    payment_method: contractPaymentMethod(order.paymentMethod),
    channel: order.platform,
    item_count: order.itemNames.length,
  };
  const firstItem = forRecipient ? '' : clip(order.itemNames[0] ?? '', FIRST_ITEM_MAX);
  if (firstItem) orderPart.first_item_name = firstItem;
  if (input.eventType === 'order.shipping') {
    const carrier = order.shippingPartner ? clip(order.shippingPartner, CARRIER_MAX) : '';
    const trackingCode = order.shippingCode ? clip(order.shippingCode, TRACKING_CODE_MAX) : '';
    if (carrier) orderPart.carrier = carrier;
    if (trackingCode) orderPart.tracking_code = trackingCode;
    if (link) orderPart.tracking_url = link;
  }
  if (input.eventType === 'order.cancelled') {
    orderPart.cancel_reason = input.cancelReason ?? 'OTHER';
    orderPart.refund_expected = input.refundExpected === true;
  }
  if ((input.eventType === 'order.created' || input.eventType === 'order.payment_confirmed') && order.checkoutGroup) {
    const groupCode = order.checkoutGroup.trim();
    if (groupCode && groupCode.length <= GROUP_CODE_MAX && order.groupSize && order.groupSize >= 1) {
      orderPart.group_code = groupCode;
      orderPart.group_size = order.groupSize;
    }
  }

  const recipient: Record<string, string> = { phone: input.recipient.phone, phone_source: input.recipient.phoneSource };
  const name = input.recipient.name && !forRecipient ? clip(input.recipient.name, NAME_MAX) : '';
  if (name) recipient.name = name;
  if (forRecipient) recipient.role = 'recipient';

  const body = {
    event_id: input.eventId,
    event_type: input.eventType,
    occurred_at: vnIso(input.occurredAt),
    sequence: input.sequence,
    sender: MSS_SENDER,
    order: orderPart,
    recipient,
    consent: { order_updates_zalo: true, captured_at: vnIso(input.consent.capturedAt), source: input.consent.source },
  };
  const withBill = input.bill && (input.eventType === 'order.created' || input.eventType === 'order.payment_confirmed') ? input.bill : null;
  const json = withBill ? fitBill(body, orderPart, withBill, order, link) : JSON.stringify(body);
  if (Buffer.byteLength(json, 'utf8') > MSS_EVENT_BODY_MAX_BYTES) throw new MssEventBodyError('Thân sự kiện vượt 8 KB');
  return { json, sha256: createHash('sha256').update(json, 'utf8').digest('hex') };
}

/**
 * Nối khoá bill vào SAU các khoá v1.2 của `order` (thứ tự cũ giữ nguyên byte) và trả JSON không quá MSS_BILL_BODY_BUDGET_BYTES: bỏ món từ cuối,
 * tăng `items_more`; hết món mà vẫn vượt thì trả thân không bill. `orderPart` bị sửa tại chỗ (nó là của riêng lần dựng này).
 */
function fitBill(
  body: { order: Record<string, unknown> },
  orderPart: Record<string, unknown>,
  bill: MssBillInput,
  order: MssEventBodyInput['order'],
  link: string | null,
): string {
  const billKeys = ['detail_url', 'subtotal_vnd', 'discount_vnd', 'shipping_fee_vnd', 'items', 'items_more'] as const;
  const drop = () => {
    for (const k of billKeys) delete orderPart[k];
  };
  if (link) orderPart.detail_url = link;
  if (billMoneyConsistent(order.total, bill)) {
    orderPart.subtotal_vnd = bill.subtotal;
    orderPart.discount_vnd = bill.discount;
    orderPart.shipping_fee_vnd = bill.shippingFee;
  }
  const all = bill.items.slice(0, BILL_MAX_ITEMS).map(billItem);
  const items = all.every((it) => it !== null) ? (all as Record<string, string | number | boolean>[]) : [];
  const itemCount = order.itemNames.length;
  for (;;) {
    delete orderPart.items;
    delete orderPart.items_more;
    if (items.length > 0) {
      orderPart.items = items;
      const more = itemCount - items.length;
      if (more >= 1) orderPart.items_more = more;
    }
    const json = JSON.stringify(body);
    if (Buffer.byteLength(json, 'utf8') <= MSS_BILL_BODY_BUDGET_BYTES) return json;
    if (items.length === 0) break;
    items.pop();
  }
  drop();
  return JSON.stringify(body);
}
