import { useEffect, useRef } from 'react';
import type { SupportSender } from '@tubutree/shared-types';
import { Button } from '../ui/button';
import { Text } from '../ui/text';
import { formatDateTime } from '../../utils/format';

export type ChatItemStatus = 'sent' | 'sending' | 'failed' | 'rejected';

export interface ChatItem {
  key: string;
  sender: SupportSender;
  body: string;
  imageUrl: string | null;
  createdAt: string | null;
  status: ChatItemStatus;
  error?: string;
  onRetry?: () => void;
}

const STATUS_LABEL: Record<ChatItemStatus, string> = {
  sent: 'Đã gửi',
  sending: 'Đang gửi',
  failed: 'Chưa gửi được',
  rejected: 'Không gửi được',
};

function Bubble({ item }: { item: ChatItem }) {
  if (item.sender === 'SYSTEM') {
    return (
      <div data-testid={`msg-${item.key}`} data-sender="SYSTEM" style={{ textAlign: 'center', padding: '4px 24px' }}>
        <Text variant="caption" tone="tertiary">{item.body}</Text>
      </div>
    );
  }
  const mine = item.sender === 'CUSTOMER';
  return (
    <div
      data-testid={`msg-${item.key}`}
      data-sender={item.sender}
      style={{ display: 'flex', flexDirection: 'column', alignItems: mine ? 'flex-end' : 'flex-start', gap: 2 }}
    >
      {!mine && <Text variant="caption" tone="tertiary">Tubu Tree</Text>}
      <div
        style={{
          maxWidth: '80%',
          padding: '8px 12px',
          borderRadius: 'var(--radius-card)',
          background: mine ? 'var(--color-action-primary-bg)' : 'var(--color-bg-surface)',
          color: mine ? 'var(--color-action-primary-fg)' : 'var(--color-text-primary)',
          border: mine ? 'none' : '1px solid var(--color-border-subtle)',
          overflowWrap: 'anywhere',
          whiteSpace: 'pre-wrap',
        }}
      >
        {item.imageUrl && (
          <img src={item.imageUrl} alt="Ảnh đã gửi" style={{ display: 'block', maxWidth: '100%', borderRadius: 'var(--radius-control)', marginBottom: item.body ? 6 : 0 }} />
        )}
        {item.body && <Text variant="body-md" tone="primary" style={{ color: 'inherit' }}>{item.body}</Text>}
      </div>
      {mine && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <Text variant="caption" tone={item.status === 'failed' || item.status === 'rejected' ? 'danger' : 'tertiary'}>{STATUS_LABEL[item.status]}</Text>
          {item.createdAt && <Text variant="caption" tone="tertiary">{formatDateTime(item.createdAt)}</Text>}
        </div>
      )}
      {!mine && item.createdAt && <Text variant="caption" tone="tertiary">{formatDateTime(item.createdAt)}</Text>}
      {item.error && <Text variant="caption" tone="danger" as="div">{item.error}</Text>}
      {item.onRetry && (
        <Button variant="ghost" onPress={item.onRetry}>Gửi lại</Button>
      )}
    </div>
  );
}

export function MessageList({ items }: { items: ChatItem[] }) {
  const endRef = useRef<HTMLDivElement>(null);
  const last = items[items.length - 1];
  useEffect(() => {
    endRef.current?.scrollIntoView?.({ block: 'end' });
  }, [items.length, last?.status]);
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10, padding: 12 }}>
      {items.map((it) => (
        <Bubble key={it.key} item={it} />
      ))}
      <div ref={endRef} />
    </div>
  );
}
