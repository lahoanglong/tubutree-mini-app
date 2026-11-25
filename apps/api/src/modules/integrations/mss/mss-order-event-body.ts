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
  };
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

export interface MssEventBody {
  json: string;
  sha256: string;
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

  const orderPart: Record<string, string | number | boolean> = {
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
    if (input.linkOrigin && !forRecipient) orderPart.tracking_url = `${input.linkOrigin}/tai-khoan/don-hang/${encodeURIComponent(code)}`;
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
  const json = JSON.stringify(body);
  if (Buffer.byteLength(json, 'utf8') > MSS_EVENT_BODY_MAX_BYTES) throw new MssEventBodyError('Thân sự kiện vượt 8 KB');
  return { json, sha256: createHash('sha256').update(json, 'utf8').digest('hex') };
}
