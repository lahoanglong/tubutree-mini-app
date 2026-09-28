import type { CSSProperties, ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';
import { Icon } from './icon';

export interface ChipProps {
  children: ReactNode;
  selected?: boolean;
  onPress?: () => void;
  icon?: LucideIcon;
  count?: number;
  size?: 'sm' | 'md';
  variant?: 'filter' | 'choice' | 'info';
  className?: string;
  style?: CSSProperties;
}

/** Chip lọc/chọn — thay 3 định nghĩa trùng lặp (browse.tsx/feed.tsx byte-for-byte, audit A4-19). */
export function Chip({
  children,
  selected,
  onPress,
  icon: IconCmp,
  count,
  size = 'md',
  className,
  style,
}: ChipProps) {
  return (
    <span
      role="button"
      aria-pressed={selected}
      className={['tubu-press', className].filter(Boolean).join(' ')}
      onClick={onPress}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 4,
        background: selected ? 'var(--color-action-primary-bg)' : 'var(--stone-100)',
        color: selected ? 'var(--color-action-primary-fg)' : 'var(--color-text-secondary)',
        fontWeight: selected ? 600 : 500,
        fontSize: 'var(--type-body-sm-size)',
        padding: size === 'md' ? '8px 14px' : '6px 10px',
        minHeight: size === 'md' ? 36 : 32,
        borderRadius: 'var(--radius-pill)',
        whiteSpace: 'nowrap',
        boxSizing: 'border-box',
        ...style,
      }}
    >
      {IconCmp && <Icon icon={IconCmp} size="sm" tone={selected ? 'inverse' : 'muted'} />}
      {children}
      {typeof count === 'number' && <span style={{ opacity: 0.75 }}>({count})</span>}
    </span>
  );
}
