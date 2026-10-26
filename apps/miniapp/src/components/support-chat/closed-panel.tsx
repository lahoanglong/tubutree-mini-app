import { useSnackbar } from 'zmp-ui';
import { useState, type ReactNode } from 'react';
import { Copy, MessageSquare, Phone, type LucideIcon } from 'lucide-react';
import { supportCopy } from '@tubutree/app-core/support-copy';
import { Button } from '../ui/button';
import { Icon } from '../ui/icon';
import { Heading, Text } from '../ui/text';
import { callPhone, hasOA, openOAChat } from '../../services/zmp-bridge';
import { copyText } from '../../utils/clipboard';
import { haptic } from '../../utils/haptic';
import { formatPhoneDisplay } from '../../utils/phone';
import type { SupportContact } from '../../pages/about-data';

/** Biểu tượng nằm trong nhãn thay vì prefixIcon của ZaUI: ZaUI đặt biểu tượng cao và xa chữ hơn bản web (cùng khung 24px + lề 8px). */
function WithIcon({ icon, tone, gap = 12, children }: { icon: LucideIcon; tone: 'brand' | 'inverse'; gap?: number; children: ReactNode }) {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap }}>
      <Icon icon={icon} size="sm" tone={tone} />
      {children}
    </span>
  );
}

/**
 * Chat tắt: màn không được trống, khách phải thấy ngay số để gọi (lỗi đọc cấu hình đã rơi về số mặc định ở nơi gọi).
 * `compact` dùng khi chat tắt mà còn lịch sử: nằm dưới danh sách thay cho ô nhập.
 */
export function ChatClosedPanel({ support, compact = false }: { support: SupportContact | undefined; compact?: boolean }) {
  const { openSnackbar } = useSnackbar();
  const [more, setMore] = useState(false);
  const copy = supportCopy.closed;
  const hotline = support?.hotline ?? null;
  const display = hotline ? formatPhoneDisplay(hotline) : '';

  const copyHotline = async () => {
    if (!hotline) return;
    haptic('light');
    const ok = await copyText(display);
    openSnackbar(ok ? { text: copy.copied, type: 'success' } : { text: copy.copyFailed, type: 'error' });
  };

  const callButton = hotline && (
    <Button
      aria-label={copy.call(display)}
      fullWidth
      onPress={() => {
        haptic('light');
        void callPhone(hotline);
      }}
      style={{ marginTop: 8 }}
    >
      <WithIcon icon={Phone} tone="inverse" gap={8}>{copy.call(display)}</WithIcon>
    </Button>
  );
  const oaNode =
    support?.zaloOaName &&
    (hasOA ? (
      <Button variant="secondary" aria-label={copy.oa} fullWidth onPress={() => void openOAChat()}>
        <WithIcon icon={MessageSquare} tone="brand">{copy.oa}</WithIcon>
      </Button>
    ) : (
      <Text variant="body-sm" tone="secondary">{copy.oaName(support.zaloOaName)}</Text>
    ));
  const emailNode = support?.email && (
    <Button
      variant="ghost"
      aria-label={support.email}
      onPress={() => {
        haptic('light');
        void copyText(support.email!).then((ok) => openSnackbar(ok ? { text: 'Đã sao chép email hỗ trợ', type: 'success' } : { text: copy.copyFailed, type: 'error' }));
      }}
    >
      <WithIcon icon={Copy} tone="brand">{support.email}</WithIcon>
    </Button>
  );

  if (compact) {
    const hasMore = !!(oaNode || emailNode);
    return (
      <div data-testid="chat-closed" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center', gap: 4, padding: '12px 16px' }}>
        <Heading variant="title-sm">{copy.title}</Heading>
        {support?.hours && <Text variant="caption" tone="secondary">{copy.hours(support.hours)}</Text>}
        {callButton}
        {hasMore && (
          <Button variant="ghost" aria-expanded={more} onPress={() => setMore((v) => !v)}>
            {more ? copy.less : copy.more}
          </Button>
        )}
        {more && oaNode}
        {more && emailNode}
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
            onClick={() => void copyHotline()}
            aria-label={`${display}. ${copy.tapToCopy}`}
            style={{ background: 'none', border: 0, padding: '8px 12px', marginTop: 8, cursor: 'pointer', minHeight: 44 }}
          >
            <Heading variant="display-md" tone="brand">{display}</Heading>
          </button>
          <Text variant="caption" tone="tertiary">{copy.tapToCopy}</Text>
          {callButton}
        </>
      )}
      {support?.hours && <Text variant="body-sm" tone="secondary">{copy.hours(support.hours)}</Text>}
      {oaNode}
      {emailNode}
    </div>
  );
}
