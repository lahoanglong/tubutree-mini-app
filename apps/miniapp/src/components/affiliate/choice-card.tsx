import { Text } from '../ui/text';

export interface ChoiceCardProps {
  active: boolean;
  title: string;
  sub: string;
  onPress: () => void;
}

/** Thẻ chọn một trong vài phương án (rút tiền về đâu, thu tiền kiểu nào): hai dòng chữ, là nút thật
 * để dùng được bằng bàn phím và trình đọc màn hình (`aria-pressed`), vùng chạm cao >= 44px. */
export function ChoiceCard({ active, title, sub, onPress }: ChoiceCardProps) {
  return (
    <button
      type="button"
      aria-pressed={active}
      className="tubu-press"
      onClick={onPress}
      style={{
        flex: 1,
        minHeight: 44,
        padding: 12,
        textAlign: 'left',
        fontFamily: 'inherit',
        cursor: 'pointer',
        borderRadius: 'var(--radius-control)',
        border: `1.5px solid ${active ? 'var(--color-border-selected)' : 'var(--color-border-subtle)'}`,
        background: active ? 'var(--color-action-secondary-bg)' : 'var(--color-bg-surface)',
      }}
    >
      <Text variant="body-sm" tone={active ? 'brand' : 'primary'} as="div" style={{ fontWeight: 600 }}>
        {title}
      </Text>
      <Text variant="caption" tone="tertiary" as="div">
        {sub}
      </Text>
    </button>
  );
}
