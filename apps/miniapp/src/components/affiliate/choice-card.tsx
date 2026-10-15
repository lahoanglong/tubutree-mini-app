import { Text } from '../ui/text';

export interface ChoiceCardProps {
  active: boolean;
  title: string;
  sub: string;
  onPress: () => void;
  /** Phương án không dùng được: mờ, bấm không đổi gì; lý do nằm ở phần tử `describedBy` (chữ không mờ để đọc được). */
  disabled?: boolean;
  describedBy?: string;
}

/** Thẻ chọn một trong vài phương án (rút tiền về đâu, thu tiền kiểu nào): hai dòng chữ, là nút thật
 * để dùng được bằng bàn phím và trình đọc màn hình (`aria-pressed`), vùng chạm cao >= 44px. */
export function ChoiceCard({ active, title, sub, onPress, disabled = false, describedBy }: ChoiceCardProps) {
  return (
    <button
      type="button"
      aria-pressed={active}
      aria-disabled={disabled || undefined}
      aria-describedby={describedBy}
      className={disabled ? undefined : 'tubu-press'}
      onClick={disabled ? undefined : onPress}
      style={{
        flex: 1,
        minHeight: 44,
        padding: 12,
        textAlign: 'left',
        fontFamily: 'inherit',
        cursor: disabled ? 'default' : 'pointer',
        borderRadius: 'var(--radius-control)',
        border: `1.5px solid ${active ? 'var(--color-border-selected)' : 'var(--color-border-subtle)'}`,
        background: active ? 'var(--color-action-secondary-bg)' : 'var(--color-bg-surface)',
      }}
    >
      <Text variant="body-sm" tone={disabled ? 'disabled' : active ? 'brand' : 'primary'} as="div" style={{ fontWeight: 600 }}>
        {title}
      </Text>
      <Text variant="caption" tone={disabled ? 'disabled' : 'tertiary'} as="div">
        {sub}
      </Text>
    </button>
  );
}
