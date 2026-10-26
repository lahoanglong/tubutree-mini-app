'use client';

import { supportCopy, type QuickReply } from '@tubutree/app-core/support-copy';
import { Text } from '@/components/mini';

/** Câu hỏi nhanh dưới lời chào; chạm là gửi đúng câu đó. */
export function QuickReplies({ items, onPick }: { items: QuickReply[]; onPick: (reply: QuickReply) => void }) {
  return (
    <div role="group" aria-label={supportCopy.quickTitle} style={{ display: 'flex', flexWrap: 'wrap', gap: 8, padding: '8px 12px 0', background: 'var(--color-bg-surface)' }}>
      {items.map((q) => (
        <button
          key={q.label}
          type="button"
          onClick={() => onPick(q)}
          style={{
            minHeight: 36,
            padding: '6px 12px',
            borderRadius: 'var(--radius-pill)',
            border: '1px solid var(--color-border-subtle)',
            background: 'var(--color-bg-subtle)',
            cursor: 'pointer',
          }}
        >
          <Text variant="body-sm" tone="brand">{q.label}</Text>
        </button>
      ))}
    </div>
  );
}
