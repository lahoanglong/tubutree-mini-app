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
  className?: string;
  style?: CSSProperties;
}

/** Nhãn trạng thái — thay 34 pill tự vẽ + STATUS_COLOR hardcode hex (audit A4-19). */
export function Badge({ children, tone = 'neutral', size = 'md', className, style }: BadgeProps) {
  const c = TONE_STYLE[tone];
  return (
    <span
      className={className}
      style={{
        background: c.bg, color: c.fg, fontWeight: 600, whiteSpace: 'nowrap',
        borderRadius: 'var(--radius-pill)',
        fontSize: size === 'md' ? 'var(--type-label-size)' : 11,
        padding: size === 'md' ? '3px 8px' : '2px 6px',
        ...style,
      }}
    >
      {children}
    </span>
  );
}

/** Alias — audit's own naming uses "StatusPill" for order/kiểm duyệt trạng thái contexts. */
export const StatusPill = Badge;
