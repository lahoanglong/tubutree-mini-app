'use client';

// Nguồn: apps/miniapp/src/components/ui/badge.tsx
import type { LucideIcon } from 'lucide-react';
import type { CSSProperties, ReactNode } from 'react';

export type BadgeTone = 'success' | 'warning' | 'danger' | 'info' | 'neutral' | 'brand' | 'promo';

const TONE_STYLE: Record<BadgeTone, { bg: string; fg: string }> = {
  success: { bg: 'var(--color-status-success-bg)', fg: 'var(--color-status-success-fg)' },
  warning: { bg: 'var(--color-status-warning-bg)', fg: 'var(--color-status-warning-fg)' },
  danger: { bg: 'var(--color-status-danger-bg)', fg: 'var(--color-status-danger-fg)' },
  info: { bg: 'var(--color-status-info-bg)', fg: 'var(--color-status-info-fg)' },
  neutral: { bg: 'var(--color-status-neutral-bg)', fg: 'var(--color-status-neutral-fg)' },
  brand: { bg: 'var(--color-action-secondary-bg)', fg: 'var(--color-action-secondary-fg)' },
  promo: { bg: 'var(--color-promo-bg)', fg: 'var(--color-promo-fg)' },
};

export interface BadgeProps {
  children: ReactNode;
  tone?: BadgeTone;
  size?: 'sm' | 'md';
  /** Icon nét đứng trước chữ, ăn màu chữ của tông (thay emoji đầu chuỗi). */
  icon?: LucideIcon;
  className?: string;
  style?: CSSProperties;
}

/** Nhãn trạng thái — thay 34 pill tự vẽ + STATUS_COLOR hardcode hex (audit A4-19). */
export function Badge({ children, tone = 'neutral', size = 'md', icon: IconCmp, className, style }: BadgeProps) {
  const c = TONE_STYLE[tone];
  return (
    <span
      className={className}
      style={{
        background: c.bg, color: c.fg, fontWeight: 600, whiteSpace: 'nowrap',
        borderRadius: 'var(--radius-pill)',
        fontSize: size === 'md' ? 'var(--type-label-size)' : 11,
        padding: size === 'md' ? '3px 8px' : '2px 6px',
        ...(IconCmp ? { display: 'inline-flex', alignItems: 'center', gap: 4 } : null),
        ...style,
      }}
    >
      {IconCmp && <IconCmp size={size === 'md' ? 14 : 12} strokeWidth={1.75} aria-hidden="true" />}
      {children}
    </span>
  );
}

/** Alias — audit's own naming uses "StatusPill" for order/kiểm duyệt trạng thái contexts. */
export const StatusPill = Badge;

/** Huy hiệu đếm trên icon, đặt trong phần tử `position: relative`. Có `label` thì đọc được riêng, không thì để nhãn của nút cha đọc. */
export function CountBadge({ count, label }: { count: number; label?: string }) {
  if (count <= 0) return null;
  return (
    <span
      data-testid="count-badge"
      {...(label ? { role: 'img', 'aria-label': label } : { 'aria-hidden': true })}
      style={{
        position: 'absolute', top: -2, right: -2, minWidth: 18, height: 18, boxSizing: 'border-box', padding: '0 4px',
        borderRadius: 'var(--radius-pill)', background: 'var(--color-promo-solid-bg)', color: 'var(--color-promo-solid-fg)',
        fontSize: 11, fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}
    >
      {count > 99 ? '99+' : count}
    </span>
  );
}
