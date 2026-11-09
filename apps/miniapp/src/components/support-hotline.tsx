import { useContext, useRef } from 'react';
import { QueryClientContext, useQuery } from '@tanstack/react-query';
import { Phone } from 'lucide-react';
import { Button } from './ui/button';
import { Text } from './ui/text';
import { DEFAULT_SUPPORT, fetchSupportContact } from '../pages/about-data';
import { callPhone } from '../services/zmp-bridge';
import { haptic } from '../utils/haptic';
import { formatPhoneDisplay } from '../utils/phone';
import { vi } from '../i18n/vi';

/**
 * "Cần hỗ trợ? Gọi <hotline>" cho màn lỗi: số đọc từ cấu hình công khai (cùng query với SupportContact và trang Về Tubu),
 * lỗi cấu hình thì dùng số mặc định; không có số nào thì ẩn. Màn lỗi nằm ở khắp nơi, kể cả chỗ dựng không có
 * QueryClientProvider (test đơn lẻ) — khi đó chỉ ẩn dòng này, không làm vỡ cả màn lỗi.
 */
export function SupportHotline() {
  return useContext(QueryClientContext) ? <HotlineLine /> : null;
}

function HotlineLine() {
  const q = useQuery({ queryKey: ['support-contact'], queryFn: fetchSupportContact, staleTime: 10 * 60_000 });
  // Khoá đồng bộ: cầu nối gọi điện còn chạy thì cú chạm kế bị bỏ, khỏi mở hai cuộc gọi.
  const callingRef = useRef(false);
  const hotline = (q.isError ? DEFAULT_SUPPORT : q.data)?.hotline;
  if (!hotline) return null;
  const call = async () => {
    if (callingRef.current) return;
    callingRef.current = true;
    try {
      haptic('light');
      await callPhone(hotline);
    } finally {
      callingRef.current = false;
    }
  };
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', flexWrap: 'wrap', gap: 4 }}>
      <Text variant="caption" tone="tertiary">
        {vi.errors.needHelp}
      </Text>
      <Button
        variant="ghost"
        icon={Phone}
        style={{ whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums' }}
        onPress={() => void call()}
      >
        {vi.errors.callHotline(formatPhoneDisplay(hotline))}
      </Button>
    </div>
  );
}
