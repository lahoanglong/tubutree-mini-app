'use client';

import { useRef, useState } from 'react';
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
  // `n` đếm số lần báo: cùng một chữ lặp lại (hai lần thất bại liền) vẫn dựng lại nút thông báo để trình đọc màn hình đọc lại.
  const [feedback, setFeedback] = useState<{ text: string; ok: boolean; n: number } | null>(null);
  const [more, setMore] = useState(false);
  const hotline = support?.hotline ?? null;
  const display = hotline ? formatPhoneDisplay(hotline) : '';
  const hasOA = platformBridge.oa.available;

  // Khoá đồng bộ: Promise sao chép còn treo thì cú bấm thứ hai (số hoặc email) bị bỏ.
  const copyingRef = useRef(false);
  const copyWith = async (value: string, okText: string) => {
    if (copyingRef.current) return;
    copyingRef.current = true;
    try {
      const ok = await copyText(value);
      setFeedback((prev) => ({ text: ok ? okText : copy.copyFailed, ok, n: (prev?.n ?? 0) + 1 }));
    } finally {
      copyingRef.current = false;
    }
  };

  const callLink = hotline && (
    <a
      href={`tel:${hotline.replace(/[^\d+]/g, '')}`}
      className="zaui-btn zaui-btn-primary zaui-btn-prefix-icon tubu-btn"
      style={{ minHeight: 44, width: '100%', borderRadius: 'var(--radius-control)', fontWeight: 600, marginTop: 8, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}
    >
      <Phone size={16} aria-hidden />
      {copy.call(display)}
    </a>
  );
  const oaNode =
    support?.zaloOaName &&
    (hasOA ? (
      <Button variant="secondary" icon={MessageSquare} fullWidth onPress={() => void platformBridge.oa.openChat()}>
        {copy.oa}
      </Button>
    ) : (
      <Text variant="body-sm" tone="secondary">{copy.oaName(support.zaloOaName)}</Text>
    ));
  const emailNode = support?.email && (
    <Button variant="ghost" icon={Copy} onPress={() => void copyWith(support.email!, 'Đã sao chép email hỗ trợ')}>
      {support.email}
    </Button>
  );
  const status = (
    <div style={{ minHeight: compact ? 0 : 18 }}>
      <div role="status" aria-live="polite">
        {feedback?.ok && <Text key={feedback.n} variant="caption" tone="secondary">{feedback.text}</Text>}
      </div>
      {feedback && !feedback.ok && (
        <div role="alert" key={feedback.n}>
          <Text variant="caption" tone="danger">{feedback.text}</Text>
        </div>
      )}
    </div>
  );

  if (compact) {
    const hasMore = !!(oaNode || emailNode);
    return (
      <div data-testid="chat-closed" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center', gap: 4, padding: '12px 16px' }}>
        <Heading variant="title-sm">{copy.title}</Heading>
        {support?.hours && <Text variant="caption" tone="secondary">{copy.hours(support.hours)}</Text>}
        {callLink}
        {hasMore && (
          <Button variant="ghost" aria-expanded={more} onPress={() => setMore((v) => !v)}>
            {more ? copy.less : copy.more}
          </Button>
        )}
        {more && oaNode}
        {more && emailNode}
        {status}
      </div>
    );
  }

  return (
    <div data-testid="chat-closed" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center', gap: 8, padding: '40px 24px' }}>
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
            <Heading variant="display-md" tone="brand" style={{ fontVariantNumeric: 'tabular-nums' }}>{display}</Heading>
          </button>
          <Text variant="caption" tone="tertiary">{copy.tapToCopy}</Text>
          {callLink}
        </>
      )}
      {support?.hours && <Text variant="body-sm" tone="secondary">{copy.hours(support.hours)}</Text>}
      {oaNode}
      {emailNode}
      {status}
    </div>
  );
}
