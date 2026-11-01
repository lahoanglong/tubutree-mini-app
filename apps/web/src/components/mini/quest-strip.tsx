'use client';

// Nguồn: apps/miniapp/src/components/ui/quest-strip.tsx
import { ChevronRight, Target } from 'lucide-react';
import { Icon } from './icon';

export interface QuestStripProps {
  text: string;
  spoken: string;
  hasReward: boolean;
  onOpen: () => void;
}

/**
 * Hành trình gian hàng thu thành một dải 56px: có thưởng chờ thì nói thưởng, không thì việc kế tiếp. Nút "Nhận" nằm trong sheet
 * mở ra từ đây, nên màn dựng chỉ còn một nút chính (thanh dính), không ba nút xanh đặc như trước.
 */
export function QuestStrip({ text, spoken, hasReward, onOpen }: QuestStripProps) {
  return (
    <button
      type="button"
      data-reward={hasReward ? 'true' : 'false'}
      aria-label={spoken}
      className="tubu-press"
      onClick={onOpen}
      style={{
        width: '100%', minHeight: 56, display: 'flex', alignItems: 'center', gap: 10, padding: '0 12px', border: 'none', textAlign: 'left', cursor: 'pointer', font: 'inherit',
        borderRadius: 'var(--radius-card)',
        background: hasReward ? 'var(--color-action-secondary-bg)' : 'var(--color-bg-surface)',
        boxShadow: hasReward ? 'none' : 'inset 0 0 0 1px var(--color-border-subtle)',
        color: 'var(--color-text-primary)',
      }}
    >
      <Icon icon={Target} size="md" tone="brand" style={{ flexShrink: 0 }} />
      <span style={{ flex: 1, minWidth: 0, fontSize: 'var(--type-body-sm-size)', lineHeight: 'var(--type-body-sm-lh)', fontWeight: hasReward ? 600 : 400, overflowWrap: 'anywhere' }}>{text}</span>
      <Icon icon={ChevronRight} size="sm" tone="muted" style={{ flexShrink: 0 }} />
    </button>
  );
}
