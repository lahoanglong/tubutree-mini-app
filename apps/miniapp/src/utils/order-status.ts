/** Màu + thứ tự timeline cho trạng thái đơn (spec §6.4). */

export const STATUS_COLOR: Record<string, { bg: string; fg: string }> = {
  PENDING_PAYMENT: { bg: 'var(--clay-50)', fg: 'var(--clay-700)' },
  CONFIRMED: { bg: 'var(--primary-50)', fg: 'var(--primary-700)' },
  PACKED: { bg: 'var(--primary-50)', fg: 'var(--primary-700)' },
  SHIPPING: { bg: '#EAF2FA', fg: 'var(--info)' },
  DELIVERED: { bg: 'var(--leaf-50)', fg: 'var(--leaf-700)' },
  RETURNED: { bg: 'var(--neutral-100)', fg: 'var(--neutral-600)' },
  CANCELLED: { bg: '#FAEAEA', fg: 'var(--danger)' },
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
