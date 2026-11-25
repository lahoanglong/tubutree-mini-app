import { createHash } from 'node:crypto';
import { cartExpiresAt, MSS_CART_LIVE_RESULTS, MSS_CART_RECOVERY_WINDOW_MS } from './mss-cart-event-types';
import { newEventId, vnIso } from './mss-order-event-body';
import { MSS_SENDER, type MssPhoneSource } from './mss-order-event-types';

/**
 * Dựng thân `POST /cart-events` (hợp đồng cart-events v1) bằng cách GHÉP đúng các khoá hợp đồng cho phép: MSS trả 422
 * `unexpected_field` cho mọi khoá lạ ở mọi tầng. Thân không có giá, link hay tên khách. Tuần tự hoá MỘT lần; mọi lần gửi lại dùng đúng
 * các byte đó.
 */

/** Hợp đồng: thân tối đa 4096 byte (lớn hơn MSS trả 413). */
export const MSS_CART_BODY_MAX_BYTES = 4096;
const EVENT_ID_RE = /^[A-Za-z0-9._:-]{8,64}$/;
const CART_REF_RE = /^[\x21-\x7e]{1,64}$/;
const ITEM_NAME_MAX = 120;
const CONSENT_SOURCE_MAX = 40;
const ITEM_COUNT_MAX = 9999;

export class MssCartBodyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MssCartBodyError';
  }
}

export interface MssCartBody {
  json: string;
  sha256: string;
}

export interface CartAbandonedBodyInput {
  eventId: string;
  occurredAt: Date;
  cart: { ref: string; updatedAt: Date; itemCount: number; firstItemName?: string | null };
  customer: { phone: string; phoneSource: MssPhoneSource };
  consent: { at: Date; source: string };
}

export interface CartRecoveredBodyInput {
  eventId: string;
  occurredAt: Date;
  cartRef: string;
}

/** Cắt theo ký tự (không theo đơn vị UTF-16) để không chẻ đôi một ký tự ngoài BMP. */
function clip(text: string, max: number): string {
  const chars = [...text.replace(/\s+/g, ' ').trim()];
  return chars.length <= max ? chars.join('') : chars.slice(0, max).join('').trimEnd();
}

function checkCommon(eventId: string, cartRef: string): void {
  if (!EVENT_ID_RE.test(eventId)) throw new MssCartBodyError('event_id không hợp lệ');
  if (!CART_REF_RE.test(cartRef)) throw new MssCartBodyError('cart.ref không hợp lệ');
}

function seal(body: object): MssCartBody {
  const json = JSON.stringify(body);
  if (Buffer.byteLength(json, 'utf8') > MSS_CART_BODY_MAX_BYTES) throw new MssCartBodyError('Thân sự kiện giỏ vượt 4 KB');
  return { json, sha256: createHash('sha256').update(json, 'utf8').digest('hex') };
}

export function buildCartAbandonedBody(input: CartAbandonedBodyInput): MssCartBody {
  checkCommon(input.eventId, input.cart.ref);
  if (input.cart.updatedAt.getTime() > input.occurredAt.getTime()) throw new MssCartBodyError('cart.updated_at sau occurred_at');
  if (!Number.isInteger(input.cart.itemCount) || input.cart.itemCount < 1) throw new MssCartBodyError('cart.item_count phải là số nguyên ≥ 1');
  if (!/^0[35789]\d{8}$/.test(input.customer.phone)) throw new MssCartBodyError('customer.phone không phải số di động Việt Nam');
  const source = clip(input.consent.source, CONSENT_SOURCE_MAX);
  if (!source) throw new MssCartBodyError('consent.source rỗng');

  const cart: Record<string, string | number> = {
    ref: input.cart.ref,
    updated_at: vnIso(input.cart.updatedAt),
    item_count: Math.min(input.cart.itemCount, ITEM_COUNT_MAX),
  };
  const firstItem = input.cart.firstItemName ? clip(input.cart.firstItemName, ITEM_NAME_MAX) : '';
  if (firstItem) cart.first_item_name = firstItem;

  return seal({
    event_id: input.eventId,
    type: 'cart.abandoned',
    sender: MSS_SENDER,
    occurred_at: vnIso(input.occurredAt),
    cart,
    customer: { phone: input.customer.phone, phone_source: input.customer.phoneSource },
    consent: { zalo_reminders: true, at: vnIso(input.consent.at), source },
  });
}

export function buildCartRecoveredBody(input: CartRecoveredBodyInput): MssCartBody {
  checkCommon(input.eventId, input.cartRef);
  return seal({
    event_id: input.eventId,
    type: 'cart.recovered',
    sender: MSS_SENDER,
    occurred_at: vnIso(input.occurredAt),
    cart: { ref: input.cartRef },
  });
}

export interface CartRecoveredRowInput {
  userId: string;
  cartRef: string;
  cartId: string;
  cartUpdatedAt: Date;
}

/**
 * Dòng `cart.recovered` chờ gửi: lệnh huỷ lần nhắc MSS đang giữ cho giỏ đó. Thân chỉ có mã giỏ (không SĐT, không tên), nên giữ được cả sau
 * khi tài khoản bị xoá. Sender (khách đặt đơn, giỏ trống, rút đồng ý) và xoá tài khoản cùng dựng bằng hàm này.
 */
export function cartRecoveredRow(input: CartRecoveredRowInput, now: Date) {
  const eventId = newEventId(now.getTime());
  const body = buildCartRecoveredBody({ eventId, occurredAt: now, cartRef: input.cartRef });
  return {
    eventId,
    type: 'cart.recovered',
    userId: input.userId,
    cartRef: input.cartRef,
    cartId: input.cartId,
    cartUpdatedAt: input.cartUpdatedAt,
    occurredAt: now,
    body: body.json,
    bodySha256: body.sha256,
    nextAttemptAt: now,
    expiresAt: cartExpiresAt('cart.recovered', input.cartUpdatedAt, now),
    createdAt: now,
  };
}

/**
 * `cart.abandoned` mà MSS có thể đang giữ (lần nhắc chưa quá cửa sổ 48 giờ): đang gửi dở, hoặc MSS đã nhận với mã còn sống hay mã không đọc
 * được (null). Đây là các dòng cần lệnh huỷ khi khách thôi đủ điều kiện nhận tin.
 */
export function cartHeldByMssWhere(userId: string, now: Date) {
  return {
    userId,
    type: 'cart.abandoned',
    cartUpdatedAt: { gte: new Date(now.getTime() - MSS_CART_RECOVERY_WINDOW_MS) },
    OR: [{ status: 'SENDING' }, { status: 'ACCEPTED', OR: [{ resultStatus: { in: [...MSS_CART_LIVE_RESULTS] } }, { resultStatus: null }] }],
  };
}
