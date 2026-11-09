'use client';

import { supportCopy, type QuickReply } from '@tubutree/app-core/support-copy';
import { Text } from '@/components/mini';

/**
 * Câu hỏi nhanh dưới lời chào; chạm là gửi đúng câu đó. `inPane`: dải nằm trong khung tin (máy tính) nên cùng nền khung,
 * không phải nền trắng của thanh nhập ở đáy điện thoại. `busy` (đang gửi một câu) hoặc `disabled`: mọi chip khoá, nhóm báo `aria-busy` khi bận.
 */
export function QuickReplies({
  items,
  onPick,
  inPane = false,
  disabled = false,
  busy = false,
}: {
  items: QuickReply[];
  onPick: (reply: QuickReply) => void;
  inPane?: boolean;
  disabled?: boolean;
  busy?: boolean;
}) {
  if (items.length === 0) return null;
  const locked = disabled || busy;
  return (
    <div
      role="group"
      aria-label={supportCopy.quickTitle}
      aria-busy={busy || undefined}
      style={{ display: 'flex', flexWrap: 'wrap', gap: 8, padding: '8px 12px 0', background: inPane ? 'transparent' : 'var(--color-bg-surface)' }}
    >
      {items.map((q) => (
        <button
          key={q.label}
          type="button"
          disabled={locked}
          onClick={() => onPick(q)}
          style={{
            minHeight: 44,
            maxWidth: '24rem',
            padding: '6px 12px',
            borderRadius: 'var(--radius-pill)',
            border: '1px solid var(--color-border-subtle)',
            background: 'var(--color-bg-subtle)',
            cursor: locked ? 'not-allowed' : 'pointer',
            opacity: locked ? 0.55 : undefined,
          }}
        >
          <Text variant="body-sm" tone="brand">{q.label}</Text>
        </button>
      ))}
    </div>
  );
}
