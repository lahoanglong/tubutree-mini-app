import { orderCopy } from '../account-copy';
import { fillCopy } from '../shop-copy';
import { vnd } from './money';
import { NO_PAYMENT_WAIT, shippingEvents, shortDateTime, type TrackEvent, type TrackOrder } from './order-tracking';

/**
 * Thanh tiến trình 4 bước của đơn (Đã tiếp nhận, Đang chuẩn bị, Đang giao hàng, Hoàn tất) và đoạn tóm tắt đơn để khách chép gửi người thân hoặc CSKH.
 * Bản tóm lược của `orderTrack` (5 bước kèm mốc hãng vận chuyển, ở `order-tracking.ts`): thanh này chỉ cho khách thấy đơn đang ở đâu trong một cái nhìn.
 */

export type OrderTimelineKey = 'received' | 'preparing' | 'shipping' | 'delivered' | 'cancelled' | 'returned';
/** `cancelled` là trạng thái của bước nhánh (Đã huỷ, Đã hoàn trả), không phải bước chưa làm. */
export type OrderTimelineState = 'completed' | 'current' | 'upcoming' | 'cancelled';

export interface OrderTimelineStamps {
  createdAt?: string;
  confirmedAt?: string;
  shippingAt?: string;
  deliveredAt?: string;
  /** Giờ huỷ; với đơn hoàn trả là giờ hoàn trả (bước nhánh cuối). */
  cancelledAt?: string;
}

export interface OrderTimelineStep {
  key: OrderTimelineKey;
  label: string;
  state: OrderTimelineState;
  /** Giờ bước đã tới (ISO); bước chưa tới hoặc thiếu mốc thì null. */
  at: string | null;
}

const MAIN_KEYS = ['received', 'preparing', 'shipping', 'delivered'] as const;
type MainKey = (typeof MAIN_KEYS)[number];

const STAMP_OF: Record<MainKey, keyof OrderTimelineStamps> = {
  received: 'createdAt',
  preparing: 'confirmedAt',
  shipping: 'shippingAt',
  delivered: 'deliveredAt',
};

/** Bước đang diễn ra ứng với trạng thái đơn (chỉ số trong `MAIN_KEYS`); `MAIN_KEYS.length` nghĩa là đã giao xong. Trạng thái lạ coi như vừa nhận. */
function currentIndex(status: string): number {
  switch (status) {
    case 'CONFIRMED':
    case 'PACKED':
      return 1;
    case 'SHIPPING':
      return 2;
    case 'DELIVERED':
      return MAIN_KEYS.length;
    default:
      return 0;
  }
}

const label = (key: OrderTimelineKey) => fillCopy(`order.timeline.${key}`);

/**
 * Các bước của đơn kèm trạng thái từng bước. Đơn huỷ hoặc hoàn trả rẽ nhánh: giữ những bước đã qua rồi thêm bước cuối Đã huỷ (hoặc Đã hoàn trả).
 * Đơn huỷ chỉ giữ bước có bằng chứng đã qua: bước có mốc giờ, hoặc có bước sau nó (trừ Hoàn tất) đã có mốc giờ. Đơn COD không có dòng lịch sử Đã xác nhận,
 * nên đơn đã giao hãng rồi mới huỷ vẫn phải hiện Đang chuẩn bị dù bước ấy thiếu giờ.
 */
export function buildOrderTimelineSteps(status: string, timestamps: OrderTimelineStamps = {}): OrderTimelineStep[] {
  const stamp = (key: MainKey): string | null => timestamps[STAMP_OF[key]] ?? null;

  if (status === 'CANCELLED') {
    const beforeDelivered = MAIN_KEYS.slice(0, -1);
    const passed = MAIN_KEYS.filter((k, i) => i === 0 || (k !== 'delivered' && beforeDelivered.slice(i).some((later) => stamp(later) !== null)));
    return [
      ...passed.map<OrderTimelineStep>((k) => ({ key: k, label: label(k), state: 'completed', at: stamp(k) })),
      { key: 'cancelled', label: label('cancelled'), state: 'cancelled', at: timestamps.cancelledAt ?? null },
    ];
  }

  const returned = status === 'RETURNED';
  const current = returned ? MAIN_KEYS.length : currentIndex(status);
  const steps = MAIN_KEYS.map<OrderTimelineStep>((k, i) => {
    const state: OrderTimelineState = i < current ? 'completed' : i === current ? 'current' : 'upcoming';
    return { key: k, label: label(k), state, at: state === 'upcoming' ? null : stamp(k) };
  });
  if (returned) steps.push({ key: 'returned', label: label('returned'), state: 'cancelled', at: timestamps.cancelledAt ?? null });
  return steps;
}

/**
 * Mốc giờ của đơn theo dạng `buildOrderTimelineSteps` cần, lấy từ `createdAt`, `deliveredAt` và sổ `statusTimes` API trả (khoá là trạng thái đơn).
 * Đơn COD và ví tạo thẳng ở Đã xác nhận nên sổ không có dòng cho bước ấy: lấy giờ Đã đóng gói, không có thì (đơn còn đi tiếp) giờ đặt; đơn huỷ không đoán giờ.
 */
export function orderTimelineStamps(o: {
  createdAt: string;
  status?: string;
  paymentMethod?: string;
  deliveredAt?: string | null;
  statusTimes?: Partial<Record<string, string>> | null;
}): OrderTimelineStamps {
  const times = o.statusTimes ?? {};
  const out: OrderTimelineStamps = { createdAt: o.createdAt };
  const startsConfirmed = o.status !== 'CANCELLED' && NO_PAYMENT_WAIT.has(o.paymentMethod ?? '');
  const confirmed = times.CONFIRMED ?? times.PACKED ?? (startsConfirmed ? o.createdAt : undefined);
  if (confirmed) out.confirmedAt = confirmed;
  if (times.SHIPPING) out.shippingAt = times.SHIPPING;
  const delivered = o.deliveredAt ?? times.DELIVERED;
  if (delivered) out.deliveredAt = delivered;
  const closed = times.CANCELLED ?? times.RETURNED;
  if (closed) out.cancelledAt = closed;
  return out;
}

export interface OrderShareInput {
  code: string;
  items: readonly { name: string; quantity: number }[];
  totalAmount: number;
  trackingUrl?: string | null;
}

/** Số dòng món tối đa trong đoạn tóm tắt; đơn dài hơn ghi "và n sản phẩm khác" cho tin nhắn không dài như hoá đơn. */
const SHARE_MAX_ITEMS = 8;

/** Bỏ dấu chấm than (chữ gian hàng không dùng, tên món do khách hàng đặt có thể có) và gộp khoảng trắng. */
const tidy = (s: string): string => s.replace(/!/g, '').replace(/\s+/g, ' ').trim();

/** Đoạn chữ thuần để khách dán vào Zalo: mã đơn, từng món kèm số lượng, tổng tiền, link theo dõi (nếu có). */
export function formatOrderShareSummary(order: OrderShareInput): string {
  const lines = order.items
    .map((it) => ({ name: tidy(it.name), quantity: it.quantity }))
    .filter((it) => it.name !== '' && Number.isInteger(it.quantity) && it.quantity > 0);
  const shown = lines.slice(0, SHARE_MAX_ITEMS).map((it) => fillCopy('order.share.item', { name: it.name, qty: it.quantity }));
  const rest = lines.length - SHARE_MAX_ITEMS;
  const out = [fillCopy('order.share.title', { code: order.code }), ...shown];
  if (rest > 0) out.push(fillCopy('order.share.more', { n: rest }));
  out.push(fillCopy('order.share.total', { amount: vnd(order.totalAmount) }));
  if (order.trackingUrl) out.push(fillCopy('order.share.track', { url: order.trackingUrl }));
  return out.join('\n');
}

/**
 * Một dòng thời gian cho chi tiết đơn (cờ `orders.timeline_v2_enabled`): 4 bước của thanh tiến trình, mỗi bước kèm giờ, ngày giao dự kiến ở bước
 * đang diễn ra, mốc hãng vận chuyển gập dưới "Đang giao hàng", dòng phụ "đã báo qua Zalo/ZNS" và lời báo khi hãng lâu không cập nhật.
 * Chỉ đọc dữ liệu API đã trả: không tự chuyển bước, không đoán mốc.
 */

export type OrderNoticeChannel = 'ZALO' | 'ZNS';

/** Một tin đã tới khách ngoài ứng dụng (`notices` của GET /orders/:code): loại sự kiện đơn, kênh, giờ gửi. */
export interface OrderNotice {
  event: string;
  channel: OrderNoticeChannel;
  at: string;
}

/** Sự kiện đơn gửi MSS (hợp đồng tubu-mss-order-events) ứng với bước nào của dòng thời gian. Đơn trả tiền trước: "đã nhận tiền" là lúc đơn sang Đang chuẩn bị. */
const NOTICE_STEP: Readonly<Record<string, OrderTimelineKey>> = {
  'order.created': 'received',
  'order.payment_confirmed': 'preparing',
  'order.shipping': 'shipping',
  'order.delivered': 'delivered',
  'order.cancelled': 'cancelled',
};

export function orderNoticeStep(event: unknown): OrderTimelineKey | null {
  return typeof event === 'string' && Object.prototype.hasOwnProperty.call(NOTICE_STEP, event) ? NOTICE_STEP[event]! : null;
}

/** Đọc `notices` từ API; dòng lạ (kênh khác, giờ hỏng, sự kiện không có bước) bị bỏ. API cũ không trả thì mảng rỗng. */
export function orderNotices(raw: unknown): OrderNotice[] {
  if (!Array.isArray(raw)) return [];
  const out: OrderNotice[] = [];
  for (const n of raw) {
    if (!n || typeof n !== 'object') continue;
    const { event, channel, at } = n as Record<string, unknown>;
    if (orderNoticeStep(event) === null || (channel !== 'ZALO' && channel !== 'ZNS') || typeof at !== 'string' || Number.isNaN(Date.parse(at))) continue;
    out.push({ event: event as string, channel, at });
  }
  return out;
}

/** "Đã báo qua Zalo · 14:02 18/11" (MSS gửi xong) hoặc "Đã báo qua ZNS · …" (đường lui ZNS); giờ Việt Nam, kèm ngày như giờ của từng bước. */
export function orderNoticeLine(n: Pick<OrderNotice, 'channel' | 'at'>, now: number = Date.now()): string {
  return fillCopy(n.channel === 'ZALO' ? 'order.journey.noticeZalo' : 'order.journey.noticeZns', { time: shortDateTime(n.at, now) });
}

/** Mặc định của `orders.tracking_stale_hours`; số thật do API trả kèm đơn. */
export const TRACKING_STALE_HOURS_DEFAULT = 72;

const HOUR_MS = 3_600_000;

/**
 * Đơn đang giao mà quá `staleHours` giờ không có mốc mới (giờ chuyển Đang giao hoặc mốc hãng mới nhất): khách cần biết dữ liệu đang đứng yên,
 * không phải đơn đứng yên. API không trả số giờ (API cũ, cờ tắt) hoặc không có mốc giờ nào thì không kết luận.
 */
export function trackingStale(
  o: { status: string; statusTimes?: Partial<Record<string, string>> | null },
  events: readonly { at: string | null }[],
  staleHours: unknown,
  now: number = Date.now(),
): boolean {
  if (o.status !== 'SHIPPING' || typeof staleHours !== 'number' || !Number.isInteger(staleHours) || staleHours <= 0) return false;
  const times = [o.statusTimes?.SHIPPING ?? null, ...events.map((e) => e.at)].map((t) => (t ? Date.parse(t) : Number.NaN)).filter((t) => !Number.isNaN(t));
  if (times.length === 0) return false;
  return now - Math.max(...times) > staleHours * HOUR_MS;
}

export interface OrderJourneyStep extends OrderTimelineStep {
  /** "Dự kiến giao 20/11 – 22/11", chỉ ở bước đang diễn ra. */
  eta: string | null;
  /** Mốc hãng vận chuyển (mới nhất trên cùng), chỉ ở một bước. */
  events: TrackEvent[];
  /** Dòng "Đã báo qua Zalo · 14:02"; chỉ ở bước đã tới. */
  notice: string | null;
  /** Bước Đang giao hàng chờ hãng cập nhật quá lâu. */
  stale: boolean;
}

export interface OrderJourneyView {
  steps: OrderJourneyStep[];
  hasCarrierEvents: boolean;
}

export interface OrderJourneyOrder {
  status: string;
  createdAt: string;
  paymentMethod?: string;
  deliveredAt?: string | null;
  statusTimes?: Partial<Record<string, string>> | null;
  shippingHistory?: TrackOrder['shippingHistory'];
  notices?: unknown;
  trackingStaleHours?: unknown;
}

/** Số mốc hãng mở sẵn dưới bước Đang giao hàng; còn lại sau nút "Xem đủ". */
export const JOURNEY_EVENTS_OPEN = 2;

/**
 * Dựng dòng thời gian một khối. Mốc hãng nằm dưới Đang giao hàng khi đơn đã tới bước đó; hãng quét trước khi đơn chuyển Đang giao (kho vừa bàn giao)
 * thì nằm dưới bước đang diễn ra; đơn huỷ/hoàn chưa qua Đang giao thì nằm dưới bước nhánh cuối.
 */
export function buildOrderJourney(o: OrderJourneyOrder, ctx: { etaLabel?: string | null; now?: number } = {}): OrderJourneyView {
  const now = ctx.now ?? Date.now();
  const base = buildOrderTimelineSteps(o.status, orderTimelineStamps({ ...o, statusTimes: o.statusTimes ?? null }));
  const events = shippingEvents(o.shippingHistory);
  const reached = (s: OrderTimelineStep) => s.state !== 'upcoming';
  const shipping = base.find((s) => s.key === 'shipping' && reached(s));
  const holder = shipping ?? base.find((s) => s.state === 'current') ?? [...base].reverse().find(reached) ?? null;
  const latestNotice = new Map<OrderTimelineKey, OrderNotice>();
  for (const n of orderNotices(o.notices)) {
    const step = orderNoticeStep(n.event)!;
    const prev = latestNotice.get(step);
    if (!prev || Date.parse(n.at) > Date.parse(prev.at)) latestNotice.set(step, n);
  }
  const stale = trackingStale(o, events, o.trackingStaleHours, now);
  const steps = base.map<OrderJourneyStep>((s) => {
    const notice = reached(s) ? latestNotice.get(s.key) : undefined;
    return {
      ...s,
      eta: s.state === 'current' && ctx.etaLabel ? orderCopy.etaLine(ctx.etaLabel) : null,
      events: s === holder ? events : [],
      notice: notice ? orderNoticeLine(notice, now) : null,
      stale: s.key === 'shipping' && s.state === 'current' && stale,
    };
  });
  return { steps, hasCarrierEvents: events.length > 0 };
}
