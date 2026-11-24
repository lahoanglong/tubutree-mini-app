'use client';

import { useState } from 'react';
import { MessageSquare } from 'lucide-react';
import { copyText } from '@/lib/copy-text';
import { ui } from '@/lib/guest-ui';
import { guestCopy } from '@/lib/guest-checkout/copy';
import { guestSupportHandoff } from '@/lib/guest-checkout/support';
import { zaloOaChatUrl } from '@/lib/platform-bridge';
import { usePublicConfig } from '@/lib/use-public-config';

/**
 * "Nhắn Zalo cho Tubu về đơn này" của trang tra cứu và trang theo dõi đơn khách: một chạm mở chat Zalo của Tubu ở thẻ mới và chép sẵn
 * "Hỗ trợ đơn <mã>" để khách dán (web không điền sẵn được tin nhắn Zalo). Liên kết thật (`<a target="_blank">`), không `window.open` sau khi chép
 * xong: trình duyệt chặn thẻ mới mở ngoài cú chạm. Chép bắt đầu trong lúc xử lý cú chạm, trước khi trang mất focus cho thẻ mới. Câu báo kết quả
 * giữ nguyên tới khi khách quay lại trang; chép không được thì đọc mã đơn cho khách gõ.
 */
export function GuestSupportLink({ code, className = '' }: { code: string; className?: string }) {
  const zaloPhone = usePublicConfig().tubuZaloPhone;
  const handoff = guestSupportHandoff(code, { oaUrl: zaloOaChatUrl(), zaloPhone });
  const [copied, setCopied] = useState<boolean | null>(null);

  const onOpen = () => {
    if (handoff.message) void copyText(handoff.message).then(setCopied);
  };

  return (
    <div className={className}>
      <a
        href={handoff.href}
        target="_blank"
        rel="noopener noreferrer"
        onClick={onOpen}
        data-testid="guest-support-zalo"
        className={`${ui.btnSecondary} w-full gap-2`}
      >
        <MessageSquare size={16} aria-hidden="true" />
        {guestCopy('supportZalo')}
      </a>
      <p aria-live="polite" data-testid="guest-support-note" className={copied === null ? 'sr-only' : 'mt-1 text-caption text-[color:var(--color-text-secondary)]'}>
        {copied === true && handoff.message
          ? guestCopy('supportCopied', { text: handoff.message })
          : copied === false
            ? guestCopy('supportCopyFailed', { code: code.trim().toUpperCase() })
            : ''}
      </p>
    </div>
  );
}
