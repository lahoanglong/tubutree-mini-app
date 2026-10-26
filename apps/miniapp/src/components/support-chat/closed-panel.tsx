import { useSnackbar } from 'zmp-ui';
import { Copy, MessageSquare, Phone } from 'lucide-react';
import { supportCopy } from '@tubutree/app-core/support-copy';
import { Button } from '../ui/button';
import { Heading, Text } from '../ui/text';
import { callPhone, hasOA, openOAChat } from '../../services/zmp-bridge';
import { copyText } from '../../utils/clipboard';
import { haptic } from '../../utils/haptic';
import { formatPhoneDisplay } from '../../utils/phone';
import type { SupportContact } from '../../pages/about-data';

/** Chat tắt: màn không được trống, khách phải thấy ngay số để gọi (lỗi đọc cấu hình đã rơi về số mặc định ở nơi gọi). */
export function ChatClosedPanel({ support }: { support: SupportContact | undefined }) {
  const { openSnackbar } = useSnackbar();
  const copy = supportCopy.closed;
  const hotline = support?.hotline ?? null;
  const display = hotline ? formatPhoneDisplay(hotline) : '';

  const copyHotline = async () => {
    if (!hotline) return;
    haptic('light');
    const ok = await copyText(display);
    openSnackbar(ok ? { text: copy.copied, type: 'success' } : { text: copy.copyFailed, type: 'error' });
  };

  return (
    <div data-testid="chat-closed" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center', gap: 8, padding: '40px 24px' }}>
      <Heading variant="title-md">{copy.title}</Heading>
      <Text variant="body-md" tone="secondary">{copy.lead}</Text>
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
          <Button
            icon={Phone}
            fullWidth
            onPress={() => {
              haptic('light');
              void callPhone(hotline);
            }}
            style={{ marginTop: 8 }}
          >
            {copy.call(display)}
          </Button>
        </>
      )}
      {support?.hours && <Text variant="body-sm" tone="secondary">{copy.hours(support.hours)}</Text>}
      {support?.zaloOaName &&
        (hasOA ? (
          <Button variant="secondary" icon={MessageSquare} fullWidth onPress={() => void openOAChat()}>
            {copy.oa}
          </Button>
        ) : (
          <Text variant="body-sm" tone="secondary">{copy.oaName(support.zaloOaName)}</Text>
        ))}
      {support?.email && (
        <Button
          variant="ghost"
          icon={Copy}
          onPress={() => {
            haptic('light');
            void copyText(support.email!).then((ok) => openSnackbar(ok ? { text: 'Đã sao chép email hỗ trợ', type: 'success' } : { text: copy.copyFailed, type: 'error' }));
          }}
        >
          {support.email}
        </Button>
      )}
    </div>
  );
}
