import { useEffect, useId, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'zmp-ui';
import { ORDER_CSAT_COPY, orderCsatChatPath, orderCsatNext, showOrderCsat, submitOrderCsat, type OrderCsatAnswer } from '@tubutree/app-core/order-csat';
import type { ReviewLine } from '@tubutree/app-core/order-line-review';
import { Box } from '../ui/box';
import { Button } from '../ui/button';
import { Text } from '../ui/text';
import { usePublicConfig } from '../../hooks/use-public-config';
import { coreHttp } from '../../services/core-http';
import { haptic } from '../../utils/haptic';

export interface OrderCsatCardProps {
  /** `id` để ô viết đánh giá mở đúng lần mua; web có thể thiếu (OrderDetailDTO), khi đó ô chọn đơn nhận sớm nhất. */
  order: { id?: string; code: string; status: string; csatAsk?: boolean; items: readonly ReviewLine[] };
  /** 👎 khi chat chưa mở: trang đưa khách tới khối liên hệ (hotline, Zalo OA). */
  onSupport: () => void;
}

/**
 * "Đơn này thế nào?" ở Chi tiết đơn đã giao: một dòng, hai nút 👍/👎 (luật ở `packages/app-core/src/order-csat.ts`). Chạm là ghi câu trả lời
 * (không chờ máy chủ, lỗi mạng bỏ qua) rồi đi tiếp ngay: ô viết đánh giá, chat kèm mã đơn, hay khối liên hệ. Bản đệm của đơn được đánh dấu đã trả
 * lời để quay lại không hiện lại thẻ; dòng cảm ơn giữ chỗ tới khi rời trang.
 */
export function OrderCsatCard({ order, onSupport }: OrderCsatCardProps) {
  const navigate = useNavigate();
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
    haptic('light');
    void submitOrderCsat(coreHttp, order.code, a, 'miniapp').catch(() => undefined);
    qc.setQueryData<{ csatAsk?: boolean }>(['order', order.code], (old) => (old ? { ...old, csatAsk: false } : old));
    const next = orderCsatNext(a, order, chatReady);
    // Nút vừa chạm biến mất: chỉ dời focus vào dòng cảm ơn khi khách ở lại trang và không có khối nào khác nhận focus.
    focusThanks.current = next.kind === 'thanks';
    setThanks(next.kind === 'support' ? ORDER_CSAT_COPY.thanksDown : ORDER_CSAT_COPY.thanksUp);
    if (next.kind === 'review') navigate(`/product/${next.slug}`, { state: { reviewOrderId: order.id } });
    else if (next.kind === 'chat') navigate(orderCsatChatPath('miniapp', order.code));
    else if (next.kind === 'support') onSupport();
  };

  return (
    <Box p={4} mt={2} data-testid="order-csat" style={{ background: 'var(--color-bg-surface)' }}>
      {thanks === null && (
        <Box flex alignItems="center" justifyContent="space-between" role="group" aria-labelledby={titleId} style={{ gap: 'var(--space-inline-sm)' }}>
          <Text variant="body-sm" as="div" style={{ fontWeight: 600 }} {...{ id: titleId }}>
            {ORDER_CSAT_COPY.title}
          </Text>
          <Box flex style={{ gap: 'var(--space-inline-sm)', flex: '0 0 auto' }}>
            <Button variant="secondary" aria-label={ORDER_CSAT_COPY.up} onPress={() => answer('up')}>
              👍
            </Button>
            <Button variant="secondary" aria-label={ORDER_CSAT_COPY.down} onPress={() => answer('down')}>
              👎
            </Button>
          </Box>
        </Box>
      )}
      <div ref={thanksRef} role="status" tabIndex={-1} style={{ outline: 'none' }}>
        {thanks && (
          <Text variant="body-sm" tone="secondary" as="div">
            {thanks}
          </Text>
        )}
      </div>
    </Box>
  );
}
