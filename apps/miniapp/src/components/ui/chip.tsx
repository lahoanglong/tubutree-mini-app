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
  /** Tên truy cập riêng khi nhãn nhìn thấy không đủ nghĩa (vd "Bỏ lọc Tubu"). */
  ariaLabel?: string;
  className?: string;
  style?: CSSProperties;
}

/** Chip lọc/chọn — thay 3 định nghĩa trùng lặp (browse.tsx/feed.tsx byte-for-byte, audit A4-19).
 * Nhìn cao 36px nhưng vùng chạm 44px nhờ `.tubu-hit-44` (follow-up DS v2: "Chip under 44px").
 * Hàng chip trong `.scroll-x` cần đệm dọc ≥ 4px để vùng chạm không bị overflow cắt.
 * Là `<button>` thật nên Tab/Enter/Space hoạt động (không còn span role=button không bàn phím). */
export function Chip({
  children,
  selected,
  onPress,
  icon: IconCmp,
  count,
  size = 'md',
  ariaLabel,
  className,
  style,
}: ChipProps) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      aria-label={ariaLabel}
      className={['tubu-press', 'tubu-hit-44', className].filter(Boolean).join(' ')}
      onClick={onPress}
      style={{
        border: 'none',
        cursor: 'pointer',
        fontFamily: 'inherit',
        lineHeight: 'inherit',
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
    </button>
  );
}
