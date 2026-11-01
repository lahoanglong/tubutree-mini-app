import type { LucideIcon } from 'lucide-react';
import { Icon, type IconProps } from '../ui/icon';

/** Nút chỉ-icon trong hàng/thẻ: vùng chạm 44px và cho chỉnh tông icon (IconButton của DS chưa có `tone`). */
export function RowIconButton({
  icon, label, tone = 'muted', disabled, onPress,
}: { icon: LucideIcon; label: string; tone?: NonNullable<IconProps['tone']>; disabled?: boolean; onPress: () => void }) {
  return (
    <button
      type="button"
      aria-label={label}
      disabled={disabled}
      className="tubu-press touch-target"
      onClick={onPress}
      style={{
        minWidth: 44, minHeight: 44, flexShrink: 0, border: 'none', background: 'transparent', borderRadius: 'var(--radius-pill)',
        cursor: disabled ? 'default' : 'pointer', opacity: disabled ? 0.35 : 1,
      }}
    >
      <Icon icon={icon} size="sm" tone={tone} />
    </button>
  );
}
