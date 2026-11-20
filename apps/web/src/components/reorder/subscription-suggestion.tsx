'use client';

// Nguồn: apps/miniapp/src/components/reorder/subscription-suggestion.tsx (cùng chữ, cùng test-id, cùng sự kiện).
import { useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { CalendarClock, ChevronRight } from 'lucide-react';
import { getSubscriptionSuggestions } from '@tubutree/app-core/api/subscriptions';
import { publicConfigQuery } from '@tubutree/app-core/queries/config';
import {
  pickSubscriptionSuggestion,
  readSubscriptionSuggestions,
  subscriptionSuggestionText,
  type SubscriptionSuggestion,
} from '@tubutree/app-core/commerce/green-box';
import { coreHttp } from '@/lib/core-http';
import { useAuthPhase } from '@/lib/auth-phase';
import { trackWebEvent } from '@/lib/analytics';
import { useAutoDismiss } from '@/lib/use-auto-dismiss';
import { SubscribeSheetLazy as SubscribeSheet } from './reorder-sheets-lazy';

const NOTICE_MS = 6000;

/**
 * Gợi ý giao định kỳ (cờ `subscriptions.smart_interval_enabled` ở máy chủ) cho một trong các phân loại `variationIds`, hoặc gợi ý đầu tiên khi không truyền.
 * Chỉ hỏi khi `open` và khách đã đăng nhập; câu có số % nên chờ cấu hình công khai thật, không hiện số mặc định.
 */
export function useSubscriptionSuggestion(open: boolean, variationIds?: readonly string[]): { suggestion: SubscriptionSuggestion | null; discountFraction: number } {
  const authed = useAuthPhase() === 'authenticated';
  const q = useQuery({
    // Dưới khoá ['subscriptions']: tạo, sửa, huỷ gói làm mới khoá đó nên gợi ý cho món vừa có gói biến mất ngay.
    queryKey: ['subscriptions', 'suggestions'],
    queryFn: () => getSubscriptionSuggestions(coreHttp),
    enabled: open && authed,
    staleTime: 5 * 60_000,
    retry: false,
  });
  const cfgQ = useQuery({ ...publicConfigQuery(coreHttp), staleTime: 5 * 60_000, enabled: open && authed });
  const pct = cfgQ.data?.subscribeDiscountPct;
  if (!open || typeof pct !== 'number') return { suggestion: null, discountFraction: 0 };
  return { suggestion: pickSubscriptionSuggestion(readSubscriptionSuggestions(q.data), variationIds), discountFraction: pct };
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
    trackWebEvent('subscription_suggestion_shown', {});
  }, [suggestion.variationId]);
  return (
    <button
      type="button"
      data-testid="subscription-suggestion"
      onClick={() => {
        trackWebEvent('subscription_suggestion_accepted', { intervalWeeks: suggestion.intervalWeeks });
        onAccept(suggestion);
      }}
      className="flex min-h-11 w-full items-center gap-2 rounded-[var(--radius-card)] bg-[var(--color-status-success-bg)] px-3 py-2 text-left text-sm text-success-fg"
    >
      <CalendarClock size={16} aria-hidden="true" className="flex-none" />
      <span className="min-w-0 flex-1">{subscriptionSuggestionText(suggestion, discountFraction)}</span>
      <ChevronRight size={16} aria-hidden="true" className="flex-none" />
    </button>
  );
}

/**
 * Sheet Đặt định kỳ mở từ một gợi ý, chọn sẵn chu kỳ. Sống tới khi sheet đóng và lời báo kết quả (nếu có) tự tắt: nơi mở (sheet Mua lại) đã đóng nên
 * lời báo nằm ở đây, như dải Hoàn tác của giỏ.
 */
export function SuggestedSubscribe({ suggestion, onDone }: { suggestion: SubscriptionSuggestion; onDone: () => void }) {
  const [open, setOpen] = useState(true);
  const [notice, setNotice] = useState<string | null>(null);
  const done = useRef(onDone);
  done.current = onDone;
  const hold = useAutoDismiss(notice !== null, NOTICE_MS, () => setNotice(null), notice);
  useEffect(() => {
    if (!open && notice === null) done.current();
  }, [open, notice]);
  return (
    <>
      {open && (
        <SubscribeSheet
          visible
          onClose={() => setOpen(false)}
          onNotice={setNotice}
          variationId={suggestion.variationId}
          quantity={1}
          initialWeeks={suggestion.intervalWeeks}
        />
      )}
      <div role="status">
        {notice && (
          <p
            data-surface="inverse"
            {...hold}
            className="fixed inset-x-3 bottom-6 z-30 mx-auto max-w-md rounded-control bg-[var(--color-bg-inverse)] px-4 py-2 text-sm text-[color:var(--color-text-inverse)]"
          >
            {notice}
          </p>
        )}
      </div>
    </>
  );
}
