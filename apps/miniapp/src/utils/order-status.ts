/** Màu + thứ tự timeline cho trạng thái đơn (spec §6.4). */

import type { BadgeTone } from '../components/ui/badge';

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

/** Vị trí hiện tại trên timeline; -1 nếu trạng thái nằm ngoài hành trình chuẩn. */
export function timelineIndex(status: string): number {
  return TIMELINE_STEPS.indexOf(status as (typeof TIMELINE_STEPS)[number]);
}
