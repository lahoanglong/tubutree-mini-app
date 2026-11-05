import { orderCopy } from '../account-copy';
import { journeyEventLabel, journeyEvents } from '../shipping-events';
import { fillCopy } from '../shop-copy';

/**
 * Trang theo dõi đơn của khách (Mini App và web): đơn đang ở đâu, bao giờ tới, làm được gì lúc này. Mọi điều kiện lấy từ dữ liệu
 * API đã trả (trạng thái, cờ `canCancel`, `manualHandling`, mốc giao, hạn thanh toán, dòng đã đánh giá), không đoán thêm. Hai app chỉ vẽ.
 */

const DAY_MS = 86_400_000;
const VN_OFFSET_MS = 7 * 3_600_000;
const pad2 = (n: number) => String(n).padStart(2, '0');

export interface TrackItem {
  id?: string | null;
  productSlug?: string | null;
  productPublic?: boolean;
  reviewId?: string | null;
  reviewable?: boolean;
  backorderedQty?: number | null;
}

export interface TrackOrder {
  status: string;
  createdAt: string;
  updatedAt?: string | null;
  deliveredAt?: string | null;
  type?: string | null;
  paymentMethod: string;
  paymentStatus?: string | null;
  paymentDeadline?: string | null;
  manualHandling?: boolean | null;
  canCancel?: boolean | null;
  placedForCustomer?: boolean | null;
  referrerUserId?: string | null;
  statusTimes?: Partial<Record<string, string>>;
  shippingCode?: string | null;
  gomdonOrderId?: string | null;
  gomdonPartnerCode?: string | null;
  gomdonStatus?: string | null;
  hasRecyclingPickup?: boolean | null;
  shippingHistory?: readonly ({ at?: string | null; status?: string | null; code?: string | null } | null | undefined)[] | null;
  items?: readonly TrackItem[] | null;
}

export interface TrackCtx {
  /** Giờ hiện tại (ms); thiếu thì `Date.now()`. */
  now?: number;
  userId?: string | null;
  /** Khoảng ngày giao dự kiến đã ghép ("30/10 – 01/11"). */
  etaLabel?: string | null;
  /** Số ngày được đổi/trả kể từ khi giao; thiếu thì 7 như cấu hình mặc định. */
  returnDays?: number;
  /** Chữ đếm ngược tới hạn thanh toán ("2 giờ 05 phút"), do hook đếm ngược của app tính (giờ máy chủ). */
  deadlineLeft?: string;
  /** Đơn đã có yêu cầu đổi/trả đang chờ duyệt. */
  pendingReturn?: boolean;
  /** Còn dòng nào chưa trả hết số lượng. Chưa biết (chưa tải) thì để trống: coi như còn. */
  returnableLeft?: boolean;
}

export type OrderStage =
  | 'PAY_WAIT'
  | 'PAY_MANUAL'
  | 'PAY_OVERDUE'
  | 'CONFIRMED'
  | 'PACKED'
  | 'CARRIER_BOOKED'
  | 'SHIPPING'
  | 'DELIVERED'
  | 'CANCELLED'
  | 'RETURNED'
  | 'OTHER';

/** Kho đã đặt hãng cho đơn (Pancake gắn mã vận đơn hãng lúc in phiếu) dù đơn chưa chuyển "Đang giao". Mã thu gom của Gomdon không tính. */
function carrierBooked(o: TrackOrder): boolean {
  if (o.status !== 'CONFIRMED' && o.status !== 'PACKED') return false;
  return !!o.shippingCode && o.shippingCode !== o.gomdonOrderId && o.shippingCode !== o.gomdonPartnerCode;
}

/** Bưu tá Gomdon đã cầm hàng (mã số khác 1/2/10): luật dự phòng khi API chưa trả `canCancel`. */
function recyclingPickedUp(status: string | null | undefined): boolean {
  if (!status || !/^\d+$/.test(status)) return false;
  return !['1', '2', '10'].includes(status);
}

const deadlineMs = (o: TrackOrder): number => (o.paymentDeadline ? Date.parse(o.paymentDeadline) : Number.NaN);

/** Đơn chuyển khoản còn chờ tiền, Tubu chưa nhận xử lý tay và chưa quá hạn. Không có hạn (hoặc hạn không đọc được) thì còn trả được. */
export function canPayOrder(o: TrackOrder, now: number = Date.now()): boolean {
  if (o.status !== 'PENDING_PAYMENT' || o.paymentMethod !== 'BANK_TRANSFER' || o.manualHandling) return false;
  const deadline = deadlineMs(o);
  return Number.isNaN(deadline) || deadline > now;
}

/**
 * Khách tự huỷ được không, chỉ để không bày nút chắc chắn bị từ chối; máy chủ vẫn quyết. API trả `canCancel` thì theo đó; API cũ thì
 * tự xét: tới trước khi bàn giao vận chuyển (đơn đại lý chỉ tới Đã xác nhận), kho chưa đặt hãng, Tubu không xử lý tay, bưu tá thu gom
 * chưa lấy hàng, đơn CTV lên hộ khách đã trả tiền chỉ quản trị huỷ.
 */
export function canCancelOrder(o: TrackOrder, userId?: string | null): boolean {
  const cancellable = o.type === 'DEALER' ? ['PENDING_PAYMENT', 'CONFIRMED'] : ['PENDING_PAYMENT', 'CONFIRMED', 'PACKED'];
  if (!cancellable.includes(o.status)) return false;
  if (typeof o.canCancel === 'boolean') return o.canCancel;
  if (o.manualHandling) return false;
  if (o.placedForCustomer && o.paymentStatus === 'PAID' && !!userId && o.referrerUserId === userId) return false;
  if (o.hasRecyclingPickup && recyclingPickedUp(o.gomdonStatus)) return false;
  return !carrierBooked(o);
}

/** Hạn đổi/trả còn mở không, cùng cách tính của máy chủ: mốc giao, thiếu thì `updatedAt`. Không có mốc nào thì để máy chủ quyết (coi như còn). */
export function returnWindowOpen(o: TrackOrder, days: number, now: number = Date.now()): boolean {
  const base = o.deliveredAt ?? o.updatedAt;
  if (!base) return true;
  return Date.parse(base) + days * DAY_MS > now;
}

export function orderStage(o: TrackOrder, now: number = Date.now()): OrderStage {
  switch (o.status) {
    case 'PENDING_PAYMENT': {
      if (o.manualHandling) return 'PAY_MANUAL';
      const deadline = deadlineMs(o);
      return !Number.isNaN(deadline) && deadline <= now ? 'PAY_OVERDUE' : 'PAY_WAIT';
    }
    case 'CONFIRMED':
    case 'PACKED':
      return carrierBooked(o) ? 'CARRIER_BOOKED' : o.status === 'CONFIRMED' ? 'CONFIRMED' : 'PACKED';
    case 'SHIPPING':
    case 'DELIVERED':
    case 'CANCELLED':
    case 'RETURNED':
      return o.status;
    default:
      return 'OTHER';
  }
}

/** "18:48 05/11" theo giờ Việt Nam (UTC+7 quanh năm), không phụ thuộc múi giờ máy; khác năm với `now` thì thêm năm ("18:48 05/11/2025"). */
export function shortDateTime(iso: string, now: number = Date.now()): string {
  const d = new Date(Date.parse(iso) + VN_OFFSET_MS);
  const year = d.getUTCFullYear() === new Date(now + VN_OFFSET_MS).getUTCFullYear() ? '' : `/${d.getUTCFullYear()}`;
  return `${pad2(d.getUTCHours())}:${pad2(d.getUTCMinutes())} ${pad2(d.getUTCDate())}/${pad2(d.getUTCMonth() + 1)}${year}`;
}

const dayMonth = (ms: number): string => {
  const d = new Date(ms + VN_OFFSET_MS);
  return `${pad2(d.getUTCDate())}/${pad2(d.getUTCMonth() + 1)}`;
};

/** Dòng đầu tiên chưa có đánh giá mà khách viết được: còn trang sản phẩm, mua lẻ cho chính mình (API cũ chưa trả `reviewable` thì coi là viết được). */
export function pendingReviewItem(o: TrackOrder): TrackItem | null {
  if (o.status !== 'DELIVERED') return null;
  return (o.items ?? []).find((it) => !!it.productSlug && it.productPublic !== false && !it.reviewId && it.reviewable !== false) ?? null;
}

export interface OrderHeadline {
  stage: OrderStage;
  /** Một câu nói đơn đang ở đâu. */
  sentence: string;
  /** Mốc cần biết: ngày giao dự kiến, hạn thanh toán, hạn đổi/trả. */
  milestone: string | null;
  /** Bước kế tiếp của khách (hoặc của Tubu). */
  next: string | null;
}

const SENTENCE: Record<OrderStage, string | null> = {
  PAY_WAIT: 'order.sentence.payWait',
  PAY_MANUAL: 'order.sentence.payManual',
  PAY_OVERDUE: 'order.sentence.payOverdue',
  CONFIRMED: 'order.sentence.confirmed',
  PACKED: 'order.sentence.packed',
  CARRIER_BOOKED: 'order.sentence.carrierBooked',
  SHIPPING: 'order.sentence.shipping',
  DELIVERED: 'order.sentence.delivered',
  CANCELLED: 'order.sentence.cancelled',
  RETURNED: 'order.sentence.returned',
  OTHER: null,
};

export function orderHeadline(o: TrackOrder, ctx: TrackCtx = {}): OrderHeadline {
  const now = ctx.now ?? Date.now();
  const stage = orderStage(o, now);
  const key = SENTENCE[stage];
  const sentence = key ? fillCopy(key) : '';
  const days = ctx.returnDays ?? 7;
  const eta = ctx.etaLabel ? orderCopy.etaLine(ctx.etaLabel) : null;

  let milestone: string | null = null;
  let next: string | null = null;
  switch (stage) {
    case 'PAY_WAIT': {
      if (o.paymentDeadline && !Number.isNaN(deadlineMs(o))) {
        const at = shortDateTime(o.paymentDeadline, now);
        milestone = ctx.deadlineLeft ? fillCopy('order.payByLeft', { at, t: ctx.deadlineLeft }) : fillCopy('order.payBy', { at });
      }
      next = fillCopy('order.next.payWait');
      break;
    }
    case 'PAY_OVERDUE':
      next = fillCopy('order.next.payOverdue');
      break;
    case 'CONFIRMED':
    case 'PACKED':
      milestone = eta;
      next = canCancelOrder(o, ctx.userId) ? fillCopy('order.next.cancelable') : null;
      break;
    case 'CARRIER_BOOKED':
      milestone = eta;
      // Hãng mới gắn mã vận đơn, hàng chưa tới tay bưu tá: không nói "đã giao cho đơn vị vận chuyển" (trái với "hàng sắp được lấy").
      next = fillCopy('order.next.carrierBooked');
      break;
    case 'SHIPPING':
      milestone = eta;
      next = `${fillCopy('order.next.handed')} ${fillCopy('order.next.shipping', { n: days })}`;
      break;
    case 'DELIVERED': {
      const base = o.deliveredAt ?? o.updatedAt;
      if (base && !Number.isNaN(Date.parse(base))) {
        milestone = returnWindowOpen(o, days, now) ? fillCopy('order.returnUntil', { date: dayMonth(Date.parse(base) + days * DAY_MS) }) : fillCopy('order.returnClosed');
      }
      next = pendingReviewItem(o) ? fillCopy('order.next.review') : null;
      break;
    }
    case 'CANCELLED':
      next = o.paymentStatus === 'PAID' || o.paymentStatus === 'REFUNDED' ? fillCopy('order.next.refund') : fillCopy('order.next.rebuy');
      break;
    case 'RETURNED':
      next = fillCopy('order.next.refund');
      break;
    default:
      break;
  }
  return { stage, sentence, milestone, next };
}

export interface TrackEvent {
  label: string;
  at: string | null;
  /** Mốc mới nhất (đứng đầu danh sách). */
  latest: boolean;
}

/**
 * Các mốc vận chuyển hãng ghi vào đơn (Pancake, Gomdon), mới nhất trên cùng. Hãng hay bắn lại cùng một trạng thái: các mốc liền
 * nhau cùng chữ gộp thành một, giữ giờ lúc trạng thái bắt đầu (mốc sớm nhất trong cụm), vì khách muốn biết hàng tới chặng đó khi nào.
 */
export function shippingEvents(history: TrackOrder['shippingHistory']): TrackEvent[] {
  const newestFirst = journeyEvents((history ?? []).map((e) => e ?? null) as { at?: string | null; status?: string | null; code?: string | null }[]);
  const out: Omit<TrackEvent, 'latest'>[] = [];
  for (const ev of newestFirst) {
    const label = journeyEventLabel(ev);
    const prev = out[out.length - 1];
    if (prev && prev.label === label) {
      prev.at = ev.at ?? prev.at;
      continue;
    }
    out.push({ label, at: ev.at ?? null });
  }
  return out.map((e, i) => ({ ...e, latest: i === 0 }));
}

const STEPS = ['PENDING_PAYMENT', 'CONFIRMED', 'PACKED', 'SHIPPING', 'DELIVERED'] as const;
/** COD và Ví Tubu không bao giờ chờ thanh toán (trả khi nhận hàng, hoặc trừ ví ngay lúc đặt), nên bỏ bước đầu. */
const NO_PAYMENT_WAIT = new Set(['COD', 'WALLET']);

export type TrackState = 'done' | 'current' | 'upcoming';

export interface TrackStep {
  key: string;
  label: string;
  state: TrackState;
  /** Giờ bước đã tới; bước chưa tới thì null. Bước đầu thiếu dòng lịch sử thì lấy giờ đặt. */
  at: string | null;
  /** Ngày giao dự kiến, chỉ ở bước cuối khi chưa có giờ giao. */
  eta: string | null;
  /** Mốc vận chuyển, mới nhất trên cùng; chỉ có ở bước "Đang giao" (hoặc bước hiện tại khi hãng đã nhận mà đơn chưa chuyển Đang giao). */
  events: TrackEvent[];
}

export interface OrderTrackView {
  steps: TrackStep[];
  current: number;
}

/** Hành trình 5 bước chuẩn; đơn đã huỷ hoặc hoàn nằm ngoài đường này nên trả null (trạng thái đã có ở đầu trang). */
export function orderTrack(o: TrackOrder, ctx: Pick<TrackCtx, 'etaLabel'> = {}): OrderTrackView | null {
  const keys = NO_PAYMENT_WAIT.has(o.paymentMethod) ? STEPS.filter((s) => s !== 'PENDING_PAYMENT') : [...STEPS];
  const current = (keys as readonly string[]).indexOf(o.status);
  if (current < 0) return null;
  const events = shippingEvents(o.shippingHistory);
  const shipIdx = keys.indexOf('SHIPPING');
  const eventsAt = current >= shipIdx ? shipIdx : current;
  const steps = keys.map<TrackStep>((key, i) => {
    const state: TrackState = i < current ? 'done' : i === current ? 'current' : 'upcoming';
    const at = i > current ? null : (o.statusTimes?.[key] ?? (i === 0 ? o.createdAt : null));
    return {
      key,
      label: fillCopy(`order.step.${key}`),
      state,
      at,
      eta: ctx.etaLabel && i === keys.length - 1 && !at ? orderCopy.etaLine(ctx.etaLabel) : null,
      events: i === eventsAt ? events : [],
    };
  });
  return { steps, current };
}

export type OrderActionKind = 'pay' | 'cancel' | 'contact' | 'review' | 'reorder' | 'return';

export interface OrderActionPlan {
  stage: OrderStage;
  /** Một nút chính của trạng thái. */
  primary: OrderActionKind | null;
  /** Nút phụ, vào menu "Thêm thao tác". */
  more: OrderActionKind[];
  /** Dòng cần đánh giá khi nút chính là "Đánh giá sản phẩm". */
  reviewItemId: string | null;
}

/**
 * Nút nào hiện ở trạng thái nào. Nút chính:
 * chờ thanh toán là Thanh toán ngay; trước bàn giao vận chuyển là Huỷ đơn; đang giao là Liên hệ; đã giao là Đánh giá (còn dòng chưa
 * đánh giá) hoặc Mua lại; đã huỷ hoặc hoàn là Mua lại. Mọi nút cấm (huỷ khi hàng đã giao hãng, trả tiền khi Tubu xử lý tay, đổi/trả
 * quá hạn hoặc đã có yêu cầu chờ) không bao giờ có trong kế hoạch.
 */
export function orderActionPlan(o: TrackOrder, ctx: TrackCtx = {}): OrderActionPlan {
  const now = ctx.now ?? Date.now();
  const stage = orderStage(o, now);
  const cancel = canCancelOrder(o, ctx.userId);
  const more: OrderActionKind[] = [];
  let primary: OrderActionKind | null = null;
  let reviewItemId: string | null = null;

  switch (stage) {
    case 'PAY_WAIT':
      primary = canPayOrder(o, now) ? 'pay' : 'contact';
      if (cancel) more.push('cancel');
      if (primary !== 'contact') more.push('contact');
      break;
    case 'PAY_MANUAL':
    case 'CARRIER_BOOKED':
      primary = 'contact';
      break;
    case 'PAY_OVERDUE':
    case 'SHIPPING':
      primary = 'contact';
      if (cancel) more.push('cancel');
      break;
    case 'CONFIRMED':
    case 'PACKED':
      primary = cancel ? 'cancel' : 'contact';
      if (cancel) more.push('contact');
      break;
    case 'DELIVERED': {
      const review = pendingReviewItem(o);
      reviewItemId = review?.id ?? null;
      primary = review ? 'review' : 'reorder';
      if (review) more.push('reorder');
      if (!ctx.pendingReturn && ctx.returnableLeft !== false && returnWindowOpen(o, ctx.returnDays ?? 7, now)) more.push('return');
      more.push('contact');
      break;
    }
    case 'CANCELLED':
    case 'RETURNED':
      primary = 'reorder';
      more.push('contact');
      break;
    default:
      primary = 'contact';
      break;
  }
  return { stage, primary, more, reviewItemId };
}

const ACTION_LABEL: Record<OrderActionKind, string> = {
  pay: 'order.action.pay',
  cancel: 'order.action.cancel',
  contact: 'order.action.contact',
  review: 'order.action.review',
  reorder: 'order.action.reorder',
  return: 'order.action.return',
};

export function orderActionLabel(kind: OrderActionKind, opts: { returnMore?: boolean } = {}): string {
  return fillCopy(kind === 'return' && opts.returnMore ? 'order.action.returnMore' : ACTION_LABEL[kind]);
}
