'use client';

import { useState } from 'react';
import { Copy, MessageSquare, Phone } from 'lucide-react';
import { supportCopy } from '@tubutree/app-core/support-copy';
import type { SupportContact } from '@tubutree/app-core/api/config';
import { Button, Heading, Text } from '@/components/mini';
import { copyText } from '@/lib/copy-text';
import { formatPhoneDisplay } from '@/lib/phone-display';
import { platformBridge } from '@/lib/platform-bridge';

/** Chat tắt: cùng nội dung với Mini App, khách thấy ngay số để gọi (lỗi đọc cấu hình đã rơi về số mặc định ở nơi gọi). */
export function ChatClosedPanel({ support, compact = false }: { support: SupportContact | undefined; compact?: boolean }) {
  const copy = supportCopy.closed;
  const [feedback, setFeedback] = useState<string | null>(null);
  const hotline = support?.hotline ?? null;
  const display = hotline ? formatPhoneDisplay(hotline) : '';
  const hasOA = platformBridge.oa.available;

  const copyWith = async (value: string, okText: string) => {
    setFeedback((await copyText(value)) ? okText : copy.copyFailed);
  };

  return (
    <div data-testid="chat-closed" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center', gap: 8, padding: compact ? '16px 24px' : '40px 24px' }}>
      <Heading variant="title-md">{copy.title}</Heading>
      <Text variant="body-md" tone="secondary">{copy.lead(!!hotline)}</Text>
      {hotline && (
        <>
          <button
            type="button"
            onClick={() => void copyWith(display, copy.copied)}
            aria-label={`${display}. ${copy.tapToCopy}`}
            style={{ background: 'none', border: 0, padding: '8px 12px', marginTop: 8, cursor: 'pointer', minHeight: 44 }}
          >
            <Heading variant="display-md" tone="brand">{display}</Heading>
          </button>
          <Text variant="caption" tone="tertiary">{copy.tapToCopy}</Text>
          <a
            href={`tel:${hotline.replace(/[^\d+]/g, '')}`}
            className="zaui-btn zaui-btn-primary zaui-btn-prefix-icon tubu-btn"
            style={{ minHeight: 44, width: '100%', borderRadius: 'var(--radius-control)', fontWeight: 600, marginTop: 8, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}
          >
            <Phone size={16} aria-hidden />
            {copy.call(display)}
          </a>
        </>
      )}
      {support?.hours && <Text variant="body-sm" tone="secondary">{copy.hours(support.hours)}</Text>}
      {support?.zaloOaName &&
        (hasOA ? (
          <Button variant="secondary" icon={MessageSquare} fullWidth onPress={() => void platformBridge.oa.openChat()}>
            {copy.oa}
          </Button>
        ) : (
          <Text variant="body-sm" tone="secondary">{copy.oaName(support.zaloOaName)}</Text>
        ))}
      {support?.email && (
        <Button variant="ghost" icon={Copy} onPress={() => void copyWith(support.email!, 'Đã sao chép email hỗ trợ')}>
          {support.email}
        </Button>
      )}
      <div role="status" aria-live="polite" style={{ minHeight: 18 }}>
        {feedback && <Text variant="caption" tone="secondary">{feedback}</Text>}
      </div>
    </div>
  );
}
