'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useQueryClient } from '@tanstack/react-query';
import { ORDER_CSAT_COPY, orderCsatChatPath, orderCsatNext, showOrderCsat, submitOrderCsat, type OrderCsatAnswer } from '@tubutree/app-core/order-csat';
import type { ReviewLine } from '@tubutree/app-core/order-line-review';
import { Button, Text } from '@/components/mini';
import { coreHttp } from '@/lib/core-http';
import { reviewHref } from '@/lib/reviews-client';
import { usePublicConfig } from '@/lib/use-public-config';

export interface OrderCsatCardProps {
  /** `id` để ô viết đánh giá mở đúng lần mua; web có thể thiếu (OrderDetailDTO), khi đó ô chọn đơn nhận sớm nhất. */
  order: { id?: string; code: string; status: string; csatAsk?: boolean; items: readonly ReviewLine[] };
  /** 👎 khi chat chưa mở: trang đưa khách tới khối liên hệ (hotline, Zalo OA). */
  onSupport: () => void;
  className?: string;
}

/**
 * "Đơn này thế nào?" ở Chi tiết đơn đã giao, cùng thẻ với Mini App (`apps/miniapp/src/components/orders/order-csat-card.tsx`, luật ở
 * `packages/app-core/src/order-csat.ts`). Chạm là ghi câu trả lời (không chờ máy chủ, lỗi mạng bỏ qua) rồi đi tiếp ngay: ô viết đánh giá, chat kèm mã
 * đơn, hay khối liên hệ. Bản đệm của đơn được đánh dấu đã trả lời để quay lại không hiện lại thẻ; dòng cảm ơn giữ chỗ tới khi rời trang.
 */
export function OrderCsatCard({ order, onSupport, className }: OrderCsatCardProps) {
  const router = useRouter();
  const qc = useQueryClient();
  const chatReady = usePublicConfig().chat?.enabled === true;
  const titleId = useId();
  const [thanks, setThanks] = useState<string | null>(null);
  const answered = useRef(false);
  const thanksRef = useRef<HTMLDivElement>(null);
  const focusThanks = useRef(false);
  useEffect(() => {
    if (thanks && focusThanks.current) thanksRef.current?.focus();
  }, [thanks]);
  if (thanks === null && !showOrderCsat(order)) return null;

  const answer = (a: OrderCsatAnswer) => {
    if (answered.current) return;
    answered.current = true;
    void submitOrderCsat(coreHttp, order.code, a, 'web').catch(() => undefined);
    qc.setQueryData<{ csatAsk?: boolean }>(['order', order.code], (old) => (old ? { ...old, csatAsk: false } : old));
    const next = orderCsatNext(a, order, chatReady);
    // Nút vừa chạm biến mất: chỉ dời focus vào dòng cảm ơn khi khách ở lại trang và không có khối nào khác nhận focus.
    focusThanks.current = next.kind === 'thanks';
    setThanks(next.kind === 'support' ? ORDER_CSAT_COPY.thanksDown : ORDER_CSAT_COPY.thanksUp);
    if (next.kind === 'review') router.push(reviewHref(next.slug, order.id));
    else if (next.kind === 'chat') router.push(orderCsatChatPath('web', order.code));
    else if (next.kind === 'support') onSupport();
  };

  return (
    <div data-testid="order-csat" className={className}>
      {thanks === null && (
        <div role="group" aria-labelledby={titleId} className="flex items-center justify-between gap-[var(--space-inline-sm)]">
          <Text variant="body-sm" as="div" style={{ fontWeight: 600 }} {...{ id: titleId }}>
            {ORDER_CSAT_COPY.title}
          </Text>
          <div className="flex flex-none gap-[var(--space-inline-sm)]">
            <Button variant="secondary" aria-label={ORDER_CSAT_COPY.up} onPress={() => answer('up')}>
              👍
            </Button>
            <Button variant="secondary" aria-label={ORDER_CSAT_COPY.down} onPress={() => answer('down')}>
              👎
            </Button>
          </div>
        </div>
      )}
      <div ref={thanksRef} role="status" tabIndex={-1} className="outline-none">
        {thanks && (
          <Text variant="body-sm" tone="secondary" as="div">
            {thanks}
          </Text>
        )}
      </div>
    </div>
  );
}
