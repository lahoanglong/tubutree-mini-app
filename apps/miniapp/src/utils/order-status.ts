/** Màu + thứ tự timeline cho trạng thái đơn (spec §6.4). */

import type { BadgeTone } from '../components/ui/badge';
import { vi } from '../i18n/vi';
import { formatNumber } from './format';

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
 */
export function orderPointsNote(status: string, pointsEarned: number): { text: string; tone: 'success' | 'muted' } | null {
  if (pointsEarned <= 0 || status === 'CANCELLED') return null;
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

/** Số MÓN của đơn (tổng số lượng) — trước đây thẻ đơn đếm số dòng (A2-47). */
export function orderUnitCount(items: { quantity: number }[]): number {
  return items.reduce((s, it) => s + it.quantity, 0);
}
