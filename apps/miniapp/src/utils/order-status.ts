/** Màu + thứ tự timeline cho trạng thái đơn (spec §6.4). */

import type { BadgeTone } from '../components/ui/badge';
import { vi } from '../i18n/vi';
import { formatNumber, formatPoints } from './format';

/** Cùng nguồn token với Badge's TONE_STYLE (audit A4-08: trước đây map này dùng hex chép tay
 * "gần giống" — SHIPPING `#EAF2FA` gần nhưng KHÁC `--info-bg` thật, CANCELLED `#FAEAEA` tương tự
 * lệch với `--danger-bg`; các entry còn lại tham chiếu biến `--primary-*`/`--leaf-*`/`--neutral-*`
 * đã bị DS v2 khai tử hoàn toàn). Nay dùng ĐÚNG các biến CSS ngữ nghĩa "color-status-*" mà
 * `components/ui/badge.tsx`'s TONE_STYLE dùng — không còn 2 nguồn có thể trôi khỏi nhau. */
export const STATUS_COLOR: Record<string, { bg: string; fg: string }> = {
  PENDING_PAYMENT: { bg: 'var(--color-status-warning-bg)', fg: 'var(--color-status-warning-fg)' },
  CONFIRMED: { bg: 'var(--color-action-secondary-bg)', fg: 'var(--color-action-secondary-fg)' },
  PACKED: { bg: 'var(--color-action-secondary-bg)', fg: 'var(--color-action-secondary-fg)' },
  SHIPPING: { bg: 'var(--color-status-info-bg)', fg: 'var(--color-status-info-fg)' },
  DELIVERED: { bg: 'var(--color-status-success-bg)', fg: 'var(--color-status-success-fg)' },
  RETURNED: { bg: 'var(--color-status-neutral-bg)', fg: 'var(--color-status-neutral-fg)' },
  CANCELLED: { bg: 'var(--color-status-danger-bg)', fg: 'var(--color-status-danger-fg)' },
};

/** Tone Badge cho từng trạng thái đơn — dùng trực tiếp `<Badge tone={STATUS_TONE[status]}>` (vd
 * orders.tsx) để pill LUÔN vẽ bằng đúng Badge's TONE_STYLE, không qua một map màu song song nữa. */
export const STATUS_TONE: Record<string, BadgeTone> = {
  PENDING_PAYMENT: 'warning',
  CONFIRMED: 'brand',
  PACKED: 'brand',
  SHIPPING: 'info',
  DELIVERED: 'success',
  RETURNED: 'neutral',
  CANCELLED: 'danger',
};

/** 5 bước hành trình chuẩn — RETURNED/CANCELLED hiển thị riêng, không vào timeline. */
export const TIMELINE_STEPS = [
  'PENDING_PAYMENT',
  'CONFIRMED',
  'PACKED',
  'SHIPPING',
  'DELIVERED',
] as const;

/** Đơn không bao giờ chờ thanh toán: COD (trả khi nhận hàng) và Ví Tubu (trừ ví ngay lúc đặt). */
const NO_PAYMENT_WAIT = new Set(['COD', 'WALLET']);

export function timelineStepsFor(paymentMethod?: string | null): readonly string[] {
  return paymentMethod && NO_PAYMENT_WAIT.has(paymentMethod)
    ? TIMELINE_STEPS.filter((s) => s !== 'PENDING_PAYMENT')
    : TIMELINE_STEPS;
}

/** Vị trí hiện tại trên timeline; -1 nếu trạng thái nằm ngoài hành trình chuẩn. */
export function timelineIndex(status: string, steps: readonly string[] = TIMELINE_STEPS): number {
  return steps.indexOf(status);
}

/**
 * Mốc thời gian đầu trang chi tiết đơn. `createdAt` là giờ ĐẶT; để nó đứng cạnh "Giao thành công" mà không có nhãn
 * thì khách đọc thành giờ giao. Đơn đã giao có mốc giao thật thì hiện mốc đó.
 */
export function orderStamp(o: { status: string; createdAt: string; deliveredAt?: string | null }): { label: string; at: string } {
  return o.status === 'DELIVERED' && o.deliveredAt
    ? { label: 'Giao lúc', at: o.deliveredAt }
    : { label: 'Đặt lúc', at: o.createdAt };
}

/**
 * Dòng Điểm Xanh của đơn theo trạng thái: chưa giao thì "sẽ nhận", đã giao thì "đã cộng", đã hoàn thì đã thu hồi.
 * Chỉ nói "khi giao thành công" ở đơn chưa giao.
 * `pointsTaken`: số điểm thực thu lại do trả hàng (API `pointsReturnReversed`). API cũ chưa trả thì chỉ có `pointsReversed` (phần chia
 * chưa kẹp theo số dư) nên ghi "tối đa".
 */
export function orderPointsNote(
  status: string,
  pointsEarned: number,
  pointsReversed = 0,
  pointsTaken?: number,
): { text: string; tone: 'success' | 'muted' } | null {
  if (pointsEarned <= 0 || status === 'CANCELLED') return null;
  if (status === 'DELIVERED' && pointsTaken !== undefined) {
    if (pointsTaken > 0) {
      return { text: vi.orders.pointsCreditedReturnTaken(formatNumber(pointsEarned), formatNumber(pointsTaken)), tone: 'muted' };
    }
  } else if (status === 'DELIVERED' && pointsReversed > 0) {
    return { text: vi.orders.pointsCreditedPartlyReversed(formatNumber(pointsEarned), formatNumber(pointsReversed)), tone: 'muted' };
  }
  if (status === 'DELIVERED') return { text: vi.orders.pointsCredited(formatNumber(pointsEarned)), tone: 'success' };
  if (status === 'RETURNED') return { text: vi.orders.pointsReversed, tone: 'muted' };
  return { text: vi.checkout.pointsEarn(pointsEarned), tone: 'success' };
}

/**
 * Hạn đổi/trả còn mở không — cùng cách tính của API (OrdersService.requestReturn): mốc giao, thiếu thì updatedAt.
 * Không có mốc nào thì để API quyết định (coi như còn hạn).
 */
export function returnWindowState(
  o: { deliveredAt?: string | null; updatedAt?: string | null },
  windowDays: number,
  now: number = Date.now(),
): { open: boolean; daysLeft: number } {
  const base = o.deliveredAt ?? o.updatedAt;
  if (!base) return { open: true, daysLeft: windowDays };
  const left = (new Date(base).getTime() + windowDays * 864e5 - now) / 864e5;
  return left > 0 ? { open: true, daysLeft: Math.ceil(left) } : { open: false, daysLeft: 0 };
}

/** Trạng thái hiện nút "Mua lại" — cùng điều kiện `isDone` của chi tiết đơn (order-detail.tsx). */
export const REORDERABLE_STATUSES = ['DELIVERED', 'CANCELLED', 'RETURNED'] as const;

export function isReorderable(status: string): boolean {
  return (REORDERABLE_STATUSES as readonly string[]).includes(status);
}

interface CarrierFacts {
  status: string;
  shippingCode?: string | null;
  gomdonOrderId?: string | null;
  gomdonPartnerCode?: string | null;
}

/**
 * Kho đã đặt hãng cho đơn (Pancake gắn mã vận đơn hãng lúc in phiếu) dù đơn chưa chuyển "Đang giao". Mã của vận đơn thu
 * gom Gomdon không tính (bưu tá chưa tới). Cùng mốc CARRIER_WAYBILL của cancelHandover ở BE.
 */
export function isCarrierBooked(o: CarrierFacts): boolean {
  if (o.status !== 'CONFIRMED' && o.status !== 'PACKED') return false;
  return !!o.shippingCode && o.shippingCode !== o.gomdonOrderId && o.shippingCode !== o.gomdonPartnerCode;
}

/** Hàng đã rời kho cho hãng vận chuyển (đang giao, hoặc kho đã đặt hãng): từ đây không huỷ được nữa. */
export function isHandedToCarrier(o: CarrierFacts): boolean {
  return o.status === 'SHIPPING' || isCarrierBooked(o);
}

/** Nhãn trạng thái cho khách: đơn đã đặt hãng thì nói rõ, khỏi để chip "Đang đóng gói" mâu thuẫn lời "đã bàn giao". */
export function buyerStatusLabel(o: CarrierFacts): string {
  return isCarrierBooked(o) ? vi.orders.carrierBooked : (vi.orderStatus[o.status] ?? o.status);
}

/** Bưu tá Gomdon đã cầm hàng (mã số khác 1/2/10): luật dự phòng khi API chưa trả `canCancel`. */
function isRecyclingPickedUp(gomdonStatus: string | null | undefined): boolean {
  if (!gomdonStatus || !/^\d+$/.test(gomdonStatus)) return false;
  return !['1', '2', '10'].includes(gomdonStatus);
}

/**
 * Khách tự huỷ được không — chỉ để không bày nút chắc chắn bị từ chối; BE vẫn quyết. API trả `canCancel` (đúng luật huỷ
 * của khách ở BE) thì theo đó; API cũ thì tự xét: tới trước khi bàn giao vận chuyển (đơn đại lý chỉ tới Đã xác nhận), kho
 * chưa đặt hãng, bưu tá thu gom chưa lấy hàng, đơn CTV lên hộ khách đã trả tiền chỉ admin huỷ.
 */
export function canCustomerCancel(
  o: CarrierFacts & {
    type?: string | null;
    paymentStatus?: string | null;
    placedForCustomer?: boolean | null;
    referrerUserId?: string | null;
    hasRecyclingPickup?: boolean | null;
    gomdonStatus?: string | null;
    canCancel?: boolean | null;
  },
  meId: string | null | undefined,
): boolean {
  const cancellable = o.type === 'DEALER' ? ['PENDING_PAYMENT', 'CONFIRMED'] : ['PENDING_PAYMENT', 'CONFIRMED', 'PACKED'];
  if (!cancellable.includes(o.status)) return false;
  if (typeof o.canCancel === 'boolean') return o.canCancel;
  if (o.placedForCustomer && o.paymentStatus === 'PAID' && !!meId && o.referrerUserId === meId) return false;
  if (o.hasRecyclingPickup && isRecyclingPickedUp(o.gomdonStatus)) return false;
  return !isCarrierBooked(o);
}

/** Số MÓN của đơn (tổng số lượng) — trước đây thẻ đơn đếm số dòng (A2-47). */
export function orderUnitCount(items: { quantity: number }[]): number {
  return items.reduce((s, it) => s + it.quantity, 0);
}

export interface OrderDiscountParts {
  discount: number;
  pointsUsed: number;
  couponCode?: string | null;
  /** Mã của lần đặt khi đơn tách này không giữ lượt dùng mã nhưng nhận một phần giảm của mã (chỉ đơn đầu của nhóm có `couponCode`). */
  groupCouponCode?: string | null;
  couponDiscount?: number;
  comboDiscount?: number;
  tierDiscount?: number;
  pointsDiscount?: number;
}

/**
 * Các dòng giảm giá ở tóm tắt tiền chi tiết đơn, cùng cách tách của màn Thanh toán. Đơn tạo trước khi API lưu từng khoản
 * chỉ có tổng `discount` (đã gồm tiền Điểm Xanh) nên hiện một dòng và ghi rõ đã gồm điểm.
 */
export function discountRows(o: OrderDiscountParts): { label: string; amount: number }[] {
  const coupon = o.couponDiscount ?? 0;
  const combo = o.comboDiscount ?? 0;
  const tier = o.tierDiscount ?? 0;
  const points = o.pointsDiscount ?? 0;
  const couponCode = o.couponCode ?? o.groupCouponCode;
  const known = coupon + combo + tier + points;
  if (known === 0) {
    if (o.discount <= 0) return [];
    return [{ label: o.pointsUsed > 0 ? 'Giảm giá (gồm Điểm Xanh)' : 'Giảm giá', amount: o.discount }];
  }
  const rows = [
    { label: couponCode ? `Mã giảm giá (${couponCode})` : 'Mã giảm giá', amount: coupon },
    { label: 'Ưu đãi combo', amount: combo },
    { label: 'Ưu đãi hạng thành viên', amount: tier },
    { label: `Điểm Xanh (${formatPoints(o.pointsUsed)})`, amount: points },
    { label: 'Giảm giá khác', amount: o.discount - known },
  ];
  return rows.filter((r) => r.amount > 0);
}
