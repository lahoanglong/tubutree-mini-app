import type { CSSProperties } from 'react';
import type { LucideIcon } from 'lucide-react';
import { Icon } from './icon';

export interface IconButtonProps {
  icon: LucideIcon;
  label: string;
  size?: 'md' | 'sm';
  onPress?: () => void;
  badge?: boolean;
  className?: string;
  style?: CSSProperties;
}

/** Nút chỉ-icon — vùng chạm LUÔN 44x44 dù nhìn nhỏ hơn (audit A4-14: 31 vòng icon 32-40px cũ).
 * `label` bắt buộc ở kiểu (TS) VÀ ở lint (Task 6) — hai lớp phòng thủ cho cùng một lỗi A4-16. */
export function IconButton({ icon: IconCmp, label, size = 'md', onPress, badge, className, style }: IconButtonProps) {
  return (
    <button
      type="button"
      aria-label={label}
      className={['tubu-press', className].filter(Boolean).join(' ')}
      onClick={onPress}
      style={{
        position: 'relative',
        minWidth: 44,
        minHeight: 44,
        borderRadius: 'var(--radius-pill)',
        border: 'none',
        background: 'transparent',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        cursor: 'pointer',
        ...style,
      }}
    >
      <Icon icon={IconCmp} size={size === 'md' ? 'md' : 'sm'} />
      {badge && (
        <span
          data-testid="icon-button-badge"
          aria-hidden
          style={{
            position: 'absolute', top: 2, right: 2, width: 8, height: 8, borderRadius: '50%',
            background: 'var(--color-action-danger-bg)', border: '1.5px solid var(--color-bg-surface)',
          }}
        />
      )}
    </button>
  );
}
