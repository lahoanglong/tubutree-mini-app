import type { LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';

export type BadgeTone = 'success' | 'warning' | 'danger' | 'info' | 'neutral' | 'brand' | 'promo';

const TONE_CLASS: Record<BadgeTone, string> = {
  success: 'bg-success-bg text-success-fg',
  warning: 'bg-warning-bg text-warning-fg',
  danger: 'bg-danger-bg text-danger-fg',
  info: 'bg-info-bg text-info-fg',
  neutral: 'bg-stone-100 text-stone-700',
  brand: 'bg-forest-50 text-forest-700',
  promo: 'bg-promo-bg text-promo-fg',
};

export interface BadgeProps {
  children: ReactNode;
  tone?: BadgeTone;
  size?: 'sm' | 'md';
  /** Icon nét đứng trước chữ, ăn màu chữ của tông (thay emoji đầu chuỗi). */
  icon?: LucideIcon;
  className?: string;
}

/** Nhãn trạng thái, cùng tông với `Badge` của Mini App. Chữ ≥12px. */
export function Badge({ children, tone = 'neutral', size = 'md', icon: Icon, className = '' }: BadgeProps) {
  return (
    <span
      className={`inline-flex items-center gap-1 whitespace-nowrap rounded-full font-semibold ${size === 'md' ? 'px-2 py-[3px] text-xs' : 'px-1.5 py-0.5 text-xs'} ${TONE_CLASS[tone]} ${className}`}
    >
      {Icon && <Icon className={size === 'md' ? 'h-3.5 w-3.5' : 'h-3 w-3'} strokeWidth={1.75} aria-hidden="true" />}
      {children}
    </span>
  );
}

export const StatusPill = Badge;
