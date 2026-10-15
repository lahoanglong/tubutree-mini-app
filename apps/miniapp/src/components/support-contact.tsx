import { useQuery } from '@tanstack/react-query';
import { useSnackbar } from 'zmp-ui';
import { Copy, MessageSquare, Phone } from 'lucide-react';
import { Button } from './ui/button';
import { Text } from './ui/text';
import { DEFAULT_SUPPORT, fetchSupportContact } from '../pages/about-data';
import { callPhone, hasOA, openOAChat } from '../services/zmp-bridge';
import { copyText } from '../utils/clipboard';
import { haptic } from '../utils/haptic';
import { formatPhoneDisplay } from '../utils/phone';
import { vi } from '../i18n/vi';

/**
 * Kênh liên hệ khi đơn gặp sự cố (không huỷ được, giao sai...). Trước đây chỉ có đúng một dòng "Nhắn Tubu qua Zalo OA"
 * mà OA chưa gắn thì không bấm được, lỗi API cũng chỉ chỉ về Zalo OA. Hotline/email đọc từ cấu hình công khai để admin
 * đổi không cần phát hành lại; kênh nào trống thì ẩn, không có kênh nào thì ẩn cả khối.
 */
export function SupportContact({ orderCode }: { orderCode?: string }) {
  const { openSnackbar } = useSnackbar();
  const supportQ = useQuery({ queryKey: ['support-contact'], queryFn: fetchSupportContact, staleTime: 10 * 60_000 });
  const support = supportQ.isError ? DEFAULT_SUPPORT : supportQ.data;
  if (!support && !hasOA) return null;
  const hotline = support?.hotline ?? null;
  const email = support?.email ?? null;
  if (!hasOA && !hotline && !email) return null;

  const copyEmail = async (value: string) => {
    haptic('light');
    const ok = await copyText(value);
    openSnackbar(
      ok
        ? { text: 'Đã sao chép email hỗ trợ', type: 'success' }
        : { text: 'Không sao chép được — hãy chọn và chép thủ công.', type: 'error' },
    );
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8 }}>
      <Text variant="caption" tone="tertiary">{vi.orders.support}</Text>
      {hasOA && (
        <Button
          variant="ghost"
          icon={MessageSquare}
          onPress={() => void openOAChat(orderCode ? `Hỗ trợ đơn ${orderCode}` : undefined)}
        >
          Nhắn Zalo OA
        </Button>
      )}
      {hotline && (
        <Button variant="ghost" icon={Phone} onPress={() => void callPhone(hotline)}>
          {`Gọi hotline ${formatPhoneDisplay(hotline)}`}
        </Button>
      )}
      {email && (
        <Button variant="ghost" icon={Copy} onPress={() => void copyEmail(email)}>
          {email}
        </Button>
      )}
    </div>
  );
}
