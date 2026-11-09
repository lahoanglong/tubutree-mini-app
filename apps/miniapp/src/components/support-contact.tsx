import { useId, useRef } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate, useSnackbar } from 'zmp-ui';
import { Copy, MessageCircle, MessageSquare, Phone } from 'lucide-react';
import { Button } from './ui/button';
import { Text } from './ui/text';
import { DEFAULT_SUPPORT, fetchSupportContact } from '../pages/about-data';
import { callPhone, hasOA, openOAChat } from '../services/zmp-bridge';
import { copyText } from '../utils/clipboard';
import { haptic } from '../utils/haptic';
import { formatPhoneDisplay } from '../utils/phone';
import { useAuthPhase } from '../hooks/use-auth-phase';
import { useLoginWithNotice } from './ui/auth-gate';
import { usePublicConfig } from '../hooks/use-public-config';
import { fillCopy } from '@tubutree/app-core/shop-copy';

/** Khoá đồng bộ cho việc gọi cầu nối: còn một lần chạy thì lần chạm kế bị bỏ, nhả khi cầu nối xong hoặc lỗi. */
export async function once(lock: { current: boolean }, run: () => unknown) {
  if (lock.current) return;
  lock.current = true;
  try {
    await run();
  } finally {
    lock.current = false;
  }
}

/**
 * Kênh liên hệ khi đơn gặp sự cố (không huỷ được, giao sai...). Trước đây chỉ có đúng một dòng "Nhắn Tubu qua Zalo OA"
 * mà OA chưa gắn thì không bấm được, lỗi API cũng chỉ chỉ về Zalo OA. Hotline/email đọc từ cấu hình công khai để admin
 * đổi không cần phát hành lại; kênh nào trống thì ẩn, không có kênh nào thì ẩn cả khối.
 */
export function SupportContact({ orderCode }: { orderCode?: string }) {
  const { openSnackbar } = useSnackbar();
  const navigate = useNavigate();
  const chatOn = usePublicConfig().chat?.enabled === true;
  const phase = useAuthPhase();
  const loggedIn = phase === 'authenticated';
  const login = useLoginWithNotice();
  const titleId = useId();
  const copyingRef = useRef(false);
  const callingRef = useRef(false);
  const openingOaRef = useRef(false);
  const loggingInRef = useRef(false);
  const chatReady = chatOn && loggedIn;
  const supportQ = useQuery({ queryKey: ['support-contact'], queryFn: fetchSupportContact, staleTime: 10 * 60_000 });
  const support = supportQ.isError ? DEFAULT_SUPPORT : supportQ.data;
  if (!support && !hasOA && !chatReady) return null;
  const hotline = support?.hotline ?? null;
  const email = support?.email ?? null;
  if (!hasOA && !hotline && !email && !chatReady) return null;

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
    <div role="region" aria-labelledby={titleId} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8 }}>
      {/* Text chuyển prop còn lại xuống thẻ nhưng TextProps chưa khai `id`; spec "vùng có tên" giữ cho id này không rơi mất. */}
      <Text variant="caption" tone="tertiary" {...{ id: titleId }}>
        {fillCopy('support.title')}
      </Text>
      {chatReady && (
        <Button
          variant="ghost"
          icon={MessageCircle}
          onPress={() => navigate(orderCode ? `/chat?order=${encodeURIComponent(orderCode)}` : '/chat')}
        >
          {fillCopy('support.chat')}
        </Button>
      )}
      {!chatReady && hasOA && (
        <Button
          variant="ghost"
          icon={MessageSquare}
          onPress={() => void once(openingOaRef, () => openOAChat(orderCode ? fillCopy('support.orderContext', { code: orderCode }) : undefined))}
        >
          {fillCopy('support.oa')}
        </Button>
      )}
      {chatOn && phase === 'guest' && (
        <Button variant="ghost" icon={MessageCircle} onPress={() => void once(loggingInRef, login)}>
          {fillCopy('support.chatLogin')}
        </Button>
      )}
      {hotline && (
        <Button variant="ghost" icon={Phone} style={{ fontVariantNumeric: 'tabular-nums' }} onPress={() => void once(callingRef, () => callPhone(hotline))}>
          {fillCopy('support.hotline', { phone: formatPhoneDisplay(hotline) })}
        </Button>
      )}
      {email && (
        <Button variant="ghost" icon={Copy} onPress={() => void once(copyingRef, () => copyEmail(email))}>
          {email}
        </Button>
      )}
    </div>
  );
}
