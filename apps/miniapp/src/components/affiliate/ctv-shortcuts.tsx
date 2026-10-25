import type { LucideIcon } from 'lucide-react';
import { Icon } from '../ui/icon';
import { Text } from '../ui/text';

export interface CtvShortcut {
  key: string;
  /** Nhãn ngắn hiện trên nút (vừa một cột 1/4 màn hình). */
  label: string;
  /** Tên đầy đủ cho trình đọc màn hình; phải chứa nhãn hiển thị (WCAG 2.5.3). */
  ariaLabel?: string;
  icon: LucideIcon;
  onPress: () => void;
  disabled?: boolean;
}

/** Hàng lối tắt ngay dưới thẻ hoa hồng: việc CTV làm hằng ngày (chia sẻ, gian hàng, lên đơn hộ, chuyển hoa hồng vào Ví) không phải cuộn tới cuối trang dài. */
export function CtvShortcuts({ items }: { items: CtvShortcut[] }) {
  return (
    <div
      role="group"
      aria-label="Lối tắt của CTV"
      style={{ display: 'grid', gridTemplateColumns: `repeat(${items.length}, minmax(0, 1fr))`, gap: 8 }}
    >
      {items.map(({ key, label, ariaLabel, icon, onPress, disabled }) => (
        <button
          key={key}
          type="button"
          aria-label={ariaLabel}
          disabled={disabled}
          className={disabled ? undefined : 'tubu-press'}
          onClick={onPress}
          style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 6,
            minHeight: 76,
            padding: '10px 4px',
            border: 'none',
            borderRadius: 'var(--radius-card)',
            background: 'var(--color-bg-surface)',
            boxShadow: 'var(--elevation-1)',
            font: 'inherit',
            cursor: disabled ? 'default' : 'pointer',
          }}
        >
          <span
            aria-hidden
            style={{
              display: 'grid',
              placeItems: 'center',
              width: 36,
              height: 36,
              borderRadius: 'var(--radius-pill)',
              background: disabled ? 'var(--color-bg-subtle)' : 'var(--color-action-secondary-bg)',
            }}
          >
            <Icon icon={icon} size="md" tone={disabled ? 'muted' : 'brand'} />
          </span>
          <Text variant="caption" tone={disabled ? 'disabled' : 'primary'} style={{ fontWeight: 600, textAlign: 'center' }}>
            {label}
          </Text>
        </button>
      ))}
    </div>
  );
}
