import { lazy, Suspense, useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { CalendarClock, ChevronRight } from 'lucide-react';
import { getSubscriptionSuggestions } from '@tubutree/app-core/api/subscriptions';
import {
  pickSubscriptionSuggestion,
  readSubscriptionSuggestions,
  subscriptionSuggestionText,
  type SubscriptionSuggestion,
} from '@tubutree/app-core/commerce/green-box';
import { useAuthPhase } from '../../hooks/use-auth-phase';
import { usePublicConfig } from '../../hooks/use-public-config';
import { trackEvent } from '../../services/analytics';
import { coreHttp } from '../../services/core-http';
import { SUBSCRIPTIONS_IN_MINIAPP } from '../../utils/features';
import { Icon } from '../ui/icon';
import { Text } from '../ui/text';

// Sheet Đặt định kỳ chỉ cần khi khách chạm gợi ý: tải lười để sheet Mua lại và tab Định kỳ không gánh nó.
const SubscribeSheet = lazy(() => import('../subscribe-sheet').then((m) => ({ default: m.SubscribeSheet })));

const SHEET_CLOSE_MS = 250;

const ROW_STYLE = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'flex-start',
  gap: 'var(--space-inline-sm)',
  width: '100%',
  padding: 'var(--space-stack-xs) var(--space-inline-md)',
  border: 'none',
  borderRadius: 'var(--radius-card)',
  background: 'var(--color-status-success-bg)',
  color: 'var(--color-text-success)',
  textAlign: 'left',
  fontFamily: 'inherit',
  cursor: 'pointer',
} as const;

/**
 * Gợi ý giao định kỳ (cờ `subscriptions.smart_interval_enabled` ở máy chủ) cho một trong các phân loại `variationIds`, hoặc gợi ý đầu tiên khi không truyền.
 * Chỉ hỏi khi `open`, khách đã đăng nhập và Mini App cho tạo gói; câu có số % nên chờ cấu hình công khai thật, không hiện số mặc định.
 * Cùng web `apps/web/src/components/reorder/subscription-suggestion.tsx` (cùng chữ, cùng test-id, cùng sự kiện).
 */
export function useSubscriptionSuggestion(open: boolean, variationIds?: readonly string[]): { suggestion: SubscriptionSuggestion | null; discountFraction: number } {
  const authed = useAuthPhase() === 'authenticated';
  const on = open && SUBSCRIPTIONS_IN_MINIAPP && authed;
  const q = useQuery({
    // Dưới khoá ['subscriptions']: tạo, sửa, huỷ gói làm mới khoá đó nên gợi ý cho món vừa có gói biến mất ngay.
    queryKey: ['subscriptions', 'suggestions'],
    queryFn: () => getSubscriptionSuggestions(coreHttp),
    enabled: on,
    staleTime: 5 * 60_000,
    retry: false,
  });
  const cfg = usePublicConfig();
  // `resolvePublicConfig` không bù số này từ mặc định: API thiếu số thì không có câu "giảm …%".
  if (!on || !cfg.isLoaded || typeof cfg.subscribeDiscountPct !== 'number') return { suggestion: null, discountFraction: 0 };
  return { suggestion: pickSubscriptionSuggestion(readSubscriptionSuggestions(q.data), variationIds), discountFraction: cfg.subscribeDiscountPct };
}

/** Một dòng chạm được: "Bạn thường mua … Đặt giao định kỳ, giảm {pct}%". Báo `subscription_suggestion_shown` mỗi lần một gợi ý mới hiện. */
export function SubscriptionSuggestionRow({
  suggestion,
  discountFraction,
  onAccept,
}: {
  suggestion: SubscriptionSuggestion;
  discountFraction: number;
  onAccept: (s: SubscriptionSuggestion) => void;
}) {
  useEffect(() => {
    trackEvent('subscription_suggestion_shown', 'miniapp', {});
  }, [suggestion.variationId]);
  return (
    <button
      type="button"
      data-testid="subscription-suggestion"
      className="tubu-press touch-target"
      onClick={() => {
        trackEvent('subscription_suggestion_accepted', 'miniapp', { intervalWeeks: suggestion.intervalWeeks });
        onAccept(suggestion);
      }}
      style={ROW_STYLE}
    >
      <Icon icon={CalendarClock} size="sm" tone="current" style={{ flex: 'none' }} />
      <Text variant="body-sm" as="span" numeric style={{ flex: 1, minWidth: 0, color: 'inherit' }}>
        {subscriptionSuggestionText(suggestion, discountFraction)}
      </Text>
      <Icon icon={ChevronRight} size="sm" tone="current" style={{ flex: 'none' }} />
    </button>
  );
}

/**
 * Sheet Đặt định kỳ mở từ một gợi ý, chọn sẵn chu kỳ. Nơi mở (sheet Mua lại) đã đóng nên sheet sống ở cha, tới khi khách đóng hay tạo xong
 * (SubscribeSheet tự báo kết quả bằng snackbar).
 */
export function SuggestedSubscribe({ suggestion, onDone }: { suggestion: SubscriptionSuggestion; onDone: () => void }) {
  const [open, setOpen] = useState(true);
  // Đóng thì giữ sheet dựng thêm một nhịp cho ZaUI chạy hết hiệu ứng trượt xuống (200ms, xem bottom-sheet.tsx) rồi mới để cha gỡ.
  useEffect(() => {
    if (open) return;
    const t = setTimeout(onDone, SHEET_CLOSE_MS);
    return () => clearTimeout(t);
  }, [open, onDone]);
  return (
    <Suspense fallback={null}>
      <SubscribeSheet visible={open} onClose={() => setOpen(false)} variationId={suggestion.variationId} quantity={1} initialWeeks={suggestion.intervalWeeks} />
    </Suspense>
  );
}
