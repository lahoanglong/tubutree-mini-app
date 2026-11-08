import { ChevronRight, Target } from 'lucide-react';
import { Icon } from './icon';

export interface QuestStripProps {
  text: string;
  /** Tên đọc khi chữ nhìn thấy chưa đủ nghĩa. Rỗng hoặc chỉ khoảng trắng thì bỏ `aria-label` để nút lấy tên từ `text` (WCAG 2.5.3). */
  spoken?: string;
  hasReward: boolean;
  onOpen: () => void;
  /** Đang mở sheet hành trình hoặc nhận thưởng: khoá nút thật, báo `aria-busy`, không gọi lại `onOpen`. */
  busy?: boolean;
  disabled?: boolean;
}

/**
 * Hành trình gian hàng thu thành một dải 56px: có thưởng chờ thì nói thưởng, không thì việc kế tiếp. Nút "Nhận" nằm trong sheet
 * mở ra từ đây, nên màn dựng chỉ còn một nút chính (thanh dính), không ba nút xanh đặc như trước. Chữ rỗng thì không dựng dải
 * (một khung 56px chỉ có hai icon là nút không nói gì).
 */
export function QuestStrip({ text, spoken, hasReward, onOpen, busy, disabled }: QuestStripProps) {
  if (!text || !text.trim()) return null;
  const cleanSpoken = spoken?.trim() || undefined;
  const isDisabled = Boolean(disabled || busy);
  return (
    <button
      type="button"
      data-reward={hasReward ? 'true' : 'false'}
      aria-label={cleanSpoken}
      aria-busy={busy ? true : undefined}
      disabled={isDisabled}
      className="tubu-press"
      onClick={() => {
        if (!isDisabled) onOpen();
      }}
      style={{
        width: '100%', minHeight: 56, display: 'flex', alignItems: 'center', gap: 10, padding: '0 12px', border: 'none', textAlign: 'left', cursor: isDisabled ? 'not-allowed' : 'pointer', font: 'inherit',
        borderRadius: 'var(--radius-card)',
        background: hasReward ? 'var(--color-action-secondary-bg)' : 'var(--color-bg-surface)',
        boxShadow: hasReward ? 'none' : 'inset 0 0 0 1px var(--color-border-subtle)',
        color: 'var(--color-text-primary)',
        opacity: isDisabled ? 0.6 : 1,
      }}
    >
      <Icon icon={Target} size="md" tone="brand" style={{ flexShrink: 0 }} />
      <span style={{ flex: 1, minWidth: 0, fontSize: 'var(--type-body-sm-size)', lineHeight: 'var(--type-body-sm-lh)', fontWeight: hasReward ? 600 : 400, overflowWrap: 'anywhere' }}>{text}</span>
      <Icon icon={ChevronRight} size="sm" tone="muted" style={{ flexShrink: 0 }} />
    </button>
  );
}
